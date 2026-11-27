import * as THREE from 'three';
import { ELEVATIONS, getFloorExplodeOffset } from '../config/campusConfig.js';
import { createSurveillanceCamera, normalizeCameraState } from './SurveillanceCamera.js';

/**
 * 摄像头编排层：统一管理所有 SurveillanceCamera 组件实例
 * - 新增摄像头：system.add(spec) 一行接入（自带立杆/壁挂硬件 + 点位 + 视锥 + 画中画）
 * - 存量 12 路：adoptLegacy(cameraLayer) 只挂点位与视锥，硬件仍由 CameraLayer 的合批模型负责
 * - 视锥显示模式：'selected'（默认，仅选中）/ 'all' / 'none'
 * - 联动：爆炸分层平移、楼层剖切隐藏、告警脉冲、点选拾取
 */

const FLOOR_GROUND_Y = {
  '1F': ELEVATIONS.FLOOR_1_Y,
  '2F': ELEVATIONS.FLOOR_2_Y,
  '3F': ELEVATIONS.FLOOR_3_Y,
};

export function createSurveillanceSystem() {
  const group = new THREE.Group();
  group.name = 'SurveillanceSystem';

  const cams = new Map();
  const listeners = new Set();
  let selectedId = null;
  let fovMode = 'selected';
  let markersVisible = true;
  let explodeFactor = 0;
  let hiddenFloors = new Set();
  const raycaster = new THREE.Raycaster();

  const emit = (type, payload) => {
    for (const cb of listeners) cb(type, payload);
  };

  function applyFov(cam) {
    const show = fovMode === 'all' || (fovMode === 'selected' && cam.id === selectedId);
    cam.setFovVisible(show);
  }

  function applyFloor(cam) {
    const { isIndoor, floor } = cam.spec;
    cam.setFloorOffset(isIndoor ? getFloorExplodeOffset(floor, explodeFactor) : 0);
    cam.root.visible = !(isIndoor && hiddenFloors.has(floor));
  }

  const system = {
    group,

    /** 接入一路摄像头，返回组件实例 */
    add(spec, opts = {}) {
      if (!spec?.id || cams.has(spec.id)) return null;
      const cam = createSurveillanceCamera(spec, opts);
      cam.source = opts.source || 'component';
      cams.set(cam.id, cam);
      group.add(cam.root);
      cam.setMarkerVisible(markersVisible);
      applyFloor(cam);
      applyFov(cam);
      emit('add', cam.id);
      return cam;
    },

    remove(id) {
      const cam = cams.get(id);
      if (!cam) return false;
      if (selectedId === id) system.select(null);
      cam.dispose();
      cams.delete(id);
      emit('remove', id);
      return true;
    },

    /** 为 CameraLayer 中已建模的存量摄像头补齐点位 + 视锥组件（不重复生成硬件） */
    adoptLegacy(cameraLayer) {
      const { cameras } = cameraLayer.getCatalogSnapshot();
      for (const c of cameras) {
        const isIndoor = Boolean(c.isIndoor);
        system.add(
          {
            ...c,
            position: [...c.position],
            groundY: isIndoor ? FLOOR_GROUND_Y[c.floor] ?? c.position[1] - 4 : 0.07,
            markerHeight: isIndoor ? 3.2 : 5.5,
            range: c.range,
            fovDeg: c.fovDeg,
          },
          { withHardware: false, source: 'legacy' }
        );
      }
    },

    get(id) {
      return cams.get(id) || null;
    },

    list() {
      return [...cams.values()].map((cam) => ({
        id: cam.id,
        name: cam.spec.name,
        type: cam.spec.type,
        floor: cam.spec.isIndoor ? cam.spec.floor : 'outdoor',
        isIndoor: Boolean(cam.spec.isIndoor),
        groupId: cam.spec.groupId || null,
        nvrId: cam.spec.nvrId || null,
        state: cam.getState(),
        fovDeg: cam.spec.fovDeg,
        range: cam.spec.range,
        source: cam.source,
        selected: cam.id === selectedId,
      }));
    },

    setState(id, state) {
      const cam = cams.get(id);
      if (!cam || !normalizeCameraState(state)) return false;
      cam.setState(state);
      emit('state', { id, state: cam.getState() });
      return true;
    },

    select(id) {
      const next = id && cams.has(id) ? id : null;
      if (next === selectedId) return selectedId;
      if (selectedId) cams.get(selectedId)?.setSelected(false);
      selectedId = next;
      if (selectedId) cams.get(selectedId).setSelected(true);
      for (const cam of cams.values()) applyFov(cam);
      emit('select', selectedId);
      return selectedId;
    },

    getSelected() {
      return selectedId;
    },

    setFovMode(mode) {
      fovMode = ['all', 'none', 'selected'].includes(mode) ? mode : 'selected';
      for (const cam of cams.values()) applyFov(cam);
      emit('fovMode', fovMode);
      return fovMode;
    },

    getFovMode() {
      return fovMode;
    },

    setMarkersVisible(flag) {
      markersVisible = Boolean(flag);
      for (const cam of cams.values()) cam.setMarkerVisible(markersVisible);
      return markersVisible;
    },

    getMarkersVisible() {
      return markersVisible;
    },

    syncExplosion(f) {
      explodeFactor = f;
      for (const cam of cams.values()) applyFloor(cam);
    },

    setHiddenFloors(set) {
      hiddenFloors = new Set(set || []);
      for (const cam of cams.values()) applyFloor(cam);
    },

    /** 屏幕点选：ndc 为 [-1,1] 归一化坐标，返回命中的摄像头 id */
    pick(ndc, camera) {
      raycaster.setFromCamera(ndc, camera);
      const pins = [];
      for (const cam of cams.values()) {
        if (cam.root.visible && cam.markerGroup.visible) pins.push(cam.pin);
      }
      const hit = raycaster.intersectObjects(pins, false)[0];
      return hit ? hit.object.userData.cameraId : null;
    },

    getWorldPosition(id) {
      const cam = cams.get(id);
      return cam ? cam.getWorldPosition() : null;
    },

    getMarkerWorldPosition(id) {
      const cam = cams.get(id);
      return cam ? cam.getMarkerWorldPosition() : null;
    },

    /** 画中画：返回已同步到镜头位姿的取景相机 */
    getPreviewCamera(id) {
      const cam = cams.get(id);
      return cam ? cam.syncPreviewCamera() : null;
    },

    hasActivity() {
      if (selectedId) return true;
      for (const cam of cams.values()) {
        const s = cam.getState();
        if (s === 'alarm_critical' || s === 'alarm_order' || s === 'tamper') return true;
      }
      return fovMode === 'all';
    },

    update(time) {
      for (const cam of cams.values()) {
        if (cam.root.visible) cam.update(time);
      }
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  return system;
}
