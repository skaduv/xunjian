import * as THREE from 'three';
import { ELEVATIONS, LAKE_SHORELINE, PLINTH_CONFIG } from '../config/campusConfig.js';
import { createRoundedRectShape } from '../plinth/HardwarePlinth.js';
import {
  createFeatheredLightPoolTexture,
  createMowedLawnTexture,
  createTeakDeckTexture,
} from '../core/ProceduralTextures.js';

/**
 * 博物馆级工业微缩园区微地形、晶莹水池与精工景观构筑物（对齐 Art Spec #9 与 Joint Report #11 全部修复）：
 * - 丰润缎面鼠尾草绿微缩草坪与层次橄榄绿 CNC 铣削等高线微地形（告别泛白发灰！）
 * - 西南螺旋步道草坡：重定位至 (-126, 133), outerR=21.5, summitR=7.0（L2 彻底清除侵湖/埋路），
 *   玻璃栏杆/拉丝钛扶手/暖光环与螺旋步道出口 100% 同角对齐（L3 修复），无缝衔接环湖绿道
 * - 西南钢拱肋磨砂冰青玻璃拱桥：倒角暖石双端桥台 + 蝴蝶倾角拉丝钛/深石墨拱肋 + 精准连接桥面边沿的斜拉吊杆（L7 修复）
 * - 西南张拉膜小亭：重定位至 (-78, 154) 远离湖岸 10.8m，四角全量钢桅杆与张力拉索锁合石材基座（L4 修复）
 * - 东岸六角木吊顶临湖亭 & 双岸无缝亲水栈桥：玻璃核心与暖金灯笼芯严密咬合（L6 修复），
 *   栈桥延展至 (99.4,24.0) ↔ (154.4,2.4) 无缝锁合消防环道与环湖绿道，全部桩柱深扎 -2.20 湖底 0.32m（L5 修复）
 * - 北侧对称下沉倒角镜面水池：水体下沉于 0.28 石材压顶以下（y=0.20）零穿模鼓包（L8 修复），配深鼠尾草绿修剪绿篱
 * - 临湖柚木阶梯看台地上拾级而下紧贴 0.20 驳岸压顶（L9 修复）
 * - 精工悬挑长椅、八角缎面遮阳伞、CNC 深石墨微距 LED 庭院柱灯与 1:100 雕塑感比例小人全量贴地生根 + 接触 AO 柔影（L10/L11/L12 修复）
 */

const SW_HILL = {
  cx: -126,
  cz: 133,
  outerR: 21.5,
  summitR: 7.0,
  meshRadius: 22.0,
  height: 6.8,
  deckTop: 7.04,
};

const HYPER_PAV = {
  cx: -78,
  cz: 154,
  padTop: 0.3,
};

const EAST_PAV = {
  cx: 146,
  cz: -24,
  radius: 9.4,
  baseTop: 0.45,
};

const EAST_PIER = {
  p1: new THREE.Vector3(99.4, 0.2, 24.0),
  p2: new THREE.Vector3(154.4, 0.2, 2.4),
  deckTop: 0.31,
};

const SW_BRIDGE = {
  pStart: new THREE.Vector3(-179, 0.05, 95),
  pEnd: new THREE.Vector3(-161, 0.05, 122),
  deckW: 4.5,
  baseY: 0.068,
  archDeckH: 2.05,
};

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 柔和的 CNC 建筑模型微阶梯调制（既有优雅的建筑模型等高线韵律，又保持连续柔和坡面不割裂）
 */
function subtleTerrace(h, step = 1.65) {
  if (h <= 0.02) return 0;
  const k = h / step;
  const i = Math.floor(k);
  const f = k - i;
  const stepped = (i + smoothstep(0.18, 0.82, f)) * step;
  return h * 0.62 + stepped * 0.38;
}

/**
 * 精准高度场查询函数（同时供给微地形网格、连续螺旋步道与 VegetationSystem 树木贴地生根）
 * Cross-Worker Contract (#11): SW Hill 位于 (-126, 133), outerR=21.5, summitR=7.0
 */
export function sampleSWHillHeight(x, z) {
  const d = Math.hypot(x - SW_HILL.cx, z - SW_HILL.cz);
  if (d >= SW_HILL.outerR) return 0;
  if (d <= SW_HILL.summitR) return SW_HILL.height;
  const t = 1 - (d - SW_HILL.summitR) / (SW_HILL.outerR - SW_HILL.summitR);
  const smoothH = smoothstep(0, 1, t) * SW_HILL.height;
  return subtleTerrace(smoothH, 1.15);
}

export function sampleLongpanHeight(x, z) {
  if (x < 164) return 0;
  const westMask = smoothstep(166, 186, x);

  const peaks = [
    { cx: 222, cz: -78, rx: 48, rz: 82, h: 22.0 },
    { cx: 226, cz: 72, rx: 44, rz: 78, h: 18.5 },
    { cx: 234, cz: -4, rx: 32, rz: 48, h: 12.0 },
  ];
  let raw = 0;
  for (const p of peaks) {
    const nx = (x - p.cx) / p.rx;
    const nz = (z - p.cz) / p.rz;
    const r2 = nx * nx + nz * nz;
    if (r2 < 1.35) {
      const val = Math.exp(-r2 * 2.15) * p.h;
      raw = Math.max(raw, val);
    }
  }
  const hw = PLINTH_CONFIG.width * 0.5 - 3.5;
  const hd = PLINTH_CONFIG.depth * 0.5 - 3.5;
  const edgeFadeX = smoothstep(hw + 2.0, hw - 10.0, x);
  const edgeFadeZ = smoothstep(hd + 2.0, hd - 14.0, Math.abs(z));
  const h = raw * westMask * edgeFadeX * edgeFadeZ;
  return subtleTerrace(h, 1.85);
}

export function sampleGroundElevation(x, z) {
  return Math.max(sampleSWHillHeight(x, z), sampleLongpanHeight(x, z));
}

/**
 * 极轻量内联深森影软接触阴影圆盘纹理（深润柔和 AO，零硬边，适配日光绿地与暖石广场）
 */
function createContactShadowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(20, 30, 22, 0.46)');
  grad.addColorStop(0.45, 'rgba(20, 30, 22, 0.26)');
  grad.addColorStop(0.75, 'rgba(20, 30, 22, 0.09)');
  grad.addColorStop(1.0, 'rgba(20, 30, 22, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 辅助函数：构建两点之间的精工圆柱杆件（用于斜拉吊杆、张拉膜钢桅杆、斜撑拉索）
 */
function createStrutMesh(p1, p2, rTop, rBot, mat, segs = 8, castShadow = true) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, segs), mat);
  mesh.position.lerpVectors(p1, p2, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = castShadow;
  return mesh;
}

/**
 * 1. 西南平滑 CNC 等高线螺旋草坡公园（L2 重定位清障 + L3 栏杆/扶手/灯环与步道出口 100% 同角对齐）
 */
function buildSculptedSWHillPark(mats, warmAccentMat, landmarkPoolMat) {
  const grp = new THREE.Group();
  grp.name = 'SW_SpiralHillPark';

  const { cx, cz, meshRadius, summitR, height, deckTop } = SW_HILL;
  const rings = 26;
  const segs = 64;

  const positions = [];
  const rawHeights = [];
  const indices = [];

  positions.push(cx, height, cz);
  rawHeights.push(height);

  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * meshRadius;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const wx = cx + Math.cos(a) * rad;
      const wz = cz + Math.sin(a) * rad;
      const wy = sampleSWHillHeight(wx, wz);
      // 外裙低于 3cm 沉入草坪下方 -0.025m，杜绝与 y=0.000 草坪发生共面 Z-Fighting
      const yFinal = wy < 0.03 ? -0.025 : wy;
      positions.push(wx, yFinal, wz);
      rawHeights.push(wy);
    }
  }

  for (let s = 0; s < segs; s++) {
    const next = (s + 1) % segs;
    indices.push(0, 1 + next, 1 + s);
  }
  for (let r = 1; r < rings; r++) {
    const rowA = 1 + (r - 1) * segs;
    const rowB = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const next = (s + 1) % segs;
      indices.push(rowA + s, rowA + next, rowB + s);
      indices.push(rowA + next, rowB + next, rowB + s);
    }
  }

  const hillGeo = new THREE.BufferGeometry();
  hillGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  hillGeo.setIndex(indices);
  hillGeo.computeVertexNormals();

  // 丰茂健康深翠航拍微地形着色（#36662d 坡脚无缝融坪 -> #32602a -> #244f22 -> #497d35 日照翠顶 + 自然向阳坡面光影）
  const colLawnBase = new THREE.Color('#36662d');
  const colLow = new THREE.Color('#32602a');
  const colMid = new THREE.Color('#244f22');
  const colHigh = new THREE.Color('#497d35');
  const colSunlit = new THREE.Color('#558c3b');
  const sunDir = new THREE.Vector3(-265, 205, 165).normalize();
  const tmpCol = new THREE.Color();

  const posAttr = hillGeo.attributes.position;
  const normAttr = hillGeo.attributes.normal;
  const colors = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const wy = rawHeights[i];
    const t = Math.max(0, Math.min(1, wy / height));
    const baseBlend = smoothstep(0.0, 0.14, t);

    tmpCol.copy(colLawnBase).lerp(colLow, baseBlend);
    tmpCol.lerp(colMid, Math.min(1, t * 1.35) * baseBlend);
    tmpCol.lerp(colHigh, Math.max(0, t * 1.45 - 0.48));

    const sunDot = Math.max(
      0,
      Math.min(1, normAttr.getX(i) * sunDir.x + normAttr.getY(i) * sunDir.y + normAttr.getZ(i) * sunDir.z)
    );
    const sunLift = smoothstep(0.42, 0.88, sunDot) * smoothstep(0.12, 0.85, t) * 0.24;
    const shadeDip = (1.0 - smoothstep(0.18, 0.56, sunDot)) * baseBlend * 0.10;
    const meadowPatch = (Math.sin(vx * 0.11 + vz * 0.08) * 0.55 + Math.cos(vx * 0.07 - vz * 0.13) * 0.45) * 0.055 * baseBlend;

    tmpCol.lerp(colSunlit, sunLift);
    tmpCol.multiplyScalar(1.0 - shadeDip + meadowPatch);

    // 细腻等高线压暗（保持线性色域色相不偏色，不裁切 R/B 通道）
    if (wy > 0.35 && wy < height - 0.3 && Math.abs(((wy / 1.15) % 1) - 0.5) < 0.062) {
      tmpCol.multiplyScalar(0.87);
    }

    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }
  hillGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const hillMesh = new THREE.Mesh(
    hillGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 0.85,
    })
  );
  hillMesh.receiveShadow = true;
  hillMesh.castShadow = true;
  grp.add(hillMesh);

  // 连续贴地暖洞石螺旋步道（起点北偏西直指 WalkwayMain (-129.33, 108.04)，盘旋 1.25 圈抵达东侧山顶观景口）
  const startAngle = -Math.PI * 0.542;
  const endAngle = startAngle + Math.PI * 2 * 1.25;
  const pathSteps = 84;
  const pathHalfW = 1.15;
  const pPos = [];
  const pIdx = [];

  for (let i = 0; i <= pathSteps; i++) {
    const t = i / pathSteps;
    const angle = THREE.MathUtils.lerp(startAngle, endAngle, t);
    const rad = THREE.MathUtils.lerp(21.1, summitR + 0.05, t);
    const px = cx + Math.cos(angle) * rad;
    const pz = cz + Math.sin(angle) * rad;

    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const inX = px - dirX * pathHalfW;
    const inZ = pz - dirZ * pathHalfW;
    const outX = px + dirX * pathHalfW;
    const outZ = pz + dirZ * pathHalfW;

    const yMid = sampleSWHillHeight(px, pz) + 0.18;
    const yIn = Math.max(yMid, sampleSWHillHeight(inX, inZ) + 0.16);
    const yOut = yMid - 0.02;
    const yOutBot = sampleSWHillHeight(outX, outZ) - 0.42;

    // 接近山顶平台出口时平滑过渡至 deckTop，与柚木平台零高差齐平
    const summitBlend = smoothstep(0.92, 1.0, t);
    const yInFinal = THREE.MathUtils.lerp(yIn, deckTop - 0.01, summitBlend);
    const yOutFinal = THREE.MathUtils.lerp(yOut, deckTop - 0.01, summitBlend);

    pPos.push(inX, yInFinal, inZ, outX, yOutFinal, outZ, outX, yOutBot, outZ);
  }

  for (let i = 0; i < pathSteps; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    // angle 顺时针递增：T × R = +Y（顶面朝上可见），T × D = +R（外护沿朝坡外可见）
    pIdx.push(a, b, a + 1, a + 1, b, b + 1);
    pIdx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }

  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  pathGeo.setIndex(pIdx);
  pathGeo.computeVertexNormals();

  const pathMesh = new THREE.Mesh(pathGeo, mats.warmStone);
  pathMesh.receiveShadow = true;
  pathMesh.castShadow = true;
  grp.add(pathMesh);

  // 山脚无缝暖石连接引道：将螺旋步道起点 (-128.8, 112.0, y=0.18) 平顺接通北侧环湖步道 WalkwayMain (-129.33, 108.04, y=0.06)
  const startPt = new THREE.Vector3(
    cx + Math.cos(startAngle) * 21.1,
    0,
    cz + Math.sin(startAngle) * 21.1
  );
  const walkPt = new THREE.Vector3(-129.33, 0, 108.04);
  const entryDir = new THREE.Vector3().subVectors(walkPt, startPt);
  const entryLen = entryDir.length() + 1.5;
  const entryMid = new THREE.Vector3().addVectors(startPt, walkPt).multiplyScalar(0.5);
  const entryApron = new THREE.Mesh(new THREE.BoxGeometry(pathHalfW * 2.15, 0.16, entryLen), mats.warmStone);
  entryApron.position.set(entryMid.x, 0.04, entryMid.z);
  entryApron.rotation.y = Math.atan2(entryDir.x, entryDir.z);
  entryApron.receiveShadow = true;
  grp.add(entryApron);

  // 山顶双阶倒角暖石基环 + 深影凹槽 + 蜜色柚木观景台（deckTop = 7.04）
  const baseRing = new THREE.Mesh(
    new THREE.CylinderGeometry(summitR + 0.25, summitR + 0.58, 0.42, 40),
    mats.ashlar
  );
  baseRing.position.set(cx, height - 0.05, cz);
  baseRing.receiveShadow = true;
  grp.add(baseRing);

  const revealRing = new THREE.Mesh(
    new THREE.CylinderGeometry(summitR + 0.04, summitR + 0.06, 0.12, 40),
    mats.shadowReveal
  );
  revealRing.position.set(cx, height + 0.16, cz);
  grp.add(revealRing);

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(summitR - 0.08, summitR - 0.04, 0.16, 40),
    mats.teak
  );
  deck.position.set(cx, deckTop - 0.08, cz);
  deck.receiveShadow = true;
  grp.add(deck);

  // L3 精确同角开口：玻璃栏杆、拉丝钛顶扶手、深石墨底槽、暖金灯带全部围绕 endAngle 留出 ±0.34 rad 精准入口！
  const gapHalf = 0.34;
  const railArcLen = Math.PI * 2 - gapHalf * 2;
  const railR = summitR - 0.22;

  // CylinderGeometry: x = r*sin(theta), z = r*cos(theta) => theta = PI/2 - angle
  const glassThetaStart = Math.PI * 0.5 - endAngle + gapHalf;
  const glassRail = new THREE.Mesh(
    new THREE.CylinderGeometry(railR, railR, 1.02, 40, 1, true, glassThetaStart, railArcLen),
    mats.frostedAquaGlass
  );
  glassRail.position.set(cx, deckTop + 0.52, cz);
  grp.add(glassRail);

  // 用与螺旋步道完全一致的 (cx + cos(a)*R, y, cz + sin(a)*R) 参数曲线直接生成顶扶手/底槽/暖灯环（0.000 rad 偏差）
  const ringSegs = 44;
  const handPts = [];
  const baseChanPts = [];
  const glowPts = [];
  for (let i = 0; i <= ringSegs; i++) {
    const a = endAngle + gapHalf + (i / ringSegs) * railArcLen;
    const rx = cx + Math.cos(a) * railR;
    const rz = cz + Math.sin(a) * railR;
    handPts.push(new THREE.Vector3(rx, deckTop + 1.04, rz));
    baseChanPts.push(new THREE.Vector3(rx, deckTop + 0.03, rz));
    glowPts.push(new THREE.Vector3(rx, deckTop + 0.09, rz));
  }

  const topRail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(handPts), 44, 0.052, 8, false),
    mats.titanium
  );
  grp.add(topRail);

  const baseChannel = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(baseChanPts), 44, 0.058, 6, false),
    mats.graphite
  );
  grp.add(baseChannel);

  // 观景台栏杆立柱（含入口两侧端柱，InstancedMesh）
  const postCount = 13;
  const postInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.038, 0.044, 1.04, 8), mats.graphite, postCount);
  const pDummy = new THREE.Object3D();
  for (let i = 0; i < postCount; i++) {
    const a = endAngle + gapHalf + (i / (postCount - 1)) * railArcLen;
    pDummy.position.set(cx + Math.cos(a) * railR, deckTop + 0.52, cz + Math.sin(a) * railR);
    pDummy.rotation.set(0, 0, 0);
    pDummy.scale.set(1, 1, 1);
    pDummy.updateMatrix();
    postInst.setMatrixAt(i, pDummy.matrix);
  }
  postInst.instanceMatrix.needsUpdate = true;
  grp.add(postInst);

  if (warmAccentMat) {
    const markerCount = 24;
    const markerGeo = new THREE.BoxGeometry(0.28, 0.14, 0.11);
    const markerInst = new THREE.InstancedMesh(markerGeo, warmAccentMat, markerCount);
    const mDummy = new THREE.Object3D();
    for (let i = 0; i < markerCount; i++) {
      const t = 0.04 + (i / (markerCount - 1)) * 0.92;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, t);
      const rad = THREE.MathUtils.lerp(21.1, summitR + 0.05, t) + pathHalfW - 0.12;
      const mx = cx + Math.cos(angle) * rad;
      const mz = cz + Math.sin(angle) * rad;
      const my = sampleSWHillHeight(mx, mz) + 0.18;
      mDummy.position.set(mx, my, mz);
      mDummy.rotation.set(0, -angle, 0);
      mDummy.scale.set(1, 1, 1);
      mDummy.updateMatrix();
      markerInst.setMatrixAt(i, mDummy.matrix);
    }
    markerInst.instanceMatrix.needsUpdate = true;
    grp.add(markerInst);

    const summitGlowRing = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(glowPts), 44, 0.046, 6, false),
      warmAccentMat
    );
    grp.add(summitGlowRing);
  }

  if (landmarkPoolMat) {
    const summitPool = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 13.2), landmarkPoolMat);
    summitPool.userData.noMerge = true;
    summitPool.rotation.x = -Math.PI / 2;
    summitPool.position.set(cx, deckTop + 0.02, cz);
    grp.add(summitPool);
  }

  return grp;
}

/**
 * 2. 东侧龙蟠山连续 CNC 精雕微等高线地形网格（丰润鼠尾草橄榄绿阶梯，绝不溢出陶瓷底座）
 */
function buildSculptedLongpanMountain() {
  const grp = new THREE.Group();
  grp.name = 'LongpanMountain_Sculpted';

  const xMin = 162;
  const xMax = PLINTH_CONFIG.width * 0.5 - 1.2;
  const zMin = -PLINTH_CONFIG.depth * 0.5 + 1.2;
  const zMax = PLINTH_CONFIG.depth * 0.5 - 1.2;
  const cornerR = PLINTH_CONFIG.cornerRadius + 1.2;

  const segX = 36;
  const segZ = 76;
  const positions = [];
  const rawHeights = [];
  const indices = [];

  for (let iz = 0; iz <= segZ; iz++) {
    const vz = iz / segZ;
    const rawZ = THREE.MathUtils.lerp(zMin, zMax, vz);
    for (let ix = 0; ix <= segX; ix++) {
      const vx = ix / segX;
      let x = THREE.MathUtils.lerp(xMin, xMax, vx);
      let z = rawZ;

      const cxCorner = xMax - cornerR;
      const czCorner = zMax - cornerR;
      if (x > cxCorner && Math.abs(z) > czCorner) {
        const dx = x - cxCorner;
        const dz = Math.abs(z) - czCorner;
        const dist = Math.hypot(dx, dz);
        if (dist > cornerR) {
          x = cxCorner + (dx / dist) * cornerR;
          z = Math.sign(z) * (czCorner + (dz / dist) * cornerR);
        }
      }

      const y = sampleLongpanHeight(x, z);
      const yFinal = y < 0.04 ? -0.025 : y;
      positions.push(x, yFinal, z);
      rawHeights.push(y);
    }
  }

  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * (segX + 1) + ix;
      const b = a + 1;
      const c = a + segX + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // 丰茂健康深翠航拍龙蟠山着色（#36662d 坡脚无缝融坪 -> #32602a -> #244f22 深谷苔绿 -> #497d35 晴翠山脊 + 自然坡向光影）
  const colLawnBase = new THREE.Color('#36662d');
  const colLow = new THREE.Color('#32602a');
  const colMid = new THREE.Color('#244f22');
  const colHigh = new THREE.Color('#497d35');
  const colSunlit = new THREE.Color('#558c3b');
  const sunDir = new THREE.Vector3(-265, 205, 165).normalize();
  const tmpCol = new THREE.Color();

  const posAttr = geo.attributes.position;
  const normAttr = geo.attributes.normal;
  const colors = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const y = rawHeights[i];
    const t = Math.max(0, Math.min(1, y / 22.0));
    const baseBlend = smoothstep(0.0, 0.10, t);

    tmpCol.copy(colLawnBase).lerp(colLow, baseBlend);
    tmpCol.lerp(colMid, Math.min(1, t * 1.45) * baseBlend);
    tmpCol.lerp(colHigh, Math.max(0, t * 1.55 - 0.55));

    const sunDot = Math.max(
      0,
      Math.min(1, normAttr.getX(i) * sunDir.x + normAttr.getY(i) * sunDir.y + normAttr.getZ(i) * sunDir.z)
    );
    const sunLift = smoothstep(0.42, 0.88, sunDot) * smoothstep(0.10, 0.80, t) * 0.26;
    const shadeDip = (1.0 - smoothstep(0.16, 0.54, sunDot)) * baseBlend * 0.12;
    const forestPatch = (Math.sin(vx * 0.065 + vz * 0.048) * 0.55 + Math.cos(vx * 0.042 - vz * 0.075) * 0.45) * 0.065 * baseBlend;

    tmpCol.lerp(colSunlit, sunLift);
    tmpCol.multiplyScalar(1.0 - shadeDip + forestPatch);

    // 柔和山体等高线暗沟（线性比例压暗，色相饱满清透）
    if (y > 0.45 && Math.abs(((y / 1.85) % 1) - 0.5) < 0.068) {
      tmpCol.multiplyScalar(0.85);
    }

    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 0.85,
    })
  );
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  grp.add(mesh);

  return grp;
}

/**
 * 辅助函数：西南拱桥桥面标高解析式（同时驱动桥面与桥上 1:100 比例小人精确站位）
 */
function sampleSWBridgeDeckY(t) {
  return SW_BRIDGE.baseY + Math.pow(Math.cos(t * Math.PI), 1.35) * SW_BRIDGE.archDeckH;
}

/**
 * 3. 跨西南湖湾拉丝钛双拱肋磨砂冰青玻璃拱桥（阶梯倒角暖石桥台 + 斜拉吊杆精准锁合桥面 L7 修复）
 */
function buildSeamlessSWArchBridge(mats, warmAccentMat, bridgeArchLedMat) {
  const grp = new THREE.Group();
  grp.name = 'SW_ArchBridge';

  const { pStart, pEnd, deckW } = SW_BRIDGE;
  const mid = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);
  const span = pStart.distanceTo(pEnd);
  const rotY = Math.atan2(pEnd.x - pStart.x, pEnd.z - pStart.z);

  grp.position.set(mid.x, 0, mid.z);
  grp.rotation.y = rotY;

  const segs = 32;
  const teakHalfW = deckW * 0.5 - 0.48;

  // 1. 连续平滑蜜色柚木中央桥面 + 两侧倒角暖石边石 + 拉丝钛流线箱梁 + 深石墨下翼缘
  const deckPos = [];
  const deckUv = [];
  const deckIdx = [];
  const stoneCurbPos = [];
  const stoneCurbIdx = [];
  const girderPos = [];
  const girderIdx = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs - 0.5;
    const z = t * span;
    const y = sampleSWBridgeDeckY(t);
    const v = (i / segs) * 9;

    deckPos.push(-teakHalfW, y, z, teakHalfW, y, z);
    deckUv.push(0, v, 1, v);

    // 两侧倒角暖石压边（高出柚木面 2cm，外缘略倒角）
    stoneCurbPos.push(
      -deckW * 0.5, y - 0.03, z,
      -deckW * 0.5 + 0.08, y + 0.025, z,
      -teakHalfW, y + 0.025, z,
      teakHalfW, y + 0.025, z,
      deckW * 0.5 - 0.08, y + 0.025, z,
      deckW * 0.5, y - 0.03, z
    );

    // 桥下流线型拉丝钛箱梁腹板与底板
    girderPos.push(
      -deckW * 0.52, y - 0.02, z,
      -deckW * 0.42, y - 0.48, z,
      deckW * 0.42, y - 0.48, z,
      deckW * 0.52, y - 0.02, z
    );
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    deckIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);

    const sa = i * 6;
    const sb = (i + 1) * 6;
    // 左倒角、左顶、右顶、右倒角
    stoneCurbIdx.push(sa, sb, sa + 1, sa + 1, sb, sb + 1);
    stoneCurbIdx.push(sa + 1, sb + 1, sa + 2, sa + 2, sb + 1, sb + 2);
    stoneCurbIdx.push(sa + 3, sb + 3, sa + 4, sa + 4, sb + 3, sb + 4);
    stoneCurbIdx.push(sa + 4, sb + 4, sa + 5, sa + 5, sb + 4, sb + 5);

    const ga = i * 4;
    const gb = (i + 1) * 4;
    girderIdx.push(ga, ga + 1, gb, ga + 1, gb + 1, gb);
    girderIdx.push(ga + 1, ga + 2, gb + 1, ga + 2, gb + 2, gb + 1);
    girderIdx.push(ga + 2, ga + 3, gb + 2, ga + 3, gb + 3, gb + 2);
  }

  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUv, 2));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  const deckMesh = new THREE.Mesh(deckGeo, mats.teak);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  grp.add(deckMesh);

  const stoneCurbGeo = new THREE.BufferGeometry();
  stoneCurbGeo.setAttribute('position', new THREE.Float32BufferAttribute(stoneCurbPos, 3));
  stoneCurbGeo.setIndex(stoneCurbIdx);
  stoneCurbGeo.computeVertexNormals();
  const stoneCurbMesh = new THREE.Mesh(stoneCurbGeo, mats.warmStone);
  stoneCurbMesh.castShadow = true;
  stoneCurbMesh.receiveShadow = true;
  grp.add(stoneCurbMesh);

  const girderGeo = new THREE.BufferGeometry();
  girderGeo.setAttribute('position', new THREE.Float32BufferAttribute(girderPos, 3));
  girderGeo.setIndex(girderIdx);
  girderGeo.computeVertexNormals();
  const girderMesh = new THREE.Mesh(girderGeo, mats.titanium);
  girderMesh.castShadow = true;
  grp.add(girderMesh);

  // 2. 连续磨砂冰青亚克力玻璃护栏 + 深石墨底槽 + 拉丝钛扶手 + 护栏暗藏暖金导引光带
  for (const side of [-1, 1]) {
    const railPos = [];
    const railIdx = [];
    const handPts = [];
    const chanPts = [];
    const rx = side * (deckW * 0.5 - 0.18);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs - 0.5;
      const z = t * span;
      const y = sampleSWBridgeDeckY(t);
      railPos.push(rx, y + 0.05, z, rx, y + 1.06, z);
      handPts.push(new THREE.Vector3(rx, y + 1.08, z));
      chanPts.push(new THREE.Vector3(rx, y + 0.04, z));
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      railIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    railGeo.setIndex(railIdx);
    railGeo.computeVertexNormals();
    grp.add(new THREE.Mesh(railGeo, mats.frostedAquaGlass));

    grp.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(handPts), 32, 0.048, 8, false),
        mats.titanium
      )
    );
    grp.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(chanPts), 32, 0.052, 6, false),
        mats.graphite
      )
    );

    if (warmAccentMat) {
      const stripPts = handPts.map((pt) => new THREE.Vector3(pt.x, pt.y - 0.085, pt.z));
      grp.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stripPts), 28, 0.038, 6, false),
          warmAccentMat
        )
      );
    }
  }

  // 3. 双端实体阶梯倒角暖石桥台（深扎 -2.35 湖底，顶面精准对接环湖步道 0.062m）+ 深石墨拱脚推力座
  for (const endSign of [-1, 1]) {
    const ez = endSign * (span * 0.5 + 1.15);

    // 主桥台实体（[-2.35, +0.04]）
    const abutBody = new THREE.Mesh(new THREE.BoxGeometry(deckW + 1.5, 2.39, 3.4), mats.ashlar);
    abutBody.position.set(0, -1.155, ez);
    abutBody.receiveShadow = true;
    grp.add(abutBody);

    // 倒角暖石台帽（平滑衔接步道 y=0.059..0.068）
    const abutCap = new THREE.Mesh(new THREE.BoxGeometry(deckW + 1.2, 0.14, 3.6), mats.warmStone);
    abutCap.position.set(0, 0.0, ez + endSign * 0.1);
    abutCap.receiveShadow = true;
    grp.add(abutCap);

    // 双侧深石墨拱肋推力支座（稳稳接住双侧钢拱肋脚端）
    for (const side of [-1, 1]) {
      const thrustBlock = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.65, 1.35), mats.graphite);
      thrustBlock.position.set(side * (deckW * 0.5 + 0.34), 0.14, endSign * (span * 0.5 + 0.55));
      thrustBlock.castShadow = true;
      thrustBlock.receiveShadow = true;
      grp.add(thrustBlock);
    }
  }

  // 4. 双侧蝴蝶倾角拉丝钛 + 深石墨双弦拱肋、顶部横撑与精准斜拉吊杆（L7 彻底修复！）
  const archH = 7.4;
  const archSpan = span + 1.2;
  const archSample = (side, t) => {
    const z = t * archSpan;
    const y = -0.02 + (1 - 4 * t * t) * archH;
    const x = side * (deckW * 0.5 + 0.34 - (1 - 4 * t * t) * 0.52);
    return new THREE.Vector3(x, y, z);
  };

  for (const side of [-1, 1]) {
    const archPts = [];
    const innerSpinePts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28 - 0.5;
      const pt = archSample(side, t);
      archPts.push(pt);
      innerSpinePts.push(new THREE.Vector3(pt.x - side * 0.14, pt.y - 0.16, pt.z));
    }

    const archMesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 32, 0.22, 10, false),
      mats.titanium
    );
    archMesh.castShadow = true;
    grp.add(archMesh);

    const spineMesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(innerSpinePts), 32, 0.105, 8, false),
      mats.graphite
    );
    grp.add(spineMesh);

    if (bridgeArchLedMat) {
      const archLedPts = archPts.map((pt) => new THREE.Vector3(pt.x - side * 0.18, pt.y - 0.25, pt.z));
      grp.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archLedPts), 28, 0.062, 6, false),
          bridgeArchLedMat
        )
      );
    }

    // L7 修复：每根吊杆由拱肋精确点斜向连接至桥面暖石边石锚固点（零悬空、零错位！）
    for (let k = -4; k <= 4; k++) {
      const tDeck = k * 0.085;
      const z = tDeck * span;
      const tArch = z / archSpan;
      const pArch = archSample(side, tArch);
      const yDeck = sampleSWBridgeDeckY(tDeck);
      const pDeck = new THREE.Vector3(side * (deckW * 0.5 - 0.14), yDeck + 0.02, z);

      grp.add(createStrutMesh(pDeck, pArch, 0.036, 0.036, mats.titanium, 6, true));

      // 桥面锚固套筒
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.14, 8), mats.graphite);
      socket.position.copy(pDeck).add(new THREE.Vector3(0, 0.05, 0));
      grp.add(socket);
    }
  }

  // 拱顶 3 根横向深石墨联系风撑（强化工业结构精工质感）
  for (const tBr of [-0.14, 0, 0.14]) {
    const pL = archSample(-1, tBr);
    const pR = archSample(1, tBr);
    grp.add(createStrutMesh(pL, pR, 0.075, 0.075, mats.graphite, 8, false));
  }

  return grp;
}

/**
 * 4. 西南张拉膜小亭（L4 修复：重定位至 (-78, 154) 远离湖岸 10.8m + 四角全量斜桅杆与拉索锚固）
 */
function buildHyperbolicMembranePavilion(mats, warmAccentMat, landmarkPoolMat) {
  const grp = new THREE.Group();
  grp.name = 'SW_HyperbolicPavilion';
  grp.position.set(HYPER_PAV.cx, 0, HYPER_PAV.cz);

  // 双阶倒角暖石基座 + 深影凹槽 + 暗藏暖金轮廓灯环（padTop = 0.30）
  const lowerPad = new THREE.Mesh(new THREE.CylinderGeometry(8.45, 8.75, 0.2, 40), mats.ashlar);
  lowerPad.position.y = 0.05; // [-0.05, +0.15]
  lowerPad.receiveShadow = true;
  grp.add(lowerPad);

  const revealPad = new THREE.Mesh(new THREE.CylinderGeometry(7.92, 7.95, 0.08, 40), mats.shadowReveal);
  revealPad.position.y = 0.16;
  grp.add(revealPad);

  const upperPad = new THREE.Mesh(new THREE.CylinderGeometry(7.9, 8.05, 0.13, 40), mats.warmStone);
  upperPad.position.y = HYPER_PAV.padTop - 0.065; // [0.17, 0.30]
  upperPad.receiveShadow = true;
  grp.add(upperPad);

  if (warmAccentMat) {
    const edgeRing = new THREE.Mesh(new THREE.TorusGeometry(7.96, 0.042, 6, 48), warmAccentMat);
    edgeRing.rotation.x = Math.PI / 2;
    edgeRing.position.y = 0.165;
    grp.add(edgeRing);
  }

  // 东北向暖石引道无缝接通环湖步道 WalkwayMain (-67, 143)
  const linkDir = new THREE.Vector3(11, 0, -11); // 从 (-78,154) 指向 (-67,143)，距 15.56m
  const linkUnit = linkDir.clone().normalize();
  const linkLen = 8.4;
  const linkMidDist = 11.7;
  const linkMesh = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, linkLen), mats.warmStone);
  linkMesh.position.set(linkUnit.x * linkMidDist, 0.015, linkUnit.z * linkMidDist);
  linkMesh.rotation.y = Math.atan2(linkUnit.x, linkUnit.z);
  linkMesh.receiveShadow = true;
  grp.add(linkMesh);

  // 衔接阶台（由 0.30 平滑步降至 0.075 引道）
  const entryStep = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.18, 1.3), mats.ashlar);
  entryStep.position.set(linkUnit.x * 8.2, 0.09, linkUnit.z * 8.2);
  entryStep.rotation.y = Math.atan2(linkUnit.x, linkUnit.z);
  entryStep.receiveShadow = true;
  grp.add(entryStep);

  // 真正四角锚固的双曲抛物面缎面陶瓷张拉膜：y = 4.2 + 1.85 * (u * v)
  // (+1,+1) & (-1,-1) 为 6.05m 高尖角，(+1,-1) & (-1,+1) 为 2.35m 低锚角，边缘微内收呈真实张拉弧度
  const seg = 22;
  const half = 5.35;
  const evalMembrane = (u, v) => {
    const edgePull = 1 - 0.055 * ((1 - u * u) * v * v + (1 - v * v) * u * u);
    const x = u * half * edgePull;
    const z = v * half * edgePull;
    const y = 4.2 + 1.85 * u * v;
    return new THREE.Vector3(x, y, z);
  };

  const positions = [];
  const indices = [];
  for (let iy = 0; iy <= seg; iy++) {
    const v = (iy / seg) * 2 - 1;
    for (let ix = 0; ix <= seg; ix++) {
      const u = (ix / seg) * 2 - 1;
      const pt = evalMembrane(u, v);
      positions.push(pt.x, pt.y, pt.z);
    }
  }
  for (let iy = 0; iy < seg; iy++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iy * (seg + 1) + ix;
      indices.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
    }
  }
  const memGeo = new THREE.BufferGeometry();
  memGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  memGeo.setIndex(indices);
  memGeo.computeVertexNormals();

  // 缎面暖瓷白（非刺眼纯白，匹配 Art Spec #9）
  const memMat = new THREE.MeshStandardMaterial({
    color: '#ded8ce',
    emissive: new THREE.Color('#ffd498'),
    emissiveIntensity: 0.0,
    roughness: 0.36,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const memMesh = new THREE.Mesh(memGeo, memMat);
  memMesh.castShadow = true;
  memMesh.receiveShadow = true;
  grp.add(memMesh);

  // 4 条沿膜边走线的深石墨张力边索
  const edgeParamPairs = [
    (t) => evalMembrane(t, -1),
    (t) => evalMembrane(t, 1),
    (t) => evalMembrane(-1, t),
    (t) => evalMembrane(1, t),
  ];
  for (const fn of edgeParamPairs) {
    const pts = [];
    for (let i = 0; i <= 14; i++) pts.push(fn((i / 14) * 2 - 1));
    grp.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.042, 6, false),
        mats.graphite
      )
    );
  }

  // 四角全量斜倾深石墨钢桅杆 + 外部张力背索 + 锚固钢靴（全部精准落于 padTop = 0.30 上）
  const corners = [
    { u: 1, v: 1, high: true },
    { u: -1, v: -1, high: true },
    { u: 1, v: -1, high: false },
    { u: -1, v: 1, high: false },
  ];
  for (const c of corners) {
    const pTop = evalMembrane(c.u, c.v);
    const radialDir = new THREE.Vector3(c.u, 0, c.v).normalize();
    // 主桅杆脚端落于 r = 6.55m，背索锚靴落于 r = 7.65m（均稳固落于 upperPad r=7.90m 上）
    const pMastBot = radialDir.clone().multiplyScalar(c.high ? 6.45 : 6.75).setY(HYPER_PAV.padTop);
    const pCableBot = radialDir.clone().multiplyScalar(7.65).setY(HYPER_PAV.padTop);

    grp.add(createStrutMesh(pMastBot, pTop, c.high ? 0.09 : 0.075, c.high ? 0.13 : 0.1, mats.graphite, 10, true));
    grp.add(createStrutMesh(pCableBot, pTop, 0.028, 0.028, mats.titanium, 6, false));

    // 锚固底座钢靴 + 顶部拉索节点球
    const shoe = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.14, 10), mats.titanium);
    shoe.position.set(pMastBot.x, HYPER_PAV.padTop + 0.06, pMastBot.z);
    grp.add(shoe);

    const cableShoe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.12, 8), mats.graphite);
    cableShoe.position.set(pCableBot.x, HYPER_PAV.padTop + 0.05, pCableBot.z);
    grp.add(cableShoe);

    const capNode = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), mats.titanium);
    capNode.position.copy(pTop);
    grp.add(capNode);

    if (warmAccentMat) {
      const uplight = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 10), warmAccentMat);
      uplight.position.set(pMastBot.x * 0.82, HYPER_PAV.padTop + 0.04, pMastBot.z * 0.82);
      grp.add(uplight);
    }
  }

  if (landmarkPoolMat) {
    const pavPool = new THREE.Mesh(new THREE.PlaneGeometry(14.8, 14.8), landmarkPoolMat);
    pavPool.userData.noMerge = true;
    pavPool.rotation.x = -Math.PI / 2;
    pavPool.position.set(0, HYPER_PAV.padTop + 0.014, 0);
    grp.add(pavPool);
  }

  return { group: grp, memMat };
}

/**
 * 5. 东岸六角木吊顶临湖亭（L6 严密收口 + 保留 v2.1 璀璨暖金灯笼夜景）与双岸无缝亲水栈桥（L5 延伸+深桩扎底）
 */
function buildEastLakesidePavilionAndPier(mats, warmAccentMat, maxAnisotropy = 4) {
  const grp = new THREE.Group();
  grp.name = 'EastShore_PavilionAndPier';

  const { cx: px, cz: pz, radius, baseTop } = EAST_PAV;

  // 双阶倒角六角暖石基座（下阶埋入草坪 -0.06m 零浮边，上阶顶面精确 baseTop = 0.45）
  const pavBaseMat = new THREE.MeshStandardMaterial({
    color: '#c9c1b5',
    emissive: new THREE.Color('#a86220'),
    emissiveIntensity: 0.0,
    roughness: 0.62,
    metalness: 0.03,
  });
  const lowerHex = new THREE.Mesh(new THREE.CylinderGeometry(radius + 1.95, radius + 2.25, 0.28, 6), mats.ashlar);
  lowerHex.position.set(px, 0.08, pz); // [-0.06, +0.22]
  lowerHex.receiveShadow = true;
  grp.add(lowerHex);

  const revealHex = new THREE.Mesh(new THREE.CylinderGeometry(radius + 1.48, radius + 1.52, 0.08, 6), mats.shadowReveal);
  revealHex.position.set(px, 0.23, pz);
  grp.add(revealHex);

  const upperHex = new THREE.Mesh(new THREE.CylinderGeometry(radius + 1.42, radius + 1.6, 0.22, 6), pavBaseMat);
  upperHex.position.set(px, baseTop - 0.11, pz); // [0.23, 0.45]
  upperHex.receiveShadow = true;
  grp.add(upperHex);

  // 东侧正交双阶嵌入式入口踏步平台（严格垂直对接六角东平边 x=155.37，平滑双阶降至 WalkwayMain 西路缘 x=158.65，底扎 -0.06m 零浮边）
  const eastStep1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.36, 5.2), mats.warmStone);
  eastStep1.position.set(155.7, 0.12, pz); // x∈[154.80,156.60] 深嵌入上阶六角边，y∈[-0.06,+0.30]
  eastStep1.castShadow = true;
  eastStep1.receiveShadow = true;
  grp.add(eastStep1);

  const eastStep2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.24, 5.4), mats.ashlar);
  eastStep2.position.set(157.15, 0.06, pz); // x∈[156.40,157.90]，y∈[-0.06,+0.18]
  eastStep2.castShadow = true;
  eastStep2.receiveShadow = true;
  grp.add(eastStep2);

  const eastApronFlush = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.135, 5.4), mats.warmStone);
  eastApronFlush.position.set(158.2, 0.0075, pz); // x∈[157.68,158.73] 齐平嵌入 WalkwayMain (0.059..0.081)，top=+0.075
  eastApronFlush.receiveShadow = true;
  grp.add(eastApronFlush);

  for (const s of [-1, 1]) {
    const stepCheek = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.42, 0.34), mats.ashlar);
    stepCheek.position.set(156.8, 0.15, pz + s * 2.77); // x∈[155.20,158.40]，两侧收边挡墙
    stepCheek.castShadow = true;
    stepCheek.receiveShadow = true;
    grp.add(stepCheek);
  }

  // 6 根深石墨精工钢柱（带拉丝钛柱脚与柱头，严密连接 baseTop=0.45 至屋檐吊顶 4.98）
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const colX = px + Math.cos(a) * (radius - 0.85);
    const colZ = pz + Math.sin(a) * (radius - 0.85);

    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 4.56, 10), mats.graphite);
    col.position.set(colX, baseTop + 2.28, colZ); // [0.45, 5.01]
    col.castShadow = true;
    grp.add(col);

    const shoe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.16, 10), mats.titanium);
    shoe.position.set(colX, baseTop + 0.08, colZ);
    grp.add(shoe);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.14, 10), mats.titanium);
    cap.position.set(colX, 4.92, colZ);
    grp.add(cap);
  }

  // L6 修复：磨砂冰青玻璃核心柱严密横跨 [0.43, 5.01]（消除 0.34m 顶隙！）+ 上下深石墨收边压环
  const pavGlassMat = mats.frostedAquaGlass.clone();
  pavGlassMat.emissive = new THREE.Color('#ffba52');
  pavGlassMat.emissiveIntensity = 0.0;
  const glassCore = new THREE.Mesh(new THREE.CylinderGeometry(radius - 2.4, radius - 2.4, 4.58, 6), pavGlassMat);
  glassCore.position.set(px, 2.72, pz); // [0.43, 5.01]
  grp.add(glassCore);

  for (const frameY of [baseTop + 0.06, 4.95]) {
    const frameRing = new THREE.Mesh(new THREE.TorusGeometry(radius - 2.4, 0.08, 6, 6), mats.graphite);
    frameRing.rotation.x = Math.PI / 2;
    frameRing.rotation.z = Math.PI / 6;
    frameRing.position.set(px, frameY, pz);
    grp.add(frameRing);
  }

  // L6 修复：亭内暖金建筑漫射内芯严密落于 baseTop=0.45（消除 0.11m 底部浮空！）
  const pavInnerGlowMat = new THREE.MeshStandardMaterial({
    color: '#ffedc8',
    emissive: new THREE.Color('#ffae42'),
    emissiveIntensity: 0.0,
    roughness: 0.45,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    visible: false,
  });
  const innerCore = new THREE.Mesh(new THREE.CylinderGeometry(radius - 3.55, radius - 3.25, 4.44, 6), pavInnerGlowMat);
  innerCore.userData.noMerge = true;
  innerCore.position.set(px, baseTop + 2.22, pz); // [0.45, 4.89]
  grp.add(innerCore);

  // 精工双层倒角拉丝深青铜/钛岩灰六角折面屋顶（Art Spec #9: #3D434B）+ 6 条拉丝钛屋脊肋 + 顶部呼吸灯亭宝顶
  const roofMat = new THREE.MeshStandardMaterial({ color: '#3d434b', roughness: 0.38, metalness: 0.58 });
  const roofFascia = new THREE.Mesh(new THREE.CylinderGeometry(radius + 2.38, radius + 2.66, 0.24, 6), mats.titanium);
  roofFascia.position.set(px, 5.28, pz);
  roofFascia.castShadow = true;
  roofFascia.receiveShadow = true;
  grp.add(roofFascia);

  const roofCap = new THREE.Mesh(new THREE.ConeGeometry(radius + 2.45, 2.85, 6), roofMat);
  roofCap.position.set(px, 6.76, pz);
  roofCap.castShadow = true;
  roofCap.receiveShadow = true;
  grp.add(roofCap);

  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.15, 0.42, 6), mats.titanium);
  cupola.position.set(px, 8.22, pz);
  grp.add(cupola);

  // 6 条屋面拉丝钛斜脊线
  const apexPt = new THREE.Vector3(px, 8.18, pz);
  for (let i = 0; i < 6; i++) {
    // CylinderGeometry/ConeGeometry 顶点角在 PI/2 - (i/6)*2PI -> 对齐六角棱线 (a = i*PI/3 + PI/6)
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const eavePt = new THREE.Vector3(
      px + Math.cos(a) * (radius + 2.42),
      5.34,
      pz + Math.sin(a) * (radius + 2.42)
    );
    grp.add(createStrutMesh(eavePt, apexPt, 0.06, 0.075, mats.titanium, 6, false));
  }

  // 温暖雪松木六角格栅吊顶（Art Spec #9: #9C6F47，完整保留 v2.1 暖金木顶夜景辉光）
  const warmWoodMat = new THREE.MeshStandardMaterial({
    color: '#9c6f47',
    emissive: new THREE.Color('#e88a24'),
    emissiveIntensity: 0.0,
    roughness: 0.48,
    metalness: 0.04,
  });
  const ceilingPlate = new THREE.Mesh(new THREE.CylinderGeometry(radius + 2.18, radius + 2.08, 0.24, 6), warmWoodMat);
  ceilingPlate.position.set(px, 5.08, pz); // [4.96, 5.20]
  grp.add(ceilingPlate);

  if (warmAccentMat) {
    const eaveHalo = new THREE.Mesh(new THREE.TorusGeometry(radius + 1.98, 0.095, 6, 6), warmAccentMat);
    eaveHalo.rotation.x = Math.PI / 2;
    eaveHalo.rotation.z = Math.PI / 6;
    eaveHalo.position.set(px, 4.96, pz);
    grp.add(eaveHalo);
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.15, 0.22, 0.24), warmWoodMat);
    rib.position.set(px, 4.95, pz);
    rib.rotation.y = a;
    grp.add(rib);

    if (warmAccentMat) {
      const ribLed = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.95, 0.075, 0.13), warmAccentMat);
      ribLed.position.set(px, 4.84, pz);
      ribLed.rotation.y = a;
      grp.add(ribLed);
    }
  }

  if (warmAccentMat) {
    const crownGlow = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 0.12, 6), warmAccentMat);
    crownGlow.position.set(px, 4.91, pz);
    grp.add(crownGlow);
  }

  const pavPoolTex = createFeatheredLightPoolTexture('255, 224, 152', '255, 156, 48', maxAnisotropy);
  const pavDeckPoolMat = new THREE.MeshBasicMaterial({
    map: pavPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const pavDeckPool = new THREE.Mesh(new THREE.PlaneGeometry(21.2, 21.2), pavDeckPoolMat);
  pavDeckPool.userData.noMerge = true;
  pavDeckPool.rotation.x = -Math.PI / 2;
  pavDeckPool.position.set(px, baseTop + 0.015, pz);
  grp.add(pavDeckPool);

  const pavLawnPoolMat = new THREE.MeshBasicMaterial({
    map: pavPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const pavLawnPool = new THREE.Mesh(new THREE.PlaneGeometry(36.0, 36.0), pavLawnPoolMat);
  pavLawnPool.userData.noMerge = true;
  pavLawnPool.rotation.x = -Math.PI / 2;
  pavLawnPool.position.set(px, 0.095, pz);
  grp.add(pavLawnPool);

  // L5 彻底修复：无缝双岸亲水栈桥延展至 p1=(99.4, 0.20, 24.0) ↔ p2=(154.4, 0.20, 2.4)
  const { p1, p2 } = EAST_PIER;
  const pierLen = p1.distanceTo(p2);
  const pierMid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const pierRotY = Math.atan2(p2.x - p1.x, p2.z - p1.z);

  const pierGrp = new THREE.Group();
  pierGrp.position.copy(pierMid);
  pierGrp.rotation.y = pierRotY;

  // 蜜色柚木栈桥面（local y [-0.11, +0.11] => world [+0.09, +0.31]）
  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, pierLen), mats.teak);
  pierDeck.castShadow = true;
  pierDeck.receiveShadow = true;
  pierGrp.add(pierDeck);

  // 双侧深青铜/石墨倒角纵梁边饰
  for (const side of [-1, 1]) {
    const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.3, pierLen - 0.4), mats.bronze);
    stringer.position.set(side * 1.62, -0.04, 0);
    stringer.castShadow = true;
    pierGrp.add(stringer);
  }

  // 两端阶梯式暖石着陆引台（西端零缝对接 FireRing 99.82，东端零缝对接 WalkwayMain 154.0，底扎 -0.80m）
  for (const end of [-1, 1]) {
    const zBase = end * (pierLen * 0.5 - 0.85);
    const landingMain = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.96, 2.6), mats.ashlar);
    landingMain.position.set(0, -0.42, zBase); // top=+0.06 local => +0.26 world
    landingMain.receiveShadow = true;
    pierGrp.add(landingMain);

    // 顺平过渡步踏（步降至 world y=0.08，无断崖衔接道路与步道）
    const approachStep = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.48, 1.5), mats.warmStone);
    approachStep.position.set(0, -0.34, end * (pierLen * 0.5 + 0.35)); // top=-0.10 local => +0.10 world
    approachStep.receiveShadow = true;
    pierGrp.add(approachStep);
  }

  // 双侧磨砂冰青玻璃护栏 + 纤细深石墨扶手 + 暖琥珀线性边缘灯带
  const railSpan = pierLen - 2.4;
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.94, railSpan), mats.frostedAquaGlass);
    rail.position.set(side * 1.55, 0.58, 0);
    pierGrp.add(rail);

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.065, railSpan + 0.1), mats.bronze);
    topBar.position.set(side * 1.55, 1.07, 0);
    pierGrp.add(topBar);

    if (warmAccentMat) {
      const edgeLed = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, pierLen - 1.6), warmAccentMat);
      edgeLed.position.set(side * 1.52, 0.145, 0);
      pierGrp.add(edgeLed);
    }
  }

  // 护栏纤细竖柱（InstancedMesh）
  const stanchionCount = 24;
  const stanchionInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 0.98, 0.055), mats.graphite, stanchionCount);
  const sDummy = new THREE.Object3D();
  let si = 0;
  for (let i = 0; i < 12; i++) {
    const z = -railSpan * 0.5 + (i / 11) * railSpan;
    for (const side of [-1.55, 1.55]) {
      sDummy.position.set(side, 0.58, z);
      sDummy.rotation.set(0, 0, 0);
      sDummy.scale.set(1, 1, 1);
      sDummy.updateMatrix();
      stanchionInst.setMatrixAt(si++, sDummy.matrix);
    }
  }
  stanchionInst.instanceMatrix.needsUpdate = true;
  pierGrp.add(stanchionInst);

  // L5 彻底修复：9 对（18 根）加长深水基础桩（避开 t=0.302 与 t=0.635 驳岸墙，全部扎入 -2.20 湖底以下 0.32m！）
  // local y = [-2.72, -0.02] => world y = [-2.52, +0.18]（上紧扣纵梁，下深扎湖底 0.32m）
  const pileTs = [0.08, 0.2, 0.34, 0.43, 0.51, 0.6, 0.72, 0.84, 0.92];
  const pileInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.145, 0.165, 2.7, 10), mats.graphite, pileTs.length * 2);
  const collarInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 10), mats.titanium, 8);
  const dummy = new THREE.Object3D();
  let pi = 0;
  let ci = 0;
  for (const t of pileTs) {
    const z = (t - 0.5) * pierLen;
    const isOverWater = t > 0.31 && t < 0.63;
    for (const side of [-1.32, 1.32]) {
      dummy.position.set(side, -1.37, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pileInst.setMatrixAt(pi++, dummy.matrix);

      if (isOverWater && ci < 8) {
        // 水线以上拉丝钛防腐抱箍（world y = -0.48）
        dummy.position.set(side, -0.68, z);
        dummy.updateMatrix();
        collarInst.setMatrixAt(ci++, dummy.matrix);
      }
    }
  }
  pileInst.instanceMatrix.needsUpdate = true;
  collarInst.instanceMatrix.needsUpdate = true;
  pierGrp.add(pileInst, collarInst);
  grp.add(pierGrp);

  return { group: grp, warmWoodMat, pavGlassMat, pavInnerGlowMat, pavBaseMat, pavDeckPoolMat, pavLawnPoolMat };
}

/**
 * 6. 临湖柚木阶梯看台（L9）、八角缎面遮阳伞（L6）、悬挑长椅（L10）、CNC 庭院柱灯（L11）与 1:100 雕塑小人（L12）
 */
function buildWaterfrontFurnitureAndPeople(mats, warmAccentMat, contactAoMat, maxAnisotropy) {
  const grp = new THREE.Group();
  grp.name = 'WaterfrontFurnitureAndPeople';

  // 1. L9 修复：临湖柚木阶梯看台全部拾级建于地上（yTop = 0.58 -> 0.38 -> 0.20），底齐草坪，前沿紧贴 0.20 驳岸压顶！
  const stepSets = [
    { x: -98, zStart: 50.45, width: 22 },   // 止于 z=53.15（紧贴 z=54.0 驳岸内缘 53.18）
    { x: 26, zStart: -59.55, width: 28 },   // 止于 z=-56.85（紧贴 z=-56.0 驳岸内缘 -56.82）
  ];
  const tierTops = [0.58, 0.38, 0.2];
  const tierDepth = 0.9;
  for (const st of stepSets) {
    for (let k = 0; k < 3; k++) {
      const topY = tierTops[k];
      const zc = st.zStart + (k + 0.5) * tierDepth;
      const baseH = topY - 0.08 + 0.04; // 埋入草坪 -0.04m

      const stoneBase = new THREE.Mesh(new THREE.BoxGeometry(st.width, baseH, tierDepth - 0.02), mats.ashlar);
      stoneBase.position.set(st.x, -0.04 + baseH * 0.5, zc);
      stoneBase.receiveShadow = true;
      grp.add(stoneBase);

      const teakTread = new THREE.Mesh(new THREE.BoxGeometry(st.width + 0.06, 0.08, tierDepth + 0.04), mats.teak);
      teakTread.position.set(st.x, topY - 0.04, zc + 0.02);
      teakTread.castShadow = true;
      teakTread.receiveShadow = true;
      grp.add(teakTread);

      if (warmAccentMat && k < 2) {
        const riserLed = new THREE.Mesh(new THREE.BoxGeometry(st.width - 0.6, 0.045, 0.05), warmAccentMat);
        riserLed.position.set(st.x, topY - 0.1, zc + tierDepth * 0.5 + 0.01);
        grp.add(riserLed);
      }
    }

    // 两侧暖石挡肩墙，令阶梯看台如精密建筑雕塑般收边
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.66, tierDepth * 3 + 0.08), mats.warmStone);
      cheek.position.set(st.x + side * (st.width * 0.5 + 0.22), 0.29, st.zStart + tierDepth * 1.5);
      cheek.castShadow = true;
      cheek.receiveShadow = true;
      grp.add(cheek);
    }
  }

  const dummy = new THREE.Object3D();
  const aoDiscGeo = new THREE.PlaneGeometry(1, 1);
  aoDiscGeo.rotateX(-Math.PI / 2);
  const aoPlacements = [];

  // 2. L6 修复：精工八角缎面遮阳伞与咖啡座（配重基座 + 拉丝钛杆 + 暖石圆桌 + 缎面八角伞篷 + 顶帽）
  const parasols = [
    { x: -68, z: 53.5, y: 0.315 },
    { x: -62, z: 53.5, y: 0.315 },
    { x: -56, z: 53.5, y: 0.315 },
    { x: -28, z: -30.5, y: 0.315 },
    { x: -22, z: -30.5, y: 0.315 },
    { x: -16, z: -30.5, y: 0.315 },
    // L6 移至东亭上层石材露台宽敞角湾（150° & 90° 开间，距所有 6 根钢柱 >4.3m、距玻璃核心 >1.5m，精准落于 baseTop=0.45）
    { x: 138.6, z: -19.8, y: EAST_PAV.baseTop },
    { x: 146.0, z: -15.5, y: EAST_PAV.baseTop },
  ];
  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#e2dcd2',
    roughness: 0.52,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const pBaseInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.38, 0.1, 12), mats.graphite, parasols.length);
  const pPoleInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.042, 0.048, 2.55, 8), mats.titanium, parasols.length);
  const pTabInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.58, 0.54, 0.08, 14), mats.warmStone, parasols.length);
  const pUmbInst = new THREE.InstancedMesh(new THREE.ConeGeometry(1.58, 0.52, 8), canopyMat, parasols.length);
  const pCapInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.12, 0.12, 8), mats.graphite, parasols.length);
  pUmbInst.castShadow = true;
  pTabInst.receiveShadow = true;

  parasols.forEach((p, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(p.x, p.y + 0.05, p.z);
    dummy.updateMatrix();
    pBaseInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + 1.28, p.z);
    dummy.updateMatrix();
    pPoleInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + 0.78, p.z);
    dummy.updateMatrix();
    pTabInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + 2.48, p.z);
    dummy.updateMatrix();
    pUmbInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + 2.76, p.z);
    dummy.updateMatrix();
    pCapInst.setMatrixAt(i, dummy.matrix);

    aoPlacements.push({ x: p.x, y: p.y + 0.014, z: p.z, sx: 2.4, sz: 2.4, ry: 0 });
  });
  pBaseInst.instanceMatrix.needsUpdate = true;
  pPoleInst.instanceMatrix.needsUpdate = true;
  pTabInst.instanceMatrix.needsUpdate = true;
  pUmbInst.instanceMatrix.needsUpdate = true;
  pCapInst.instanceMatrix.needsUpdate = true;
  grp.add(pBaseInst, pPoleInst, pTabInst, pUmbInst, pCapInst);

  // 3. L6 & L10 修复：精工悬挑长椅（蜜色柚木座面+靠背 + 深石墨悬挑双腿 + 精准落于各自地坪标高）
  const benches = [
    // 北迎宾广场（PLAZA_TOP = 0.072）
    { x: 14, z: -89, y: ELEVATIONS.PLAZA_TOP, ry: Math.PI / 2 },
    { x: 38, z: -89, y: ELEVATIONS.PLAZA_TOP, ry: -Math.PI / 2 },
    { x: 14, z: -104, y: ELEVATIONS.PLAZA_TOP, ry: Math.PI / 2 },
    { x: 38, z: -104, y: ELEVATIONS.PLAZA_TOP, ry: -Math.PI / 2 },
    // W2 临湖步道两侧（避让 x∈[-109,-87] 看台，落于 y=0.00 草坪）
    { x: -113, z: 51.6, y: 0.0, ry: 0 },
    { x: -82, z: 51.6, y: 0.0, ry: 0 },
    // 重定位后的西南螺旋山顶观景台（(-126,133), deckTop=7.04）
    { x: -126, z: 128.8, y: SW_HILL.deckTop, ry: 0 },
    // 重定位后的张拉膜小亭石台（(-78,154), padTop=0.30）
    { x: -80.5, z: 151.0, y: HYPER_PAV.padTop, ry: 0.65 },
    // 东岸六角亭外廊西北观湖角湾（210° 开间，距柱 >4.3m 且远离遮阳伞，精准落于 baseTop=0.45）
    { x: 138.6, z: -28.2, y: EAST_PAV.baseTop, ry: Math.PI * 0.67 },
    // 东岸临湖绿地（避让消防道与栈桥，落于 y=0.00）
    { x: 104.5, z: 17.5, y: 0.0, ry: Math.PI / 2 },
  ];

  const bSeatInst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.15, 0.1, 0.56), mats.teak, benches.length);
  const bBackInst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.15, 0.24, 0.08), mats.teak, benches.length);
  const bLegInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.44, 0.52), mats.graphite, benches.length * 2);
  bSeatInst.castShadow = true;
  bSeatInst.receiveShadow = true;
  bBackInst.castShadow = true;

  let bLegIdx = 0;
  benches.forEach((b, idx) => {
    const cosR = Math.cos(b.ry);
    const sinR = Math.sin(b.ry);

    dummy.rotation.set(0, b.ry, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(b.x, b.y + 0.45, b.z);
    dummy.updateMatrix();
    bSeatInst.setMatrixAt(idx, dummy.matrix);

    // 局部 (0, 0.68, -0.25) 旋转至世界
    dummy.position.set(b.x - sinR * 0.25, b.y + 0.68, b.z - cosR * 0.25);
    dummy.rotation.set(-0.14, b.ry, 0);
    dummy.updateMatrix();
    bBackInst.setMatrixAt(idx, dummy.matrix);

    // 双侧深石墨悬挑支腿（底部精准贴合 b.y）
    for (const lx of [-0.82, 0.82]) {
      dummy.position.set(b.x + cosR * lx, b.y + 0.22, b.z - sinR * lx);
      dummy.rotation.set(0, b.ry, 0);
      dummy.updateMatrix();
      bLegInst.setMatrixAt(bLegIdx++, dummy.matrix);
    }

    aoPlacements.push({ x: b.x, y: b.y + 0.015, z: b.z, sx: 2.55, sz: 1.05, ry: b.ry });
  });
  bSeatInst.instanceMatrix.needsUpdate = true;
  bBackInst.instanceMatrix.needsUpdate = true;
  bLegInst.instanceMatrix.needsUpdate = true;
  grp.add(bSeatInst, bBackInst, bLegInst);

  // 4. L11 修复：CNC 精密机加工深石墨微距 LED 庭院柱灯（清障镜面水池、清障广场车流、精确标高）
  const lampPoints = [
    // 北迎宾大道绿化带（x=16.0/36.0 精准位于道路路缘与镜面水池之间，z=-117 避让 -120 处道路路灯 3.0m！）
    [16.0, -138], [36.0, -138], [16.0, -117.0], [36.0, -117.0],
    // 北广场两侧（L11 移离车流轨迹至 (9.5,-86) & (42.5,-86)，精准落于 plazaBox 0.072）
    [9.5, -86], [42.5, -86],
    // 中央门廊南缘（精准落于门廊地坪 0.175）
    [16, -60], [36, -60],
    // 西北/西侧环路与亲水廊道
    [-46, -101], [-90, -96], [-140, -86], [-174, -40], [-182, 4], [-182, 42], [-180, 76],
    [-112, 52], [-66, 52], [-49.5, 18], [-49.5, -14], [-25.0, -32.2],
    // 东侧消防环道与东岸公园绿道（避让调整后 WalkwayMain [160.5,-24], [154,-76] 与东亭）
    [102, -96], [102, -48], [102, 2], [115, 25], [139, -6], [156, -48], [150, -94], [168, 38],
    // 南岸环湖步道（避让 WalkwayMain 路面中心线与重定位后的 SW Hill / HyperPav）
    [154, 92], [114, 131], [60, 152], [16, 165], [-26, 162], [-61.5, 148.5], [-88, 124], [-178, 86],
  ];

  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: '#fff4da',
    emissive: new THREE.Color('#ffbe62'),
    emissiveIntensity: 0.35,
    roughness: 0.18,
    metalness: 0.05,
  });
  const bollardPoolTex = createFeatheredLightPoolTexture('255, 228, 168', '255, 164, 58', maxAnisotropy);
  const poolMat = new THREE.MeshBasicMaterial({
    map: bollardPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const poolGeo = new THREE.PlaneGeometry(8.2, 8.2);
  poolGeo.rotateX(-Math.PI / 2);

  // CNC 多段机加工柱灯：倒角底座法兰 + 阳极深石墨柱身 + 磨砂发光亚克力灯环 + 拉丝钛顶帽
  const flangeInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.09, 12), mats.titanium, lampPoints.length);
  const postInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.115, 0.13, 1.18, 12), mats.graphite, lampPoints.length);
  const headInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.122, 0.122, 0.28, 12), lampGlowMat, lampPoints.length);
  const capInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.135, 0.145, 0.09, 12), mats.titanium, lampPoints.length);
  const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, lampPoints.length);
  postInst.castShadow = true;

  lampPoints.forEach(([lx, lz], i) => {
    let baseY = sampleGroundElevation(lx, lz);
    let poolY = baseY + 0.095;

    if (lx >= 10 && lx <= 42 && lz >= -82 && lz <= -59.5) {
      // 中央门廊地坪 top = 0.175
      baseY = 0.175;
      poolY = 0.19;
    } else if (lx >= 8 && lx <= 44 && lz >= -107 && lz <= -81) {
      // 北迎宾广场 plazaBox top = 0.072 (L11 修复!)
      baseY = ELEVATIONS.PLAZA_TOP;
      poolY = ELEVATIONS.PLAZA_TOP + 0.018;
    } else if (
      (lx >= -76 && lx <= -52 && lz >= 50 && lz <= 57.5) ||
      (lx >= -34 && lx <= -10 && lz >= -34 && lz <= -26.5)
    ) {
      // W2 / W5_S 临湖柚木平台 top = 0.315
      baseY = 0.315;
      poolY = 0.33;
    }

    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(lx, baseY + 0.045, lz);
    dummy.updateMatrix();
    flangeInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lx, baseY + 0.66, lz);
    dummy.updateMatrix();
    postInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lx, baseY + 1.38, lz);
    dummy.updateMatrix();
    headInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lx, baseY + 1.56, lz);
    dummy.updateMatrix();
    capInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lx, poolY, lz);
    dummy.updateMatrix();
    poolInst.setMatrixAt(i, dummy.matrix);

    aoPlacements.push({ x: lx, y: baseY + 0.015, z: lz, sx: 0.72, sz: 0.72, ry: 0 });
  });
  flangeInst.instanceMatrix.needsUpdate = true;
  postInst.instanceMatrix.needsUpdate = true;
  headInst.instanceMatrix.needsUpdate = true;
  capInst.instanceMatrix.needsUpdate = true;
  poolInst.instanceMatrix.needsUpdate = true;
  grp.add(flangeInst, postInst, headInst, capInst, poolInst);

  // 统一一次 Draw Call 渲染全部家具/灯柱地面柔和接触 AO 阴影盘
  const aoInst = new THREE.InstancedMesh(aoDiscGeo, contactAoMat, aoPlacements.length);
  aoInst.name = 'SitePropsContactAO';
  aoInst.userData.noMerge = true;
  aoPlacements.forEach((a, i) => {
    dummy.position.set(a.x, a.y, a.z);
    dummy.rotation.set(0, a.ry, 0);
    dummy.scale.set(a.sx, 1, a.sz);
    dummy.updateMatrix();
    aoInst.setMatrixAt(i, dummy.matrix);
  });
  aoInst.instanceMatrix.needsUpdate = true;
  grp.add(aoInst);

  return {
    group: grp,
    setDuskFactor(dusk, night = dusk) {
      lampGlowMat.emissiveIntensity = 0.35 + dusk * 2.9 + night * 1.1;
      poolMat.visible = dusk > 0.005;
      poolMat.opacity = dusk * 0.42 + night * 0.2;
    },
  };
}

export function buildTerrainAndStructures(maxAnisotropy = 8) {
  const group = new THREE.Group();
  group.name = 'TerrainAndStructures';

  const lawnTex = createMowedLawnTexture(maxAnisotropy);
  const teakTex = createTeakDeckTexture(maxAnisotropy);
  const contactAoTex = createContactShadowTexture();

  // 核心材质库（100% 对齐无边界云雾绿野规范 #38：与外围无界草坪共用完全一致的材质参数、色阶与世界 UV）
  const lawnMat = new THREE.MeshStandardMaterial({
    name: 'CampusLawnEmerald',
    color: '#ffffff',
    map: lawnTex,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });
  const teakMat = new THREE.MeshStandardMaterial({
    map: teakTex,
    emissive: new THREE.Color('#6b4118'),
    emissiveIntensity: 0.0,
    roughness: 0.6,
    metalness: 0.04,
  });
  const mats = {
    teak: teakMat,
    warmStone: new THREE.MeshStandardMaterial({ color: '#c9c1b5', roughness: 0.68, metalness: 0.03 }),
    ashlar: new THREE.MeshStandardMaterial({ color: '#ada69b', roughness: 0.66, metalness: 0.05 }),
    shadowReveal: new THREE.MeshStandardMaterial({ color: '#5d5954', roughness: 0.62, metalness: 0.08 }),
    titanium: new THREE.MeshStandardMaterial({ color: '#9ba1a8', roughness: 0.3, metalness: 0.68 }),
    graphite: new THREE.MeshStandardMaterial({ color: '#2f353d', roughness: 0.38, metalness: 0.6 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#3a3e44', roughness: 0.38, metalness: 0.62 }),
    frostedAquaGlass: new THREE.MeshStandardMaterial({
      color: '#7ecad6',
      roughness: 0.14,
      metalness: 0.1,
      transparent: true,
      opacity: 0.44,
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  };

  const contactAoMat = new THREE.MeshBasicMaterial({
    map: contactAoTex,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  // 1. 精确平齐 y = 0.000 的无边界健康翡翠绿主草坪（纯顶面 ShapeGeometry 零垂向裙壁，精准抠除湖盆 + 1BF 车库坡道井口，
  //    与外围无界大地共享 ±243×±184 (r=26) 24 段圆角边界与世界 UV u=(x+243)/486, v=(z+184)/368，100% 无缝衔接）
  const lawnShape = createRoundedRectShape(PLINTH_CONFIG.width, PLINTH_CONFIG.depth, PLINTH_CONFIG.cornerRadius);
  const lakeHole = new THREE.Path();
  lakeHole.moveTo(LAKE_SHORELINE[0][0], -LAKE_SHORELINE[0][1]);
  for (let i = 1; i < LAKE_SHORELINE.length; i++) {
    lakeHole.lineTo(LAKE_SHORELINE[i][0], -LAKE_SHORELINE[i][1]);
  }
  lakeHole.closePath();
  lawnShape.holes.push(lakeHole);

  const rampHole = new THREE.Path();
  rampHole.moveTo(49.0, 94.7);
  rampHole.lineTo(70.0, 94.7);
  rampHole.lineTo(70.0, 87.7);
  rampHole.lineTo(49.0, 87.7);
  rampHole.closePath();
  lawnShape.holes.push(rampHole);

  const lawnGeo = new THREE.ShapeGeometry(lawnShape, 24);
  lawnGeo.rotateX(-Math.PI / 2);
  const lPos = lawnGeo.attributes.position;
  const lUv = new Float32Array(lPos.count * 2);
  for (let i = 0; i < lPos.count; i++) {
    lUv[i * 2] = (lPos.getX(i) + PLINTH_CONFIG.width * 0.5) / PLINTH_CONFIG.width;
    lUv[i * 2 + 1] = (lPos.getZ(i) + PLINTH_CONFIG.depth * 0.5) / PLINTH_CONFIG.depth;
  }
  lawnGeo.setAttribute('uv', new THREE.BufferAttribute(lUv, 2));

  const lawnMesh = new THREE.Mesh(lawnGeo, lawnMat);
  lawnMesh.name = 'InnerCampusEmeraldLawn';
  lawnMesh.position.y = ELEVATIONS.LAWN_TOP;
  lawnMesh.receiveShadow = true;
  lawnMesh.castShadow = false;
  group.add(lawnMesh);

  // 2. L8 修复：北侧对称下沉倒角暖石迎宾镜面水池（水体 y=0.20 真正下沉于 0.28 石材压顶之下！）+ 丰润深鼠尾草修剪绿篱
  const warmAccentMat = new THREE.MeshStandardMaterial({
    color: '#ffebbf',
    emissive: new THREE.Color('#ffae42'),
    emissiveIntensity: 0.14,
    roughness: 0.22,
  });
  const cyanMicroLedMat = new THREE.MeshStandardMaterial({
    color: '#9cf5ff',
    emissive: new THREE.Color('#2ed6ee'),
    emissiveIntensity: 0.85,
    roughness: 0.18,
  });
  const bridgeArchLedMat = new THREE.MeshStandardMaterial({
    color: '#dff6ff',
    emissive: new THREE.Color('#8ee2f7'),
    emissiveIntensity: 0.14,
    roughness: 0.2,
  });
  const landmarkPoolTex = createFeatheredLightPoolTexture('255, 224, 160', '255, 162, 56', maxAnisotropy);
  const landmarkPoolMat = new THREE.MeshBasicMaterial({
    map: landmarkPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });

  const poolCopingMat = new THREE.MeshStandardMaterial({ color: '#b9b2a7', roughness: 0.56, metalness: 0.05 });
  const poolBevelMat = new THREE.MeshStandardMaterial({ color: '#cfc8bd', roughness: 0.48, metalness: 0.05 });
  const poolBasinFloorMat = new THREE.MeshStandardMaterial({ color: '#0a2029', roughness: 0.88, metalness: 0.04 });
  const dayMirrorCol = new THREE.Color('#133a47');
  const nightMirrorCol = new THREE.Color('#0c233a');
  const mirrorWaterMat = new THREE.MeshStandardMaterial({
    color: '#133a47',
    emissive: new THREE.Color('#0f2c44'),
    emissiveIntensity: 0.0,
    roughness: 0.05,
    metalness: 0.24,
    envMapIntensity: 1.65,
  });
  const mirrorWarmReflectMat = new THREE.MeshBasicMaterial({
    map: landmarkPoolTex,
    color: '#ffd694',
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });
  const hedgeDeepMat = new THREE.MeshStandardMaterial({
    color: '#1a4220',
    roughness: 0.84,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });
  const hedgeCrownMat = new THREE.MeshStandardMaterial({
    color: '#2d622a',
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });

  for (const side of [-1, 1]) {
    const px = 26 + side * 15.8;
    const pz = -124.5;
    const innerW = 8.4;
    const innerL = 23.3;
    const wallT = 0.62;
    const outerW = innerW + wallT * 2; // 9.64
    const outerL = innerL + wallT * 2; // 24.54

    // 下沉深玉青池底（[-0.04, +0.06]）
    const basinFloor = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.1, 0.1, innerL + 0.1), poolBasinFloorMat);
    basinFloor.position.set(px, 0.01, pz);
    group.add(basinFloor);

    // 4 边独立围合暖石池壁（[-0.04, +0.28]）+ 顶部微倒角收边压条（绝不遮挡/不穿透水面）
    for (const s of [-1, 1]) {
      const longWall = new THREE.Mesh(new THREE.BoxGeometry(wallT, 0.32, outerL), poolCopingMat);
      longWall.position.set(px + s * (innerW * 0.5 + wallT * 0.5), 0.12, pz);
      longWall.receiveShadow = true;
      longWall.castShadow = true;
      group.add(longWall);

      const longBevel = new THREE.Mesh(new THREE.BoxGeometry(wallT - 0.12, 0.035, outerL - 0.12), poolBevelMat);
      longBevel.position.set(px + s * (innerW * 0.5 + wallT * 0.5), 0.285, pz);
      longBevel.receiveShadow = true;
      group.add(longBevel);

      const shortWall = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.32, wallT), poolCopingMat);
      shortWall.position.set(px, 0.12, pz + s * (innerL * 0.5 + wallT * 0.5));
      shortWall.receiveShadow = true;
      shortWall.castShadow = true;
      group.add(shortWall);

      const shortBevel = new THREE.Mesh(new THREE.BoxGeometry(innerW + 0.12, 0.035, wallT - 0.12), poolBevelMat);
      shortBevel.position.set(px, 0.285, pz + s * (innerL * 0.5 + wallT * 0.5));
      shortBevel.receiveShadow = true;
      group.add(shortBevel);

      // 池壁内缘暗影凹槽下的微距暖金/冰青水缘灯带（top = 0.25 < 0.28 压顶，绝不鼓出！）
      const poolLedLong = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, innerL - 0.2), warmAccentMat);
      poolLedLong.position.set(px + s * (innerW * 0.5 - 0.04), 0.228, pz);
      group.add(poolLedLong);

      const poolLedShort = new THREE.Mesh(new THREE.BoxGeometry(innerW - 0.2, 0.045, 0.08), cyanMicroLedMat);
      poolLedShort.position.set(px, 0.228, pz + s * (innerL * 0.5 - 0.04));
      group.add(poolLedShort);
    }

    // 真正下沉于压顶之下的深玉青镜面水体（top = 0.20，低于 0.28 压顶 8cm！）
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(innerW, 0.12, innerL), mirrorWaterMat);
    mirror.position.set(px, 0.14, pz); // [0.08, 0.20]
    mirror.receiveShadow = true;
    group.add(mirror);

    // 夜间水面柔和暖金倒影光晕层（y = 0.208，8mm 脱离水面零 Z-Fighting）
    const mirrorShimmer = new THREE.Mesh(new THREE.PlaneGeometry(innerW - 0.5, innerL - 0.7), mirrorWarmReflectMat);
    mirrorShimmer.userData.noMerge = true;
    mirrorShimmer.rotation.x = -Math.PI / 2;
    mirrorShimmer.position.set(px, 0.208, pz);
    group.add(mirrorShimmer);

    // 丰润深鼠尾草绿双阶修剪黄杨绿篱 + 暖石种植池收边（告别苍白灰绿方块！）
    const planterCurb = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, outerL), poolCopingMat);
    planterCurb.position.set(px + side * 6.75, 0.05, pz);
    planterCurb.receiveShadow = true;
    group.add(planterCurb);

    const hedgeOuter = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.82, outerL - 0.5), hedgeDeepMat);
    hedgeOuter.position.set(px + side * 6.0, 0.52, pz);
    hedgeOuter.castShadow = true;
    hedgeOuter.receiveShadow = true;
    group.add(hedgeOuter);

    const hedgeOuterTop = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, outerL - 0.7), hedgeCrownMat);
    hedgeOuterTop.position.set(px + side * 6.0, 0.98, pz);
    hedgeOuterTop.castShadow = true;
    hedgeOuterTop.receiveShadow = true;
    group.add(hedgeOuterTop);

    const hedgeInner = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.46, 20.6), hedgeDeepMat);
    hedgeInner.position.set(px + side * 7.55, 0.34, pz);
    hedgeInner.castShadow = true;
    hedgeInner.receiveShadow = true;
    group.add(hedgeInner);

    const hedgeInnerTop = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.12, 20.4), hedgeCrownMat);
    hedgeInnerTop.position.set(px + side * 7.55, 0.62, pz);
    group.add(hedgeInnerTop);
  }

  // 3. 西南平滑 CNC 等高线圆丘 + 连续螺旋步道 + 嵌入式山顶柚木平台（L2 & L3）
  group.add(buildSculptedSWHillPark(mats, warmAccentMat, landmarkPoolMat));

  // 4. 东侧龙蟠山平滑 CNC 微等高线山体
  group.add(buildSculptedLongpanMountain());

  // 5. 西南拉丝钛钢拱肋磨砂玻璃拱桥（L7）
  group.add(buildSeamlessSWArchBridge(mats, warmAccentMat, bridgeArchLedMat));

  // 6. 西南双曲张拉膜小亭（L4）
  const membranePavilion = buildHyperbolicMembranePavilion(mats, warmAccentMat, landmarkPoolMat);
  group.add(membranePavilion.group);

  // 7. 东岸六角木吊顶临湖亭与无缝双岸亲水栈桥（L5 & L6）
  const eastPavilion = buildEastLakesidePavilionAndPier(mats, warmAccentMat, maxAnisotropy);
  group.add(eastPavilion.group);

  // 8. 临湖柚木看台、八角遮阳伞、悬挑长椅、CNC 柱灯与 1:100 雕塑小人（L9/L10/L11/L12）
  const furniture = buildWaterfrontFurnitureAndPeople(mats, warmAccentMat, contactAoMat, maxAnisotropy);
  group.add(furniture.group);

  return {
    group,
    setDuskFactor(dusk, night = dusk) {
      const glowOn = dusk > 0.005;
      furniture.setDuskFactor(dusk, night);
      warmAccentMat.emissiveIntensity = 0.14 + dusk * 2.95 + night * 1.15;
      cyanMicroLedMat.emissiveIntensity = 0.85 + dusk * 1.35 + night * 0.75;
      bridgeArchLedMat.emissiveIntensity = 0.14 + dusk * 2.15 + night * 0.95;
      membranePavilion.memMat.emissiveIntensity = dusk * 0.42 + night * 0.22;

      // 东岸六角木吊顶临湖亭：完整保留 v2.1 饱满暖金木顶 + 内芯灯笼漫射 + 双层羽化暖光
      eastPavilion.warmWoodMat.emissiveIntensity = dusk * 1.65 + night * 1.15;
      eastPavilion.pavGlassMat.emissiveIntensity = dusk * 1.15 + night * 0.85;
      eastPavilion.pavGlassMat.opacity = 0.44 + dusk * 0.14 + night * 0.1;
      eastPavilion.pavInnerGlowMat.visible = glowOn;
      eastPavilion.pavInnerGlowMat.opacity = dusk * 0.52 + night * 0.26;
      eastPavilion.pavInnerGlowMat.emissiveIntensity = dusk * 1.8 + night * 1.1;
      eastPavilion.pavBaseMat.emissiveIntensity = dusk * 0.28 + night * 0.2;
      eastPavilion.pavDeckPoolMat.visible = glowOn;
      eastPavilion.pavDeckPoolMat.opacity = dusk * 0.46 + night * 0.24;
      eastPavilion.pavLawnPoolMat.visible = glowOn;
      eastPavilion.pavLawnPoolMat.opacity = dusk * 0.3 + night * 0.2;

      teakMat.emissiveIntensity = dusk * 0.12 + night * 0.08;

      // 北侧对称迎宾镜面水池：深青碧航拍镜面日间 -> 深邃夜蓝金属微反光 + 暖金倒影微辉
      const mirrorT = Math.min(1, dusk * 0.72 + night * 0.28);
      mirrorWaterMat.color.lerpColors(dayMirrorCol, nightMirrorCol, mirrorT);
      mirrorWaterMat.metalness = 0.24 + mirrorT * 0.34;
      mirrorWaterMat.envMapIntensity = 1.65 + dusk * 0.55 + night * 0.55;
      mirrorWaterMat.emissiveIntensity = dusk * 0.36 + night * 0.28;
      mirrorWarmReflectMat.visible = glowOn;
      mirrorWarmReflectMat.opacity = dusk * 0.18 + night * 0.14;

      landmarkPoolMat.visible = glowOn;
      landmarkPoolMat.opacity = dusk * 0.38 + night * 0.22;

      // 夜间轻微减弱日间接触 AO，避免与地面羽化光池打架
      contactAoMat.opacity = THREE.MathUtils.lerp(0.76, 0.28, dusk);
    },
  };
}
