import * as THREE from 'three';
import { BUILDING_WINGS, ELEVATIONS, PLINTH_CONFIG } from '../config/campusConfig.js';
import {
  createAsphaltRoadTexture,
  createFeatheredLightPoolTexture,
  createLightConeTexture,
  createParkingLotTexture,
  createPlazaPaverTexture,
  createSolarPanelTexture,
} from '../core/ProceduralTextures.js';

/**
 * 精工偏白模园区道路、无缝交叉口、停车场（太阳能车棚）、全园区道路路灯及 1BF 车库下沉坡道
 * - 严格保留零闪烁（Zero Z-Fighting）3D 挤压实体结构：沥青顶面 0.062m，陶瓷白路缘石 0.085m，标线全烘焙进 UV
 * - 市政主干道全部精准贯通并无缝裁切至底座边框，绝不中途断头
 * - 环湖步道与西南钢拱桥两端、西南螺旋草坡入口、停车场出入口全部 100% 严丝合缝衔接
 * - 全园区静态泊车与动态交通车辆由独立模块 VehicleTrafficSystem.js 统一管理
 */

/**
 * 将点约束在底座有效草坪内框之内，防止市政道路断面伸出陶瓷白压边外
 */
function clampToPlinthBorder(x, z) {
  const hw = PLINTH_CONFIG.width * 0.5 - 0.6;
  const hd = PLINTH_CONFIG.depth * 0.5 - 0.6;
  return [
    Math.max(-hw, Math.min(hw, x)),
    Math.max(-hd, Math.min(hd, z)),
  ];
}

function buildExtrudedRoadRibbon({
  controlPoints,
  width,
  topY = ELEVATIONS.ROAD_TOP,
  bottomY = -0.06,
  curbTopY = ELEVATIONS.CURB_TOP,
  curbWidth = 0.42,
  segments = 56,
  uvTileLength = 14,
  roadMaterial,
  curbMaterial,
  closed = false,
  withCurbs = true,
}) {
  const grp = new THREE.Group();
  const vecs = controlPoints.map(([x, z]) => {
    const [cx, cz] = clampToPlinthBorder(x, z);
    return new THREE.Vector3(cx, 0, cz);
  });
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'catmullrom', 0.32);
  const pts = curve.getSpacedPoints(segments);
  const count = pts.length;
  const halfW = width * 0.5;

  const rights = [];
  const arcLens = [0];
  for (let i = 0; i < count; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(count - 1, i + 1)];
    const tan = new THREE.Vector3().subVectors(next, prev).normalize();
    rights.push(new THREE.Vector3(-tan.z, 0, tan.x).normalize());
    if (i > 0) arcLens.push(arcLens[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }

  const buildSolidStrip = (leftOffset, rightOffset, yTop, yBot, mat, uvScaleLen) => {
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i < count; i++) {
      const p = pts[i];
      const r = rights[i];
      const v = arcLens[i] / uvScaleLen;
      positions.push(
        p.x + r.x * leftOffset, yTop, p.z + r.z * leftOffset,
        p.x + r.x * rightOffset, yTop, p.z + r.z * rightOffset
      );
      uvs.push(0, v, 1, v);
    }
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    // 左壁
    const leftBase = positions.length / 3;
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      const r = rights[i];
      const v = arcLens[i] / uvScaleLen;
      const lx = p.x + r.x * leftOffset;
      const lz = p.z + r.z * leftOffset;
      positions.push(lx, yTop, lz, lx, yBot, lz);
      uvs.push(0.02, v, 0.02, v);
    }
    for (let i = 0; i < count - 1; i++) {
      const a = leftBase + i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }

    // 右壁
    const rightBase = positions.length / 3;
    for (let i = 0; i < count; i++) {
      const p = pts[i];
      const r = rights[i];
      const v = arcLens[i] / uvScaleLen;
      const rx = p.x + r.x * rightOffset;
      const rz = p.z + r.z * rightOffset;
      positions.push(rx, yTop, rz, rx, yBot, rz);
      uvs.push(0.98, v, 0.98, v);
    }
    for (let i = 0; i < count - 1; i++) {
      const a = rightBase + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  };

  grp.add(buildSolidStrip(-halfW, halfW, topY, bottomY, roadMaterial, uvTileLength));
  if (withCurbs && curbMaterial) {
    grp.add(buildSolidStrip(-halfW - curbWidth, -halfW, curbTopY, bottomY, curbMaterial, 12));
    grp.add(buildSolidStrip(halfW, halfW + curbWidth, curbTopY, bottomY, curbMaterial, 12));
  }
  return grp;
}

/**
 * 精工白模太阳能充电车棚（哑光白立柱 + 浅蓝灰光伏顶棚 + 冰青微光充电桩 + 夜间棚底冰青线形灯带）
 */
function buildSolarCarport({ x, z, lengthZ, widthX, solarMat, whiteSteelMat, chargerMat, ledMat, underStripMat }) {
  const grp = new THREE.Group();
  grp.position.set(x, ELEVATIONS.ROAD_TOP, z);

  // 轻薄悬挑陶瓷白外框顶棚 + 顶部光伏板
  const frame = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.3, 0.16, lengthZ + 0.3), whiteSteelMat);
  frame.position.set(0, 3.12, 0);
  frame.rotation.z = 0.11;
  frame.castShadow = true;
  frame.receiveShadow = true;
  grp.add(frame);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(widthX - 0.1, 0.08, lengthZ - 0.2), solarMat);
  canopy.position.set(0, 3.22, 0);
  canopy.rotation.z = 0.11;
  grp.add(canopy);

  // 太阳能车棚底面双排冰青色新能源线性照明灯带（夜景极具科技感）
  if (underStripMat) {
    for (const sx of [-widthX * 0.2, widthX * 0.2]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.06, lengthZ - 0.8),
        underStripMat
      );
      strip.position.set(sx, 3.0 + sx * Math.tan(0.11), 0);
      strip.rotation.z = 0.11;
      grp.add(strip);
    }
  }

  const posts = Math.max(3, Math.round(lengthZ / 6.2));
  for (let i = 0; i < posts; i++) {
    const pz = -lengthZ * 0.44 + (i / (posts - 1)) * (lengthZ * 0.88);
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.1, 0.24), whiteSteelMat);
    col.position.set(-widthX * 0.34, 1.55, pz);
    col.castShadow = true;
    grp.add(col);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(widthX, 0.16, 0.18), whiteSteelMat);
    arm.position.set(0, 3.0, pz);
    arm.rotation.z = 0.11;
    grp.add(arm);

    const charger = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.28, 0.24), chargerMat);
    charger.position.set(-widthX * 0.42, 0.64, pz + 0.55);
    grp.add(charger);

    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.14), ledMat);
    dot.position.set(-widthX * 0.42, 1.08, pz + 0.55);
    grp.add(dot);
  }
  return grp;
}

/**
 * 北侧地下车库（1BF）入口下沉坡道（无缝衔接北侧消防环道 + 陶瓷白挡墙 + 冰青磨砂玻璃雨棚 + 夜间暖金车库入口照明）
 */
function buildUndergroundGarageRamp(whiteSteelMat, curbMat, rampGlowMat) {
  const grp = new THREE.Group();
  grp.name = 'GarageRamp_1BF';

  const rx = 59.5;
  const rz = -91.2;
  const rampLen = 20.5;
  const rampW = 7.0;

  const pitWallMat = new THREE.MeshStandardMaterial({ color: '#7a8490', roughness: 0.72 });
  const rampFloorMat = new THREE.MeshStandardMaterial({ color: '#a8b0ba', roughness: 0.82 });

  // 入口北侧平坦过渡引道（严丝合缝接入 Z = -104 消防环道）
  const apron = new THREE.Mesh(new THREE.BoxGeometry(10.0, ELEVATIONS.ROAD_TOP + 0.06, 13.0), rampFloorMat);
  apron.position.set(70.2, (ELEVATIONS.ROAD_TOP - 0.06) * 0.5 - 0.002, -97.0);
  apron.receiveShadow = true;
  grp.add(apron);

  // 下沉车道坡板
  const slopeMesh = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.22, rampW - 0.5), rampFloorMat);
  slopeMesh.position.set(rx, -1.62, rz);
  slopeMesh.rotation.z = -0.17;
  slopeMesh.receiveShadow = true;
  grp.add(slopeMesh);

  // 两侧精细陶瓷白清水混凝土挡墙（与周边草坪边缘严丝合缝）
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(rampLen + 0.8, 1.05, 0.44), curbMat);
    wall.position.set(rx, 0.36, rz + side * (rampW * 0.5));
    wall.castShadow = true;
    wall.receiveShadow = true;
    grp.add(wall);

    // 挡墙内侧夜间坡道防撞暖金引导灯条
    if (rampGlowMat) {
      const wallStrip = new THREE.Mesh(new THREE.BoxGeometry(rampLen - 1.5, 0.09, 0.08), rampGlowMat);
      wallStrip.position.set(rx, 0.14, rz + side * (rampW * 0.5 - 0.24));
      grp.add(wallStrip);
    }
  }

  // 西端地下车库门洞封框 + 精致冰青磨砂玻璃雨棚
  const portalBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.0, rampW), pitWallMat);
  portalBack.position.set(rx - rampLen * 0.5, 0.05, rz);
  grp.add(portalBack);

  const canopyGlassMat = new THREE.MeshStandardMaterial({
    color: '#bfe4ee',
    emissive: new THREE.Color('#ffbe66'),
    emissiveIntensity: 0.0,
    roughness: 0.14,
    metalness: 0.1,
    transparent: true,
    opacity: 0.52,
  });
  const canopyGlass = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.1, rampW + 1.2), canopyGlassMat);
  canopyGlass.position.set(rx - 3.6, 2.35, rz);
  canopyGlass.rotation.z = -0.07;
  grp.add(canopyGlass);

  // 雨棚底面嵌入式暖金灯管 + 地下 1BF 车库入口内透暖光面
  if (rampGlowMat) {
    for (const dx of [-7.6, -3.6, 0.2]) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, rampW - 0.6), rampGlowMat);
      tube.position.set(rx + dx, 2.25 - (dx + 3.6) * 0.07, rz);
      grp.add(tube);
    }
    const tunnelMouthGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 1.85, rampW - 1.1),
      rampGlowMat
    );
    tunnelMouthGlow.position.set(rx - rampLen * 0.5 + 0.42, -0.35, rz);
    grp.add(tunnelMouthGlow);
  }

  for (const sx of [-8.8, -4.0, 0.8]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.35, 8), whiteSteelMat);
      post.position.set(rx + sx, 1.18, rz + sz * (rampW * 0.5));
      grp.add(post);
    }
  }
  return { group: grp, canopyGlassMat };
}

/**
 * 建筑级全园区路灯系统（全量 InstancedMesh：仅 6 次 Draw Call，0 PointLight！）
 * 包含：渐细灯杆 + 优雅曲臂挑梁 + 极简刀锋灯头 + 暖琥珀 LED 发光面 + 羽化径向渐变地面光池 + 极柔和体积微光锥
 */
function buildRoadStreetlights(streetlightPlacements, maxAnisotropy) {
  const grp = new THREE.Group();
  grp.name = 'RoadStreetlightSystem';
  const count = streetlightPlacements.length;
  if (count === 0) {
    return { group: grp, setDuskFactor() {} };
  }

  const poleMat = new THREE.MeshStandardMaterial({
    color: '#4e5866',
    roughness: 0.36,
    metalness: 0.64,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: '#fff4d6',
    emissive: new THREE.Color('#ffba52'),
    emissiveIntensity: 0.15,
    roughness: 0.2,
  });
  const poolTex = createFeatheredLightPoolTexture('255, 228, 170', '255, 160, 54', maxAnisotropy);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const coneTex = createLightConeTexture('255, 210, 134');
  const coneMat = new THREE.MeshBasicMaterial({
    map: coneTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    visible: false,
  });

  // 1. 渐细灯杆（基座在 y=0，顶在 y=1，按杆高缩放）
  const poleGeo = new THREE.CylinderGeometry(0.085, 0.14, 1.0, 8);
  poleGeo.translate(0, 0.5, 0);

  // 2. 优雅曲臂挑梁（局部 +X 朝道路内侧弯曲悬挑 1.85m）
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 0.0, 0),
    new THREE.Vector3(0.18, 0.58, 0),
    new THREE.Vector3(0.75, 0.94, 0),
    new THREE.Vector3(1.82, 0.98, 0),
  ]);
  const armGeo = new THREE.TubeGeometry(armCurve, 10, 0.062, 6, false);

  // 3. 极简刀锋灯头外壳 & 底部发光 LED 模组
  const housingGeo = new THREE.BoxGeometry(0.92, 0.11, 0.36);
  const lensGeo = new THREE.BoxGeometry(0.76, 0.065, 0.28);

  // 4. 羽化径向渐变道路地面光晕池（严格贴合 y = ROAD_TOP + 0.015，杜绝硬圆盘与 Z-Fighting）
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);

  // 5. 极轻柔羽化体积微光锥（上细下宽，顶在 y=0 向下延展 1.0）
  const coneGeo = new THREE.CylinderGeometry(0.24, 3.1, 1.0, 10, 1, true);
  coneGeo.translate(0, -0.5, 0);

  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, count);
  const armInst = new THREE.InstancedMesh(armGeo, poleMat, count);
  const housingInst = new THREE.InstancedMesh(housingGeo, poleMat, count);
  const lensInst = new THREE.InstancedMesh(lensGeo, lensMat, count);
  const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, count);
  const coneInst = new THREE.InstancedMesh(coneGeo, coneMat, count);
  poleInst.castShadow = false;
  poleInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  streetlightPlacements.forEach((sl, i) => {
    const s = sl.scale ?? 1.0;
    const poleH = 6.2 * s;
    const baseY = ELEVATIONS.CURB_TOP;
    const rotY = sl.rotY;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);

    // 局部 +X=(1,0,0) 绕 Y 轴旋转 rotY 后的世界方向为 (cosY, 0, -sinY)
    const dirX = cosY;
    const dirZ = -sinY;

    // 杆身
    dummy.position.set(sl.x, baseY, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s, poleH, s);
    dummy.updateMatrix();
    poleInst.setMatrixAt(i, dummy.matrix);

    // 曲臂（衔接杆顶）
    dummy.position.set(sl.x, baseY + poleH - 0.06 * s, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    armInst.setMatrixAt(i, dummy.matrix);

    // 灯头位置（曲臂末端）
    const headX = sl.x + dirX * 1.88 * s;
    const headZ = sl.z + dirZ * 1.88 * s;
    const headY = baseY + poleH + 0.92 * s;

    dummy.position.set(headX, headY, headZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    housingInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(headX, headY - 0.06 * s, headZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    lensInst.setMatrixAt(i, dummy.matrix);

    // 羽化道路光晕池（略微顺道路延伸呈自然椭圆，严格落于 y = ROAD_TOP + 0.015）
    const poolX = sl.x + dirX * (sl.poolReach ?? 2.6 * s);
    const poolZ = sl.z + dirZ * (sl.poolReach ?? 2.6 * s);
    const poolW = (sl.poolSize ?? 12.2) * s;
    const poolL = (sl.poolSize ?? 14.4) * s;
    dummy.position.set(poolX, ELEVATIONS.ROAD_TOP + 0.015, poolZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(poolW, 1, poolL);
    dummy.updateMatrix();
    poolInst.setMatrixAt(i, dummy.matrix);

    // 羽化体积微光锥（从灯头温和向下散开，贴地渐隐）
    const coneH = Math.max(2.5, headY - ELEVATIONS.ROAD_TOP - 0.35);
    dummy.position.set(headX, headY - 0.08 * s, headZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s * 0.95, coneH, s * 0.95);
    dummy.updateMatrix();
    coneInst.setMatrixAt(i, dummy.matrix);
  });

  poleInst.instanceMatrix.needsUpdate = true;
  armInst.instanceMatrix.needsUpdate = true;
  housingInst.instanceMatrix.needsUpdate = true;
  lensInst.instanceMatrix.needsUpdate = true;
  poolInst.instanceMatrix.needsUpdate = true;
  coneInst.instanceMatrix.needsUpdate = true;

  grp.add(poleInst, armInst, housingInst, lensInst, poolInst, coneInst);

  return {
    group: grp,
    setDuskFactor(dusk, night = dusk) {
      const active = dusk > 0.005;
      lensMat.emissiveIntensity = 0.15 + dusk * 3.1 + night * 1.35;
      poolMat.visible = active;
      poolMat.opacity = dusk * 0.44 + night * 0.24;
      coneMat.visible = active;
      coneMat.opacity = dusk * 0.12 + night * 0.13;
    },
  };
}

/**
 * 沿道路中心线样条自动采样路缘外侧路灯点位（严格避让交叉口、建筑退界与底座边框）
 */
function sampleStreetlightsAlongRoad({
  controlPoints,
  roadWidth,
  spacing = 28,
  staggerSides = true,
  fixedSide = null,
  poleScale = 1.0,
  startMargin = 12,
  endMargin = 12,
  skipFn = null,
}) {
  const vecs = controlPoints.map(([x, z]) => {
    const [cx, cz] = clampToPlinthBorder(x, z);
    return new THREE.Vector3(cx, 0, cz);
  });
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.32);
  const totalLen = curve.getLength();
  if (totalLen <= startMargin + endMargin) return [];

  const hw = PLINTH_CONFIG.width * 0.5 - 5.5;
  const hd = PLINTH_CONFIG.depth * 0.5 - 5.5;
  const curbOffset = roadWidth * 0.5 + 0.85;
  const samples = [];
  const count = Math.max(1, Math.floor((totalLen - startMargin - endMargin) / spacing));

  const hitsBuilding = (px, pz) => {
    for (const w of BUILDING_WINGS) {
      if (px >= w.x1 - 1.8 && px <= w.x2 + 1.8 && pz >= w.z1 - 1.8 && pz <= w.z2 + 1.8) {
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i <= count; i++) {
    const dist = startMargin + (i / Math.max(1, count)) * (totalLen - startMargin - endMargin);
    const u = Math.min(0.995, Math.max(0.005, dist / totalLen));
    const p = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const right = new THREE.Vector3(-tan.z, 0, tan.x).normalize();

    const side = fixedSide !== null ? fixedSide : staggerSides ? (i % 2 === 0 ? -1 : 1) : 1;
    const px = p.x + right.x * side * curbOffset;
    const pz = p.z + right.z * side * curbOffset;

    if (Math.abs(px) > hw || Math.abs(pz) > hd) continue;
    if (hitsBuilding(px, pz)) continue;
    if (skipFn && skipFn(px, pz, p.x, p.z)) continue;

    // 悬臂指向道路内侧（-right * side）
    const inX = -right.x * side;
    const inZ = -right.z * side;
    const rotY = Math.atan2(-inZ, inX);

    samples.push({
      x: px,
      z: pz,
      rotY,
      scale: poleScale,
      poolReach: Math.min(roadWidth * 0.38, 3.2 * poleScale),
      poolSize: roadWidth >= 14 ? 13.8 : 10.2,
    });
  }
  return samples;
}

export function buildRoadsAndParking(maxAnisotropy = 8) {
  const group = new THREE.Group();
  group.name = 'RoadsAndParking';

  const arterialTex = createAsphaltRoadTexture('arterial', maxAnisotropy);
  const campusTex = createAsphaltRoadTexture('campus', maxAnisotropy);
  const fireTex = createAsphaltRoadTexture('firelane', maxAnisotropy);
  const plazaTex = createPlazaPaverTexture(maxAnisotropy);
  const solarTex = createSolarPanelTexture(maxAnisotropy);

  const arterialMat = new THREE.MeshStandardMaterial({ map: arterialTex, roughness: 0.82, metalness: 0.03 });
  const campusRoadMat = new THREE.MeshStandardMaterial({ map: campusTex, roughness: 0.82, metalness: 0.03 });
  const fireRoadMat = new THREE.MeshStandardMaterial({ map: fireTex, roughness: 0.82, metalness: 0.03 });
  const junctionMat = new THREE.MeshStandardMaterial({ color: '#b4bcc5', roughness: 0.84, metalness: 0.02 });
  const pathMat = new THREE.MeshStandardMaterial({ color: '#d7dce2', roughness: 0.78, metalness: 0.02 });
  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.68, metalness: 0.04 });
  const curbMat = new THREE.MeshStandardMaterial({ color: '#eff2f6', roughness: 0.5, metalness: 0.04 });
  const whiteSteelMat = new THREE.MeshStandardMaterial({ color: '#e9edf3', roughness: 0.35, metalness: 0.35 });
  const solarMat = new THREE.MeshStandardMaterial({ map: solarTex, roughness: 0.28, metalness: 0.35 });
  const chargerMat = new THREE.MeshStandardMaterial({ color: '#f3f5f8', roughness: 0.32, metalness: 0.15 });
  const chargerLedMat = new THREE.MeshStandardMaterial({
    color: '#38f2ff',
    emissive: new THREE.Color('#22d3ee'),
    emissiveIntensity: 1.8,
  });
  const carportUnderStripMat = new THREE.MeshStandardMaterial({
    color: '#9bf7ff',
    emissive: new THREE.Color('#22d3ee'),
    emissiveIntensity: 0.25,
    roughness: 0.22,
  });
  const rampWarmGlowMat = new THREE.MeshStandardMaterial({
    color: '#ffebbf',
    emissive: new THREE.Color('#ffad3d'),
    emissiveIntensity: 0.12,
    roughness: 0.24,
  });

  // 共享各主干道与内部环道样条控制点（同时精准驱动路面挤压与路灯分布）
  const zhongguancunPts = [
    [-208, -184],
    [-211, -92],
    [-216, 15],
    [-221, 110],
    [-224, 184],
  ];
  const pinglingPts = [
    [-243, -100],
    [-211, -106],
    [-130, -124],
    [-25, -144],
    [65, -162],
    [164, -184],
  ];
  const yongpingPts = [
    [-243, 114],
    [-221, 122],
    [-186, 138],
    [-138, 164],
    [-94, 184],
  ];
  const fireRingPts = [
    [-210, -66],
    [-174, -84],
    [-130, -98],
    [-58, -106],
    [26, -108],
    [96, -104],
    [98, -64],
    [97, -12],
    [96, 24],
  ];
  const westBranchPts = [
    [-214, 22],
    [-168, 22],
    [-146, 18],
    [-146, -34],
    [-144, -93],
  ];

  // 1. 西侧市政主干道：中关村大道（严丝合缝贯通南北底座陶瓷边）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: zhongguancunPts,
      width: 17.5,
      topY: ELEVATIONS.ROAD_TOP + 0.004,
      curbTopY: ELEVATIONS.CURB_TOP + 0.003,
      segments: 56,
      uvTileLength: 20,
      roadMaterial: arterialMat,
      curbMaterial: curbMat,
    })
  );

  // 2. 北侧市政主干道：平陵西路（贯通西侧中关村大道与北侧底座边）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: pinglingPts,
      width: 15.5,
      topY: ELEVATIONS.ROAD_TOP + 0.002,
      curbTopY: ELEVATIONS.CURB_TOP + 0.002,
      segments: 56,
      uvTileLength: 20,
      roadMaterial: arterialMat,
      curbMaterial: curbMat,
    })
  );

  // 3. 西南市政主干道：永平大道（贯通西侧中关村大道与南侧底座边）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: yongpingPts,
      width: 15.0,
      topY: ELEVATIONS.ROAD_TOP + 0.001,
      curbTopY: ELEVATIONS.CURB_TOP + 0.001,
      segments: 44,
      uvTileLength: 20,
      roadMaterial: arterialMat,
      curbMaterial: curbMat,
    })
  );

  // 市政交叉路口平滑圆角过渡垫层（消除道路十字交叉的生硬断口）
  const junctions = [
    { x: -211, z: -106, r: 10.5 },
    { x: -221, z: 122, r: 10.2 },
    { x: 26, z: -153, r: 9.8 },
  ];
  for (const j of junctions) {
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(j.r, j.r + 0.2, ELEVATIONS.ROAD_TOP + 0.07, 24),
      junctionMat
    );
    pad.position.set(j.x, (ELEVATIONS.ROAD_TOP - 0.06) * 0.5 + 0.006, j.z);
    pad.receiveShadow = true;
    group.add(pad);
  }

  // 4. 北侧迎宾大道与回转广场（严丝合缝对接平陵西路与 32m 中央门廊）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [26, -153],
        [26, -124],
        [26, -82],
      ],
      width: 16.8,
      topY: ELEVATIONS.ROAD_TOP + 0.003,
      curbTopY: ELEVATIONS.CURB_TOP + 0.002,
      segments: 20,
      uvTileLength: 14,
      roadMaterial: plazaMat,
      curbMaterial: curbMat,
    })
  );

  const plazaBox = new THREE.Mesh(
    new THREE.BoxGeometry(36.0, ELEVATIONS.PLAZA_TOP + 0.06, 26.0),
    plazaMat
  );
  plazaBox.position.set(26, (ELEVATIONS.PLAZA_TOP - 0.06) * 0.5, -94);
  plazaBox.receiveShadow = true;
  group.add(plazaBox);

  // 中央精致陶瓷白种植岛
  const islandCurb = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.45, 0.22, 24), curbMat);
  islandCurb.scale.set(1.0, 1, 2.75);
  islandCurb.position.set(26, 0.11, -112);
  islandCurb.receiveShadow = true;
  group.add(islandCurb);

  const islandTurf = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.95, 0.26, 24),
    new THREE.MeshStandardMaterial({ color: '#c8d4c4', roughness: 0.9 })
  );
  islandTurf.scale.set(1.0, 1, 2.65);
  islandTurf.position.set(26, 0.13, -112);
  group.add(islandTurf);

  // 5. 环绕建筑内部消防车道与装卸区（无缝衔接中关村大道、北迎宾广场、东装卸区与东侧门洞）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: fireRingPts,
      width: 6.8,
      topY: ELEVATIONS.ROAD_TOP,
      curbTopY: ELEVATIONS.CURB_TOP,
      segments: 84,
      uvTileLength: 12,
      roadMaterial: fireRoadMat,
      curbMaterial: curbMat,
    })
  );

  // 西翼消防支线（直通西停车场与中关村大道）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: westBranchPts,
      width: 6.2,
      topY: ELEVATIONS.ROAD_TOP - 0.002,
      curbTopY: ELEVATIONS.CURB_TOP - 0.001,
      segments: 48,
      uvTileLength: 12,
      roadMaterial: campusRoadMat,
      curbMaterial: curbMat,
    })
  );

  // 西停车场无缝入口引道（连接 X = -146 支线至西停车场）
  const westApron = new THREE.Mesh(
    new THREE.BoxGeometry(10.0, ELEVATIONS.ROAD_TOP + 0.06, 9.0),
    campusRoadMat
  );
  westApron.position.set(-140.5, (ELEVATIONS.ROAD_TOP - 0.06) * 0.5 - 0.001, -10.0);
  westApron.receiveShadow = true;
  group.add(westApron);

  // 东侧装卸区平滑加宽泊位
  const loadingBay = new THREE.Mesh(
    new THREE.BoxGeometry(10.5, ELEVATIONS.ROAD_TOP + 0.06, 24.0),
    fireRoadMat
  );
  loadingBay.position.set(92.5, (ELEVATIONS.ROAD_TOP - 0.06) * 0.5 - 0.001, -4.0);
  loadingBay.receiveShadow = true;
  group.add(loadingBay);

  // 6. 环湖景观慢行绿道（精准锁合西南钢拱桥两端 (-179,95) & (-161,122)、西南草坡螺旋入口、张拉膜小亭与东岸湖滨亭！）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [-178, -78],
        [-184, -18],
        [-184, 52],
        [-181, 78],
        [-179, 95], // 精确对接西南拱桥北桥台！
      ],
      width: 3.6,
      topY: ELEVATIONS.ROAD_TOP - 0.003,
      curbTopY: ELEVATIONS.CURB_TOP - 0.004,
      curbWidth: 0.22,
      segments: 40,
      uvTileLength: 10,
      roadMaterial: pathMat,
      curbMaterial: curbMat,
    })
  );

  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [-161, 122], // 精确对接西南拱桥南桥台！
        [-144, 110], // 无缝切过西南草坡螺旋步道入口
        [-114, 106],
        [-84, 126],
        [-64, 146],
        [-22, 165],
        [28, 168],
        [88, 152],
        [136, 114],
        [168, 74],
        [172, 34],
        [156, 2],
        [152, -24], // 经过东岸六角木吊顶临湖亭广场
        [148, -76],
        [136, -132],
        [98, -142],
        [72, -160], // 顺畅接入平陵西路！
      ],
      width: 3.6,
      topY: ELEVATIONS.ROAD_TOP - 0.003,
      curbTopY: ELEVATIONS.CURB_TOP - 0.004,
      curbWidth: 0.22,
      segments: 112,
      uvTileLength: 10,
      roadMaterial: pathMat,
      curbMaterial: curbMat,
    })
  );

  // 7. 西侧与东北侧地面停车场（无缝引道 + 浅灰烘焙标线 + 精工白模太阳能充电车棚 + 雕塑感流线 InstancedMesh 汽车）
  const westParkTex = createParkingLotTexture(2, 9, 5, maxAnisotropy);
  const westParkMat = new THREE.MeshStandardMaterial({ map: westParkTex, roughness: 0.8 });
  const westLot = new THREE.Mesh(
    new THREE.BoxGeometry(34.0, ELEVATIONS.ROAD_TOP + 0.06, 44.0),
    westParkMat
  );
  westLot.position.set(-120.0, (ELEVATIONS.ROAD_TOP - 0.06) * 0.5, -10.0);
  westLot.receiveShadow = true;
  group.add(westLot);

  const addLotCurbs = (cx, cz, w, d) => {
    const t = 0.42;
    const h = ELEVATIONS.CURB_TOP + 0.06;
    const y = (ELEVATIONS.CURB_TOP - 0.06) * 0.5;
    const parts = [
      [cx, y, cz - d / 2 - t / 2, w + t * 2, h, t],
      [cx, y, cz + d / 2 + t / 2, w + t * 2, h, t],
      [cx + w / 2 + t / 2, y, cz, t, h, d],
    ];
    for (const [px, py, pz, pw, ph, pd] of parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), curbMat);
      m.position.set(px, py, pz);
      m.receiveShadow = true;
      group.add(m);
    }
  };
  addLotCurbs(-120.0, -10.0, 34.0, 44.0);

  group.add(
    buildSolarCarport({
      x: -130.5,
      z: -16.0,
      lengthZ: 24.0,
      widthX: 6.2,
      solarMat,
      whiteSteelMat,
      chargerMat,
      ledMat: chargerLedMat,
      underStripMat: carportUnderStripMat,
    })
  );

  const neParkTex = createParkingLotTexture(2, 5, 3, maxAnisotropy);
  const neParkMat = new THREE.MeshStandardMaterial({ map: neParkTex, roughness: 0.8 });
  const neLot = new THREE.Mesh(
    new THREE.BoxGeometry(30.0, ELEVATIONS.ROAD_TOP + 0.06, 22.0),
    neParkMat
  );
  neLot.position.set(89.5, (ELEVATIONS.ROAD_TOP - 0.06) * 0.5, -116.0);
  neLot.receiveShadow = true;
  group.add(neLot);
  addLotCurbs(89.5, -116.0, 30.0, 22.0);

  group.add(
    buildSolarCarport({
      x: 80.5,
      z: -116.5,
      lengthZ: 15.0,
      widthX: 5.8,
      solarMat,
      whiteSteelMat,
      chargerMat,
      ledMat: chargerLedMat,
      underStripMat: carportUnderStripMat,
    })
  );

  // 8. 北侧地下车库（1BF）入口下沉坡道（含夜间暖金雨棚与洞口照明）
  const garageRamp = buildUndergroundGarageRamp(whiteSteelMat, curbMat, rampWarmGlowMat);
  group.add(garageRamp.group);

  // 9. 全园区建筑级道路路灯系统（覆盖中关村大道、平陵西路、永平大道、北迎宾大道、内部消防环道、西翼支线与两大停车场）
  const nearJunction = (px, pz, cx, cz) => {
    const avoidPts = [
      [-211, -106, 15.5],
      [-221, 122, 15.5],
      [26, -153, 15.5],
      [-210, -66, 11.5],
      [-214, 22, 11.5],
    ];
    for (const [ax, az, rad] of avoidPts) {
      if (Math.hypot(px - ax, pz - az) < rad || Math.hypot(cx - ax, cz - az) < rad) return true;
    }
    return false;
  };

  const streetlightPlacements = [
    ...sampleStreetlightsAlongRoad({
      controlPoints: zhongguancunPts,
      roadWidth: 17.5,
      spacing: 24,
      staggerSides: true,
      poleScale: 1.04,
      startMargin: 12,
      endMargin: 12,
      skipFn: nearJunction,
    }),
    ...sampleStreetlightsAlongRoad({
      controlPoints: pinglingPts,
      roadWidth: 15.5,
      spacing: 25,
      staggerSides: true,
      poleScale: 1.0,
      startMargin: 14,
      endMargin: 14,
      skipFn: nearJunction,
    }),
    ...sampleStreetlightsAlongRoad({
      controlPoints: yongpingPts,
      roadWidth: 15.0,
      spacing: 24,
      staggerSides: true,
      poleScale: 0.98,
      startMargin: 14,
      endMargin: 12,
      skipFn: nearJunction,
    }),
    // 北侧迎宾大道对称双侧礼仪路灯
    ...[
      { x: 16.5, z: -138, rotY: 0, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 35.5, z: -138, rotY: Math.PI, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 16.5, z: -120, rotY: 0, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 35.5, z: -120, rotY: Math.PI, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 16.5, z: -102, rotY: 0, scale: 0.88, poolReach: 3.2, poolSize: 13.0 },
      { x: 35.5, z: -102, rotY: Math.PI, scale: 0.88, poolReach: 3.2, poolSize: 13.0 },
    ],
    // 内部消防环道（外侧单排精工园区路灯，避让北迎宾广场、车库坡道、东北弯道行车线、东装卸区与西路口）
    ...sampleStreetlightsAlongRoad({
      controlPoints: fireRingPts,
      roadWidth: 6.8,
      spacing: 22,
      fixedSide: 1,
      poleScale: 0.82,
      startMargin: 16,
      endMargin: 8,
      skipFn: (px, pz, cx, cz) =>
        (cx > 6 && cx < 46 && cz < -82) ||
        (cx > 63 && cx < 77 && cz < -88 && cz > -108) ||
        (cx > 76 && cz < -94) ||
        (cx > 86 && cz > -17 && cz < 9) ||
        cx < -196,
    }),
    // 东侧装卸区外缘草坪补位路灯（位于消防环道东侧路缘外，与装卸区及动态车流保持安全净距 >= 3m）
    { x: 101.8, z: -6.0, rotY: Math.PI, scale: 0.82, poolReach: 3.0, poolSize: 11.4 },
    // 西翼消防支线（单排园区路灯，避让西停车场引道开口与西南弯道内切顶角）
    ...sampleStreetlightsAlongRoad({
      controlPoints: westBranchPts,
      roadWidth: 6.2,
      spacing: 22,
      fixedSide: -1,
      poleScale: 0.8,
      startMargin: 18,
      endMargin: 10,
      skipFn: (px, pz, cx, cz) =>
        (cz > -19 && cz < -1 && cx > -152 && cx < -138) ||
        Math.hypot(cx + 146, cz - 18) < 10.5 ||
        Math.hypot(px + 146, pz - 18) < 10.5 ||
        cx < -198,
    }),
    // 西侧地面停车场外缘照明路灯（面向场内泊位）
    { x: -102.2, z: -26, rotY: Math.PI, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -102.2, z: -13, rotY: Math.PI, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -102.2, z: 0, rotY: Math.PI, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -102.2, z: 10, rotY: Math.PI, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -137.8, z: 3.5, rotY: 0, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    // 东北侧地面停车场照明路灯
    { x: 105.2, z: -122, rotY: Math.PI, scale: 0.8, poolReach: 2.8, poolSize: 11.0 },
    { x: 105.2, z: -110, rotY: Math.PI, scale: 0.8, poolReach: 2.8, poolSize: 11.0 },
    { x: 89.5, z: -127.8, rotY: -Math.PI / 2, scale: 0.8, poolReach: 2.8, poolSize: 11.0 },
  ];

  const streetlights = buildRoadStreetlights(streetlightPlacements, maxAnisotropy);
  group.add(streetlights.group);

  // 10. 太阳能 EV 充电车棚冰青地面漫射微光池 & 1BF 车库引道暖金入口光池
  const cyanPoolTex = createFeatheredLightPoolTexture('135, 245, 255', '34, 211, 238', maxAnisotropy);
  const cyanPoolMat = new THREE.MeshBasicMaterial({
    map: cyanPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const cyanPoolGeo = new THREE.PlaneGeometry(1, 1);
  cyanPoolGeo.rotateX(-Math.PI / 2);
  const carportPools = new THREE.InstancedMesh(cyanPoolGeo, cyanPoolMat, 2);
  const cpDummy = new THREE.Object3D();
  [
    { x: -130.2, z: -16.0, sx: 11.0, sz: 27.0 },
    { x: 80.5, z: -116.5, sx: 9.8, sz: 18.0 },
  ].forEach((p, idx) => {
    cpDummy.position.set(p.x, ELEVATIONS.ROAD_TOP + 0.014, p.z);
    cpDummy.rotation.set(0, 0, 0);
    cpDummy.scale.set(p.sx, 1, p.sz);
    cpDummy.updateMatrix();
    carportPools.setMatrixAt(idx, cpDummy.matrix);
  });
  carportPools.instanceMatrix.needsUpdate = true;
  group.add(carportPools);

  const rampPoolTex = createFeatheredLightPoolTexture('255, 224, 162', '255, 160, 56', maxAnisotropy);
  const rampPoolMat = new THREE.MeshBasicMaterial({
    map: rampPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const rampPoolMesh = new THREE.Mesh(new THREE.PlaneGeometry(11.0, 10.5), rampPoolMat);
  rampPoolMesh.userData.noMerge = true;
  rampPoolMesh.rotation.x = -Math.PI / 2;
  rampPoolMesh.position.set(70.5, ELEVATIONS.ROAD_TOP + 0.015, -98.8);
  group.add(rampPoolMesh);

  return {
    group,
    setDuskFactor(dusk, night = dusk) {
      const active = dusk > 0.005;
      streetlights.setDuskFactor(dusk, night);
      chargerLedMat.emissiveIntensity = 1.8 + dusk * 1.4 + night * 0.6;
      carportUnderStripMat.emissiveIntensity = 0.25 + dusk * 2.35 + night * 0.85;
      rampWarmGlowMat.emissiveIntensity = 0.12 + dusk * 2.85 + night * 0.95;
      garageRamp.canopyGlassMat.emissiveIntensity = dusk * 0.48 + night * 0.28;

      cyanPoolMat.visible = active;
      cyanPoolMat.opacity = dusk * 0.24 + night * 0.16;
      rampPoolMat.visible = active;
      rampPoolMat.opacity = dusk * 0.34 + night * 0.2;
    },
  };
}
