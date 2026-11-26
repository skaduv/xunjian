import * as THREE from 'three';
import {
  BUILDING_WINGS,
  ELEVATIONS,
  getFloorExplodeOffset,
  NVR_DEVICES,
  SAFETY_ZONES,
  SECURITY_CAMERAS,
  SECURITY_GROUPS,
} from '../config/campusConfig.js';

/**
 * 统一对外暴露的 window.CampusTwin v2.0 外部控制与双向交互 API（100% 向后兼容 v1.0）
 *
 * v1.0 基础能力：
 * - getCatalog(), flyToCamera(), flyToGroup(), resetView(), setExploded()
 * - setLayerVisible(), setSafetyZoneFilter(), setCameraState(), setNvrOffline()
 * - setLightingMode('day' | 'dusk' | 'night'), getPerfStats(), getScreenPosition()
 *
 * v2.0 巡检工作台核心升级：
 * - 事件总线：on(event, handler) / off(event, handler)
 *   支持 'entity:hover' | 'entity:click' | 'canvas:click' | 'view:change' | 'state:change' | 'patrol:change'
 * - 零抖动同帧空间锚点：getScreenPositions(ids), subscribeAnchors(ids | 'all', cb)
 * - 3D 交互反馈联动：setSelectedEntity(), setHoveredEntity(), setCameraFovOverride(), setNvrTopologyVisible()
 * - 视口安全区与楼层切剖：setViewportInsets(), setExplodeFactor(), focusFloor()
 * - 智能自动巡检状态机：startPatrol(), pausePatrol(), resumePatrol(), stepPatrol(), stopPatrol(), getPatrolState()
 */

const FLOOR_RANK = {
  outdoor: 0,
  '1F': 1,
  '2F': 2,
  '3F': 3,
  roof: 4,
  floatingCanopy: 5,
};

const ALL_ANCHOR_IDS = [
  ...SECURITY_CAMERAS.map((c) => c.id),
  ...NVR_DEVICES.map((n) => n.id),
];

const _tmpWorld = new THREE.Vector3();
const _tmpProj = new THREE.Vector3();

export function createCampusTwinAPI({
  studio,
  architecture,
  landscapeRoot,
  cameraLayer,
  safetyZonesLayer,
  interactionManager: initialInteraction = null,
  patrolController: initialPatrol = null,
}) {
  let interactionManager = initialInteraction;
  let patrolController = initialPatrol;

  const layerMap = {
    cameras: cameraLayer.camerasGroup,
    cameraFov: cameraLayer.fovGroup,
    safetyZones: safetyZonesLayer.group,
    architecture: architecture.root,
    landscape: landscapeRoot,
  };

  // ======================== 轻量事件总线 ========================
  const eventMap = new Map();

  function emit(event, payload) {
    const set = eventMap.get(event);
    if (!set || set.size === 0) return;
    for (const handler of Array.from(set)) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[CampusTwin] listener error on "${event}":`, err);
      }
    }
  }

  function on(event, handler) {
    if (typeof event !== 'string' || typeof handler !== 'function') return () => {};
    let set = eventMap.get(event);
    if (!set) {
      set = new Set();
      eventMap.set(event, set);
    }
    set.add(handler);
    return () => off(event, handler);
  }

  function off(event, handler) {
    const set = eventMap.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) eventMap.delete(event);
  }

  // ======================== 空间投影、遮挡与安全区 Edge Clamping ========================
  const groupById = new Map(SECURITY_GROUPS.map((g) => [g.id, g]));
  const wingById = new Map(BUILDING_WINGS.map((w) => [w.id, w]));
  const zoneById = new Map(SAFETY_ZONES.map((z) => [z.id, z]));

  function getGroupWorldFocus(grp, outVec) {
    const [x, y, z] = grp.focus.pos;
    if (grp.zoneType === 'outdoor') {
      return outVec.set(x, y, z);
    }
    const explodeFactor = architecture.getExplodeFactor();
    const focused = architecture.getFocusedFloor?.() || 'all';
    let floorKey = '1F';
    if (grp.zoneType === 'core') {
      floorKey = '1F';
    } else if (focused !== 'all') {
      floorKey = focused;
    } else if (y >= ELEVATIONS.FLOOR_3_Y) {
      floorKey = '3F';
    } else if (y >= ELEVATIONS.FLOOR_2_Y) {
      floorKey = '2F';
    }
    const dy = getFloorExplodeOffset(floorKey, explodeFactor);
    return outVec.set(x, y + dy, z);
  }

  function resolveEntityWorldMeta(id, outVec) {
    const camEntry = cameraLayer.getCameraEntry(id);
    if (camEntry) {
      outVec.copy(camEntry.head.position);
      return {
        found: true,
        isIndoor: Boolean(camEntry.config.isIndoor),
        floor: camEntry.config.floor || 'outdoor',
      };
    }

    const nvrEntry = cameraLayer.getNvrEntry?.(id);
    if (nvrEntry) {
      outVec.copy(nvrEntry.nodeGrp.position);
      outVec.y += 1.45;
      return {
        found: true,
        isIndoor: true,
        floor: nvrEntry.config.floor || '1F',
      };
    }

    const zoneCfg = zoneById.get(id);
    if (zoneCfg) {
      const center = safetyZonesLayer.getZoneCenter(id);
      if (center) {
        outVec.copy(center);
        return {
          found: true,
          isIndoor: Boolean(zoneCfg.isIndoor),
          floor: zoneCfg.floor || 'outdoor',
        };
      }
    }

    const grp = groupById.get(id);
    if (grp) {
      getGroupWorldFocus(grp, outVec);
      return {
        found: true,
        isIndoor: false,
        floor: 'all',
      };
    }

    const wing = wingById.get(id);
    if (wing) {
      const explodeFactor = architecture.getExplodeFactor();
      const maxF = Math.max(...wing.floors);
      const y =
        (maxF === 3 ? ELEVATIONS.FLOOR_3_Y : maxF === 2 ? ELEVATIONS.FLOOR_2_Y : ELEVATIONS.FLOOR_1_Y) +
        ELEVATIONS.FLOOR_HEIGHT * 0.5 +
        getFloorExplodeOffset(`${maxF}F`, explodeFactor);
      outVec.set((wing.x1 + wing.x2) * 0.5, y, (wing.z1 + wing.z2) * 0.5);
      return {
        found: true,
        isIndoor: false,
        floor: `${maxF}F`,
      };
    }

    return { found: false, isIndoor: false, floor: 'outdoor' };
  }

  function computeOccluded(meta) {
    if (!meta.isIndoor) return false;
    const explodeFactor = architecture.getExplodeFactor();
    if (explodeFactor >= 0.18) return false;

    const focused = architecture.getFocusedFloor?.() || 'all';
    if (focused === 'all') return true;
    if (focused === meta.floor) return false;

    const entRank = FLOOR_RANK[meta.floor] ?? 1;
    const focusRank = FLOOR_RANK[focused] ?? 1;
    // 上方隐藏层或被当前聚焦层遮盖的下方室内点位视为遮挡
    return entRank !== focusRank;
  }

  function projectWithMetadata(worldPos, meta) {
    const v = _tmpProj.copy(worldPos).project(studio.camera);
    const w = studio.width || window.innerWidth;
    const h = studio.height || window.innerHeight;
    const inFront = v.z >= -1 && v.z <= 1;
    const rawX = (v.x + 1) * 0.5 * w;
    const rawY = (-v.y + 1) * 0.5 * h;
    const visible = inFront && v.x >= -1.05 && v.x <= 1.05 && v.y >= -1.05 && v.y <= 1.05;
    const distance = studio.camera.position.distanceTo(worldPos);

    // 基于当前 viewportInsets 计算安全区 Edge Clamping 坐标与指示角
    const insets = studio.getViewportInsets?.() || { top: 0, right: 0, bottom: 0, left: 0 };
    const safeLeft = Math.min(w * 0.4, (insets.left || 16) + 18);
    const safeRight = Math.max(w * 0.6, w - (insets.right || 16) - 18);
    const safeTop = Math.min(h * 0.35, (insets.top || 64) + 16);
    const safeBottom = Math.max(h * 0.65, h - (insets.bottom || 64) - 16);

    let clampedX = rawX;
    let clampedY = rawY;
    let edgeAngle = 0;

    const inSafe =
      inFront &&
      rawX >= safeLeft &&
      rawX <= safeRight &&
      rawY >= safeTop &&
      rawY <= safeBottom;

    if (!inSafe) {
      const cx = (safeLeft + safeRight) * 0.5;
      const cy = (safeTop + safeBottom) * 0.5;
      let dx = rawX - cx;
      let dy = rawY - cy;
      if (!inFront) {
        dx = -dx;
        dy = -dy;
      }
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dx = 1;
      const halfW = Math.max(60, (safeRight - safeLeft) * 0.5 - 52);
      const halfH = Math.max(48, (safeBottom - safeTop) * 0.5 - 20);
      const scale = Math.min(
        Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity,
        Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity
      );
      clampedX = cx + dx * scale;
      clampedY = cy + dy * scale;
      edgeAngle = Number(((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1));
    }

    return {
      x: Math.round(rawX * 100) / 100,
      y: Math.round(rawY * 100) / 100,
      visible,
      ndcZ: Number(v.z.toFixed(5)),
      occluded: computeOccluded(meta),
      distance: Number(distance.toFixed(1)),
      clampedX: Math.round(clampedX * 100) / 100,
      clampedY: Math.round(clampedY * 100) / 100,
      edgeAngle,
    };
  }

  function getScreenPositions(ids = 'all') {
    const list = ids === 'all' || !Array.isArray(ids) ? ALL_ANCHOR_IDS : ids;
    const out = {};
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      const meta = resolveEntityWorldMeta(id, _tmpWorld);
      if (!meta.found) {
        out[id] = {
          x: 0,
          y: 0,
          visible: false,
          ndcZ: 2,
          occluded: false,
          distance: 0,
          clampedX: 0,
          clampedY: 0,
          edgeAngle: 0,
        };
      } else {
        out[id] = projectWithMetadata(_tmpWorld, meta);
      }
    }
    return out;
  }

  // ======================== 同帧零抖动锚点推送（onAfterRender 驱动） ========================
  const anchorSubscribers = new Set();
  const lastSig = new Float64Array(15);
  let lastFocusedFloorSig = '';
  let anchorsForceDirty = true;

  function markAnchorsDirty() {
    anchorsForceDirty = true;
    studio.wake(220);
  }

  function isViewOrStateDirty() {
    const p = studio.camera.position;
    const q = studio.camera.quaternion;
    const pe = studio.camera.projectionMatrix.elements;
    const explodeFactor = architecture.getExplodeFactor();
    const focused = architecture.getFocusedFloor?.() || 'all';

    let viewChanged = false;
    if (
      Math.abs(lastSig[0] - p.x) > 1e-4 ||
      Math.abs(lastSig[1] - p.y) > 1e-4 ||
      Math.abs(lastSig[2] - p.z) > 1e-4 ||
      Math.abs(lastSig[3] - q.x) > 1e-5 ||
      Math.abs(lastSig[4] - q.y) > 1e-5 ||
      Math.abs(lastSig[5] - q.z) > 1e-5 ||
      Math.abs(lastSig[6] - q.w) > 1e-5 ||
      Math.abs(lastSig[7] - pe[0]) > 1e-5 ||
      Math.abs(lastSig[8] - pe[5]) > 1e-5 ||
      Math.abs(lastSig[9] - pe[8]) > 1e-5 ||
      Math.abs(lastSig[10] - pe[9]) > 1e-5 ||
      lastSig[11] !== studio.width ||
      lastSig[12] !== studio.height
    ) {
      viewChanged = true;
    }

    const stateChanged =
      anchorsForceDirty ||
      Math.abs(lastSig[13] - explodeFactor) > 1e-4 ||
      Math.abs(lastSig[14] - studio.duskFactor) > 1e-3 ||
      lastFocusedFloorSig !== focused;

    if (viewChanged || stateChanged) {
      lastSig[0] = p.x;
      lastSig[1] = p.y;
      lastSig[2] = p.z;
      lastSig[3] = q.x;
      lastSig[4] = q.y;
      lastSig[5] = q.z;
      lastSig[6] = q.w;
      lastSig[7] = pe[0];
      lastSig[8] = pe[5];
      lastSig[9] = pe[8];
      lastSig[10] = pe[9];
      lastSig[11] = studio.width;
      lastSig[12] = studio.height;
      lastSig[13] = explodeFactor;
      lastSig[14] = studio.duskFactor;
      lastFocusedFloorSig = focused;
      anchorsForceDirty = false;
    }

    return { viewChanged, dirty: viewChanged || stateChanged };
  }

  const unsubAfterRender = studio.onAfterRender(() => {
    const { viewChanged, dirty } = isViewOrStateDirty();
    if (!dirty) return;

    if (viewChanged && eventMap.has('view:change')) {
      const cp = studio.camera.position;
      const ct = studio.controls.target;
      emit('view:change', {
        position: [Number(cp.x.toFixed(2)), Number(cp.y.toFixed(2)), Number(cp.z.toFixed(2))],
        target: [Number(ct.x.toFixed(2)), Number(ct.y.toFixed(2)), Number(ct.z.toFixed(2))],
        insets: studio.getViewportInsets?.() || { top: 0, right: 0, bottom: 0, left: 0 },
      });
    }

    if (anchorSubscribers.size === 0) return;

    const meta = {
      explodeFactor: architecture.getExplodeFactor(),
      duskFactor: studio.duskFactor,
      nightFactor: studio.nightFactor,
      focusedFloor: architecture.getFocusedFloor?.() || 'all',
    };

    // 同帧去重投影缓存，避免多个订阅者重复计算
    const frameCache = Object.create(null);
    for (const sub of Array.from(anchorSubscribers)) {
      const list = sub.ids === 'all' ? ALL_ANCHOR_IDS : sub.ids;
      const payload = {};
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (!frameCache[id]) {
          const entMeta = resolveEntityWorldMeta(id, _tmpWorld);
          frameCache[id] = entMeta.found
            ? projectWithMetadata(_tmpWorld, entMeta)
            : {
                x: 0,
                y: 0,
                visible: false,
                ndcZ: 2,
                occluded: false,
                distance: 0,
                clampedX: 0,
                clampedY: 0,
                edgeAngle: 0,
              };
        }
        payload[id] = frameCache[id];
      }
      try {
        sub.cb(payload, meta);
      } catch (err) {
        console.error('[CampusTwin] anchor subscriber error:', err);
      }
    }
  });

  function subscribeAnchors(ids, cb) {
    let targetIds = ids;
    let callback = cb;
    if (typeof ids === 'function') {
      callback = ids;
      targetIds = 'all';
    }
    if (typeof callback !== 'function') return () => {};

    const normalizedIds =
      targetIds === 'all' || !Array.isArray(targetIds) ? 'all' : targetIds.slice();
    const entry = { ids: normalizedIds, cb: callback };
    anchorSubscribers.add(entry);

    // 订阅瞬间立即推送首帧坐标，确保 HUD 空间锚点零延迟挂载
    const initialPos = getScreenPositions(normalizedIds);
    const initialMeta = {
      explodeFactor: architecture.getExplodeFactor(),
      duskFactor: studio.duskFactor,
      nightFactor: studio.nightFactor,
      focusedFloor: architecture.getFocusedFloor?.() || 'all',
    };
    try {
      callback(initialPos, initialMeta);
    } catch (err) {
      console.error('[CampusTwin] anchor initial push error:', err);
    }

    return () => {
      anchorSubscribers.delete(entry);
    };
  }

  // ======================== 对外公开 API 对象 ========================
  const api = {
    version: '2.0.0',

    on,
    off,

    getCatalog() {
      const { cameras, nvrs, explodeFactor } = cameraLayer.getCatalogSnapshot();
      const safetyZones = safetyZonesLayer.getCatalogSnapshot();
      const groups = SECURITY_GROUPS.map((g) => ({
        ...g,
        cameraIds: cameras.filter((c) => c.groupId === g.id).map((c) => c.id),
      }));

      const fovVisible =
        typeof cameraLayer.isGlobalFovVisible === 'function'
          ? cameraLayer.isGlobalFovVisible()
          : layerMap.cameraFov.visible;

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
          cameraFov: fovVisible,
          safetyZones: layerMap.safetyZones.visible,
          architecture: layerMap.architecture.visible,
          landscape: layerMap.landscape.visible,
        },
        state: {
          exploded: architecture.isExploded(),
          explodeFactor: Number(explodeFactor.toFixed(4)),
          focusedFloor: architecture.getFocusedFloor?.() || 'all',
          lightingMode: studio.lightingMode,
          safetyZoneFilter: safetyZonesLayer.getFilter(),
          selectedEntity: interactionManager?.getSelectedEntity?.() || null,
          nvrTopology: interactionManager?.getNvrTopologyTarget?.() ?? false,
          viewportInsets: studio.getViewportInsets?.() || { top: 0, right: 0, bottom: 0, left: 0 },
          patrol: patrolController?.getPatrolState?.() || {
            status: 'idle',
            index: -1,
            total: SECURITY_CAMERAS.length,
            currentTarget: null,
          },
        },
      };
    },

    flyToCamera(cameraId, options = {}) {
      const entry = cameraLayer.getCameraEntry(cameraId);
      if (!entry) return false;

      if (
        options.autoExposeFloor &&
        entry.config.isIndoor &&
        entry.config.floor &&
        entry.config.floor !== 'outdoor' &&
        architecture.getExplodeFactor() < 0.55
      ) {
        if (architecture.getFocusedFloor?.() !== entry.config.floor) {
          architecture.focusFloor?.(entry.config.floor, { ghostUpper: true });
          studio.markShadowsDirty();
          markAnchorsDirty();
          emit('state:change', { kind: 'floor', focusedFloor: entry.config.floor });
        }
      }

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
      const grp = groupById.get(groupId);
      if (!grp) return false;
      const target = getGroupWorldFocus(grp, new THREE.Vector3());
      const off = options.offset || grp.focus.viewOffset;
      const scale = typeof options.distanceScale === 'number' ? options.distanceScale : 1;
      const camPos = new THREE.Vector3(
        target.x + off[0] * scale,
        Math.max(8, target.y + off[1] * scale),
        target.z + off[2] * scale
      );
      studio.flyTo(camPos, target, options.duration ?? 950);
      return true;
    },

    resetView(options = {}) {
      studio.resetView(options.duration ?? 950);
      return true;
    },

    setExploded(enabled) {
      architecture.setExploded(Boolean(enabled));
      studio.markShadowsDirty();
      studio.wake(1800);
      markAnchorsDirty();
      const exploded = architecture.isExploded();
      emit('state:change', { kind: 'explode', exploded });
      return exploded;
    },

    setExplodeFactor(factor) {
      const clamped =
        typeof architecture.setExplodeFactor === 'function'
          ? architecture.setExplodeFactor(factor)
          : (architecture.setExploded(factor > 0.5), factor > 0.5 ? 1 : 0);
      studio.markShadowsDirty();
      studio.wake(1800);
      markAnchorsDirty();
      emit('state:change', { kind: 'explode', explodeFactor: clamped, exploded: clamped > 0.5 });
      return clamped;
    },

    focusFloor(floor = 'all', options = {}) {
      const next =
        typeof architecture.focusFloor === 'function'
          ? architecture.focusFloor(floor, options)
          : 'all';
      studio.markShadowsDirty();
      studio.wake(900);
      markAnchorsDirty();
      emit('state:change', { kind: 'floor', focusedFloor: next });
      return next;
    },

    setViewportInsets(insets = {}) {
      const applied =
        typeof studio.setViewportInsets === 'function'
          ? studio.setViewportInsets(insets)
          : { top: 0, right: 0, bottom: 0, left: 0 };
      markAnchorsDirty();
      return applied;
    },

    setLayerVisible(layerName, visible) {
      const flag = Boolean(visible);
      if (layerName === 'cameraFov' && typeof cameraLayer.setGlobalFovVisible === 'function') {
        const next = cameraLayer.setGlobalFovVisible(flag);
        studio.wake(600);
        emit('state:change', { kind: 'layer', layerName, visible: next });
        return next;
      }
      const target = layerMap[layerName];
      if (!target) return false;
      target.visible = flag;
      studio.markShadowsDirty();
      studio.wake(600);
      emit('state:change', { kind: 'layer', layerName, visible: target.visible });
      return target.visible;
    },

    setSafetyZoneFilter(types) {
      studio.wake(400);
      const next = safetyZonesLayer.setFilter(types);
      emit('state:change', { kind: 'safetyZoneFilter', filter: next });
      return next;
    },

    setCameraState(cameraId, state) {
      studio.wake(1200);
      const ok = cameraLayer.setCameraState(cameraId, state);
      if (ok) {
        interactionManager?._syncSelectedRingColor?.();
        markAnchorsDirty();
        emit('state:change', { kind: 'cameraState', cameraId, state });
      }
      return ok;
    },

    setNvrOffline(nvrId, isOffline) {
      studio.wake(1200);
      const ok = cameraLayer.setNvrOffline(nvrId, Boolean(isOffline));
      if (ok) {
        interactionManager?.refreshNvrTopologyStatus?.();
        interactionManager?._syncSelectedRingColor?.();
        markAnchorsDirty();
        emit('state:change', { kind: 'nvrOffline', nvrId, isOffline: Boolean(isOffline) });
      }
      return ok;
    },

    setSelectedEntity(ref, options = {}) {
      const selected = interactionManager
        ? interactionManager.setSelectedEntity(ref, options)
        : ref || null;

      if (options?.flyTo === true && selected) {
        if (selected.type === 'camera') {
          api.flyToCamera(selected.id, {
            autoExposeFloor: options.autoExposeFloor ?? true,
            duration: options.duration,
            distanceScale: options.distanceScale,
          });
        } else if (selected.type === 'nvr') {
          api.flyToGroup('grp-nvr-room', { duration: options.duration });
        } else if (selected.type === 'group') {
          api.flyToGroup(selected.id, { duration: options.duration });
        } else if (selected.type === 'wing') {
          const wing = wingById.get(selected.id);
          if (wing?.groupId) api.flyToGroup(wing.groupId, { duration: options.duration });
        } else if (selected.type === 'zone') {
          const z = zoneById.get(selected.id);
          if (z?.cameraId) {
            api.flyToCamera(z.cameraId, { autoExposeFloor: true, duration: options.duration });
          } else if (z?.groupId) {
            api.flyToGroup(z.groupId, { duration: options.duration });
          }
        }
      }
      markAnchorsDirty();
      return selected;
    },

    setHoveredEntity(ref) {
      interactionManager?.setHoveredEntity(ref);
    },

    setCameraFovOverride(cameraId) {
      if (interactionManager) {
        return interactionManager.setCameraFovOverride(cameraId);
      }
      return cameraLayer.setCameraFovOverride?.(cameraId) ?? null;
    },

    setNvrTopologyVisible(target) {
      if (!interactionManager) return false;
      return interactionManager.setNvrTopologyVisible(target);
    },

    startPatrol(options) {
      return patrolController ? patrolController.startPatrol(options) : null;
    },

    pausePatrol(reason) {
      return patrolController ? patrolController.pausePatrol(reason) : null;
    },

    resumePatrol() {
      return patrolController ? patrolController.resumePatrol() : null;
    },

    stepPatrol(delta = 1) {
      return patrolController ? patrolController.stepPatrol(delta) : null;
    },

    stopPatrol(options) {
      return patrolController ? patrolController.stopPatrol(options) : null;
    },

    getPatrolState() {
      return patrolController
        ? patrolController.getPatrolState()
        : { status: 'idle', index: -1, total: SECURITY_CAMERAS.length, currentTarget: null };
    },

    getPerfStats() {
      return studio.getPerfStats();
    },

    setLightingMode(mode, options) {
      const normalized = mode === 'night' ? 'night' : mode === 'dusk' ? 'dusk' : 'day';
      studio.setLightingMode(normalized, options);
      markAnchorsDirty();
      emit('state:change', { kind: 'lighting', lightingMode: normalized });
      return normalized;
    },

    getScreenPosition(targetIdOrVec) {
      if (typeof targetIdOrVec === 'string') {
        const meta = resolveEntityWorldMeta(targetIdOrVec, _tmpWorld);
        if (!meta.found) {
          return { x: 0, y: 0, visible: false, ndcZ: 2 };
        }
        return projectWithMetadata(_tmpWorld, meta);
      }
      if (targetIdOrVec && typeof targetIdOrVec === 'object') {
        _tmpWorld.set(
          Number(targetIdOrVec.x) || 0,
          Number(targetIdOrVec.y) || 0,
          Number(targetIdOrVec.z) || 0
        );
        return studio.projectToScreen(_tmpWorld);
      }
      return { x: 0, y: 0, visible: false, ndcZ: 2 };
    },

    getScreenPositions,
    subscribeAnchors,

    attachControllers({ interactionManager: im, patrolController: pc }) {
      if (im) interactionManager = im;
      if (pc) patrolController = pc;
    },

    _emit: emit,
    _markAnchorsDirty: markAnchorsDirty,

    dispose() {
      unsubAfterRender();
      anchorSubscribers.clear();
      eventMap.clear();
    },
  };

  window.CampusTwin = api;
  return api;
}
