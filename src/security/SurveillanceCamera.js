import * as THREE from 'three';

/**
 * 可复用安防摄像头组件（点位 Marker + 3D 视锥 Frustum + 地面覆盖投影 Footprint + 可选立杆/壁挂硬件 + 画中画取景相机）
 *
 * 新增摄像头只需一份 spec 即可复用整套组件：
 *   const cam = createSurveillanceCamera({
 *     id: 'CAM-13', name: '北大门主出入口枪机', type: 'bullet',
 *     floor: 'outdoor', isIndoor: false,
 *     position: [x, y, z],     // 镜头光心世界坐标（米）
 *     groundY: 0.07,           // 立杆落地标高 / 视锥地面投影平面
 *     yaw: -2.8, pitch: -0.32, // yaw 0 朝 +Z（南），PI/2 朝 +X（东）；pitch 负值俯视
 *     fovDeg: 62,              // 水平视场角
 *     aspect: 16 / 9, range: 36,
 *     mount: 'pole' | 'wall' | 'ceiling' | 'none',
 *     state: 'online',
 *   });
 *
 * 组件对外只暴露 Object3D 与少量方法，由 SurveillanceSystem 统一编排（爆炸分层、剖切、选中、状态联动）。
 */

export const CAMERA_STATE_STYLES = {
  online: { color: '#c7f26a', label: '在线', fov: '#c7f26a', fovOpacity: 0.16, pulse: false },
  offline: { color: '#8a9089', label: '离线', fov: '#8a9089', fovOpacity: 0.06, pulse: false },
  muted: { color: '#b7bcb2', label: '静默', fov: '#b7bcb2', fovOpacity: 0.08, pulse: false },
  alarm_critical: { color: '#ff5a4f', label: '紧急告警', fov: '#ff5a4f', fovOpacity: 0.24, pulse: true, speed: 1.6 },
  alarm_order: { color: '#ffb547', label: '工单告警', fov: '#ffb547', fovOpacity: 0.22, pulse: true, speed: 1.2 },
  tamper: { color: '#c08bff', label: '遮挡/篡改', fov: '#c08bff', fovOpacity: 0.22, pulse: true, speed: 2.0 },
};

const STATE_ALIASES = { normal: 'online', alarm: 'alarm_critical' };

export function normalizeCameraState(state) {
  const s = STATE_ALIASES[state] || state;
  return CAMERA_STATE_STYLES[s] ? s : null;
}

/* ------------------------------------------------------------------ */
/* 共享资源（所有实例复用同一批几何体、材质与点位贴图）                */
/* ------------------------------------------------------------------ */

let sharedAssets = null;

function drawPinTexture(color, selected) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // 外层磨砂光晕
  const halo = g.createRadialGradient(cx, cy, 20, cx, cy, 62);
  halo.addColorStop(0, hexA(color, selected ? 0.55 : 0.32));
  halo.addColorStop(1, hexA(color, 0));
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, 62, 0, Math.PI * 2);
  g.fill();

  // 深色玻璃底盘 + 状态色描边
  g.fillStyle = 'rgba(18, 21, 16, 0.86)';
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = selected ? 7 : 5;
  g.strokeStyle = color;
  g.stroke();

  // 摄像头图标（机身 + 镜头 + 支架）
  g.fillStyle = color;
  roundRect(g, cx - 17, cy - 10, 26, 16, 4);
  g.fill();
  g.beginPath();
  g.moveTo(cx + 9, cy - 4);
  g.lineTo(cx + 19, cy - 10);
  g.lineTo(cx + 19, cy + 6);
  g.lineTo(cx + 9, cy);
  g.closePath();
  g.fill();
  g.fillRect(cx - 7, cy + 6, 4, 9);
  g.fillRect(cx - 12, cy + 13, 14, 4);
  g.fillStyle = 'rgba(18, 21, 16, 0.9)';
  g.beginPath();
  g.arc(cx - 4, cy - 2, 4, 0, Math.PI * 2);
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexA(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`;
}

function getSharedAssets() {
  if (sharedAssets) return sharedAssets;
  const pinTextures = new Map();
  const getPinTexture = (state, selected) => {
    const key = `${state}|${selected ? 1 : 0}`;
    if (!pinTextures.has(key)) {
      pinTextures.set(key, drawPinTexture(CAMERA_STATE_STYLES[state].color, selected));
    }
    return pinTextures.get(key);
  };

  sharedAssets = {
    getPinTexture,
    poleGeo: new THREE.CylinderGeometry(0.11, 0.15, 1, 12),
    flangeGeo: new THREE.CylinderGeometry(0.34, 0.38, 0.12, 16),
    armGeo: new THREE.BoxGeometry(0.09, 0.09, 1),
    bulletBodyGeo: new THREE.CylinderGeometry(0.15, 0.15, 0.62, 18).rotateX(Math.PI / 2),
    bulletShadeGeo: new THREE.BoxGeometry(0.38, 0.05, 0.78),
    lensGeo: new THREE.CircleGeometry(0.11, 18),
    domeGeo: new THREE.SphereGeometry(0.26, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    domeBaseGeo: new THREE.CylinderGeometry(0.3, 0.3, 0.1, 20),
    ringGeo: new THREE.RingGeometry(0.85, 1.0, 40),
    bodyMat: new THREE.MeshStandardMaterial({ color: '#d9d6ce', roughness: 0.45, metalness: 0.15 }),
    darkMat: new THREE.MeshStandardMaterial({ color: '#2b2f2a', roughness: 0.4, metalness: 0.6 }),
    lensMat: new THREE.MeshStandardMaterial({
      color: '#0b1016',
      roughness: 0.08,
      metalness: 0.9,
      emissive: '#1c3b2a',
      emissiveIntensity: 0.6,
    }),
    domeMat: new THREE.MeshStandardMaterial({
      color: '#1a1f1c',
      roughness: 0.1,
      metalness: 0.4,
      transparent: true,
      opacity: 0.85,
    }),
  };
  return sharedAssets;
}

/* ------------------------------------------------------------------ */
/* 视锥：半透明渐变锥体 + 发光棱线 + 地面覆盖投影                        */
/* ------------------------------------------------------------------ */

const FRUSTUM_VERT = /* glsl */ `
  attribute float aDepth;
  varying float vDepth;
  void main() {
    vDepth = aDepth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FRUSTUM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying float vDepth;
  void main() {
    // 近端浓、远端淡，叠加向外推进的扫描光带
    float base = mix(1.0, 0.28, vDepth);
    float band = exp(-pow((fract(uTime * 0.32) - vDepth) * 9.0, 2.0)) * 0.9;
    gl_FragColor = vec4(uColor, uOpacity * (base + band));
  }
`;

function buildFrustum(spec) {
  const range = spec.range;
  const hw = Math.tan(THREE.MathUtils.degToRad(spec.fovDeg) / 2) * range;
  const hh = hw / spec.aspect;

  // 4 个侧面三角（apex + 远端两角），本地 +Z 为光轴
  const corners = [
    [-hw, hh, range],
    [hw, hh, range],
    [hw, -hh, range],
    [-hw, -hh, range],
  ];
  const pos = [];
  const depth = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    pos.push(0, 0, 0, ...a, ...b);
    depth.push(0, 1, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: FRUSTUM_VERT,
    fragmentShader: FRUSTUM_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color('#c7f26a') },
      uOpacity: { value: 0.16 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const volume = new THREE.Mesh(geo, mat);
  volume.name = 'FrustumVolume';
  volume.renderOrder = 20;

  const edgePts = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    edgePts.push(0, 0, 0, ...a, ...a, ...b);
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: '#c7f26a', transparent: true, opacity: 0.75, depthWrite: false });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.name = 'FrustumEdges';
  edges.renderOrder = 21;

  return { volume, edges, mat, edgeMat, corners };
}

/* ------------------------------------------------------------------ */
/* 硬件：立杆 / 壁挂 / 吊顶 + 枪机 / 球机                              */
/* ------------------------------------------------------------------ */

function buildHardware(spec, assets) {
  const grp = new THREE.Group();
  grp.name = `CamHardware_${spec.id}`;
  const mount = spec.mount || 'pole';
  const [x, y, z] = spec.position;

  const head = new THREE.Group();
  head.position.set(x, y, z);
  head.rotation.order = 'YXZ';
  head.rotation.set(-spec.pitch, spec.yaw, 0);

  if (spec.type === 'dome') {
    const base = new THREE.Mesh(assets.domeBaseGeo, assets.bodyMat);
    base.position.set(x, y + 0.12, z);
    const dome = new THREE.Mesh(assets.domeGeo, assets.domeMat);
    dome.position.set(x, y + 0.08, z);
    grp.add(base, dome);
  } else {
    const body = new THREE.Mesh(assets.bulletBodyGeo, assets.bodyMat);
    const shade = new THREE.Mesh(assets.bulletShadeGeo, assets.darkMat);
    shade.position.set(0, 0.17, 0.05);
    const lens = new THREE.Mesh(assets.lensGeo, assets.lensMat);
    lens.position.z = 0.315;
    head.add(body, shade, lens);
    for (const m of [body, shade]) m.castShadow = true;
  }
  grp.add(head);

  if (mount === 'pole') {
    const groundY = spec.groundY ?? 0;
    const topY = y + 0.32;
    const h = Math.max(0.5, topY - groundY);
    const pole = new THREE.Mesh(assets.poleGeo, assets.darkMat);
    // 立杆偏离镜头 0.7m（反光轴方向），通过水平悬臂连接
    const back = new THREE.Vector3(-Math.sin(spec.yaw), 0, -Math.cos(spec.yaw)).multiplyScalar(0.7);
    pole.scale.y = h;
    pole.position.set(x + back.x, groundY + h / 2, z + back.z);
    pole.castShadow = true;
    const flange = new THREE.Mesh(assets.flangeGeo, assets.darkMat);
    flange.position.set(x + back.x, groundY + 0.02, z + back.z);
    const arm = new THREE.Mesh(assets.armGeo, assets.darkMat);
    arm.scale.z = 0.75;
    arm.position.set(x + back.x / 2, topY, z + back.z / 2);
    arm.rotation.y = spec.yaw;
    grp.add(pole, flange, arm);
  } else if (mount === 'wall') {
    const arm = new THREE.Mesh(assets.armGeo, assets.darkMat);
    arm.scale.z = 0.8;
    const back = new THREE.Vector3(-Math.sin(spec.yaw), 0, -Math.cos(spec.yaw)).multiplyScalar(0.4);
    arm.position.set(x + back.x, y + 0.3, z + back.z);
    arm.rotation.y = spec.yaw;
    grp.add(arm);
  } else if (mount === 'ceiling') {
    const drop = Math.max(0.2, (spec.ceilingY ?? y + 0.6) - (y + 0.2));
    const rod = new THREE.Mesh(assets.poleGeo, assets.darkMat);
    rod.scale.set(0.5, drop, 0.5);
    rod.position.set(x, y + 0.2 + drop / 2, z);
    grp.add(rod);
  }
  return grp;
}

/* ------------------------------------------------------------------ */
/* 组件工厂                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_SPEC = {
  type: 'bullet',
  floor: 'outdoor',
  isIndoor: false,
  yaw: 0,
  pitch: -0.3,
  fovDeg: 60,
  aspect: 16 / 9,
  range: 30,
  mount: 'pole',
  state: 'online',
  markerHeight: 5.5,
};

/**
 * @param {object} rawSpec 摄像头元数据（见文件头注释）
 * @param {{ withHardware?: boolean }} [opts] 已有建模硬件的存量摄像头传 withHardware:false，只挂载点位/视锥
 */
export function createSurveillanceCamera(rawSpec, opts = {}) {
  const spec = { ...DEFAULT_SPEC, ...rawSpec };
  spec.position = [...spec.position];
  if (typeof spec.groundY !== 'number') spec.groundY = spec.isIndoor ? spec.position[1] - 4 : 0;
  const assets = getSharedAssets();
  const withHardware = opts.withHardware !== false;

  // 随爆炸分层整体平移的根节点（硬件 + 点位 + 视锥），世界坐标直接写在子节点上
  const root = new THREE.Group();
  root.name = `SurveillanceCamera_${spec.id}`;

  const hardware = withHardware ? buildHardware(spec, assets) : null;
  if (hardware) root.add(hardware);

  // ---- 视锥 ----
  const fovPivot = new THREE.Group();
  fovPivot.name = `CamFov_${spec.id}`;
  fovPivot.position.set(...spec.position);
  fovPivot.rotation.order = 'YXZ';
  fovPivot.rotation.set(-spec.pitch, spec.yaw, 0);
  const frustum = buildFrustum(spec);
  fovPivot.add(frustum.volume, frustum.edges);

  // 地面覆盖投影（四角光线与地面求交，得到实际监控覆盖区）
  const footprintGeo = new THREE.BufferGeometry();
  footprintGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 3), 3));
  const footprintMat = new THREE.MeshBasicMaterial({
    color: '#c7f26a',
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  });
  const footprint = new THREE.Mesh(footprintGeo, footprintMat);
  footprint.name = `CamFootprint_${spec.id}`;
  footprint.renderOrder = 19;
  footprint.frustumCulled = false;
  const footprintLineGeo = new THREE.BufferGeometry();
  footprintLineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(5 * 3), 3));
  const footprintLine = new THREE.Line(
    footprintLineGeo,
    new THREE.LineBasicMaterial({ color: '#c7f26a', transparent: true, opacity: 0.9, depthWrite: false })
  );
  footprintLine.frustumCulled = false;
  footprintLine.renderOrder = 19;

  const fovGroup = new THREE.Group();
  fovGroup.name = `CamFovGroup_${spec.id}`;
  fovGroup.add(fovPivot, footprint, footprintLine);
  fovGroup.visible = false;
  root.add(fovGroup);

  // ---- 点位 Marker：屏幕恒定尺寸图钉 + 引线 + 地面脉冲环 ----
  const markerGroup = new THREE.Group();
  markerGroup.name = `CamMarker_${spec.id}`;
  const pinMat = new THREE.SpriteMaterial({
    map: assets.getPinTexture(normalizeCameraState(spec.state) || 'online', false),
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
  });
  const pin = new THREE.Sprite(pinMat);
  pin.center.set(0.5, 0.5);
  pin.scale.set(0.026, 0.026, 1);
  pin.position.set(spec.position[0], spec.position[1] + spec.markerHeight, spec.position[2]);
  pin.renderOrder = 40;
  pin.userData.cameraId = spec.id;

  const leaderGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(spec.position[0], spec.position[1] + 0.4, spec.position[2]),
    new THREE.Vector3(spec.position[0], spec.position[1] + spec.markerHeight - 0.6, spec.position[2]),
  ]);
  const leaderMat = new THREE.LineDashedMaterial({
    color: '#c7f26a',
    dashSize: 0.5,
    gapSize: 0.35,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const leader = new THREE.Line(leaderGeo, leaderMat);
  leader.computeLineDistances();
  leader.renderOrder = 39;

  const ringMat = new THREE.MeshBasicMaterial({
    color: '#c7f26a',
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(assets.ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(spec.position[0], spec.groundY + 0.12, spec.position[2]);
  ring.renderOrder = 18;
  markerGroup.add(pin, leader, ring);
  root.add(markerGroup);

  // ---- 画中画取景相机（与真实镜头同位同姿态）----
  const vfov = THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(spec.fovDeg) / 2) / spec.aspect)
  );
  const previewCamera = new THREE.PerspectiveCamera(vfov, spec.aspect, 0.25, 1600);
  previewCamera.rotation.order = 'YXZ';

  let state = normalizeCameraState(spec.state) || 'online';
  let selected = false;
  let floorOffset = 0;

  const tmpV = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function refreshFootprint() {
    fovPivot.updateMatrixWorld(true);
    const apex = fovPivot.getWorldPosition(new THREE.Vector3());
    const groundY = spec.groundY + floorOffset + 0.1;
    const pts = frustum.corners.map((c) => {
      tmpV.set(...c).applyMatrix4(fovPivot.matrixWorld);
      tmpDir.copy(tmpV).sub(apex);
      if (tmpDir.y < -1e-3) {
        const t = (groundY - apex.y) / tmpDir.y;
        if (t > 0 && t <= 1.6) return apex.clone().addScaledVector(tmpDir, t);
      }
      return new THREE.Vector3(tmpV.x, groundY, tmpV.z);
    });
    // 下边两角光线落地为近端；上边光线若射向天空，则以远端平面投影收口，得到贴地梯形覆盖区
    const [tl, tr, br, bl] = pts;
    const arr = footprintGeo.attributes.position.array;
    const poly = [bl, br, tr, tl];
    const quad = [poly[0], poly[1], poly[2], poly[0], poly[2], poly[3]];
    quad.forEach((p, i) => {
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    });
    footprintGeo.attributes.position.needsUpdate = true;
    footprintGeo.computeBoundingSphere();
    const la = footprintLineGeo.attributes.position.array;
    [...poly, poly[0]].forEach((p, i) => {
      la[i * 3] = p.x;
      la[i * 3 + 1] = p.y;
      la[i * 3 + 2] = p.z;
    });
    footprintLineGeo.attributes.position.needsUpdate = true;
    footprintLineGeo.computeBoundingSphere();
  }

  function applyVisuals() {
    const style = CAMERA_STATE_STYLES[state];
    pinMat.map = assets.getPinTexture(state, selected);
    pinMat.needsUpdate = true;
    pin.scale.setScalar(selected ? 0.036 : 0.026);
    pin.scale.z = 1;
    leaderMat.color.set(style.color);
    ringMat.color.set(style.color);
    frustum.mat.uniforms.uColor.value.set(style.fov);
    frustum.mat.uniforms.uOpacity.value = style.fovOpacity * (selected ? 1.35 : 1);
    frustum.edgeMat.color.set(style.fov);
    frustum.edgeMat.opacity = selected ? 0.95 : 0.6;
    footprintMat.color.set(style.fov);
    footprintMat.opacity = selected ? 0.26 : 0.14;
    footprintLine.material.color.set(style.fov);
  }

  applyVisuals();
  refreshFootprint();

  return {
    id: spec.id,
    spec,
    root,
    pin,
    fovGroup,
    markerGroup,
    hardware,
    previewCamera,
    getState: () => state,
    setState(next) {
      const s = normalizeCameraState(next);
      if (!s) return false;
      state = s;
      applyVisuals();
      return true;
    },
    setSelected(flag) {
      selected = Boolean(flag);
      applyVisuals();
    },
    isSelected: () => selected,
    setFovVisible(flag) {
      fovGroup.visible = Boolean(flag);
    },
    setMarkerVisible(flag) {
      markerGroup.visible = Boolean(flag);
    },
    /** 爆炸分层时整体随所属楼层平移 */
    setFloorOffset(dy) {
      if (Math.abs(dy - floorOffset) < 1e-4) return;
      floorOffset = dy;
      root.position.y = dy;
      refreshFootprint();
    },
    getWorldPosition(target = new THREE.Vector3()) {
      return target.set(spec.position[0], spec.position[1] + floorOffset, spec.position[2]);
    },
    getMarkerWorldPosition(target = new THREE.Vector3()) {
      return target.set(spec.position[0], spec.position[1] + floorOffset + spec.markerHeight, spec.position[2]);
    },
    /** 同步画中画相机到镜头当前位姿 */
    syncPreviewCamera() {
      // 沿光轴前移 0.5m，避开自身机身与遮阳罩
      const cp = Math.cos(spec.pitch);
      previewCamera.position.set(
        spec.position[0] + Math.sin(spec.yaw) * cp * 0.5,
        spec.position[1] + floorOffset + Math.sin(spec.pitch) * 0.5,
        spec.position[2] + Math.cos(spec.yaw) * cp * 0.5
      );
      // PerspectiveCamera 朝 -Z，镜头朝本地 +Z：yaw 加 PI，俯仰取反
      previewCamera.rotation.set(spec.pitch, spec.yaw + Math.PI, 0);
      previewCamera.updateMatrixWorld(true);
      return previewCamera;
    },
    update(time) {
      const style = CAMERA_STATE_STYLES[state];
      frustum.mat.uniforms.uTime.value = time;
      if (style.pulse || selected) {
        const speed = style.speed || 0.8;
        const cycle = (time * speed) % 1;
        const s = 1.2 + cycle * (selected ? 5.5 : 7);
        ring.scale.set(s, s, 1);
        ringMat.opacity = (1 - cycle) * (style.pulse ? 0.85 : 0.6);
      } else if (ringMat.opacity !== 0) {
        ringMat.opacity = 0;
      }
    },
    dispose() {
      frustum.volume.geometry.dispose();
      frustum.mat.dispose();
      frustum.edges.geometry.dispose();
      frustum.edgeMat.dispose();
      footprintGeo.dispose();
      footprintMat.dispose();
      footprintLineGeo.dispose();
      footprintLine.material.dispose();
      leaderGeo.dispose();
      leaderMat.dispose();
      ringMat.dispose();
      pinMat.dispose();
      root.removeFromParent();
    },
  };
}
