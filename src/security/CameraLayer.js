import * as THREE from 'three';
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
 * 为单路摄像头构建严密贴合建筑/立柱/天花的物理安装支架（根治 A12 / A13 全部悬空）
 */
function attachMountHardware(head, camCfg, effectivePos, mountSpec, shared) {
  if (!mountSpec || mountSpec.mount === 'pole') {
    // 室外独立立杆顶部万向横臂转接头
    const joint = new THREE.Mesh(shared.knuckleGeo, shared.darkGraphiteMat);
    joint.position.set(0, -0.22, 0);
    head.add(joint);
    return;
  }

  if (mountSpec.mount === 'ceiling') {
    const camY = effectivePos[1];
    const topLocalY = Math.max(0.32, mountSpec.ceilingY - camY);
    const startY = camCfg.type === 'dome' ? 0.26 : 0.14;
    const stemH = Math.max(0.08, topLocalY - startY);

    const stem = new THREE.Mesh(shared.stemUnitGeo, shared.darkGraphiteMat);
    stem.scale.set(1, stemH, 1);
    stem.position.set(0, startY + stemH * 0.5, 0);
    head.add(stem);

    const rose = new THREE.Mesh(shared.ceilingFlangeGeo, shared.titaniumTrimMat);
    rose.position.set(0, topLocalY - 0.04, 0);
    head.add(rose);
    return;
  }

  if (mountSpec.mount === 'cantilever') {
    const [ax, ay, az] = mountSpec.anchorOffset;
    const armY = camCfg.type === 'dome' ? 0.30 : 0.18;

    // 水平悬臂段（从相机顶部伸至实心廊道边梁）
    const horizLen = Math.hypot(ax, az);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(ax) > 0.01 ? Math.abs(ax) + 0.12 : 0.11, 0.10, Math.abs(az) > 0.01 ? Math.abs(az) + 0.12 : 0.11),
      shared.darkGraphiteMat
    );
    arm.position.set(ax * 0.5, armY, az * 0.5);
    head.add(arm);

    // 垂直锚固立管（在廊道实心区向上顶抵上层楼板底面）
    const vertH = Math.max(0.15, ay - armY);
    const vert = new THREE.Mesh(shared.stemUnitGeo, shared.darkGraphiteMat);
    vert.scale.set(1.15, vertH, 1.15);
    vert.position.set(ax, armY + vertH * 0.5, az);
    head.add(vert);

    const rose = new THREE.Mesh(shared.ceilingFlangeGeo, shared.titaniumTrimMat);
    rose.position.set(ax, ay - 0.04, az);
    head.add(rose);

    // 弯头加强节点
    if (horizLen > 0.05) {
      const elbow = new THREE.Mesh(shared.knuckleGeo, shared.titaniumTrimMat);
      elbow.position.set(ax, armY, az);
      head.add(elbow);
    }
    return;
  }

  if (mountSpec.mount === 'wall') {
    const [ax, , az] = mountSpec.anchorOffset;
    const len = Math.hypot(ax, az);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.10, len + 0.08),
      shared.darkGraphiteMat
    );
    arm.position.set(ax * 0.5, -0.10, az * 0.5);
    head.add(arm);

    const riser = new THREE.Mesh(shared.stemUnitGeo, shared.darkGraphiteMat);
    riser.scale.set(0.95, 0.22, 0.95);
    riser.position.set(0, -0.02, 0);
    head.add(riser);

    const plate = new THREE.Mesh(shared.wallPlateGeo, shared.titaniumTrimMat);
    plate.position.set(ax, -0.10, az);
    head.add(plate);
    return;
  }

  if (mountSpec.mount === 'column') {
    const [ax, , az] = mountSpec.anchorOffset;
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(Math.abs(ax) + 0.14, 0.11, 0.11),
      shared.darkGraphiteMat
    );
    arm.position.set(ax * 0.5, -0.08, az * 0.5);
    head.add(arm);

    const riser = new THREE.Mesh(shared.stemUnitGeo, shared.darkGraphiteMat);
    riser.scale.set(0.95, 0.20, 0.95);
    riser.position.set(0, -0.02, 0);
    head.add(riser);

    // 环抱中央门廊钢柱的精密抱箍卡环（严密套合柱径 0.36m）
    const clamp = new THREE.Mesh(shared.columnClampGeo, shared.titaniumTrimMat);
    clamp.position.set(ax, -0.08, az);
    head.add(clamp);
  }
}

/**
 * 构造单路精工微缩 3D 枪机（bullet）或球机（dome）头部组件
 */
function buildCameraHead(camCfg, effectivePos, mountSpec, shared) {
  const head = new THREE.Group();
  head.name = `CamHead_${camCfg.id}`;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: STATE_STYLES.online.bodyColor,
    roughness: 0.34,
    metalness: 0.32,
  });
  const statusMat = new THREE.MeshStandardMaterial({
    color: STATE_STYLES.online.color,
    emissive: new THREE.Color(STATE_STYLES.online.emissive),
    emissiveIntensity: STATE_STYLES.online.emissiveIntensity,
    roughness: 0.18,
  });

  // 物理挂装支架（随 head 一体参与爆炸位移，零悬空）
  attachMountHardware(head, camCfg, effectivePos, mountSpec, shared);

  // 相机指向器（按 yaw / pitch 朝向监控方向，局部 +Z 为镜头光轴）
  const aimGroup = new THREE.Group();
  aimGroup.rotation.order = 'YXZ';
  aimGroup.rotation.y = camCfg.yaw;
  aimGroup.rotation.x = -camCfg.pitch;

  if (camCfg.type === 'bullet') {
    // 缎面瓷灰机身 + 钛银腰带 + 深石墨上挑防雨遮阳罩 + 宝石感光学镜头 + 状态光环
    const housing = new THREE.Mesh(shared.bulletBodyGeo, bodyMat);
    housing.castShadow = true;
    aimGroup.add(housing);

    const trimBand = new THREE.Mesh(shared.bulletBevelBandGeo, shared.titaniumTrimMat);
    trimBand.position.set(0, 0.02, -0.04);
    aimGroup.add(trimBand);

    const hood = new THREE.Mesh(shared.bulletHoodGeo, shared.darkGraphiteMat);
    hood.position.set(0, 0.225, 0.08);
    aimGroup.add(hood);

    const rearCap = new THREE.Mesh(shared.bulletRearCapGeo, shared.darkGraphiteMat);
    rearCap.position.set(0, 0, -0.54);
    aimGroup.add(rearCap);

    const lensBezel = new THREE.Mesh(shared.bulletLensBezelGeo, shared.darkGraphiteMat);
    lensBezel.position.set(0, -0.01, 0.56);
    aimGroup.add(lensBezel);

    const lensJewel = new THREE.Mesh(shared.bulletLensJewelGeo, shared.lensGlassMat);
    lensJewel.position.set(0, -0.01, 0.63);
    aimGroup.add(lensJewel);

    const ring = new THREE.Mesh(shared.bulletStatusRingGeo, statusMat);
    ring.position.set(0, -0.01, 0.54);
    aimGroup.add(ring);
  } else {
    // 精工球机：倒角瓷灰法兰基座 + 钛银饰圈 + 熏蓝光学球罩 + 内置镜头瞳仁 + 微距环形状态灯
    const basePlate = new THREE.Mesh(shared.domeBasePlateGeo, shared.titaniumTrimMat);
    basePlate.position.y = 0.28;
    head.add(basePlate);

    const collar = new THREE.Mesh(shared.domeCollarGeo, bodyMat);
    collar.position.y = 0.16;
    collar.castShadow = true;
    head.add(collar);

    const trim = new THREE.Mesh(shared.domeTrimGeo, shared.darkGraphiteMat);
    trim.position.y = 0.06;
    head.add(trim);

    const dome = new THREE.Mesh(shared.domeBubbleGeo, shared.lensGlassMat);
    dome.position.y = 0.08;
    head.add(dome);

    const pupil = new THREE.Mesh(shared.domePupilGeo, shared.lensCoreMat);
    pupil.position.set(0, -0.08, 0.10);
    aimGroup.add(pupil);

    const statusRing = new THREE.Mesh(shared.domeStatusRingGeo, statusMat);
    statusRing.position.y = 0.08;
    head.add(statusRing);
  }

  head.add(aimGroup);

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

  // 解析每路摄像头的最终精准点位与安装方式
  const resolvedCameras = SECURITY_CAMERAS.map((cfg) => {
    const mountSpec = CAMERA_MOUNT_SPECS[cfg.id] || {
      mount: cfg.isIndoor ? 'ceiling' : 'pole',
      ceilingY: cfg.floor === '2F' ? ELEVATIONS.FLOOR_3_Y : ELEVATIONS.FLOOR_2_Y,
    };
    const effectivePos = mountSpec.overridePos ? [...mountSpec.overridePos] : [...cfg.position];
    return {
      cfg: { ...cfg, position: effectivePos },
      effectivePos,
      mountSpec,
    };
  });

  // 1. A13/A14 修复：仅对真正的室外独立立杆摄像头（CAM-09 / CAM-10 / CAM-11）构建精工立杆与沉地法兰
  // - CAM-06 改由中央门廊柱抱箍安装，不再重复立杆
  // - CAM-10 已移出车道至 x=-150.2
  // - 全部法兰座底延至 y=-0.04（[-0.04, +0.16]），在 0.00 草坪与 0.085 路缘上均零悬浮！
  const outdoorPoleEntries = resolvedCameras.filter((item) => item.mountSpec.mount === 'pole');
  if (outdoorPoleEntries.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.10, 0.15, 1, 12);
    const flangeGeo = new THREE.CylinderGeometry(0.36, 0.42, 0.20, 14);
    const collarGeo = new THREE.CylinderGeometry(0.20, 0.26, 0.14, 12);
    const poleInst = new THREE.InstancedMesh(poleGeo, shared.darkGraphiteMat, outdoorPoleEntries.length);
    const flangeInst = new THREE.InstancedMesh(flangeGeo, shared.darkGraphiteMat, outdoorPoleEntries.length);
    const collarInst = new THREE.InstancedMesh(collarGeo, shared.titaniumTrimMat, outdoorPoleEntries.length);
    poleInst.castShadow = true;
    poleInst.receiveShadow = true;
    flangeInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    outdoorPoleEntries.forEach(({ effectivePos }, idx) => {
      const h = effectivePos[1] - 0.12;
      // 立杆从 y=-0.02 升至镜头安装座
      dummy.position.set(effectivePos[0], -0.02 + h * 0.5, effectivePos[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(idx, dummy.matrix);

      // 沉地倒角法兰底座（y=0.06, h=0.20 -> [-0.04, +0.16]，彻底根治草坪 0.05m 悬浮）
      dummy.position.set(effectivePos[0], 0.06, effectivePos[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      flangeInst.setMatrixAt(idx, dummy.matrix);

      // 拉丝钛银收口套环
      dummy.position.set(effectivePos[0], 0.21, effectivePos[2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      collarInst.setMatrixAt(idx, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    flangeInst.instanceMatrix.needsUpdate = true;
    collarInst.instanceMatrix.needsUpdate = true;
    camerasGroup.add(poleInst, flangeInst, collarInst);
  }

  // 2. 构建 12 路精工摄像头实体与对应视锥映射表
  const cameraMap = new Map();
  for (const { cfg, effectivePos, mountSpec } of resolvedCameras) {
    const headBundle = buildCameraHead(cfg, effectivePos, mountSpec, shared);
    headBundle.head.position.set(...effectivePos);
    camerasGroup.add(headBundle.head);

    const fovBundle = buildCameraFovFrustum(cfg);
    fovBundle.fovGrp.position.set(...effectivePos);
    fovGroup.add(fovBundle.fovGrp);

    cameraMap.set(cfg.id, {
      config: { ...cfg },
      state: cfg.state || 'online',
      preOfflineState: null,
      baseY: effectivePos[1],
      ...headBundle,
      ...fovBundle,
    });
  }

  // 3. 东北机房 3 台精工 19 寸大华 NVR 汇聚节点（拉丝钛银面板 + 散热槽 + 状态光条 + 故障告警环）
  const nvrMap = new Map();
  const nvrGroup = new THREE.Group();
  nvrGroup.name = 'NvrCoreNodes';

  for (const nvr of NVR_DEVICES) {
    const nodeGrp = new THREE.Group();
    nodeGrp.position.set(...nvr.nodePosition);

    const chassis = new THREE.Mesh(shared.nvrChassisGeo, shared.darkGraphiteMat);
    chassis.position.set(0, 1.32, 0.06);
    nodeGrp.add(chassis);

    const faceplate = new THREE.Mesh(shared.nvrFaceplateGeo, shared.titaniumTrimMat);
    faceplate.position.set(0, 1.32, 0.56);
    nodeGrp.add(faceplate);

    const vent = new THREE.Mesh(shared.nvrVentGeo, shared.darkGraphiteMat);
    vent.position.set(-0.30, 1.32, 0.585);
    nodeGrp.add(vent);

    const ledMat = new THREE.MeshStandardMaterial({
      color: '#10b981',
      emissive: new THREE.Color('#10b981'),
      emissiveIntensity: 1.85,
      roughness: 0.2,
    });
    const indicator = new THREE.Mesh(shared.nvrLedBarGeo, ledMat);
    indicator.position.set(0.28, 1.32, 0.59);
    nodeGrp.add(indicator);

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

  function normalizeState(state) {
    return STATE_ALIASES[state] || state;
  }

  function applyStateVisuals(entry, state) {
    const resolved = normalizeState(state);
    const style = STATE_STYLES[resolved] || STATE_STYLES.online;
    entry.state = resolved;
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

      if (nvr.isOffline) {
        nvr.ledMat.color.set('#ef4444');
        nvr.ledMat.emissive.set('#dc2626');
        nvr.ledMat.emissiveIntensity = 3.2;
        nvr.faultRing.visible = true;
        nvr.faultBeacon.visible = true;
      } else {
        nvr.ledMat.color.set('#10b981');
        nvr.ledMat.emissive.set('#10b981');
        nvr.ledMat.emissiveIntensity = 1.85;
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
      return true;
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
