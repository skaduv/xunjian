import * as THREE from 'three';
import {
  getFloorExplodeOffset,
  NVR_DEVICES,
  SECURITY_CAMERAS,
} from '../config/campusConfig.js';

/**
 * 园区 3D 安防摄像头点位（layers.cameras）+ 半透明 3D 视锥投影体（layers.cameraFov）+ NVR 核心机房节点
 * - 室外摄像头立杆与底座全部使用 THREE.InstancedMesh 优化性能
 * - 支持 5 种状态实时外观：online / offline / muted / alarm_critical / alarm_order
 * - 支持 setNvrOffline(nvrId, isOffline) 批量置灰下属摄像头并在机房节点标记红色故障脉冲
 * - 支持爆炸透视时自动同步所有室内摄像头、室内视锥与机房节点的 Y 轴高度
 */

const STATE_STYLES = {
  online: {
    color: '#10b981',
    emissive: '#059669',
    emissiveIntensity: 1.8,
    bodyColor: '#f1f5f9',
    fovColor: '#0ea5e9',
    fovOpacity: 0.24,
    pulse: false,
  },
  offline: {
    color: '#64748b',
    emissive: '#334155',
    emissiveIntensity: 0.15,
    bodyColor: '#6b7280',
    fovColor: '#64748b',
    fovOpacity: 0.08,
    pulse: false,
  },
  muted: {
    color: '#94a3b8',
    emissive: '#475569',
    emissiveIntensity: 0.35,
    bodyColor: '#cbd5e1',
    fovColor: '#94a3b8',
    fovOpacity: 0.1,
    pulse: false,
  },
  alarm_critical: {
    color: '#ef4444',
    emissive: '#dc2626',
    emissiveIntensity: 3.2,
    bodyColor: '#fef2f2',
    fovColor: '#ef4444',
    fovOpacity: 0.38,
    pulse: true,
    pulseSpeed: 3.4,
  },
  alarm_order: {
    color: '#f59e0b',
    emissive: '#d97706',
    emissiveIntensity: 2.8,
    bodyColor: '#fffbeb',
    fovColor: '#f59e0b',
    fovOpacity: 0.34,
    pulse: true,
    pulseSpeed: 2.4,
  },
};

/**
 * 构造单路真实风格 3D 枪机（bullet）或球机（dome）头部组件
 * 共享静态几何与光学镜片材质，移除冗余材质分配
 */
function createSharedCameraAssets() {
  return {
    lensGlassMat: new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.08,
      metalness: 0.35,
      envMapIntensity: 1.5,
    }),
    bulletHousingGeo: new THREE.BoxGeometry(0.48, 0.42, 1.08),
    bulletLensGeo: new THREE.CylinderGeometry(0.15, 0.17, 0.24, 10),
    bulletRingGeo: new THREE.TorusGeometry(0.24, 0.045, 6, 14),
    domeCollarGeo: new THREE.CylinderGeometry(0.42, 0.36, 0.24, 12),
    domeSphereGeo: new THREE.SphereGeometry(0.35, 12, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58),
    domeRingGeo: new THREE.TorusGeometry(0.43, 0.055, 6, 16),
    pulseRingGeo: new THREE.RingGeometry(1.15, 1.85, 28),
    beaconGeo: new THREE.CylinderGeometry(0.16, 0.58, 13.5, 12, 1, true),
  };
}

function buildCameraHead(camCfg, shared) {
  const head = new THREE.Group();
  head.name = `CamHead_${camCfg.id}`;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: STATE_STYLES.online.bodyColor,
    roughness: 0.32,
    metalness: 0.45,
  });
  const statusMat = new THREE.MeshStandardMaterial({
    color: STATE_STYLES.online.color,
    emissive: new THREE.Color(STATE_STYLES.online.emissive),
    emissiveIntensity: STATE_STYLES.online.emissiveIntensity,
    roughness: 0.2,
  });

  // 相机指向器（按 yaw / pitch 朝向监控方向，局部 +Z 为镜头光轴）
  const aimGroup = new THREE.Group();
  aimGroup.rotation.order = 'YXZ';
  aimGroup.rotation.y = camCfg.yaw;
  aimGroup.rotation.x = -camCfg.pitch;

  if (camCfg.type === 'bullet') {
    // 精简高效枪机（机身 + 光学镜头筒 + 环形状态灯，3 次 Draw Call/路）
    const housing = new THREE.Mesh(shared.bulletHousingGeo, bodyMat);
    aimGroup.add(housing);

    const lens = new THREE.Mesh(shared.bulletLensGeo, shared.lensGlassMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, 0.56);
    aimGroup.add(lens);

    const ring = new THREE.Mesh(shared.bulletRingGeo, statusMat);
    ring.position.set(0, 0, 0.53);
    aimGroup.add(ring);
  } else {
    // 精简高效球机（吊装底座 + 熏黑球罩 + 环形状态灯）
    const collar = new THREE.Mesh(shared.domeCollarGeo, bodyMat);
    collar.position.y = 0.22;
    head.add(collar);

    const dome = new THREE.Mesh(shared.domeSphereGeo, shared.lensGlassMat);
    dome.position.y = 0.12;
    head.add(dome);

    const statusRing = new THREE.Mesh(shared.domeRingGeo, statusMat);
    statusRing.rotation.x = Math.PI / 2;
    statusRing.position.y = 0.11;
    head.add(statusRing);
  }

  head.add(aimGroup);

  // 告警脉冲扩散环（仅 alarm_critical / alarm_order 状态显示）
  const pulseMat = new THREE.MeshBasicMaterial({
    color: '#ef4444',
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const pulseRing = new THREE.Mesh(shared.pulseRingGeo, pulseMat);
  pulseRing.rotation.x = -Math.PI / 2;
  pulseRing.position.y = 0.2;
  pulseRing.visible = false;
  head.add(pulseRing);

  // 告警垂直细光束锚标（仅紧急/秩序告警脉冲态亮起，全园俯视清晰定位）
  const beaconMat = new THREE.MeshBasicMaterial({
    color: '#ef4444',
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
  });
  const beacon = new THREE.Mesh(shared.beaconGeo, beaconMat);
  beacon.position.y = 7.0;
  beacon.visible = false;
  head.add(beacon);

  return { head, bodyMat, statusMat, pulseRing, pulseMat, beacon, beaconMat };
}

/**
 * 构造单路摄像头对应的半透明 3D 视锥投影体（棱锥壳 + 细线框）
 */
function buildCameraFovFrustum(camCfg) {
  const fovGrp = new THREE.Group();
  fovGrp.name = `CamFov_${camCfg.id}`;

  const range = camCfg.range || 24;
  const vFovRad = THREE.MathUtils.degToRad((camCfg.fovDeg || 54) * 0.65);
  const hFovRad = THREE.MathUtils.degToRad(camCfg.fovDeg || 54);
  const halfH = Math.tan(vFovRad * 0.5) * range;
  const halfW = Math.tan(hFovRad * 0.5) * range;

  // 顶点：原点 0 -> 远裁剪面 4 角（沿局部 +Z 射出）
  const verts = new Float32Array([
    0, 0, 0,
    -halfW, halfH, range,
    halfW, halfH, range,
    halfW, -halfH, range,
    -halfW, -halfH, range,
  ]);
  const indices = [
    0, 1, 2,
    0, 2, 3,
    0, 3, 4,
    0, 4, 1,
    1, 4, 3,
    1, 3, 2,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const fillMat = new THREE.MeshBasicMaterial({
    color: STATE_STYLES.online.fovColor,
    transparent: true,
    opacity: STATE_STYLES.online.fovOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, fillMat);

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({
    color: STATE_STYLES.online.fovColor,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const wireframe = new THREE.LineSegments(edgeGeo, edgeMat);

  const aim = new THREE.Group();
  aim.rotation.order = 'YXZ';
  aim.rotation.y = camCfg.yaw;
  aim.rotation.x = -camCfg.pitch;
  aim.add(mesh, wireframe);
  fovGrp.add(aim);

  return { fovGrp, fillMat, edgeMat };
}

export function buildCameraAndFovLayers() {
  const camerasGroup = new THREE.Group();
  camerasGroup.name = 'SecurityCamerasLayer';

  const fovGroup = new THREE.Group();
  fovGroup.name = 'SecurityCameraFovLayer';
  fovGroup.visible = false; // 视锥默认隐藏，保持画面克制整洁

  // 1. 室外摄像头安装立杆与底盘法兰（严格使用 InstancedMesh）
  const outdoorPoleCams = SECURITY_CAMERAS.filter((c) => !c.isIndoor && c.position[1] >= 5.5);
  const poleMat = new THREE.MeshStandardMaterial({
    color: '#3f4a58',
    roughness: 0.4,
    metalness: 0.72,
  });
  if (outdoorPoleCams.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 1, 10);
    const flangeGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.18, 12);
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, outdoorPoleCams.length);
    const flangeInst = new THREE.InstancedMesh(flangeGeo, poleMat, outdoorPoleCams.length);
    poleInst.castShadow = true;
    flangeInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    outdoorPoleCams.forEach((c, idx) => {
      const h = c.position[1];
      dummy.position.set(c.position[0], h * 0.5, c.position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(c.position[0], 0.14, c.position[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      flangeInst.setMatrixAt(idx, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    flangeInst.instanceMatrix.needsUpdate = true;
    camerasGroup.add(poleInst, flangeInst);
  }

  // 2. 构建 12 路摄像头实体与对应视锥映射表
  const sharedCameraAssets = createSharedCameraAssets();
  const cameraMap = new Map();
  for (const cfg of SECURITY_CAMERAS) {
    const headBundle = buildCameraHead(cfg, sharedCameraAssets);
    headBundle.head.position.set(...cfg.position);
    camerasGroup.add(headBundle.head);

    const fovBundle = buildCameraFovFrustum(cfg);
    fovBundle.fovGrp.position.set(...cfg.position);
    fovBundle.fovGrp.visible = false;
    fovGroup.add(fovBundle.fovGrp);

    cameraMap.set(cfg.id, {
      config: { ...cfg },
      state: cfg.state || 'online',
      preOfflineState: null,
      baseY: cfg.position[1],
      ...headBundle,
      ...fovBundle,
    });
  }

  // 2b. 复用单枚摄像头头部悬浮/选中光环（0 冗余 per-camera 网格分配，仅激活时 visible = true）
  const headReticleGeo = new THREE.RingGeometry(0.75, 1.08, 28);
  headReticleGeo.rotateX(-Math.PI / 2);
  const hoverHeadRingMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const hoverHeadRing = new THREE.Mesh(headReticleGeo, hoverHeadRingMat);
  hoverHeadRing.visible = false;
  hoverHeadRing.renderOrder = 16;
  camerasGroup.add(hoverHeadRing);

  const selectHeadRingGeo = new THREE.RingGeometry(0.88, 1.32, 32);
  selectHeadRingGeo.rotateX(-Math.PI / 2);
  const selectHeadRingMat = new THREE.MeshBasicMaterial({
    color: '#0284c7',
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const selectHeadRing = new THREE.Mesh(selectHeadRingGeo, selectHeadRingMat);
  selectHeadRing.visible = false;
  selectHeadRing.renderOrder = 17;
  camerasGroup.add(selectHeadRing);

  // 3. 东北机房 3 台大华 NVR 汇聚节点状态灯与故障告警标识
  const nvrMap = new Map();
  const nvrGroup = new THREE.Group();
  nvrGroup.name = 'NvrCoreNodes';

  for (const nvr of NVR_DEVICES) {
    const nodeGrp = new THREE.Group();
    nodeGrp.position.set(...nvr.nodePosition);

    const ledMat = new THREE.MeshStandardMaterial({
      color: '#10b981',
      emissive: new THREE.Color('#10b981'),
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    const indicator = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.24), ledMat);
    indicator.position.set(0, 1.35, 0.58);
    nodeGrp.add(indicator);

    const faultMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const faultRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.15, 24), faultMat);
    faultRing.rotation.x = -Math.PI / 2;
    faultRing.position.y = 1.65;
    faultRing.visible = false;
    nodeGrp.add(faultRing);

    const faultBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.36, 9.0, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.36, depthWrite: false })
    );
    faultBeacon.position.y = 5.2;
    faultBeacon.visible = false;
    nodeGrp.add(faultBeacon);

    nvrGroup.add(nodeGrp);
    nvrMap.set(nvr.id, {
      config: { ...nvr },
      isOffline: false,
      baseY: nvr.nodePosition[1],
      nodeGrp,
      ledMat,
      faultRing,
      faultMat,
      faultBeacon,
    });
  }
  camerasGroup.add(nvrGroup);

  function applyStateVisuals(entry, state) {
    const style = STATE_STYLES[state] || STATE_STYLES.online;
    entry.state = state;
    entry.bodyMat.color.set(style.bodyColor);
    entry.statusMat.color.set(style.color);
    entry.statusMat.emissive.set(style.emissive);
    entry.statusMat.emissiveIntensity = style.emissiveIntensity;

    entry.fillMat.color.set(style.fovColor);
    entry.fillMat.opacity = style.fovOpacity;
    entry.edgeMat.color.set(style.fovColor);

    const isPulse = Boolean(style.pulse);
    entry.pulseRing.visible = isPulse;
    entry.beacon.visible = isPulse;
    if (isPulse) {
      entry.pulseMat.color.set(style.color);
      entry.beaconMat.color.set(style.color);
    }
  }

  let currentExplodeFactor = 0;
  let globalFovVisible = false;
  let fovOverrideId = null;
  let hoveredCameraId = null;
  let selectedCameraId = null;

  function syncFovVisibility() {
    fovGroup.visible = globalFovVisible || Boolean(fovOverrideId);
    for (const [id, entry] of cameraMap.entries()) {
      const isOverride = id === fovOverrideId;
      entry.fovGrp.visible = globalFovVisible || isOverride;
      const style = STATE_STYLES[entry.state] || STATE_STYLES.online;
      if (isOverride && !globalFovVisible) {
        entry.fillMat.opacity = Math.max(style.fovOpacity, 0.24);
        entry.edgeMat.opacity = 0.88;
      } else {
        entry.fillMat.opacity = style.fovOpacity;
        entry.edgeMat.opacity = 0.72;
      }
    }
  }

  function syncHeadFocusRings() {
    // 还原各摄像头头部尺度与状态灯强度
    for (const [id, entry] of cameraMap.entries()) {
      const style = STATE_STYLES[entry.state] || STATE_STYLES.online;
      const isSel = id === selectedCameraId;
      const isHov = id === hoveredCameraId;
      const scale = isSel ? 1.32 : isHov ? 1.18 : 1.0;
      entry.head.scale.setScalar(scale);
      entry.statusMat.emissiveIntensity =
        style.emissiveIntensity + (isSel ? 1.35 : isHov ? 0.75 : 0);
    }

    const selEntry = selectedCameraId ? cameraMap.get(selectedCameraId) : null;
    if (selEntry) {
      selectHeadRing.position.copy(selEntry.head.position);
      selectHeadRing.position.y += 0.16;
      const style = STATE_STYLES[selEntry.state] || STATE_STYLES.online;
      selectHeadRingMat.color.set(
        selEntry.state === 'alarm_critical'
          ? '#ef4444'
          : selEntry.state === 'alarm_order'
            ? '#f59e0b'
            : selEntry.state === 'offline'
              ? '#64748b'
              : '#38bdf8'
      );
      selectHeadRing.visible = true;
    } else {
      selectHeadRing.visible = false;
    }

    const hovEntry =
      hoveredCameraId && hoveredCameraId !== selectedCameraId
        ? cameraMap.get(hoveredCameraId)
        : null;
    if (hovEntry) {
      hoverHeadRing.position.copy(hovEntry.head.position);
      hoverHeadRing.position.y += 0.14;
      hoverHeadRing.visible = true;
    } else {
      hoverHeadRing.visible = false;
    }
  }

  return {
    camerasGroup,
    fovGroup,
    setGlobalFovVisible(visible) {
      globalFovVisible = Boolean(visible);
      syncFovVisibility();
      return globalFovVisible;
    },
    isGlobalFovVisible() {
      return globalFovVisible;
    },
    setCameraFovOverride(cameraId) {
      fovOverrideId = cameraId && cameraMap.has(cameraId) ? cameraId : null;
      syncFovVisibility();
      return fovOverrideId;
    },
    getCameraFovOverride() {
      return fovOverrideId;
    },
    setHoveredCamera(cameraId) {
      hoveredCameraId = cameraId && cameraMap.has(cameraId) ? cameraId : null;
      syncHeadFocusRings();
      return hoveredCameraId;
    },
    setSelectedCamera(cameraId) {
      selectedCameraId = cameraId && cameraMap.has(cameraId) ? cameraId : null;
      syncHeadFocusRings();
      return selectedCameraId;
    },
    setCameraState(cameraId, state) {
      const entry = cameraMap.get(cameraId);
      if (!entry) return false;
      if (!STATE_STYLES[state]) return false;
      applyStateVisuals(entry, state);
      syncFovVisibility();
      syncHeadFocusRings();
      return true;
    },
    setNvrOffline(nvrId, isOffline) {
      const nvr = nvrMap.get(nvrId);
      if (!nvr) return false;
      nvr.isOffline = Boolean(isOffline);

      if (nvr.isOffline) {
        nvr.ledMat.color.set('#ef4444');
        nvr.ledMat.emissive.set('#dc2626');
        nvr.ledMat.emissiveIntensity = 3.2;
        nvr.faultRing.visible = true;
        nvr.faultBeacon.visible = true;
      } else {
        nvr.ledMat.color.set('#10b981');
        nvr.ledMat.emissive.set('#10b981');
        nvr.ledMat.emissiveIntensity = 1.8;
        nvr.faultRing.visible = false;
        nvr.faultBeacon.visible = false;
      }

      // 收敛联动：该 NVR 下属全部摄像头一键置灰 / 恢复原状态
      for (const entry of cameraMap.values()) {
        if (entry.config.nvrId !== nvrId) continue;
        if (nvr.isOffline) {
          if (entry.state !== 'offline') {
            entry.preOfflineState = entry.state;
          }
          applyStateVisuals(entry, 'offline');
        } else {
          const restore = entry.preOfflineState || 'online';
          entry.preOfflineState = null;
          applyStateVisuals(entry, restore);
        }
      }
      syncFovVisibility();
      syncHeadFocusRings();
      return true;
    },
    isNvrOffline(nvrId) {
      const nvr = nvrMap.get(nvrId);
      return nvr ? Boolean(nvr.isOffline) : false;
    },
    getNvrEntry(nvrId) {
      return nvrMap.get(nvrId) || null;
    },
    syncExplosion(explodeFactor) {
      currentExplodeFactor = explodeFactor;
      for (const entry of cameraMap.values()) {
        const dy = entry.config.isIndoor
          ? getFloorExplodeOffset(entry.config.floor, explodeFactor)
          : 0;
        const y = entry.baseY + dy;
        entry.head.position.y = y;
        entry.fovGrp.position.y = y;
      }
      for (const nvr of nvrMap.values()) {
        const dy = getFloorExplodeOffset(nvr.config.floor, explodeFactor);
        nvr.nodeGrp.position.y = nvr.baseY + dy;
      }
      syncHeadFocusRings();
    },
    getCameraWorldPosition(cameraId) {
      const entry = cameraMap.get(cameraId);
      if (entry) {
        return entry.head.position.clone();
      }
      const nvr = nvrMap.get(cameraId);
      if (nvr) {
        return nvr.nodeGrp.position.clone();
      }
      return null;
    },
    getCameraEntry(cameraId) {
      return cameraMap.get(cameraId) || null;
    },
    hasActiveAlarms() {
      for (const entry of cameraMap.values()) {
        if (entry.state === 'alarm_critical' || entry.state === 'alarm_order') return true;
      }
      for (const nvr of nvrMap.values()) {
        if (nvr.isOffline) return true;
      }
      return false;
    },
    getCatalogSnapshot() {
      const cameras = [];
      for (const entry of cameraMap.values()) {
        const p = entry.head.position;
        cameras.push({
          ...entry.config,
          state: entry.state,
          worldPosition: [
            Number(p.x.toFixed(3)),
            Number(p.y.toFixed(3)),
            Number(p.z.toFixed(3)),
          ],
        });
      }
      const nvrs = [];
      for (const nvr of nvrMap.values()) {
        const p = nvr.nodeGrp.position;
        nvrs.push({
          ...nvr.config,
          status: nvr.isOffline ? 'offline' : 'online',
          cameraIds: cameras.filter((c) => c.nvrId === nvr.config.id).map((c) => c.id),
          worldPosition: [
            Number(p.x.toFixed(3)),
            Number(p.y.toFixed(3)),
            Number(p.z.toFixed(3)),
          ],
        });
      }
      return { cameras, nvrs, explodeFactor: currentExplodeFactor };
    },
    update(time) {
      // 紧急红脉冲 / 秩序橙脉冲与 NVR 故障脉冲呼吸动画
      for (const entry of cameraMap.values()) {
        const style = STATE_STYLES[entry.state];
        if (style?.pulse) {
          const cycle = (time * style.pulseSpeed * 0.35) % 1;
          const s = 1 + cycle * 4.2;
          entry.pulseRing.scale.set(s, s, 1);
          entry.pulseMat.opacity = (1 - cycle) * 0.85;
          entry.beaconMat.opacity = 0.18 + Math.abs(Math.sin(time * style.pulseSpeed)) * 0.28;
        }
      }
      for (const nvr of nvrMap.values()) {
        if (nvr.isOffline) {
          const cycle = (time * 1.1) % 1;
          const s = 1 + cycle * 3.8;
          nvr.faultRing.scale.set(s, s, 1);
          nvr.faultMat.opacity = (1 - cycle) * 0.9;
        }
      }
    },
  };
}
