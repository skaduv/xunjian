import * as THREE from 'three';
import { SECURITY_GROUPS, getFloorExplodeOffset } from '../config/campusConfig.js';

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
 *
 * 第二阶段（摄像头组件 / 无人机环绕 / 分层）新增：
 * - listCameras() / addCamera(spec) / removeCamera(id)       复用 SurveillanceCamera 组件增删摄像头
 * - selectCamera(id | null, { fly })                          选中摄像头：点位高亮 + 视锥 + 地面覆盖区
 * - setFovMode('selected' | 'all' | 'none') / setMarkersVisible(bool)
 * - startDroneOrbit({ periodSec, height, radius }) / stopDroneOrbit() / isDroneOrbiting()
 * - setFloorView('all' | '1F' | '2F' | '3F' | 'roof', { fly }) / getFloorView()
 * - on(eventType, cb)  事件：'select' | 'state' | 'orbit' | 'floor' | 'add' | 'remove' | 'fovMode'
 */

const FLOOR_ANCHORS = [
  { key: '1F', label: '1F 首层', x: 112, y: 2.4, z: -40 },
  { key: '2F', label: '2F 二层', x: 112, y: 7.2, z: -40 },
  { key: '3F', label: '3F 三层', x: 112, y: 12.0, z: -40 },
  { key: 'roof', label: '屋顶层', x: 112, y: 15.2, z: -40 },
];

const FLOOR_VIEW_FOCUS = {
  all: null,
  '1F': { pos: [-10, 2, -4], offset: [-190, 230, 250] },
  '2F': { pos: [-10, 6, -4], offset: [-190, 235, 250] },
  '3F': { pos: [-10, 11, -4], offset: [-190, 240, 250] },
  roof: { pos: [-10, 14, -4], offset: [-200, 250, 260] },
};

export function createCampusTwinAPI({
  studio,
  architecture,
  landscapeRoot,
  cameraLayer,
  safetyZonesLayer,
  highlightLayer,
  surveillance,
}) {
  const eventListeners = new Map();
  const emit = (type, payload) => {
    for (const cb of eventListeners.get(type) || []) cb(payload);
  };
  surveillance.onChange((type, payload) => emit(type, payload));
  studio.onOrbitChange((active, reason) => emit('orbit', { active, reason }));

  const syncHiddenFloors = () => {
    const hidden = architecture.getHiddenFloorKeys();
    cameraLayer.setHiddenFloors(hidden);
    safetyZonesLayer.setHiddenFloors(hidden);
    surveillance.setHiddenFloors(hidden);
  };

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
        cameras: surveillance.list().map((c) => {
          const legacy = cameras.find((l) => l.id === c.id);
          const p = surveillance.getWorldPosition(c.id);
          return {
            ...(legacy || surveillance.get(c.id).spec),
            ...c,
            worldPosition: [p.x, p.y, p.z].map((v) => Number(v.toFixed(3))),
          };
        }),
        safetyZones,
        layers: {
          cameras: layerMap.cameras.visible,
          cameraFov: surveillance.getFovMode() === 'all',
          cameraMarkers: surveillance.getMarkersVisible(),
          safetyZones: layerMap.safetyZones.visible,
          architecture: layerMap.architecture.visible,
          landscape: layerMap.landscape.visible,
        },
        state: {
          exploded: architecture.isExploded(),
          explodeFactor: Number(explodeFactor.toFixed(4)),
          lightingMode: studio.lightingMode,
          safetyZoneFilter: safetyZonesLayer.getFilter(),
          floorView: architecture.getFloorView(),
          droneOrbit: studio.isOrbiting(),
          selectedCamera: surveillance.getSelected(),
          fovMode: surveillance.getFovMode(),
        },
      };
    },

    flyToCamera(cameraId, options = {}) {
      const cam = surveillance.get(cameraId);
      if (!cam) return false;
      studio.stopOrbit();
      const targetPos = surveillance.getWorldPosition(cameraId);
      const offsetArr = options.offset || cam.spec.viewOffset || [-44, 38, 52];
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
      studio.stopOrbit();
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
      studio.stopOrbit();
      studio.resetView(options.duration ?? 950);
      return true;
    },

    setExploded(enabled) {
      architecture.setExploded(Boolean(enabled));
      studio.markShadowsDirty();
      studio.wake(1800);
      emit('explode', architecture.isExploded());
      return architecture.isExploded();
    },

    setLayerVisible(layerName, visible) {
      if (layerName === 'cameraFov') {
        surveillance.setFovMode(visible ? 'all' : 'selected');
        studio.wake(600);
        return Boolean(visible);
      }
      if (layerName === 'cameraMarkers') {
        studio.wake(600);
        return surveillance.setMarkersVisible(visible);
      }
      const target = layerMap[layerName];
      if (!target) return false;
      target.visible = Boolean(visible);
      if (layerName === 'cameras') surveillance.group.visible = target.visible;
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
      const legacyOk = cameraLayer.setCameraState(cameraId, state);
      const ok = surveillance.setState(cameraId, state);
      return legacyOk || ok;
    },

    /** 以当前注视点为中心推拉镜头（factor < 1 拉近） */
    zoomBy(factor = 0.75) {
      const target = studio.controls.target.clone();
      const offset = studio.camera.position.clone().sub(target);
      const dist = THREE.MathUtils.clamp(
        offset.length() * factor,
        studio.controls.minDistance,
        studio.controls.maxDistance
      );
      studio.stopOrbit();
      studio.flyTo(target.clone().add(offset.setLength(dist)), target, 450);
      return dist;
    },

    /** 机位相对注视点的方位角（度，0 = 正北，顺时针） */
    getViewHeading() {
      const d = studio.camera.position.clone().sub(studio.controls.target);
      return (THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)) + 360) % 360;
    },

    listCameras() {
      return surveillance.list();
    },

    addCamera(spec) {
      const cam = surveillance.add(spec);
      if (!cam) return false;
      surveillance.syncExplosion(architecture.getExplodeFactor());
      syncHiddenFloors();
      studio.wake(600);
      return true;
    },

    removeCamera(cameraId) {
      const cam = surveillance.get(cameraId);
      if (!cam || cam.source === 'legacy') return false; // 存量建模摄像头不允许运行时删除
      studio.wake(400);
      return surveillance.remove(cameraId);
    },

    selectCamera(cameraId, options = {}) {
      const id = surveillance.select(cameraId || null);
      if (id && options.fly) api.flyToCamera(id, options);
      studio.wake(800);
      return id;
    },

    getSelectedCamera() {
      return surveillance.getSelected();
    },

    setFovMode(mode) {
      studio.wake(500);
      return surveillance.setFovMode(mode);
    },

    setMarkersVisible(flag) {
      studio.wake(500);
      return surveillance.setMarkersVisible(flag);
    },

    startDroneOrbit(options = {}) {
      studio.startOrbit(options);
      return true;
    },

    stopDroneOrbit() {
      studio.stopOrbit();
      return false;
    },

    setDroneOrbitParams(params = {}) {
      studio.setOrbitParams(params);
      return studio.isOrbiting();
    },

    isDroneOrbiting() {
      return studio.isOrbiting();
    },

    setFloorView(key, options = {}) {
      const view = architecture.setFloorView(key);
      syncHiddenFloors();
      studio.markShadowsDirty();
      studio.wake(1200);
      const focus = FLOOR_VIEW_FOCUS[view];
      if (options.fly && focus) {
        studio.stopOrbit();
        const t = new THREE.Vector3(...focus.pos);
        studio.flyTo(t.clone().add(new THREE.Vector3(...focus.offset)), t, options.duration ?? 1100);
      }
      emit('floor', view);
      return view;
    },

    getFloorView() {
      return architecture.getFloorView();
    },

    /** 拆层展开时每层楼的标签锚点（世界坐标），供 HUD 绘制「1F / 2F / 3F / 屋顶」浮标 */
    getFloorAnchors() {
      const f = architecture.getExplodeFactor();
      const hidden = architecture.getHiddenFloorKeys();
      return FLOOR_ANCHORS.filter((a) => !hidden.has(a.key)).map((a) => ({
        key: a.key,
        label: a.label,
        explodeFactor: f,
        position: new THREE.Vector3(a.x, a.y + getFloorExplodeOffset(a.key, f), a.z),
      }));
    },

    on(type, cb) {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set());
      eventListeners.get(type).add(cb);
      return () => eventListeners.get(type)?.delete(cb);
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
          surveillance.getMarkerWorldPosition(targetIdOrVec) ||
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
