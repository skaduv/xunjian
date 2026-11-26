import * as THREE from 'three';
import { ELEVATIONS, LAKE_SHORELINE, PLINTH_CONFIG } from '../config/campusConfig.js';
import { createRoundedRectShape } from '../plinth/HardwarePlinth.js';
import {
  createFeatheredLightPoolTexture,
  createMowedLawnTexture,
  createTeakDeckTexture,
} from '../core/ProceduralTextures.js';

/**
 * 精工偏白模园区微地形与景观构筑物：
 * - 彻底摒弃粗犷叠饼山体！改用连续 CNC 精雕微等高线起伏地形网格（平滑过渡至 y = 0.000 零硬接缝！）
 * - 西南螺旋步道草坡：平滑起伏圆丘 + 贴地连续挤压螺旋步道带（彻底告别悬浮小白方块）+ 嵌入式山顶柚木观景台
 * - 西南钢拱肋玻璃拱桥：带两侧实心桥台过渡引道，100% 严丝合缝锁合环湖步道，连续曲面桥面与优雅白钢拱肋
 * - 东岸六角木吊顶临湖亭 + 无缝双岸着陆亲水栈桥、西南白色双曲张拉膜小亭、北侧对称迎宾镜面水池与绿篱
 * - 临湖柚木阶梯看台、遮阳伞咖啡座、长椅、带暮光暖光晕的庭院柱灯与 1:100 比例小人（全量 InstancedMesh）
 */

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
  // 混合 65% 平滑坡面 + 35% 柔和阶台，呈现高端博物馆铣削地形白模质感
  const stepped = (i + smoothstep(0.18, 0.82, f)) * step;
  return h * 0.62 + stepped * 0.38;
}

/**
 * 精准高度场查询函数（同时供给微地形网格、连续螺旋步道与 VegetationSystem 树木贴地生根）
 */
export function sampleSWHillHeight(x, z) {
  const cx = -126;
  const cz = 128;
  const d = Math.hypot(x - cx, z - cz);
  const outerR = 34.5;
  const summitR = 9.0;
  if (d >= outerR) return 0;
  if (d <= summitR) return 7.4;
  const t = 1 - (d - summitR) / (outerR - summitR);
  const smoothH = smoothstep(0, 1, t) * 7.4;
  return subtleTerrace(smoothH, 1.25);
}

export function sampleLongpanHeight(x, z) {
  // 严控西边界（留出环湖步道的平缓谷地）与底座圆角边缘
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
  // 靠近底座最外缘时自然平缓压低，严禁越出陶瓷白边框
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
 * 1. 精工平滑 CNC 等高线西南螺旋步道圆形草坡公园（零阶梯断层 + 连续贴地螺旋步道带 + 嵌入山顶柚木平台）
 */
function buildSculptedSWHillPark(teakMat, glassMat, steelMat, warmAccentMat, landmarkPoolMat) {
  const grp = new THREE.Group();
  grp.name = 'SW_SpiralHillPark';

  const cx = -126;
  const cz = 128;
  const radius = 35.5;
  const rings = 28;
  const segs = 64;

  // 构建径向平滑雕刻圆丘网格（带极柔和的偏白模矿物绿高程顶点渐变）
  const positions = [];
  const colors = [];
  const indices = [];

  const colLow = new THREE.Color('#d7dfd4');
  const colMid = new THREE.Color('#cfd8cd');
  const colHigh = new THREE.Color('#e2e8e0');
  const tmpCol = new THREE.Color();

  // 中心点
  positions.push(cx, 7.4, cz);
  colors.push(colHigh.r, colHigh.g, colHigh.b);

  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * radius;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const wx = cx + Math.cos(a) * rad;
      const wz = cz + Math.sin(a) * rad;
      const wy = sampleSWHillHeight(wx, wz);
      positions.push(wx, wy, wz);

      const t = wy / 7.4;
      // 叠加细微等高线明暗沟纹（模拟建筑白模 CNC 铣削等高线质感）
      const contourLine = Math.abs(((wy / 1.25) % 1) - 0.5) < 0.06 && wy > 0.2 && wy < 7.15 ? -0.032 : 0;
      tmpCol.copy(colLow).lerp(colMid, Math.min(1, t * 1.4)).lerp(colHigh, Math.max(0, t * 1.4 - 0.5));
      colors.push(
        Math.max(0, tmpCol.r + contourLine),
        Math.max(0, tmpCol.g + contourLine),
        Math.max(0, tmpCol.b + contourLine)
      );
    }
  }

  // 顶盖扇形
  for (let s = 0; s < segs; s++) {
    const next = (s + 1) % segs;
    indices.push(0, 1 + next, 1 + s);
  }
  // 径向环带
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
  hillGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  hillGeo.setIndex(indices);
  hillGeo.computeVertexNormals();

  const hillMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.02,
  });
  const hillMesh = new THREE.Mesh(hillGeo, hillMat);
  hillMesh.receiveShadow = true;
  hillMesh.castShadow = true;
  grp.add(hillMesh);

  // 真正连续贴地的螺旋石材步道实体带（从西北环湖绿道入口平滑盘旋 1.45 圈直抵山顶观景平台！）
  const pathSteps = 84;
  const pathHalfW = 1.25;
  const pPos = [];
  const pIdx = [];

  for (let i = 0; i <= pathSteps; i++) {
    const t = i / pathSteps;
    // 起点在西北侧靠近环湖路径 (-146, 108)，平滑向心盘旋至山顶平台边沿 (r = 9.0)
    const angle = -Math.PI * 0.72 + t * Math.PI * 2 * 1.42;
    const rad = THREE.MathUtils.lerp(34.2, 9.1, t);
    const px = cx + Math.cos(angle) * rad;
    const pz = cz + Math.sin(angle) * rad;

    // 径向内外侧两点精准采样坡面高度，使步道丝滑贴合丘面（外侧带实体护边下垂入土 0.35m，零悬空！）
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const inX = px - dirX * pathHalfW;
    const inZ = pz - dirZ * pathHalfW;
    const outX = px + dirX * pathHalfW;
    const outZ = pz + dirZ * pathHalfW;
    const yMid = sampleSWHillHeight(px, pz) + 0.14;
    const yIn = Math.max(yMid, sampleSWHillHeight(inX, inZ) + 0.12);
    const yOut = yMid;
    const yOutBot = sampleSWHillHeight(outX, outZ) - 0.32;

    pPos.push(inX, yIn, inZ, outX, yOut, outZ, outX, yOutBot, outZ);
  }

  for (let i = 0; i < pathSteps; i++) {
    const a = i * 3;
    const b = (i + 1) * 3;
    // 步道顶面（朝上 +Y）
    pIdx.push(a, a + 1, b, a + 1, b + 1, b);
    // 步道外侧实体护沿壁
    pIdx.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }

  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  pathGeo.setIndex(pIdx);
  pathGeo.computeVertexNormals();

  const pathMesh = new THREE.Mesh(
    pathGeo,
    new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.62, metalness: 0.04 })
  );
  pathMesh.receiveShadow = true;
  pathMesh.castShadow = true;
  grp.add(pathMesh);

  // 山顶嵌入式精工柚木观景台 + 陶瓷白外环 + 玻璃栏杆
  const summitR = 9.0;
  const summitBase = new THREE.Mesh(
    new THREE.CylinderGeometry(summitR + 0.35, summitR + 0.55, 0.36, 36),
    new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.45 })
  );
  summitBase.position.set(cx, 7.45, cz);
  summitBase.receiveShadow = true;
  grp.add(summitBase);

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(summitR - 0.15, summitR - 0.1, 0.42, 36), teakMat);
  deck.position.set(cx, 7.48, cz);
  deck.receiveShadow = true;
  grp.add(deck);

  const rail = new THREE.Mesh(
    new THREE.CylinderGeometry(summitR - 0.18, summitR - 0.18, 1.02, 36, 1, true, 0.35, Math.PI * 1.72),
    glassMat
  );
  rail.position.set(cx, 8.18, cz);
  grp.add(rail);

  const topRing = new THREE.Mesh(
    new THREE.TorusGeometry(summitR - 0.18, 0.055, 8, 42, Math.PI * 1.72),
    steelMat
  );
  topRing.rotation.x = Math.PI / 2;
  topRing.rotation.z = -0.35;
  topRing.position.set(cx, 8.68, cz);
  grp.add(topRing);

  // 夜景细部：螺旋步道外沿嵌入式暖金踏步导引微光灯柱（InstancedMesh）+ 山顶观景台暖金底座光环与羽化地坪光晕
  if (warmAccentMat) {
    const markerCount = 26;
    const markerGeo = new THREE.BoxGeometry(0.32, 0.14, 0.12);
    const markerInst = new THREE.InstancedMesh(markerGeo, warmAccentMat, markerCount);
    const mDummy = new THREE.Object3D();
    for (let i = 0; i < markerCount; i++) {
      const t = 0.04 + (i / (markerCount - 1)) * 0.92;
      const angle = -Math.PI * 0.72 + t * Math.PI * 2 * 1.42;
      const rad = THREE.MathUtils.lerp(34.2, 9.1, t) + pathHalfW - 0.12;
      const mx = cx + Math.cos(angle) * rad;
      const mz = cz + Math.sin(angle) * rad;
      const my = sampleSWHillHeight(mx, mz) + 0.24;
      mDummy.position.set(mx, my, mz);
      mDummy.rotation.set(0, -angle, 0);
      mDummy.scale.set(1, 1, 1);
      mDummy.updateMatrix();
      markerInst.setMatrixAt(i, mDummy.matrix);
    }
    markerInst.instanceMatrix.needsUpdate = true;
    grp.add(markerInst);

    const summitGlowRing = new THREE.Mesh(
      new THREE.TorusGeometry(summitR - 0.18, 0.052, 6, 42, Math.PI * 1.72),
      warmAccentMat
    );
    summitGlowRing.rotation.x = Math.PI / 2;
    summitGlowRing.rotation.z = -0.35;
    summitGlowRing.position.set(cx, 7.72, cz);
    grp.add(summitGlowRing);
  }

  if (landmarkPoolMat) {
    const summitPool = new THREE.Mesh(new THREE.PlaneGeometry(16.6, 16.6), landmarkPoolMat);
    summitPool.userData.noMerge = true;
    summitPool.rotation.x = -Math.PI / 2;
    summitPool.position.set(cx, 7.71, cz);
    grp.add(summitPool);
  }

  return grp;
}

/**
 * 2. 东侧龙蟠山连续 CNC 精雕微等高线地形网格（严丝合缝落于草坪与陶瓷白圆角边框内）
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
  const colors = [];
  const indices = [];

  const colLow = new THREE.Color('#d7dfd4');
  const colMid = new THREE.Color('#bfcdbd');
  const colHigh = new THREE.Color('#e2eae0');
  const tmpCol = new THREE.Color();

  for (let iz = 0; iz <= segZ; iz++) {
    const vz = iz / segZ;
    const rawZ = THREE.MathUtils.lerp(zMin, zMax, vz);
    for (let ix = 0; ix <= segX; ix++) {
      const vx = ix / segX;
      let x = THREE.MathUtils.lerp(xMin, xMax, vx);
      let z = rawZ;

      // 精准约束到圆角陶瓷底座内侧，绝不溢出圆角压边
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
      // 最外一圈平缓贴地至 y = -0.02，杜绝接缝浮边
      const yFinal = y < 0.04 ? -0.02 : y;
      positions.push(x, yFinal, z);

      const t = Math.min(1, y / 22.0);
      const contour = y > 0.3 && Math.abs(((y / 1.85) % 1) - 0.5) < 0.068 ? -0.056 : 0;
      tmpCol.copy(colLow).lerp(colMid, Math.min(1, t * 1.4)).lerp(colHigh, Math.max(0, t * 1.5 - 0.55));
      colors.push(
        Math.max(0, tmpCol.r + contour),
        Math.max(0, tmpCol.g + contour),
        Math.max(0, tmpCol.b + contour)
      );
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
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
    })
  );
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  grp.add(mesh);

  return grp;
}

/**
 * 3. 跨西南湖湾带钢拱肋玻璃栏杆拱桥（连续平滑曲面桥面 + 双端实心桥台无缝对接环湖步道！）
 */
function buildSeamlessSWArchBridge(teakMat, glassMat, warmAccentMat, bridgeArchLedMat) {
  const grp = new THREE.Group();
  grp.name = 'SW_ArchBridge';

  const pStart = new THREE.Vector3(-179, 0.05, 95);
  const pEnd = new THREE.Vector3(-161, 0.05, 122);
  const mid = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);
  const span = pStart.distanceTo(pEnd);
  const rotY = Math.atan2(pEnd.x - pStart.x, pEnd.z - pStart.z);

  grp.position.set(mid.x, 0, mid.z);
  grp.rotation.y = rotY;

  const whiteSteel = new THREE.MeshStandardMaterial({ color: '#f3f5f8', roughness: 0.28, metalness: 0.45 });
  const abutmentMat = new THREE.MeshStandardMaterial({ color: '#e5e9ef', roughness: 0.55, metalness: 0.08 });
  const deckW = 4.4;
  const segs = 28;
  const archDeckH = 2.05;

  // 1. 连续平滑微拱桥面与箱梁（单次连续 BufferGeometry，零块状锯齿接缝！）
  const deckPos = [];
  const deckUv = [];
  const deckIdx = [];
  const girderPos = [];
  const girderIdx = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs - 0.5;
    const z = t * span;
    const y = 0.07 + Math.pow(Math.cos(t * Math.PI), 1.35) * archDeckH;
    const v = (i / segs) * 8;
    deckPos.push(-deckW * 0.5, y, z, deckW * 0.5, y, z);
    deckUv.push(0, v, 1, v);

    // 桥下流线箱梁侧腹与底板
    girderPos.push(
      -deckW * 0.52, y, z,
      -deckW * 0.44, y - 0.46, z,
      deckW * 0.44, y - 0.46, z,
      deckW * 0.52, y, z
    );
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    deckIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    const ga = i * 4;
    const gb = (i + 1) * 4;
    // 左腹板、底板、右腹板
    girderIdx.push(ga, ga + 1, gb, ga + 1, gb + 1, gb);
    girderIdx.push(ga + 1, ga + 2, gb + 1, ga + 2, gb + 2, gb + 1);
    girderIdx.push(ga + 2, ga + 3, gb + 2, ga + 3, gb + 3, gb + 2);
  }

  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckUv, 2));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  const deckMesh = new THREE.Mesh(deckGeo, teakMat);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  grp.add(deckMesh);

  const girderGeo = new THREE.BufferGeometry();
  girderGeo.setAttribute('position', new THREE.Float32BufferAttribute(girderPos, 3));
  girderGeo.setIndex(girderIdx);
  girderGeo.computeVertexNormals();
  const girderMesh = new THREE.Mesh(girderGeo, whiteSteel);
  girderMesh.castShadow = true;
  grp.add(girderMesh);

  // 2. 连续曲面玻璃护栏（无分段裂痕）+ 顶扶手圆管
  for (const side of [-1, 1]) {
    const railPos = [];
    const railIdx = [];
    const handPts = [];
    const rx = side * (deckW * 0.5 - 0.12);
    for (let i = 0; i <= segs; i++) {
      const t = i / segs - 0.5;
      const z = t * span;
      const y = 0.07 + Math.pow(Math.cos(t * Math.PI), 1.35) * archDeckH;
      railPos.push(rx, y + 0.04, z, rx, y + 1.05, z);
      handPts.push(new THREE.Vector3(rx, y + 1.07, z));
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      railIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPos, 3));
    railGeo.setIndex(railIdx);
    railGeo.computeVertexNormals();
    grp.add(new THREE.Mesh(railGeo, glassMat));

    const handMesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(handPts), 28, 0.045, 6, false),
      whiteSteel
    );
    grp.add(handMesh);

    // 夜景桥面护栏暗藏暖金连续线性导引光带
    if (warmAccentMat) {
      const stripPts = handPts.map((pt) => new THREE.Vector3(pt.x, pt.y - 0.09, pt.z));
      const stripMesh = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stripPts), 24, 0.04, 5, false),
        warmAccentMat
      );
      grp.add(stripMesh);
    }
  }

  // 3. 双端实体桥台与平缓过渡引道（严丝合缝锁定两端环湖绿道，消除落地断层）
  for (const endSign of [-1, 1]) {
    const ez = endSign * (span * 0.5 + 1.1);
    const abutment = new THREE.Mesh(new THREE.BoxGeometry(deckW + 1.0, 1.5, 3.2), abutmentMat);
    abutment.position.set(0, -0.68, ez);
    abutment.receiveShadow = true;
    grp.add(abutment);
  }

  // 4. 两侧优雅蝴蝶倾角白钢抛物线拱肋 + 纤细竖向拉索吊杆（InstancedMesh）
  const archH = 7.4;
  const rodTransforms = [];
  for (const side of [-1, 1]) {
    const archPts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24 - 0.5;
      const z = t * (span + 1.2);
      const y = 0.05 + (1 - 4 * t * t) * archH;
      const x = side * (deckW * 0.5 + 0.34 - (1 - 4 * t * t) * 0.48);
      archPts.push(new THREE.Vector3(x, y, z));
    }
    const archMesh = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 28, 0.22, 10, false),
      whiteSteel
    );
    archMesh.castShadow = true;
    grp.add(archMesh);

    // 抛物线白钢拱肋内侧线性月白/香槟光带（夜景勾勒优雅水湾桥影）
    if (bridgeArchLedMat) {
      const archLedPts = archPts.map((pt) => new THREE.Vector3(pt.x - side * 0.14, pt.y - 0.18, pt.z));
      const archLedMesh = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archLedPts), 24, 0.068, 6, false),
        bridgeArchLedMat
      );
      grp.add(archLedMesh);
    }

    for (let k = -4; k <= 4; k++) {
      const t = k * 0.085;
      const z = t * span;
      const yDeck = 0.07 + Math.pow(Math.cos(t * Math.PI), 1.35) * archDeckH;
      const yArch = 0.05 + (1 - 4 * t * t) * archH;
      const x = side * (deckW * 0.5 + 0.34 - (1 - 4 * t * t) * 0.48);
      rodTransforms.push({ x, y: (yDeck + yArch) * 0.5, z, h: Math.max(0.35, yArch - yDeck) });
    }
  }
  const rodInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.038, 0.038, 1, 6), whiteSteel, rodTransforms.length);
  const dummy = new THREE.Object3D();
  rodTransforms.forEach((rt, idx) => {
    dummy.position.set(rt.x, rt.y, rt.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, rt.h, 1);
    dummy.updateMatrix();
    rodInst.setMatrixAt(idx, dummy.matrix);
  });
  rodInst.instanceMatrix.needsUpdate = true;
  grp.add(rodInst);

  return grp;
}

/**
 * 4. 西南白色双曲张拉膜小亭（无缝石材引道对接环湖绿道 + 丝滑鞍形白膜 + 细钢拉索）
 */
function buildHyperbolicMembranePavilion(steelMat, warmAccentMat, landmarkPoolMat) {
  const grp = new THREE.Group();
  grp.name = 'SW_HyperbolicPavilion';
  grp.position.set(-72, 0, 134);

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#ebeef3', roughness: 0.58 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.8, 0.3, 32), stoneMat);
  pad.position.y = 0.14;
  pad.receiveShadow = true;
  grp.add(pad);

  // 短石材引道无缝衔接南侧环湖步道
  const link = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.22, 10.5), stoneMat);
  link.position.set(3.2, 0.1, 8.2);
  link.rotation.y = 0.35;
  link.receiveShadow = true;
  grp.add(link);

  // 双曲抛物面张拉膜
  const seg = 20;
  const half = 6.4;
  const positions = [];
  const indices = [];
  for (let iy = 0; iy <= seg; iy++) {
    const v = (iy / seg) * 2 - 1;
    for (let ix = 0; ix <= seg; ix++) {
      const u = (ix / seg) * 2 - 1;
      positions.push(u * half, 4.3 + 2.0 * (u * u - v * v), v * half);
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

  const memMat = new THREE.MeshStandardMaterial({
    color: '#fbfcfe',
    emissive: new THREE.Color('#ffdcb0'),
    emissiveIntensity: 0.0,
    roughness: 0.32,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
  const memMesh = new THREE.Mesh(memGeo, memMat);
  memMesh.castShadow = true;
  memMesh.receiveShadow = true;
  grp.add(memMesh);

  const anchors = [
    { top: [-half, 6.3, 0], bot: [-half - 1.1, 0.15, 0] },
    { top: [half, 6.3, 0], bot: [half + 1.1, 0.15, 0] },
    { top: [0, 2.3, -half], bot: [0, 0.15, -half - 0.8] },
    { top: [0, 2.3, half], bot: [0, 0.15, half + 0.8] },
  ];
  for (const a of anchors) {
    const p1 = new THREE.Vector3(...a.bot);
    const p2 = new THREE.Vector3(...a.top);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.12, p1.distanceTo(p2), 8), steelMat);
    mast.position.lerpVectors(p1, p2, 0.5);
    mast.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
    mast.castShadow = true;
    grp.add(mast);

    // 底座向上洗亮张拉膜的建筑地埋投射灯点
    if (warmAccentMat) {
      const uplight = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.14, 8), warmAccentMat);
      uplight.position.set(p1.x * 0.82, 0.31, p1.z * 0.82);
      grp.add(uplight);
    }
  }

  if (landmarkPoolMat) {
    const pavPool = new THREE.Mesh(new THREE.PlaneGeometry(15.2, 15.2), landmarkPoolMat);
    pavPool.userData.noMerge = true;
    pavPool.rotation.x = -Math.PI / 2;
    pavPool.position.set(0, 0.305, 0);
    grp.add(pavPool);
  }

  return { group: grp, memMat };
}

/**
 * 5. 东岸六角木吊顶临湖亭（复刻 04_IOPLY_湖滨会议中心夜景 暖金木顶透光神韵）与无缝双岸亲水栈桥
 */
function buildEastLakesidePavilionAndPier(teakMat, glassMat, steelMat, warmAccentMat, landmarkPoolMat) {
  const grp = new THREE.Group();
  grp.name = 'EastShore_PavilionAndPier';

  const px = 146;
  const pz = -24;
  const radius = 9.4;

  const stoneMat = new THREE.MeshStandardMaterial({ color: '#ebeef3', roughness: 0.58 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(radius + 1.6, radius + 2.2, 0.45, 6), stoneMat);
  base.position.set(px, 0.22, pz);
  base.receiveShadow = true;
  grp.add(base);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 4.8, 8), steelMat);
    col.position.set(px + Math.cos(a) * (radius - 0.9), 2.8, pz + Math.sin(a) * (radius - 0.9));
    col.castShadow = true;
    grp.add(col);
  }

  const pavGlassMat = glassMat.clone();
  pavGlassMat.emissive = new THREE.Color('#ffae45');
  pavGlassMat.emissiveIntensity = 0.0;
  const glassCore = new THREE.Mesh(new THREE.CylinderGeometry(radius - 2.4, radius - 2.4, 4.2, 6), pavGlassMat);
  glassCore.position.set(px, 2.5, pz);
  grp.add(glassCore);

  // 精工浅炭灰/瓷灰六角折面屋顶 + 温暖香槟橡木六角吊顶（夜景如湖滨会议中心般发出瑰丽暖金光辉）
  const roofCap = new THREE.Mesh(
    new THREE.ConeGeometry(radius + 2.6, 3.0, 6),
    new THREE.MeshStandardMaterial({ color: '#6b7582', roughness: 0.52, metalness: 0.22 })
  );
  roofCap.position.set(px, 6.7, pz);
  roofCap.castShadow = true;
  roofCap.receiveShadow = true;
  grp.add(roofCap);

  const warmWoodMat = new THREE.MeshStandardMaterial({
    color: '#d5c3aa',
    emissive: new THREE.Color('#cb741c'),
    emissiveIntensity: 0.0,
    roughness: 0.48,
  });
  const ceilingPlate = new THREE.Mesh(new THREE.CylinderGeometry(radius + 1.8, radius + 1.8, 0.16, 6), warmWoodMat);
  ceilingPlate.position.set(px, 5.14, pz);
  grp.add(ceilingPlate);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.05, 0.22, 0.24), warmWoodMat);
    rib.position.set(px, 5.0, pz);
    rib.rotation.y = a;
    grp.add(rib);

    // 沿六角木肋暗藏暖琥珀线性灯槽
    if (warmAccentMat) {
      const ribLed = new THREE.Mesh(new THREE.BoxGeometry(radius * 1.82, 0.07, 0.12), warmAccentMat);
      ribLed.position.set(px, 4.86, pz);
      ribLed.rotation.y = a;
      grp.add(ribLed);
    }
  }

  // 六角亭中央穹顶暖金发光灯盘 + 石材台面羽化金光溢出
  if (warmAccentMat) {
    const crownGlow = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 0.1, 6), warmAccentMat);
    crownGlow.position.set(px, 4.94, pz);
    grp.add(crownGlow);
  }
  if (landmarkPoolMat) {
    const pavDeckPool = new THREE.Mesh(new THREE.PlaneGeometry(20.4, 20.4), landmarkPoolMat);
    pavDeckPool.userData.noMerge = true;
    pavDeckPool.rotation.x = -Math.PI / 2;
    pavDeckPool.position.set(px, 0.465, pz);
    grp.add(pavDeckPool);
  }

  // 无缝双岸亲水栈桥（西端精准对接东侧消防道路与 E3 北露台，东端对接东岸环湖步道）
  const p1 = new THREE.Vector3(101.5, 0.2, 24);
  const p2 = new THREE.Vector3(153, 0.2, 3);
  const pierLen = p1.distanceTo(p2);
  const pierMid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const pierRotY = Math.atan2(p2.x - p1.x, p2.z - p1.z);

  const pierGrp = new THREE.Group();
  pierGrp.position.copy(pierMid);
  pierGrp.rotation.y = pierRotY;

  const pierDeck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, pierLen), teakMat);
  pierDeck.castShadow = true;
  pierDeck.receiveShadow = true;
  pierGrp.add(pierDeck);

  // 两端陶瓷石材着陆踏步台（零悬空无缝锁合岸线）
  for (const end of [-1, 1]) {
    const landing = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 3.2), stoneMat);
    landing.position.set(0, -0.05, end * (pierLen * 0.5 - 1.0));
    landing.receiveShadow = true;
    pierGrp.add(landing);
  }

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, pierLen - 2.0), glassMat);
    rail.position.set(side * 1.54, 0.56, 0);
    pierGrp.add(rail);

    // 东岸亲水栈桥双侧暖琥珀护栏底缘连续线形灯带
    if (warmAccentMat) {
      const edgeLed = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, pierLen - 1.4), warmAccentMat);
      edgeLed.position.set(side * 1.52, 0.14, 0);
      pierGrp.add(edgeLed);
    }
  }
  const pileInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 8), steelMat, 14);
  const dummy = new THREE.Object3D();
  let pi = 0;
  for (let i = 0; i < 7; i++) {
    const z = -pierLen * 0.42 + (i / 6) * pierLen * 0.84;
    for (const side of [-1.25, 1.25]) {
      dummy.position.set(side, -1.1, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pileInst.setMatrixAt(pi++, dummy.matrix);
    }
  }
  pileInst.instanceMatrix.needsUpdate = true;
  pierGrp.add(pileInst);
  grp.add(pierGrp);

  return { group: grp, warmWoodMat, pavGlassMat };
}

/**
 * 6. 临湖柚木阶梯看台、遮阳伞咖啡座、长椅、庭院柱灯与 1:100 比例小人（全量 InstancedMesh 减负）
 */
function buildWaterfrontFurnitureAndPeople(teakMat, steelMat, maxAnisotropy) {
  const grp = new THREE.Group();
  grp.name = 'WaterfrontFurnitureAndPeople';

  // 临湖柚木阶梯看台
  const stepSets = [
    { x: -98, z: 51.6, width: 22 },
    { x: 26, z: -57.6, width: 28 },
  ];
  for (const st of stepSets) {
    for (let k = 0; k < 3; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(st.width, 0.26, 1.05), teakMat);
      step.position.set(st.x, 0.16 - k * 0.22, st.z + k * 0.95);
      step.receiveShadow = true;
      grp.add(step);
    }
  }

  // 遮阳伞咖啡座（全量 InstancedMesh）
  const parasolPositions = [
    [-68, 53.5], [-62, 53.5], [-56, 53.5],
    [-28, -30.5], [-22, -30.5], [-16, -30.5],
    [136, -18], [140, -14],
  ];
  const canopyMat = new THREE.MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.55, side: THREE.DoubleSide });
  const tableMat = new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.4 });
  const pPoleInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 2.5, 6), steelMat, parasolPositions.length);
  const pUmbInst = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 0.5, 8), canopyMat, parasolPositions.length);
  const pTabInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10), tableMat, parasolPositions.length);
  pUmbInst.castShadow = true;

  const dummy = new THREE.Object3D();
  parasolPositions.forEach(([px, pz], i) => {
    const baseY = px < 0 ? ELEVATIONS.FLOOR_1_Y + 0.22 : 0.24;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(px, baseY + 1.25, pz);
    dummy.updateMatrix();
    pPoleInst.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, baseY + 2.45, pz);
    dummy.updateMatrix();
    pUmbInst.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, baseY + 0.76, pz);
    dummy.updateMatrix();
    pTabInst.setMatrixAt(i, dummy.matrix);
  });
  pPoleInst.instanceMatrix.needsUpdate = true;
  pUmbInst.instanceMatrix.needsUpdate = true;
  pTabInst.instanceMatrix.needsUpdate = true;
  grp.add(pPoleInst, pUmbInst, pTabInst);

  // 长椅
  const benchPositions = [
    [14, -89, Math.PI / 2], [38, -89, -Math.PI / 2],
    [14, -104, Math.PI / 2], [38, -104, -Math.PI / 2],
    [-95, 50.8, 0], [-86, 50.8, 0],
    [-126, 121.5, 0], [-74, 129, 0.4],
    [142, -16, -0.6], [104, 18, Math.PI / 2],
  ];
  const benchInst = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.46, 0.62), teakMat, benchPositions.length);
  benchInst.receiveShadow = true;
  benchPositions.forEach(([bx, bz, ry], idx) => {
    const by = bx === -126 && bz === 121.5 ? 7.9 : 0.28;
    dummy.position.set(bx, by, bz);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    benchInst.setMatrixAt(idx, dummy.matrix);
  });
  benchInst.instanceMatrix.needsUpdate = true;
  grp.add(benchInst);

  // 庭院与环湖步道矮柱灯 + 羽化径向渐变暖金地面光晕（彻底取代硬边实心圆盘）
  const lampPoints = [
    [15, -138], [37, -138], [15, -120], [37, -120], [15, -98], [37, -98],
    [16, -60], [36, -60],
    [-46, -101], [-90, -96], [-140, -86], [-174, -40], [-182, 4], [-182, 42], [-180, 76],
    [-112, 52], [-66, 52], [-49.5, 18], [-49.5, -14], [-24, -30],
    [102, -96], [102, -48], [102, 2], [116, 26], [138, -6], [150, -48], [148, -92], [170, 38],
    [154, 92], [114, 131], [60, 152], [16, 166], [-26, 163], [-64, 146], [-88, 124], [-178, 86],
  ];
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: '#fff6e0',
    emissive: new THREE.Color('#ffbe62'),
    emissiveIntensity: 0.3,
    roughness: 0.24,
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

  const postInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.13, 1.35, 6), steelMat, lampPoints.length);
  const headInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 0.34, 6), lampGlowMat, lampPoints.length);
  const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, lampPoints.length);

  lampPoints.forEach(([lx, lz], i) => {
    let baseY = sampleGroundElevation(lx, lz);
    let poolY = baseY + 0.105;
    // 抬升位于中央大入口门廊地坪（top=0.175）及 W2/W5 临湖木平台（top=0.315）上的柱灯与光晕标高，杜绝埋没
    if (lx >= 9 && lx <= 43 && lz >= -84 && lz <= -58) {
      baseY = 0.175;
      poolY = 0.19;
    } else if (
      (lx >= -76 && lx <= -52 && lz >= 50 && lz <= 57.5) ||
      (lx >= -34 && lx <= -10 && lz >= -34 && lz <= -26.5)
    ) {
      baseY = 0.315;
      poolY = 0.33;
    }

    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(lx, baseY + 0.675, lz);
    dummy.updateMatrix();
    postInst.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lx, baseY + 1.48, lz);
    dummy.updateMatrix();
    headInst.setMatrixAt(i, dummy.matrix);
    dummy.position.set(lx, poolY, lz);
    dummy.updateMatrix();
    poolInst.setMatrixAt(i, dummy.matrix);
  });
  postInst.instanceMatrix.needsUpdate = true;
  headInst.instanceMatrix.needsUpdate = true;
  poolInst.instanceMatrix.needsUpdate = true;
  grp.add(postInst, headInst, poolInst);

  // 1:100 比例建筑模型纯白小人
  const peopleCoords = [
    [22, 0.12, -72], [25, 0.12, -70], [29, 0.12, -64], [24, 0.12, -92], [28, 0.12, -95],
    [14, 0.12, -76], [38, 0.12, -68],
    [-66, 0.28, 53.8], [-60, 0.28, 54.4], [-55, 0.28, 52.8], [-88, 0.12, 51.2],
    [-26, 0.28, -30.2], [-18, 0.28, -29.8], [-68, 0.12, 18], [-64, 0.12, 22],
    [-130, 0.12, 38], [-128, 0.12, 42],
    [72, 0.12, 22], [76, 0.12, 25], [82, 0.12, 28],
    [124, 0.35, 17], [129, 0.35, 14.2], [142, 0.5, -20], [148, 0.5, -18],
    [-170, 2.15, 108.5], [-168, 2.05, 111.2],
    [-125, 7.72, 127], [-128, 7.72, 129], [-72, 0.32, 134], [-70, 0.32, 136],
  ];
  const figMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.42 });
  const bodyInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.22, 1.3, 6), figMat, peopleCoords.length);
  const headInstP = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 6, 6), figMat, peopleCoords.length);

  peopleCoords.forEach(([px, py, pz], i) => {
    dummy.position.set(px, py + 0.65, pz);
    dummy.rotation.set(0, i * 1.1, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyInst.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, py + 1.46, pz);
    dummy.updateMatrix();
    headInstP.setMatrixAt(i, dummy.matrix);
  });
  bodyInst.instanceMatrix.needsUpdate = true;
  headInstP.instanceMatrix.needsUpdate = true;
  grp.add(bodyInst, headInstP);

  return {
    group: grp,
    setDuskFactor(dusk, night = dusk) {
      lampGlowMat.emissiveIntensity = 0.3 + dusk * 2.9 + night * 1.1;
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

  const lawnMat = new THREE.MeshStandardMaterial({
    map: lawnTex,
    roughness: 0.92,
    metalness: 0.01,
  });
  const teakMat = new THREE.MeshStandardMaterial({
    map: teakTex,
    emissive: new THREE.Color('#6b4118'),
    emissiveIntensity: 0.0,
    roughness: 0.58,
    metalness: 0.03,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#c4e3ee',
    roughness: 0.1,
    metalness: 0.12,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: '#737d8a',
    roughness: 0.38,
    metalness: 0.58,
  });

  // 1. 精确对齐 y = 0.000 的偏白模斜纹绒面草坪（精准抠除平滑样条湖盆 + 1BF 车库坡道井口）
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

  const lawnDepth = 3.6;
  const lawnGeo = new THREE.ExtrudeGeometry(lawnShape, {
    depth: lawnDepth,
    bevelEnabled: false,
    curveSegments: 20,
  });
  lawnGeo.rotateX(-Math.PI / 2);
  const lPos = lawnGeo.attributes.position;
  const lUv = new Float32Array(lPos.count * 2);
  for (let i = 0; i < lPos.count; i++) {
    lUv[i * 2] = (lPos.getX(i) + PLINTH_CONFIG.width * 0.5) / PLINTH_CONFIG.width;
    lUv[i * 2 + 1] = (lPos.getZ(i) + PLINTH_CONFIG.depth * 0.5) / PLINTH_CONFIG.depth;
  }
  lawnGeo.setAttribute('uv', new THREE.BufferAttribute(lUv, 2));

  const lawnMesh = new THREE.Mesh(lawnGeo, lawnMat);
  lawnMesh.position.y = ELEVATIONS.LAWN_TOP - lawnDepth;
  lawnMesh.receiveShadow = true;
  group.add(lawnMesh);

  // 2. 北侧对称迎宾镜面水池与精工修剪绿篱（含夜景水池暗藏边缘暖金光带）
  const warmAccentMat = new THREE.MeshStandardMaterial({
    color: '#ffebbf',
    emissive: new THREE.Color('#ffae42'),
    emissiveIntensity: 0.12,
    roughness: 0.24,
  });
  const bridgeArchLedMat = new THREE.MeshStandardMaterial({
    color: '#eef6ff',
    emissive: new THREE.Color('#c8e4ff'),
    emissiveIntensity: 0.1,
    roughness: 0.22,
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

  const poolStoneMat = new THREE.MeshStandardMaterial({ color: '#edf0f5', roughness: 0.5 });
  const dayMirrorCol = new THREE.Color('#8fb9c7');
  const nightMirrorCol = new THREE.Color('#09192b');
  const mirrorWaterMat = new THREE.MeshStandardMaterial({
    color: '#8fb9c7',
    roughness: 0.06,
    metalness: 0.24,
    envMapIntensity: 1.5,
  });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: '#9eb09e', roughness: 0.88 });

  for (const side of [-1, 1]) {
    const px = 26 + side * 15.8;
    const pz = -124.5;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.24, 24.5), poolStoneMat);
    frame.position.set(px, 0.12, pz);
    frame.receiveShadow = true;
    group.add(frame);

    const mirror = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.08, 23.3), mirrorWaterMat);
    mirror.position.set(px, 0.22, pz);
    group.add(mirror);

    // 镜面水池内檐微光水下灯槽
    for (const s of [-1, 1]) {
      const poolLed = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 22.8), warmAccentMat);
      poolLed.position.set(px + s * 4.12, 0.25, pz);
      group.add(poolLed);
    }

    const hedgeOuter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.88, 24.5), hedgeMat);
    hedgeOuter.position.set(px + side * 6.0, 0.44, pz);
    hedgeOuter.castShadow = true;
    hedgeOuter.receiveShadow = true;
    group.add(hedgeOuter);

    const hedgeInner = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.52, 20.5), hedgeMat);
    hedgeInner.position.set(px + side * 7.6, 0.26, pz);
    group.add(hedgeInner);
  }

  // 3. 西南平滑 CNC 等高线圆丘 + 连续螺旋步道（含夜间步阶微光灯柱）+ 嵌入式山顶柚木平台
  group.add(buildSculptedSWHillPark(teakMat, glassMat, steelMat, warmAccentMat, landmarkPoolMat));

  // 4. 东侧龙蟠山平滑 CNC 微等高线山体
  group.add(buildSculptedLongpanMountain());

  // 5. 无缝双端桥台西南钢拱肋玻璃栏杆拱桥（含夜间扶手与拱肋线形光带）
  group.add(buildSeamlessSWArchBridge(teakMat, glassMat, warmAccentMat, bridgeArchLedMat));

  // 6. 西南白色双曲张拉膜小亭（含夜间柔和仰光照明）
  const membranePavilion = buildHyperbolicMembranePavilion(steelMat, warmAccentMat, landmarkPoolMat);
  group.add(membranePavilion.group);

  // 7. 东岸六角木吊顶临湖亭与无缝双岸亲水栈桥（含暖金木顶与栈桥双侧线形灯带）
  const eastPavilion = buildEastLakesidePavilionAndPier(teakMat, glassMat, steelMat, warmAccentMat, landmarkPoolMat);
  group.add(eastPavilion.group);

  // 8. 临湖柚木看台、遮阳伞、长椅、庭院柱灯与 1:100 比例小人
  const furniture = buildWaterfrontFurnitureAndPeople(teakMat, steelMat, maxAnisotropy);
  group.add(furniture.group);

  return {
    group,
    setDuskFactor(dusk, night = dusk) {
      furniture.setDuskFactor(dusk, night);
      warmAccentMat.emissiveIntensity = 0.12 + dusk * 2.95 + night * 1.15;
      bridgeArchLedMat.emissiveIntensity = 0.1 + dusk * 2.15 + night * 0.95;
      membranePavilion.memMat.emissiveIntensity = dusk * 0.42 + night * 0.22;
      eastPavilion.warmWoodMat.emissiveIntensity = dusk * 0.92 + night * 0.58;
      eastPavilion.pavGlassMat.emissiveIntensity = dusk * 0.3 + night * 0.2;
      teakMat.emissiveIntensity = dusk * 0.12 + night * 0.08;
      mirrorWaterMat.color.lerpColors(dayMirrorCol, nightMirrorCol, Math.min(1, dusk * 0.72 + night * 0.32));
      landmarkPoolMat.visible = dusk > 0.005;
      landmarkPoolMat.opacity = dusk * 0.38 + night * 0.22;
    },
  };
}
