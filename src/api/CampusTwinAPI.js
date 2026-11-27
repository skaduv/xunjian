import * as THREE from 'three';
import { SECURITY_GROUPS } from '../config/campusConfig.js';

/**
 * 统一对外暴露的 window.CampusTwin 外部控制 API
 * 面向第二、三阶段「AI 智能安全巡检工作台」，无需改动 3D 建模代码即可完成全部业务联动：
 * - getCatalog()
 * - flyToCamera(cameraId, options)
 * - flyToGroup(groupId, options)
 * - resetView(options)
 * - setExploded(enabled)
 * - setLayerVisible(layerName, visible)
 * - setSafetyZoneFilter(types)
 * - setCameraState(cameraId, state)
 * - setNvrOffline(nvrId, isOffline)
 * - setLightingMode('day' | 'dusk' | 'night')
 * - getScreenPosition(cameraId | groupId | {x,y,z})
 * - highlightGroup(groupId | null)  选中楼栋发光描边 + 定位气泡（getScreenPosition(groupId) 返回气泡屏幕坐标，供 HUD 信息卡跟随）
 */

export function createCampusTwinAPI({
  studio,
  architecture,
  landscapeRoot,
  cameraLayer,
  safetyZonesLayer,
  highlightLayer,
}) {
  const layerMap = {
    cameras: cameraLayer.camerasGroup,
    cameraFov: cameraLayer.fovGroup,
    safetyZones: safetyZonesLayer.group,
    architecture: architecture.root,
    landscape: landscapeRoot,
  };

  const api = {
    version: '1.0.0',

    getCatalog() {
      const { cameras, nvrs, explodeFactor } = cameraLayer.getCatalogSnapshot();
      const safetyZones = safetyZonesLayer.getCatalogSnapshot();
      const groups = SECURITY_GROUPS.map((g) => ({
        ...g,
        cameraIds: cameras.filter((c) => c.groupId === g.id).map((c) => c.id),
      }));

      return {
        campus: {
          name: '长三角物理研究中心（IOPLY）',
          address: '江苏省常州市溧阳市中关村大道 1 号',
          grossFloorAreaSqm: 52298,
          floorsAboveGround: 3,
          floorsBelowGround: 1,
          corniceHeightM: 14.4,
          architects: ['Kengo Kuma & Associates (KKAA)', '浙江大学建筑设计研究院 (UAD)'],
        },
        groups,
        nvrs,
        cameras,
        safetyZones,
        layers: {
          cameras: layerMap.cameras.visible,
          cameraFov: layerMap.cameraFov.visible,
          safetyZones: layerMap.safetyZones.visible,
          architecture: layerMap.architecture.visible,
          landscape: layerMap.landscape.visible,
        },
        state: {
          exploded: architecture.isExploded(),
          explodeFactor: Number(explodeFactor.toFixed(4)),
          lightingMode: studio.lightingMode,
          safetyZoneFilter: safetyZonesLayer.getFilter(),
        },
      };
    },

    flyToCamera(cameraId, options = {}) {
      const entry = cameraLayer.getCameraEntry(cameraId);
      if (!entry) return false;
      const targetPos = cameraLayer.getCameraWorldPosition(cameraId);
      const offsetArr = options.offset || entry.config.viewOffset || [-44, 38, 52];
      const scale = typeof options.distanceScale === 'number' ? options.distanceScale : 1;
      const camPos = new THREE.Vector3(
        targetPos.x + offsetArr[0] * scale,
        Math.max(8, targetPos.y + offsetArr[1] * scale),
        targetPos.z + offsetArr[2] * scale
      );
      studio.flyTo(camPos, targetPos, options.duration ?? 950);
      return true;
    },

    flyToGroup(groupId, options = {}) {
      const grp = SECURITY_GROUPS.find((g) => g.id === groupId);
      if (!grp) return false;
      const target = new THREE.Vector3(...grp.focus.pos);
      const off = grp.focus.viewOffset;
      const scale = typeof options.distanceScale === 'number' ? options.distanceScale : 1;
      const camPos = new THREE.Vector3(
        target.x + off[0] * scale,
        target.y + off[1] * scale,
        target.z + off[2] * scale
      );
      studio.flyTo(camPos, target, options.duration ?? 950);
      return true;
    },

    highlightGroup(groupId, options = {}) {
      const active = highlightLayer ? highlightLayer.setHighlight(groupId || null) : null;
      if (active && options.fly) api.flyToGroup(active, options);
      studio.wake(600);
      return active;
    },

    getHighlightedGroup() {
      return highlightLayer ? highlightLayer.getHighlight() : null;
    },

    resetView(options = {}) {
      studio.resetView(options.duration ?? 950);
      return true;
    },

    setExploded(enabled) {
      architecture.setExploded(Boolean(enabled));
      studio.markShadowsDirty();
      studio.wake(1800);
      return architecture.isExploded();
    },

    setLayerVisible(layerName, visible) {
      const target = layerMap[layerName];
      if (!target) return false;
      target.visible = Boolean(visible);
      studio.markShadowsDirty();
      studio.wake(600);
      return target.visible;
    },

    setSafetyZoneFilter(types) {
      studio.wake(400);
      return safetyZonesLayer.setFilter(types);
    },

    setCameraState(cameraId, state) {
      studio.wake(1200);
      return cameraLayer.setCameraState(cameraId, state);
    },

    setNvrOffline(nvrId, isOffline) {
      studio.wake(1200);
      return cameraLayer.setNvrOffline(nvrId, Boolean(isOffline));
    },

    getPerfStats() {
      return studio.getPerfStats();
    },

    setLightingMode(mode, options) {
      const normalized = mode === 'night' ? 'night' : mode === 'dusk' ? 'dusk' : 'day';
      studio.setLightingMode(normalized, options);
      return normalized;
    },

    getScreenPosition(targetIdOrVec) {
      let worldPos = null;
      if (typeof targetIdOrVec === 'string') {
        worldPos =
          cameraLayer.getCameraWorldPosition(targetIdOrVec) ||
          safetyZonesLayer.getZoneCenter(targetIdOrVec) ||
          highlightLayer?.getAnchor(targetIdOrVec) ||
          null;
      } else if (targetIdOrVec && typeof targetIdOrVec === 'object') {
        worldPos = new THREE.Vector3(
          Number(targetIdOrVec.x) || 0,
          Number(targetIdOrVec.y) || 0,
          Number(targetIdOrVec.z) || 0
        );
      }
      if (!worldPos) {
        return { x: 0, y: 0, visible: false, ndcZ: 2 };
      }
      return studio.projectToScreen(worldPos);
    },
  };

  window.CampusTwin = api;
  return api;
}
