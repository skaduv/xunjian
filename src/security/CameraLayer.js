import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ELEVATIONS,
  getFloorExplodeOffset,
  NVR_DEVICES,
  SECURITY_CAMERAS,
} from '../config/campusConfig.js';

/**
 * 园区 3D 安防摄像头点位（layers.cameras）+ 半透明 3D 视锥投影体（layers.cameraFov）+ NVR 核心机房节点
 *
 * 精工微缩安防硬件升级 + 全部安防挂装连接缺陷（A12 / A13 / A14）根治：
 * - 缎面瓷灰机身（#D4CEC5）+ 阳极深石墨遮阳罩/支架（#2F353D）+ 拉丝钛银饰环（#9BA1A8）+ 蓝宝光学镜头 + 微距状态 LED
 * - A12: 室内顶装枪/球机配备精确到楼板底面的吊杆与法兰盘；原中庭/扶梯悬空点位（CAM-03/05/07）精准迁移至实心廊道边梁并配悬臂支架，爆炸同步移动
 * - A13: CAM-04 增设紧贴 W4 南墙的水平 L 型壁挂支架；CAM-06 去除冗余立杆改配中央门廊钢柱抱箍悬臂支架
 * - A14: CAM-10 移出 WestBranch 行车道至路缘外侧 x=-150.2；全部室外立杆法兰座底延至 y=-0.04 稳固入土零悬浮
 * - 完整保留全部对外 API 与全部状态表现（online/normal / offline / muted / alarm_critical/alarm / alarm_order / tamper）
 */

const STATE_STYLES = {
  online: {
    color: '#10b981',
    emissive: '#059669',
    emissiveIntensity: 1.85,
    bodyColor: '#d4cec5',
    fovColor: '#14b8d4',
    fovOpacity: 0.24,
    pulse: false,
  },
  offline: {
    color: '#64748b',
    emissive: '#334155',
    emissiveIntensity: 0.15,
    bodyColor: '#6f7680',
    fovColor: '#64748b',
    fovOpacity: 0.08,
    pulse: false,
  },
  muted: {
    color: '#94a3b8',
    emissive: '#475569',
    emissiveIntensity: 0.35,
    bodyColor: '#b5b8bd',
    fovColor: '#94a3b8',
    fovOpacity: 0.10,
    pulse: false,
  },
  alarm_critical: {
    color: '#ef4444',
    emissive: '#dc2626',
    emissiveIntensity: 3.2,
    bodyColor: '#e6d4d2',
    fovColor: '#ef4444',
    fovOpacity: 0.38,
    pulse: true,
    pulseSpeed: 3.4,
  },
  alarm_order: {
    color: '#f59e0b',
    emissive: '#d97706',
    emissiveIntensity: 2.8,
    bodyColor: '#e6dfd0',
    fovColor: '#f59e0b',
    fovOpacity: 0.34,
    pulse: true,
    pulseSpeed: 2.4,
  },
  tamper: {
    color: '#a855f7',
    emissive: '#9333ea',
    emissiveIntensity: 3.0,
    bodyColor: '#ded6e6',
    fovColor: '#a855f7',
    fovOpacity: 0.36,
    pulse: true,
    pulseSpeed: 4.0,
  },
};

const STATE_ALIASES = {
  normal: 'online',
  alarm: 'alarm_critical',
};

/**
 * A12 / A13 / A14 精准安装坐标与支架拓扑表（不改动 campusConfig.js，严格在 CameraLayer 内闭环修复）
 */
const CAMERA_MOUNT_SPECS = {
  // 室内实心顶板吊装（垂直吊杆上延直抵上层楼板底面）
  'CAM-01': { mount: 'ceiling', ceilingY: ELEVATIONS.FLOOR_2_Y },
  'CAM-02': { mount: 'ceiling', ceilingY: ELEVATIONS.FLOOR_2_Y },
  'CAM-08': { mount: 'ceiling', ceilingY: ELEVATIONS.FLOOR_3_Y },
  'CAM-12': { mount: 'ceiling', ceilingY: ELEVATIONS.FLOOR_2_Y },
  // A12 原开敞挑空中庭/扶梯井悬空相机：迁移至对应实心廊道边沿 + 悬臂 L 型固定支架
  'CAM-03': {
    overridePos: [-60.15, ELEVATIONS.FLOOR_2_Y + 4.2, -12.0],
    mount: 'cantilever',
    anchorOffset: [0.55, 0.60, 0], // 锚固至东侧 3F 廊道边梁 (x=-59.6, y=9.695)
  },
  'CAM-05': {
    overridePos: [-7.35, ELEVATIONS.FLOOR_1_Y + 4.2, -71.0],
    mount: 'cantilever',
    anchorOffset: [-0.45, 0.60, 0], // 锚固至西侧 2F 扶梯洞口楼板边沿 (x=-7.8, y=4.895)
  },
  'CAM-07': {
    overridePos: [68.65, ELEVATIONS.FLOOR_2_Y + 4.1, -34.0],
    mount: 'cantilever',
    anchorOffset: [-0.48, 0.70, 0], // 锚固至西侧 3F 廊道边梁 (x=68.17, y=9.695)
  },
  // A13 室外壁挂与门廊钢柱抱箍安装
  'CAM-04': {
    mount: 'wall',
    anchorOffset: [0, 0, -0.84], // 水平 L 支架向北稳固螺栓锚入 W4 南立面 z=-34.0
  },
  'CAM-06': {
    mount: 'column',
    anchorOffset: [-0.70, 0, 0], // 取消多余独立立杆，改以抱箍悬臂直连中央门廊钢柱 (32.8, 5.895, -79.2)
  },
  // A14 室外立杆移出 WestBranch 行车道至西路缘外侧 x=-150.2；CAM-09 东移至 x=15.6 避让北广场西转弯车道
  'CAM-10': {
    overridePos: [-150.2, 6.4, -36.0],
    mount: 'pole',
  },
  'CAM-09': {
    overridePos: [15.6, 6.2, -104.0],
    mount: 'pole',
  },
  'CAM-11': { mount: 'pole' },
};

function createSharedHardwareAssets() {
  const darkGraphiteMat = new THREE.MeshStandardMaterial({
    color: '#2f353d',
    roughness: 0.38,
    metalness: 0.62,
  });
  const titaniumTrimMat = new THREE.MeshStandardMaterial({
    color: '#9ba1a8',
    roughness: 0.30,
    metalness: 0.68,
  });
  const lensGlassMat = new THREE.MeshStandardMaterial({
    color: '#132234',
    roughness: 0.06,
    metalness: 0.42,
    envMapIntensity: 1.65,
  });
  const lensCoreMat = new THREE.MeshStandardMaterial({
    color: '#224766',
    emissive: new THREE.Color('#133a54'),
    emissiveIntensity: 0.35,
    roughness: 0.05,
    metalness: 0.25,
  });

  // 枪机共享几何体
  const bulletBodyGeo = new THREE.BoxGeometry(0.46, 0.38, 1.04);
  const bulletBevelBandGeo = new THREE.BoxGeometry(0.50, 0.10, 0.72);
  const bulletHoodGeo = new THREE.BoxGeometry(0.52, 0.07, 1.18);
  const bulletRearCapGeo = new THREE.BoxGeometry(0.40, 0.32, 0.14);
  const bulletLensBezelGeo = new THREE.CylinderGeometry(0.18, 0.19, 0.18, 14);
  bulletLensBezelGeo.rotateX(Math.PI / 2);
  const bulletLensJewelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14);
  bulletLensJewelGeo.rotateX(Math.PI / 2);
  const bulletStatusRingGeo = new THREE.TorusGeometry(0.215, 0.036, 8, 18);

  // 球机共享几何体
  const domeBasePlateGeo = new THREE.CylinderGeometry(0.44, 0.42, 0.12, 16);
  const domeCollarGeo = new THREE.CylinderGeometry(0.40, 0.35, 0.22, 16);
  const domeTrimGeo = new THREE.TorusGeometry(0.385, 0.024, 6, 18);
  domeTrimGeo.rotateX(Math.PI / 2);
  const domeBubbleGeo = new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  const domePupilGeo = new THREE.SphereGeometry(0.14, 10, 8);
  const domeStatusRingGeo = new THREE.TorusGeometry(0.425, 0.042, 8, 18);
  domeStatusRingGeo.rotateX(Math.PI / 2);

  // 通用挂装法兰与连接件
  const ceilingFlangeGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.08, 14);
  const stemUnitGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 10);
  const wallPlateGeo = new THREE.BoxGeometry(0.36, 0.44, 0.08);
  const columnClampGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 16);
  const knuckleGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const pulseRingGeo = new THREE.RingGeometry(1.15, 1.85, 28);
  const beaconGeo = new THREE.CylinderGeometry(0.16, 0.58, 13.5, 12, 1, true);

  // NVR 迷你机架单元几何体
  const nvrChassisGeo = new THREE.BoxGeometry(1.24, 0.32, 0.96);
  const nvrFaceplateGeo = new THREE.BoxGeometry(1.28, 0.34, 0.06);
  const nvrVentGeo = new THREE.BoxGeometry(0.48, 0.12, 0.07);
  const nvrLedBarGeo = new THREE.BoxGeometry(0.56, 0.08, 0.08);
  const nvrFaultRingGeo = new THREE.RingGeometry(0.75, 1.15, 24);
  const nvrFaultBeaconGeo = new THREE.CylinderGeometry(0.12, 0.36, 9.0, 10, 1, true);

  return {
    darkGraphiteMat,
    titaniumTrimMat,
    lensGlassMat,
    lensCoreMat,
    bulletBodyGeo,
    bulletBevelBandGeo,
    bulletHoodGeo,
    bulletRearCapGeo,
    bulletLensBezelGeo,
    bulletLensJewelGeo,
    bulletStatusRingGeo,
    domeBasePlateGeo,
    domeCollarGeo,
    domeTrimGeo,
    domeBubbleGeo,
    domePupilGeo,
    domeStatusRingGeo,
    ceilingFlangeGeo,
    stemUnitGeo,
    wallPlateGeo,
    columnClampGeo,
    knuckleGeo,
    pulseRingGeo,
    beaconGeo,
    nvrChassisGeo,
    nvrFaceplateGeo,
    nvrVentGeo,
    nvrLedBarGeo,
    nvrFaultRingGeo,
    nvrFaultBeaconGeo,
  };
}

/**
 * 规范化待合并几何体（补齐法线/UV/索引，确保 mergeGeometries 零失败且不膨胀顶点）
 */
function prepareGeoForMerge(srcGeo, matrix) {
  const g = srcGeo.clone();
  for (const attrName of Object.keys(g.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'uv') {
      g.deleteAttribute(attrName);
    }
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const count = g.attributes.position.count;
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  if (!g.index) {
    const count = g.attributes.position.count;
    const idxArr = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
    for (let i = 0; i < count; i++) idxArr[i] = i;
    g.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }
  if (matrix) g.applyMatrix4(matrix);
  return g;
}

function mergeBucketGeometries(geos) {
  if (!geos || geos.length === 0) return null;
  if (geos.length === 1) return geos[0];
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

/**
 * 创建支持逐实例独立色相 + 逐实例独立 HDR 自发光（aEmissive）的状态灯共享 PBR 材质
 */
function createInstancedStatusMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1.0,
    roughness: 0.18,
  });
  mat.customProgramCacheKey = () => 'ioply-camera-status-inst-v1';
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aEmissive;
        varying vec3 vInstEmissive;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vInstEmissive = aEmissive;
        `
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vInstEmissive;
        `
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance = vInstEmissive;
        `
      );
  };
  return mat;
}

/**
 * 收集单路摄像头的物理挂装支架静态几何到对应楼层材质合批桶（根治 A12 / A13 全部悬空）
 */
function collectMountHardware(pushStatic, camCfg, effectivePos, mountSpec, shared, headMat) {
  const partObj = new THREE.Object3D();
  const worldMat = new THREE.Matrix4();
  const addPart = (bucketKey, geo, px, py, pz, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    partObj.position.set(px, py, pz);
    partObj.rotation.set(rx, ry, rz);
    partObj.scale.set(sx, sy, sz);
    partObj.updateMatrix();
    worldMat.multiplyMatrices(headMat, partObj.matrix);
    pushStatic(bucketKey, geo, worldMat);
  };

  if (!mountSpec || mountSpec.mount === 'pole') {
    addPart('darkGraphite', shared.knuckleGeo, 0, -0.22, 0);
    return;
  }

  if (mountSpec.mount === 'ceiling') {
    const camY = effectivePos[1];
    const topLocalY = Math.max(0.32, mountSpec.ceilingY - camY);
    const startY = camCfg.type === 'dome' ? 0.26 : 0.14;
    const stemH = Math.max(0.08, topLocalY - startY);

    addPart('darkGraphite', shared.stemUnitGeo, 0, startY + stemH * 0.5, 0, 1, stemH, 1);
    addPart('titaniumTrim', shared.ceilingFlangeGeo, 0, topLocalY - 0.04, 0);
    return;
  }

  if (mountSpec.mount === 'cantilever') {
    const [ax, ay, az] = mountSpec.anchorOffset;
    const armY = camCfg.type === 'dome' ? 0.30 : 0.18;
    const horizLen = Math.hypot(ax, az);

    const armGeo = new THREE.BoxGeometry(
      Math.abs(ax) > 0.01 ? Math.abs(ax) + 0.12 : 0.11,
      0.10,
      Math.abs(az) > 0.01 ? Math.abs(az) + 0.12 : 0.11
    );
    addPart('darkGraphite', armGeo, ax * 0.5, armY, az * 0.5);
    armGeo.dispose();

    const vertH = Math.max(0.15, ay - armY);
    addPart('darkGraphite', shared.stemUnitGeo, ax, armY + vertH * 0.5, az, 1.15, vertH, 1.15);
    addPart('titaniumTrim', shared.ceilingFlangeGeo, ax, ay - 0.04, az);

    if (horizLen > 0.05) {
      addPart('titaniumTrim', shared.knuckleGeo, ax, armY, az);
    }
    return;
  }

  if (mountSpec.mount === 'wall') {
    const [ax, , az] = mountSpec.anchorOffset;
    const len = Math.hypot(ax, az);
    const armGeo = new THREE.BoxGeometry(0.10, 0.10, len + 0.08);
    addPart('darkGraphite', armGeo, ax * 0.5, -0.10, az * 0.5);
    armGeo.dispose();

    addPart('darkGraphite', shared.stemUnitGeo, 0, -0.02, 0, 0.95, 0.22, 0.95);
    addPart('titaniumTrim', shared.wallPlateGeo, ax, -0.10, az);
    return;
  }

  if (mountSpec.mount === 'column') {
    const [ax, , az] = mountSpec.anchorOffset;
    const armGeo = new THREE.BoxGeometry(Math.abs(ax) + 0.14, 0.11, 0.11);
    addPart('darkGraphite', armGeo, ax * 0.5, -0.08, az * 0.5);
    armGeo.dispose();

    addPart('darkGraphite', shared.stemUnitGeo, 0, -0.02, 0, 0.95, 0.20, 0.95);
    addPart('titaniumTrim', shared.columnClampGeo, ax, -0.08, az);
  }
}

/**
 * 构造单路摄像头的轻量级定位与告警挂载组（仅在告警时渲染脉冲环与光束，常规状态 0 Draw Call）
 * 同时将其所有静态外观构件（支架/遮阳罩/饰环/镜头）收集至楼层材质合批桶
 */
function buildCameraHeadShell(camCfg, effectivePos, mountSpec, shared, pushStatic) {
  const head = new THREE.Group();
  head.name = `CamHead_${camCfg.id}`;
  head.position.set(...effectivePos);
  head.updateMatrix();
  const headMat = head.matrix.clone();

  collectMountHardware(pushStatic, camCfg, effectivePos, mountSpec, shared, headMat);

  const aimObj = new THREE.Object3D();
  aimObj.rotation.order = 'YXZ';
  aimObj.rotation.y = camCfg.yaw;
  aimObj.rotation.x = -camCfg.pitch;
  aimObj.updateMatrix();
  const aimWorldMat = new THREE.Matrix4().multiplyMatrices(headMat, aimObj.matrix);

  const localObj = new THREE.Object3D();
  const tmpMat = new THREE.Matrix4();
  const pushLocal = (parentMat, bucketKey, geo, px, py, pz) => {
    localObj.position.set(px, py, pz);
    localObj.rotation.set(0, 0, 0);
    localObj.scale.set(1, 1, 1);
    localObj.updateMatrix();
    tmpMat.multiplyMatrices(parentMat, localObj.matrix);
    pushStatic(bucketKey, geo, tmpMat);
  };

  if (camCfg.type === 'bullet') {
    pushLocal(aimWorldMat, 'titaniumTrim', shared.bulletBevelBandGeo, 0, 0.02, -0.04);
    pushLocal(aimWorldMat, 'darkGraphite', shared.bulletHoodGeo, 0, 0.225, 0.08);
    pushLocal(aimWorldMat, 'darkGraphite', shared.bulletRearCapGeo, 0, 0, -0.54);
    pushLocal(aimWorldMat, 'darkGraphite', shared.bulletLensBezelGeo, 0, -0.01, 0.56);
    pushLocal(aimWorldMat, 'lensGlass', shared.bulletLensJewelGeo, 0, -0.01, 0.63);
  } else {
    pushLocal(headMat, 'titaniumTrim', shared.domeBasePlateGeo, 0, 0.28, 0);
    pushLocal(headMat, 'darkGraphite', shared.domeTrimGeo, 0, 0.06, 0);
    pushLocal(headMat, 'lensGlass', shared.domeBubbleGeo, 0, 0.08, 0);
    pushLocal(aimWorldMat, 'lensCore', shared.domePupilGeo, 0, -0.08, 0.10);
  }

  // 告警脉冲扩散环（仅 alarm_critical / alarm_order / tamper 状态显示）
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

  // 告警垂直细光束锚标
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

  return { head, pulseRing, pulseMat, beacon, beaconMat };
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

  const shared = createSharedHardwareAssets();

  // 按爆炸楼层（outdoor / 1F / 2F）与材质分组收集静态硬件几何，消除 122 次零散 Draw Call
  const floorBuckets = new Map();
  const getFloorBucket = (floorKey) => {
    if (!floorBuckets.has(floorKey)) {
      floorBuckets.set(floorKey, {
        darkGraphite: [],
        titaniumTrim: [],
        lensGlass: [],
        lensCore: [],
      });
    }
    return floorBuckets.get(floorKey);
  };
  const makeStaticPusher = (floorKey) => (matKey, srcGeo, matrix) => {
    getFloorBucket(floorKey)[matKey].push(prepareGeoForMerge(srcGeo, matrix));
  };

  // 解析每路摄像头的最终精准点位与安装方式
  const resolvedCameras = SECURITY_CAMERAS.map((cfg) => {
    const mountSpec = CAMERA_MOUNT_SPECS[cfg.id] || {
      mount: cfg.isIndoor ? 'ceiling' : 'pole',
      ceilingY: cfg.floor === '2F' ? ELEVATIONS.FLOOR_3_Y : ELEVATIONS.FLOOR_2_Y,
    };
    const effectivePos = mountSpec.overridePos ? [...mountSpec.overridePos] : [...cfg.position];
    const floorKey = cfg.isIndoor ? cfg.floor : 'outdoor';
    return {
      cfg: { ...cfg, position: effectivePos },
      effectivePos,
      mountSpec,
      floorKey,
    };
  });

  // 1. A13/A14 修复：仅对室外独立立杆摄像头（CAM-09 / CAM-10 / CAM-11）合批精工立杆与沉地法兰至 outdoor 静态桶
  const outdoorPoleEntries = resolvedCameras.filter((item) => item.mountSpec.mount === 'pole');
  if (outdoorPoleEntries.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.10, 0.15, 1, 12);
    const flangeGeo = new THREE.CylinderGeometry(0.36, 0.42, 0.20, 14);
    const collarGeo = new THREE.CylinderGeometry(0.20, 0.26, 0.14, 12);
    const pushOutdoor = makeStaticPusher('outdoor');
    const dummy = new THREE.Object3D();

    outdoorPoleEntries.forEach(({ effectivePos }) => {
      const h = effectivePos[1] - 0.12;
      // 立杆从 y=-0.02 升至镜头安装座
      dummy.position.set(effectivePos[0], -0.02 + h * 0.5, effectivePos[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      pushOutdoor('darkGraphite', poleGeo, dummy.matrix);

      // 沉地倒角法兰底座（y=0.06, h=0.20 -> [-0.04, +0.16]，彻底根治草坪 0.05m 悬浮）
      dummy.position.set(effectivePos[0], 0.06, effectivePos[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pushOutdoor('darkGraphite', flangeGeo, dummy.matrix);

      // 拉丝钛银收口套环
      dummy.position.set(effectivePos[0], 0.21, effectivePos[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pushOutdoor('titaniumTrim', collarGeo, dummy.matrix);
    });

    poleGeo.dispose();
    flangeGeo.dispose();
    collarGeo.dispose();
  }

  // 2. 构建 12 路精工摄像头轻量定位壳 + 视锥映射表，并统计枪机/球机动态实例索引
  const cameraMap = new Map();
  const bulletEntries = [];
  const domeEntries = [];

  for (const { cfg, effectivePos, mountSpec, floorKey } of resolvedCameras) {
    const pushStatic = makeStaticPusher(floorKey);
    const headBundle = buildCameraHeadShell(cfg, effectivePos, mountSpec, shared, pushStatic);
    camerasGroup.add(headBundle.head);

    const fovBundle = buildCameraFovFrustum(cfg);
    fovBundle.fovGrp.position.set(...effectivePos);
    fovGroup.add(fovBundle.fovGrp);

    const isBullet = cfg.type === 'bullet';
    const instanceIdx = isBullet ? bulletEntries.length : domeEntries.length;

    const entry = {
      config: { ...cfg },
      state: cfg.state || 'online',
      preOfflineState: null,
      baseY: effectivePos[1],
      floorKey,
      isBullet,
      instanceIdx,
      ...headBundle,
      ...fovBundle,
    };

    cameraMap.set(cfg.id, entry);
    if (isBullet) bulletEntries.push(entry);
    else domeEntries.push(entry);
  }

  // 3. 东北机房 3 台精工 19 寸大华 NVR 汇聚节点（静态机箱/面板/散热槽合批至对应楼层桶，状态灯条合批为 InstancedMesh）
  const nvrMap = new Map();
  const nvrList = [];
  const nvrGroup = new THREE.Group();
  nvrGroup.name = 'NvrCoreNodes';

  const nvrPartObj = new THREE.Object3D();
  const nvrWorldMat = new THREE.Matrix4();
  const nvrBaseMat = new THREE.Matrix4();

  for (const nvr of NVR_DEVICES) {
    const floorKey = nvr.floor || '1F';
    const pushNvrStatic = makeStaticPusher(floorKey);

    const nodeGrp = new THREE.Group();
    nodeGrp.position.set(...nvr.nodePosition);
    nodeGrp.updateMatrix();
    nvrBaseMat.copy(nodeGrp.matrix);

    const addNvrPart = (matKey, geo, px, py, pz) => {
      nvrPartObj.position.set(px, py, pz);
      nvrPartObj.rotation.set(0, 0, 0);
      nvrPartObj.scale.set(1, 1, 1);
      nvrPartObj.updateMatrix();
      nvrWorldMat.multiplyMatrices(nvrBaseMat, nvrPartObj.matrix);
      pushNvrStatic(matKey, geo, nvrWorldMat);
    };

    addNvrPart('darkGraphite', shared.nvrChassisGeo, 0, 1.32, 0.06);
    addNvrPart('titaniumTrim', shared.nvrFaceplateGeo, 0, 1.32, 0.56);
    addNvrPart('darkGraphite', shared.nvrVentGeo, -0.30, 1.32, 0.585);

    const faultMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const faultRing = new THREE.Mesh(shared.nvrFaultRingGeo, faultMat);
    faultRing.rotation.x = -Math.PI / 2;
    faultRing.position.y = 1.65;
    faultRing.visible = false;
    nodeGrp.add(faultRing);

    const faultBeacon = new THREE.Mesh(
      shared.nvrFaultBeaconGeo,
      new THREE.MeshBasicMaterial({ color: '#ef4444', transparent: true, opacity: 0.36, depthWrite: false })
    );
    faultBeacon.position.y = 5.2;
    faultBeacon.visible = false;
    nodeGrp.add(faultBeacon);

    nvrGroup.add(nodeGrp);
    const nvrEntry = {
      config: { ...nvr },
      isOffline: false,
      baseY: nvr.nodePosition[1],
      floorKey,
      instanceIdx: nvrList.length,
      nodeGrp,
      faultRing,
      faultMat,
      faultBeacon,
    };
    nvrMap.set(nvr.id, nvrEntry);
    nvrList.push(nvrEntry);
  }
  camerasGroup.add(nvrGroup);

  // 4. 合并并挂载按楼层划分的静态硬件 Mesh（outdoor / 1F / 2F，共 11 次 Draw Call）
  const staticMatTable = {
    darkGraphite: shared.darkGraphiteMat,
    titaniumTrim: shared.titaniumTrimMat,
    lensGlass: shared.lensGlassMat,
    lensCore: shared.lensCoreMat,
  };
  const floorStaticGroups = new Map();
  for (const [floorKey, bucket] of floorBuckets.entries()) {
    const grp = new THREE.Group();
    grp.name = `CameraStaticHardware_${floorKey}`;
    for (const [matKey, geoList] of Object.entries(bucket)) {
      const merged = mergeBucketGeometries(geoList);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, staticMatTable[matKey]);
      mesh.name = `CamStatic_${floorKey}_${matKey}`;
      if (floorKey === 'outdoor' && matKey === 'darkGraphite') {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      grp.add(mesh);
    }
    camerasGroup.add(grp);
    floorStaticGroups.set(floorKey, grp);
  }

  // 释放已被合并克隆完毕的临时基础几何体，零显存冗余
  for (const tempGeo of [
    shared.knuckleGeo,
    shared.stemUnitGeo,
    shared.ceilingFlangeGeo,
    shared.wallPlateGeo,
    shared.columnClampGeo,
    shared.bulletBevelBandGeo,
    shared.bulletHoodGeo,
    shared.bulletRearCapGeo,
    shared.bulletLensBezelGeo,
    shared.bulletLensJewelGeo,
    shared.domeBasePlateGeo,
    shared.domeTrimGeo,
    shared.domeBubbleGeo,
    shared.domePupilGeo,
    shared.nvrChassisGeo,
    shared.nvrFaceplateGeo,
    shared.nvrVentGeo,
  ]) {
    tempGeo.dispose();
  }

  // 5. 构建 5 个共享动态状态 InstancedMesh（机身色相 + 逐实例 HDR 自发光状态灯，支持独立告警与爆炸同步）
  const bodyInstMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.34,
    metalness: 0.32,
  });
  const statusInstMat = createInstancedStatusMaterial();

  const bulletBodyInst =
    bulletEntries.length > 0
      ? new THREE.InstancedMesh(shared.bulletBodyGeo, bodyInstMat, bulletEntries.length)
      : null;
  if (bulletBodyInst) {
    bulletBodyInst.name = 'BulletCameraBodies';
    bulletBodyInst.castShadow = true;
    bulletBodyInst.frustumCulled = false;
    camerasGroup.add(bulletBodyInst);
  }

  const domeCollarInst =
    domeEntries.length > 0
      ? new THREE.InstancedMesh(shared.domeCollarGeo, bodyInstMat, domeEntries.length)
      : null;
  if (domeCollarInst) {
    domeCollarInst.name = 'DomeCameraCollars';
    domeCollarInst.castShadow = true;
    domeCollarInst.frustumCulled = false;
    camerasGroup.add(domeCollarInst);
  }

  const bulletEmissiveAttr =
    bulletEntries.length > 0
      ? new THREE.InstancedBufferAttribute(new Float32Array(bulletEntries.length * 3), 3)
      : null;
  const bulletStatusInst =
    bulletEntries.length > 0
      ? (() => {
          shared.bulletStatusRingGeo.setAttribute('aEmissive', bulletEmissiveAttr);
          const inst = new THREE.InstancedMesh(shared.bulletStatusRingGeo, statusInstMat, bulletEntries.length);
          inst.name = 'BulletStatusRings';
          inst.frustumCulled = false;
          camerasGroup.add(inst);
          return inst;
        })()
      : null;

  const domeEmissiveAttr =
    domeEntries.length > 0
      ? new THREE.InstancedBufferAttribute(new Float32Array(domeEntries.length * 3), 3)
      : null;
  const domeStatusInst =
    domeEntries.length > 0
      ? (() => {
          shared.domeStatusRingGeo.setAttribute('aEmissive', domeEmissiveAttr);
          const inst = new THREE.InstancedMesh(shared.domeStatusRingGeo, statusInstMat, domeEntries.length);
          inst.name = 'DomeStatusRings';
          inst.frustumCulled = false;
          camerasGroup.add(inst);
          return inst;
        })()
      : null;

  const nvrEmissiveAttr =
    nvrList.length > 0
      ? new THREE.InstancedBufferAttribute(new Float32Array(nvrList.length * 3), 3)
      : null;
  const nvrLedInst =
    nvrList.length > 0
      ? (() => {
          shared.nvrLedBarGeo.setAttribute('aEmissive', nvrEmissiveAttr);
          const inst = new THREE.InstancedMesh(shared.nvrLedBarGeo, statusInstMat, nvrList.length);
          inst.name = 'NvrStatusLeds';
          inst.frustumCulled = false;
          camerasGroup.add(inst);
          return inst;
        })()
      : null;

  const tmpColor = new THREE.Color();
  const tmpEmissive = new THREE.Color();
  const tmpObj = new THREE.Object3D();
  const tmpLocalObj = new THREE.Object3D();
  const tmpMat = new THREE.Matrix4();

  function normalizeState(state) {
    return STATE_ALIASES[state] || state;
  }

  function applyStateVisuals(entry, state) {
    const resolved = normalizeState(state);
    const style = STATE_STYLES[resolved] || STATE_STYLES.online;
    entry.state = resolved;

    const bodyInst = entry.isBullet ? bulletBodyInst : domeCollarInst;
    const statusInst = entry.isBullet ? bulletStatusInst : domeStatusInst;
    const emissiveAttr = entry.isBullet ? bulletEmissiveAttr : domeEmissiveAttr;

    if (bodyInst) {
      bodyInst.setColorAt(entry.instanceIdx, tmpColor.set(style.bodyColor));
      if (bodyInst.instanceColor) bodyInst.instanceColor.needsUpdate = true;
    }
    if (statusInst && emissiveAttr) {
      statusInst.setColorAt(entry.instanceIdx, tmpColor.set(style.color));
      if (statusInst.instanceColor) statusInst.instanceColor.needsUpdate = true;
      tmpEmissive.set(style.emissive);
      emissiveAttr.setXYZ(
        entry.instanceIdx,
        tmpEmissive.r * style.emissiveIntensity,
        tmpEmissive.g * style.emissiveIntensity,
        tmpEmissive.b * style.emissiveIntensity
      );
      emissiveAttr.needsUpdate = true;
    }

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

  function applyNvrVisuals(nvr) {
    if (nvrLedInst && nvrEmissiveAttr) {
      if (nvr.isOffline) {
        nvrLedInst.setColorAt(nvr.instanceIdx, tmpColor.set('#ef4444'));
        tmpEmissive.set('#dc2626');
        nvrEmissiveAttr.setXYZ(nvr.instanceIdx, tmpEmissive.r * 3.2, tmpEmissive.g * 3.2, tmpEmissive.b * 3.2);
      } else {
        nvrLedInst.setColorAt(nvr.instanceIdx, tmpColor.set('#10b981'));
        tmpEmissive.set('#10b981');
        nvrEmissiveAttr.setXYZ(nvr.instanceIdx, tmpEmissive.r * 1.85, tmpEmissive.g * 1.85, tmpEmissive.b * 1.85);
      }
      if (nvrLedInst.instanceColor) nvrLedInst.instanceColor.needsUpdate = true;
      nvrEmissiveAttr.needsUpdate = true;
    }
    nvr.faultRing.visible = nvr.isOffline;
    nvr.faultBeacon.visible = nvr.isOffline;
  }

  let hiddenFloors = new Set();

  function syncDynamicTransforms(explodeFactor) {
    for (const [floorKey, grp] of floorStaticGroups.entries()) {
      grp.position.y = getFloorExplodeOffset(floorKey, explodeFactor);
      grp.visible = !hiddenFloors.has(floorKey);
    }

    for (const entry of cameraMap.values()) {
      const dy = entry.config.isIndoor
        ? getFloorExplodeOffset(entry.config.floor, explodeFactor)
        : 0;
      const x = entry.config.position[0];
      const y = entry.baseY + dy;
      const z = entry.config.position[2];

      entry.head.position.y = y;
      entry.fovGrp.position.y = y;
      const hiddenByFloor = entry.config.isIndoor && hiddenFloors.has(entry.config.floor);
      entry.head.visible = !hiddenByFloor;
      entry.fovGrp.visible = !hiddenByFloor;

      if (entry.isBullet) {
        tmpObj.position.set(x, y, z);
        tmpObj.rotation.order = 'YXZ';
        tmpObj.rotation.set(-entry.config.pitch, entry.config.yaw, 0);
        tmpObj.scale.setScalar(hiddenByFloor ? 0 : 1);
        tmpObj.updateMatrix();
        if (bulletBodyInst) bulletBodyInst.setMatrixAt(entry.instanceIdx, tmpObj.matrix);

        if (bulletStatusInst) {
          tmpLocalObj.position.set(0, -0.01, 0.54);
          tmpLocalObj.rotation.set(0, 0, 0);
          tmpLocalObj.scale.set(1, 1, 1);
          tmpLocalObj.updateMatrix();
          tmpMat.multiplyMatrices(tmpObj.matrix, tmpLocalObj.matrix);
          bulletStatusInst.setMatrixAt(entry.instanceIdx, tmpMat);
        }
      } else {
        tmpObj.rotation.order = 'XYZ';
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.scale.setScalar(hiddenByFloor ? 0 : 1);
        if (domeCollarInst) {
          tmpObj.position.set(x, y + 0.16, z);
          tmpObj.updateMatrix();
          domeCollarInst.setMatrixAt(entry.instanceIdx, tmpObj.matrix);
        }
        if (domeStatusInst) {
          tmpObj.position.set(x, y + 0.08, z);
          tmpObj.updateMatrix();
          domeStatusInst.setMatrixAt(entry.instanceIdx, tmpObj.matrix);
        }
      }
    }

    for (const nvr of nvrMap.values()) {
      const dy = getFloorExplodeOffset(nvr.config.floor, explodeFactor);
      const y = nvr.baseY + dy;
      nvr.nodeGrp.position.y = y;
      const nvrHidden = hiddenFloors.has(nvr.config.floor);
      nvr.nodeGrp.visible = !nvrHidden;

      if (nvrLedInst) {
        tmpObj.position.set(
          nvr.config.nodePosition[0] + 0.28,
          y + 1.32,
          nvr.config.nodePosition[2] + 0.59
        );
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.scale.setScalar(nvrHidden ? 0 : 1);
        tmpObj.updateMatrix();
        nvrLedInst.setMatrixAt(nvr.instanceIdx, tmpObj.matrix);
      }
    }

    if (bulletBodyInst) bulletBodyInst.instanceMatrix.needsUpdate = true;
    if (domeCollarInst) domeCollarInst.instanceMatrix.needsUpdate = true;
    if (bulletStatusInst) bulletStatusInst.instanceMatrix.needsUpdate = true;
    if (domeStatusInst) domeStatusInst.instanceMatrix.needsUpdate = true;
    if (nvrLedInst) nvrLedInst.instanceMatrix.needsUpdate = true;
  }

  // 初始化全部摄像头与 NVR 的初始矩阵、颜色与自发光属性
  for (const entry of cameraMap.values()) applyStateVisuals(entry, entry.state);
  for (const nvr of nvrMap.values()) applyNvrVisuals(nvr);
  syncDynamicTransforms(0);

  let currentExplodeFactor = 0;

  return {
    camerasGroup,
    fovGroup,
    setCameraState(cameraId, state) {
      const entry = cameraMap.get(cameraId);
      if (!entry) return false;
      const resolved = normalizeState(state);
      if (!STATE_STYLES[resolved]) return false;
      applyStateVisuals(entry, resolved);
      return true;
    },
    setNvrOffline(nvrId, isOffline) {
      const nvr = nvrMap.get(nvrId);
      if (!nvr) return false;
      nvr.isOffline = Boolean(isOffline);
      applyNvrVisuals(nvr);

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
      return true;
    },
    syncExplosion(explodeFactor) {
      currentExplodeFactor = explodeFactor;
      syncDynamicTransforms(explodeFactor);
    },
    /** 分层剖切联动：被剖切楼层上的室内摄像头/NVR 硬件一并隐藏 */
    setHiddenFloors(hiddenSet) {
      hiddenFloors = new Set(hiddenSet || []);
      syncDynamicTransforms(currentExplodeFactor);
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
        if (
          entry.state === 'alarm_critical' ||
          entry.state === 'alarm_order' ||
          entry.state === 'tamper'
        ) {
          return true;
        }
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
