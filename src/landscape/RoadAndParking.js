import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDING_WINGS, ELEVATIONS, PLINTH_CONFIG } from '../config/campusConfig.js';
import {
  createAsphaltRoadTexture,
  createContactShadowTexture,
  createFeatheredLightPoolTexture,
  createLightConeTexture,
  createParkingLotTexture,
  createPlazaPaverTexture,
  createSolarPanelTexture,
} from '../core/ProceduralTextures.js';

/**
 * IOPLY 园区精工工业模型道路网络、倒角暖石路缘、智能停车场（太阳能车棚/充电桩/门岗道闸）、
 * CNC 精雕路灯体系与 1BF 地下车库下沉坡道
 *
 * 工程与材质契约（严格对齐 @env-clouds #38 无界云雾融合规范 & 既有 R1–R10 接缝修复）：
 * - 零闪烁阶梯标高（相邻搭接面分离 >= 4mm，严禁 coplanar Z-Fighting）
 * - 三条外围市政主干道（中关村大道、平陵西路、永平大道）解除硬边界钳制，沿切线自然延展约 220m
 *   穿过无界外围绿地并经逐像素平滑透明渐变无痕消隐入云雾；核心园区段保持不透明实心阴影与车辆兼容
 * - 45° 倒角暖石路缘石于 d_out <= 32m 外平滑缓降没入绿地，且保留全部交叉口/广场/停车场/坡道净空断口
 * - 1BF 坡道精准正向由东入地（rotation.z = +0.155）、挡墙深入基坑至 -3.50m、雨棚立柱逐根精确对接斜玻璃
 * - 全部 64 盏路灯采用 InstancedMesh 批渲染（0 PointLight），加权倒角基座下探至 y = -0.04m 彻底杜绝悬空
 */

// 道路分层标高表（与 VehicleTrafficSystem.js 的 sampleRoadSurfaceY 保持毫米级 1:1 同步）
const ROAD_Y = {
  WALKWAY: 0.054,
  WALKWAY_CURB: 0.076,
  BRANCH_APRON: 0.058,
  BRANCH_CURB: 0.082,
  FIRE_LOT: ELEVATIONS.ROAD_TOP, // 0.062
  FIRE_CURB: ELEVATIONS.CURB_TOP, // 0.085
  YONGPING: 0.064,
  YONGPING_CURB: 0.086,
  WELCOME: 0.066,
  WELCOME_CURB: 0.088,
  PINGLING: 0.068,
  PINGLING_CURB: 0.090,
  ZGC: 0.072,
  ZGC_CURB: 0.094,
  PLAZA: ELEVATIONS.PLAZA_TOP, // 0.072
  JUNCTION: 0.076,
};

// 园区核心圆角矩形外距参数（与 HardwarePlinth.js 的 d_out 精确 1:1 同步：486×368, r=26）
const CAMPUS_INNER_HW = PLINTH_CONFIG.width * 0.5 - PLINTH_CONFIG.cornerRadius; // 217
const CAMPUS_INNER_HD = PLINTH_CONFIG.depth * 0.5 - PLINTH_CONFIG.cornerRadius; // 158
const CAMPUS_CORNER_R = PLINTH_CONFIG.cornerRadius; // 26

function calcCampusOutDist(x, z) {
  const qx = Math.abs(x) - CAMPUS_INNER_HW;
  const qz = Math.abs(z) - CAMPUS_INNER_HD;
  return Math.hypot(Math.max(0, qx), Math.max(0, qz)) + Math.min(Math.max(qx, qz), 0) - CAMPUS_CORNER_R;
}

function smoothstep01(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 为外延市政主干道尾部创建逐像素平滑消隐材质（与核心不透明段在接缝处 alpha=1.0 精确无缝对齐，
 * 同时按世界空间外距 d_out ∈ [115m, 212m] 与端头弧长距离双重柔化消隐入外围草地与云雾，零硬切口！）
 */
function createBoundlessArterialFadeMaterial(baseMat) {
  const mat = baseMat.clone();
  mat.name = 'ArterialRoadBoundlessFade';
  mat.transparent = true;
  mat.depthWrite = false;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -0.5;
  mat.polygonOffsetUnits = -1;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aEndDist;
        varying vec2 vRoadWorldXZ;
        varying float vRoadEndDist;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 roadWorldPos = modelMatrix * vec4(transformed, 1.0);
        vRoadWorldXZ = roadWorldPos.xz;
        vRoadEndDist = aEndDist;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vRoadWorldXZ;
        varying float vRoadEndDist;`
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
        vec2 roadQ = abs(vRoadWorldXZ) - vec2(${CAMPUS_INNER_HW.toFixed(1)}, ${CAMPUS_INNER_HD.toFixed(1)});
        float roadDOut = length(max(roadQ, 0.0)) + min(max(roadQ.x, roadQ.y), 0.0) - ${CAMPUS_CORNER_R.toFixed(1)};
        float roadFadeOut = 1.0 - smoothstep(115.0, 212.0, roadDOut);
        float roadFadeEnd = smoothstep(6.0, 108.0, vRoadEndDist);
        float roadT = clamp(roadFadeOut * roadFadeEnd, 0.0, 1.0);
        float roadAlpha = roadT * (0.60 + 0.40 * roadT);
        diffuseColor.a *= roadAlpha;
        if (diffuseColor.a < 0.004) discard;`
      );
  };
  mat.customProgramCacheKey = () => 'arterial-boundless-fade-v1';
  return mat;
}

/**
 * 将任意水平顶点精准钳制于硬件底座内腔圆角矩形内（±242.2 × ±183.2, r = 25.2），
 * 杜绝市政斜交道路及路缘外侧探入底座压边 trimMesh
 */
function clampVertexToPlinth(x, z) {
  const hw = PLINTH_CONFIG.width * 0.5 - 0.8; // 242.2
  const hd = PLINTH_CONFIG.depth * 0.5 - 0.8; // 183.2
  const r = PLINTH_CONFIG.cornerRadius - 0.8; // 25.2

  let cx = Math.max(-hw, Math.min(hw, x));
  let cz = Math.max(-hd, Math.min(hd, z));

  const ax = Math.abs(cx);
  const az = Math.abs(cz);
  const ix = hw - r;
  const iz = hd - r;
  if (ax > ix && az > iz) {
    const dx = ax - ix;
    const dz = az - iz;
    const d = Math.hypot(dx, dz);
    if (d > r) {
      cx = Math.sign(cx) * (ix + (dx / d) * r);
      cz = Math.sign(cz) * (iz + (dz / d) * r);
    }
  }
  return [cx, cz];
}

/**
 * 合并局部索引缓冲几何体（供 CNC 路灯、太阳能支架、轮挡等精致多部件资产共享复用）
 */
function mergeIndexedParts(parts) {
  const cleaned = parts.map((g) => {
    const c = g.clone();
    for (const attr of Object.keys(c.attributes)) {
      if (attr !== 'position' && attr !== 'normal') {
        c.deleteAttribute(attr);
      }
    }
    if (!c.attributes.normal) c.computeVertexNormals();
    if (!c.index) {
      const cnt = c.attributes.position.count;
      const idx = cnt > 65535 ? new Uint32Array(cnt) : new Uint16Array(cnt);
      for (let i = 0; i < cnt; i++) idx[i] = i;
      c.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    g.dispose();
    return c;
  });
  const merged = mergeGeometries(cleaned, false);
  cleaned.forEach((g) => g.dispose());
  return merged;
}

/**
 * 轻量 inline 程序化纹理（仅用于交叉口细粒深石板沥青、暖洞石慢行步道、柔软接地 AO 贴花）
 */
function createInlineSlateAsphaltTexture(hex = '#484E57', maxAnisotropy = 4) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % size;
    const py = Math.floor(i / 4 / size);
    const n = (Math.sin(px * 127.1 + py * 311.7) * 43758.5453) % 1;
    const g = (n - Math.floor(n) - 0.5) * 11;
    d[i] = Math.min(255, Math.max(0, d[i] + g));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + g));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + g));
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.anisotropy = Math.min(maxAnisotropy, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createInlineWalkwayStoneTexture(maxAnisotropy = 4) {
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // 暖洞石基础色调 (#C9C1B5，匹配 @art-lighting 石材步道规范)
  ctx.fillStyle = '#c9c1b5';
  ctx.fillRect(0, 0, w, h);

  const rows = 8;
  const cols = 3;
  const rh = h / rows;
  const cw = w / cols;
  for (let r = 0; r < rows; r++) {
    const shift = (r % 2) * (cw * 0.5);
    for (let c = -1; c <= cols; c++) {
      const seed = Math.sin((c + 7) * 51.7 + (r + 3) * 19.3) * 43758.5453;
      const frac = seed - Math.floor(seed);
      const delta = Math.floor((frac - 0.5) * 12);
      ctx.fillStyle = `rgb(${201 + delta}, ${193 + delta}, ${181 + delta})`;
      ctx.fillRect(c * cw + shift + 1.5, r * rh + 1.5, cw - 3, rh - 3);
    }
  }
  // 两侧精致石材收边缝
  ctx.fillStyle = 'rgba(130, 122, 112, 0.34)';
  ctx.fillRect(4, 0, 2, h);
  ctx.fillRect(w - 6, 0, 2, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(maxAnisotropy, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 精工 3D 挤压道路带生成器：
 * - 支持核心园区道路钳制与外围市政主干道无界自然延展（核心段不透明实心，外延尾部平滑透明消隐）
 * - 两侧采用 45° 精雕倒角暖石路缘石截面（支持交叉口/广场/入口自动断口及外延平滑缓降收尾）
 */
function buildExtrudedRoadRibbon({
  controlPoints,
  width,
  topY = ROAD_Y.FIRE_LOT,
  bottomY = -0.06,
  curbTopY = ROAD_Y.FIRE_CURB,
  curbWidth = 0.42,
  segments = 56,
  uvTileLength = 14,
  roadMaterial,
  fadeRoadMaterial = null,
  curbMaterial,
  closed = false,
  withCurbs = true,
  clampToPlinth = true,
  curbMaxOutDist = null,
  curbSuppressFn = null,
}) {
  const grp = new THREE.Group();
  const vecs = controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
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
  const totalArcLen = arcLens[count - 1];

  const resolveXZ = (x, z) => (clampToPlinth ? clampVertexToPlinth(x, z) : [x, z]);

  // 1. 路面实心挤压带（无界主干道自动拆分为不透明核心段 + 平滑渐隐外延尾段，接缝处 alpha=1.0 零闪烁）
  const buildRoadSurfaceRuns = (segPredicate, mat, { isFadeTail = false } = {}) => {
    const runs = [];
    let runStart = -1;
    for (let i = 0; i < count - 1; i++) {
      const ok = segPredicate(i);
      if (ok && runStart === -1) runStart = i;
      if (!ok && runStart !== -1) {
        runs.push([runStart, i]);
        runStart = -1;
      }
    }
    if (runStart !== -1) runs.push([runStart, count - 1]);
    if (runs.length === 0) return null;

    const positions = [];
    const uvs = [];
    const endDists = isFadeTail ? [] : null;
    const indices = [];
    const wallBotY = isFadeTail ? 0.0 : bottomY;

    for (const [startIdx, endIdx] of runs) {
      const runLen = endIdx - startIdx + 1;

      // 顶面
      const topBase = positions.length / 3;
      for (let i = startIdx; i <= endIdx; i++) {
        const p = pts[i];
        const r = rights[i];
        const v = arcLens[i] / uvTileLength;
        const [lx, lz] = resolveXZ(p.x - r.x * halfW, p.z - r.z * halfW);
        const [rx, rz] = resolveXZ(p.x + r.x * halfW, p.z + r.z * halfW);
        positions.push(lx, topY, lz, rx, topY, rz);
        uvs.push(0, v, 1, v);
        if (endDists) {
          const ed = Math.min(arcLens[i], totalArcLen - arcLens[i]);
          endDists.push(ed, ed);
        }
      }
      for (let i = 0; i < runLen - 1; i++) {
        const a = topBase + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }

      // 左壁
      const leftBase = positions.length / 3;
      for (let i = startIdx; i <= endIdx; i++) {
        const p = pts[i];
        const r = rights[i];
        const v = arcLens[i] / uvTileLength;
        const [lx, lz] = resolveXZ(p.x - r.x * halfW, p.z - r.z * halfW);
        positions.push(lx, topY, lz, lx, wallBotY, lz);
        uvs.push(0.02, v, 0.02, v);
        if (endDists) {
          const ed = Math.min(arcLens[i], totalArcLen - arcLens[i]);
          endDists.push(ed, ed);
        }
      }
      for (let i = 0; i < runLen - 1; i++) {
        const a = leftBase + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }

      // 右壁
      const rightBase = positions.length / 3;
      for (let i = startIdx; i <= endIdx; i++) {
        const p = pts[i];
        const r = rights[i];
        const v = arcLens[i] / uvTileLength;
        const [rx, rz] = resolveXZ(p.x + r.x * halfW, p.z + r.z * halfW);
        positions.push(rx, topY, rz, rx, wallBotY, rz);
        uvs.push(0.98, v, 0.98, v);
        if (endDists) {
          const ed = Math.min(arcLens[i], totalArcLen - arcLens[i]);
          endDists.push(ed, ed);
        }
      }
      for (let i = 0; i < runLen - 1; i++) {
        const a = rightBase + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (endDists) {
      geo.setAttribute('aEndDist', new THREE.Float32BufferAttribute(endDists, 1));
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    if (isFadeTail) {
      mesh.userData.noMerge = true;
    }
    return mesh;
  };

  if (fadeRoadMaterial) {
    const isCoreStation = (idx) => {
      const p = pts[idx];
      const r = rights[idx];
      const dOutMax = Math.max(
        calcCampusOutDist(p.x - r.x * halfW, p.z - r.z * halfW),
        calcCampusOutDist(p.x + r.x * halfW, p.z + r.z * halfW)
      );
      const ed = Math.min(arcLens[idx], totalArcLen - arcLens[idx]);
      return dOutMax <= 113.0 && ed >= 110.0;
    };
    const coreMesh = buildRoadSurfaceRuns(
      (i) => isCoreStation(i) && isCoreStation(i + 1),
      roadMaterial,
      { isFadeTail: false }
    );
    const fadeMesh = buildRoadSurfaceRuns(
      (i) => !(isCoreStation(i) && isCoreStation(i + 1)),
      fadeRoadMaterial,
      { isFadeTail: true }
    );
    if (coreMesh) grp.add(coreMesh);
    if (fadeMesh) grp.add(fadeMesh);
  } else {
    const fullMesh = buildRoadSurfaceRuns(() => true, roadMaterial, { isFadeTail: false });
    if (fullMesh) grp.add(fullMesh);
  }

  // 2. 45° 倒角暖石路缘石（支持沿线自动净空跳过交叉口/广场/入口，及外延段平滑缓降没入草地）
  const buildChamferedCurbSide = (sideSign) => {
    const innerOff = sideSign * halfW;
    const outerOff = sideSign * (halfW + curbWidth);
    const midOff = (innerOff + outerOff) * 0.5;
    const baseBev = Math.min(0.032, curbWidth * 0.22);

    // 判定每段是否处于净空抑止区或超出外围路缘截止距离
    const activeSeg = new Array(count - 1).fill(true);
    for (let i = 0; i < count - 1; i++) {
      const pA = pts[i];
      const pB = pts[i + 1];
      const rA = rights[i];
      const rB = rights[i + 1];
      const mx = (pA.x + rA.x * midOff + pB.x + rB.x * midOff) * 0.5;
      const mz = (pA.z + rA.z * midOff + pB.z + rB.z * midOff) * 0.5;
      if (curbMaxOutDist !== null && calcCampusOutDist(mx, mz) > curbMaxOutDist) {
        activeSeg[i] = false;
        continue;
      }
      if (curbSuppressFn && curbSuppressFn(mx, mz, sideSign)) {
        activeSeg[i] = false;
      }
    }

    // 切分为连续有效段落 [start .. end]
    const runs = [];
    let s = -1;
    for (let i = 0; i < count - 1; i++) {
      if (activeSeg[i] && s === -1) s = i;
      if (!activeSeg[i] && s !== -1) {
        runs.push([s, i]);
        s = -1;
      }
    }
    if (s !== -1) runs.push([s, count - 1]);
    if (runs.length === 0) return;

    // 统一将本侧所有有效路缘段合并入单个精简 BufferGeometry
    // 截面 6 点按从左(-right)到右(+right)排列，确保法线严格朝外
    const leftEdge = Math.min(innerOff, outerOff);
    const rightEdge = Math.max(innerOff, outerOff);
    const pCount = 6;

    const positions = [];
    const indices = [];

    for (const [startIdx, endIdx] of runs) {
      const baseV = positions.length / 3;
      const runLen = endIdx - startIdx + 1;

      for (let i = startIdx; i <= endIdx; i++) {
        const p = pts[i];
        const r = rights[i];

        // 外围市政路缘在 [curbMaxOutDist - 12m, curbMaxOutDist] 区间平滑缓降至草坪顶面下 -8mm，杜绝突兀混凝土断头
        let localCurbTop = curbTopY;
        let localBev = baseBev;
        if (curbMaxOutDist !== null) {
          const cx = p.x + r.x * midOff;
          const cz = p.z + r.z * midOff;
          const dOut = calcCampusOutDist(cx, cz);
          const taper = smoothstep01(curbMaxOutDist - 12.0, curbMaxOutDist, dOut);
          if (taper > 0) {
            localCurbTop = curbTopY * (1 - taper) + -0.008 * taper;
            localBev = baseBev * (1 - taper);
          }
        }

        const profileOffsets = [
          [leftEdge, bottomY],
          [leftEdge, localCurbTop - localBev],
          [leftEdge + localBev, localCurbTop],
          [rightEdge - localBev, localCurbTop],
          [rightEdge, localCurbTop - localBev],
          [rightEdge, bottomY],
        ];

        for (let k = 0; k < pCount; k++) {
          const [off, py] = profileOffsets[k];
          const [vx, vz] = resolveXZ(p.x + r.x * off, p.z + r.z * off);
          positions.push(vx, py, vz);
        }
      }

      // 沿道路连接 5 条倒角与侧壁条带
      for (let i = 0; i < runLen - 1; i++) {
        const rowA = baseV + i * pCount;
        const rowB = baseV + (i + 1) * pCount;
        for (let k = 0; k < pCount - 1; k++) {
          const a = rowA + k;
          const b = rowA + k + 1;
          const c = rowB + k;
          const d = rowB + k + 1;
          indices.push(a, b, c, b, d, c);
        }
      }

      // 起点与终点实心封盖，避免路缘断口漏空
      const sRow = baseV;
      indices.push(
        sRow, sRow + 2, sRow + 1,
        sRow, sRow + 3, sRow + 2,
        sRow, sRow + 4, sRow + 3,
        sRow, sRow + 5, sRow + 4
      );
      const eRow = baseV + (runLen - 1) * pCount;
      indices.push(
        eRow, eRow + 1, eRow + 2,
        eRow, eRow + 2, eRow + 3,
        eRow, eRow + 3, eRow + 4,
        eRow, eRow + 4, eRow + 5
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, curbMaterial);
    mesh.receiveShadow = true;
    grp.add(mesh);
  };

  if (withCurbs && curbMaterial) {
    buildChamferedCurbSide(-1);
    buildChamferedCurbSide(1);
  }
  return grp;
}

/**
 * 精工倒角人行横道斑马线（薄实心 3D 嵌入条，杜绝 Z-Fighting 且完美接受棚拍阴影）
 */
function buildCrosswalkStripes({ x, z, width, length = 3.2, stripes = 7, rotY = 0, topY, mat }) {
  const grp = new THREE.Group();
  grp.position.set(x, topY + 0.003, z);
  grp.rotation.y = rotY;

  const pitch = width / stripes;
  const barW = pitch * 0.52;
  for (let i = 0; i < stripes; i++) {
    const sx = -width * 0.5 + pitch * (i + 0.5);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(barW, 0.006, length), mat);
    bar.position.set(sx, 0, 0);
    bar.receiveShadow = true;
    grp.add(bar);
  }
  return grp;
}

/**
 * 工业级太阳能充电车棚（倒角缎面陶土灰外框 + 深靛蓝单晶硅光伏阵列 + 阳极石墨立柱斜撑 + 精工 EV 充电桩）
 * - 立柱位于西侧局部 x = -widthX * 0.42，充电桩位于 -widthX * 0.29，与东侧泊位车辆留足 >= 1.0m~1.75m 净距！
 */
function buildSolarCarport({
  x,
  z,
  lengthZ,
  widthX,
  solarMat,
  satinClayMat,
  darkGraphiteMat,
  brushedSilverMat,
  curbMat,
  smokedGlassMat,
  ledMat,
  microAmberMat,
  underStripMat,
}) {
  const grp = new THREE.Group();
  grp.position.set(x, ROAD_Y.FIRE_LOT, z);

  const tiltZ = 0.11;
  const tanT = Math.tan(tiltZ);

  // 1. 倒角分层悬挑顶棚（缎面陶土灰外框 + 深石墨内衬槽 + 嵌入式光伏阵列）
  const fasciaMain = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.34, 0.14, lengthZ + 0.34), satinClayMat);
  fasciaMain.position.set(0, 3.16, 0);
  fasciaMain.rotation.z = tiltZ;
  fasciaMain.castShadow = true;
  fasciaMain.receiveShadow = true;
  grp.add(fasciaMain);

  const fasciaTopCap = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.20, 0.05, lengthZ + 0.20), brushedSilverMat);
  fasciaTopCap.position.set(0, 3.24, 0);
  fasciaTopCap.rotation.z = tiltZ;
  grp.add(fasciaTopCap);

  const soffitFrame = new THREE.Mesh(new THREE.BoxGeometry(widthX + 0.16, 0.07, lengthZ + 0.16), darkGraphiteMat);
  soffitFrame.position.set(0, 3.06, 0);
  soffitFrame.rotation.z = tiltZ;
  grp.add(soffitFrame);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(widthX - 0.18, 0.06, lengthZ - 0.24), solarMat);
  canopy.position.set(0, 3.27, 0);
  canopy.rotation.z = tiltZ;
  grp.add(canopy);

  // 棚底双排冰青新能源线性照明灯带
  if (underStripMat) {
    for (const sx of [-widthX * 0.16, widthX * 0.24]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, lengthZ - 0.9), underStripMat);
      strip.position.set(sx, 3.01 + sx * tanT, 0);
      strip.rotation.z = tiltZ;
      grp.add(strip);
    }
  }

  // 2. 阳极石墨立柱（带暖石混凝土倒角基座 + 斜撑悬挑臂）与工业级 EV 智能充电桩
  const colX = -widthX * 0.42;
  const chargerX = colX + 0.56;
  const posts = Math.max(3, Math.round(lengthZ / 5.6));

  for (let i = 0; i < posts; i++) {
    const pz = -lengthZ * 0.43 + (i / (posts - 1)) * (lengthZ * 0.86);
    const colTopY = 3.02 + colX * tanT;

    // 落地混凝土保护基座（下探 -0.04m 绝不悬空）
    const footPad = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.46), curbMat);
    footPad.position.set(colX, 0.08, pz);
    footPad.receiveShadow = true;
    grp.add(footPad);

    const footCollar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.10, 0.34), brushedSilverMat);
    footCollar.position.set(colX, 0.22, pz);
    grp.add(footCollar);

    // 阳极深石墨主立柱
    const colH = colTopY - 0.20;
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.22, colH, 0.22), darkGraphiteMat);
    col.position.set(colX, 0.20 + colH * 0.5, pz);
    col.castShadow = true;
    grp.add(col);

    // 悬挑主梁 + 45° 斜撑膝梁
    const arm = new THREE.Mesh(new THREE.BoxGeometry(widthX - 0.08, 0.15, 0.16), darkGraphiteMat);
    arm.position.set(0.06, 2.98, pz);
    arm.rotation.z = tiltZ;
    grp.add(arm);

    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.10, 0.12), darkGraphiteMat);
    brace.position.set(colX + 0.54, colTopY - 0.44, pz);
    brace.rotation.z = 0.72;
    grp.add(brace);

    // 精致倒角缎面陶土灰 EV 充电桩（位于两柱之间偏内侧，避开所有停放车辆车尾）
    if (i < posts - 1) {
      const nextPz = -lengthZ * 0.43 + ((i + 1) / (posts - 1)) * (lengthZ * 0.86);
      const cz = (pz + nextPz) * 0.5;

      const chPlinth = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.36), darkGraphiteMat);
      chPlinth.position.set(chargerX, 0.04, cz);
      grp.add(chPlinth);

      const chBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.32, 0.26), satinClayMat);
      chBody.position.set(chargerX, 0.76, cz);
      chBody.castShadow = true;
      grp.add(chBody);

      const chCap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.22), brushedSilverMat);
      chCap.position.set(chargerX, 1.44, cz);
      grp.add(chCap);

      // 东侧嵌入式熏黑触控屏 + 纵向冰青充电状态灯带 + 琥珀微状态点
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.18), smokedGlassMat);
      screen.position.set(chargerX + 0.15, 1.02, cz);
      grp.add(screen);

      const ledBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.54, 0.045), ledMat);
      ledBar.position.set(chargerX + 0.155, 1.00, cz + 0.115);
      grp.add(ledBar);

      const statusDot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), microAmberMat);
      statusDot.position.set(chargerX + 0.155, 1.32, cz - 0.07);
      grp.add(statusDot);
    }
  }
  return grp;
}

/**
 * 精工智能门岗亭与抬杆道闸（精准坐落于车道外侧石材安全岛上，绝不侵入任何行驶车道！）
 */
function buildParkingGateAssembly({
  kioskPos = null,
  kioskRotY = 0,
  barriers = [],
  satinClayMat,
  darkGraphiteMat,
  brushedSilverMat,
  curbMat,
  frostedGlassMat,
  ledMat,
  microAmberMat,
  boothGlowMat,
}) {
  const grp = new THREE.Group();

  // 1. 迷你建筑级智能门岗亭（缎面陶土灰倒角悬挑檐 + 阳极石墨立柱 + 冰青磨砂全景窗）
  if (kioskPos) {
    const kGrp = new THREE.Group();
    kGrp.position.set(kioskPos[0], ROAD_Y.FIRE_LOT, kioskPos[1]);
    kGrp.rotation.y = kioskRotY;

    // 暖石安全岛底座（下探至世界 y = -0.05m，草坪/路面均严丝合缝贴地）
    const pad = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.28, 1.85), curbMat);
    pad.position.set(0, 0.03, 0);
    pad.receiveShadow = true;
    kGrp.add(pad);

    // 底部围裙壳体
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.88, 1.48), satinClayMat);
    skirt.position.set(0, 0.61, 0);
    skirt.castShadow = true;
    kGrp.add(skirt);

    // 中部冰青磨砂玻璃围合窗
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.04, 1.12, 1.38), frostedGlassMat);
    glass.position.set(0, 1.60, 0);
    kGrp.add(glass);

    // 室内微弱暖光芯（暮光/夜景柔和透光）
    if (boothGlowMat) {
      const inner = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.86, 0.96), boothGlowMat);
      inner.position.set(0, 1.56, 0);
      kGrp.add(inner);
    }

    // 4 根阳极石墨角柱
    for (const sx of [-1.02, 1.02]) {
      for (const sz of [-0.69, 0.69]) {
        const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.16, 0.10), darkGraphiteMat);
        mullion.position.set(sx, 1.60, sz);
        kGrp.add(mullion);
      }
    }

    // 悬挑倒角缎面屋顶（带深石墨阴影退槽与冰青呼吸灯条）
    const reveal = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.10, 1.50), darkGraphiteMat);
    reveal.position.set(0, 2.21, 0);
    kGrp.add(reveal);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.18, 1.96), satinClayMat);
    roof.position.set(0, 2.34, 0);
    roof.castShadow = true;
    kGrp.add(roof);

    const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.05, 1.82), brushedSilverMat);
    roofTrim.position.set(0, 2.45, 0);
    kGrp.add(roofTrim);

    const statusStrip = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.055, 0.05), ledMat);
    statusStrip.position.set(0, 2.34, 0.99);
    kGrp.add(statusStrip);

    grp.add(kGrp);
  }

  // 2. 自动道闸主机与抬升式轻质铝合金拦杆（62° 抬起放行姿态，100% 避让通行车辆）
  for (const b of barriers) {
    const bGrp = new THREE.Group();
    bGrp.position.set(b.x, ROAD_Y.FIRE_LOT, b.z);
    bGrp.rotation.y = b.rotY ?? 0;

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.42), darkGraphiteMat);
    base.position.set(0, 0.00, 0);
    bGrp.add(base);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.96, 0.30), satinClayMat);
    housing.position.set(0, 0.60, 0);
    housing.castShadow = true;
    bGrp.add(housing);

    const topBezel = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.10, 0.32), darkGraphiteMat);
    topBezel.position.set(0, 1.11, 0);
    bGrp.add(topBezel);

    const ledDot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), ledMat);
    ledDot.position.set(0, 0.96, 0);
    bGrp.add(ledDot);

    if (b.hasArm) {
      const armPivot = new THREE.Group();
      armPivot.position.set(0, 0.92, 0);
      // 抬起 64° 保持高净空，同时呈精致工业机械造型
      armPivot.rotation.z = b.armTilt ?? 1.12;

      const armLen = b.armLen ?? 3.4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.075, 0.05), brushedSilverMat);
      arm.position.set(armLen * 0.5, 0, 0);
      armPivot.add(arm);

      const accent = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.082, 0.056), microAmberMat);
      accent.position.set(armLen * 0.72, 0, 0);
      armPivot.add(accent);

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.10, 10), darkGraphiteMat);
      hub.rotation.x = Math.PI / 2;
      armPivot.add(hub);

      bGrp.add(armPivot);
    }

    grp.add(bGrp);
  }

  return grp;
}

/**
 * 北侧地下车库（1BF）入口下沉坡道（修复 R1：正向由东向西下坡 + 深埋挡墙至 -3.50m + 逐柱精确对接斜玻璃雨棚！）
 */
function buildUndergroundGarageRamp({
  satinClayMat,
  darkGraphiteMat,
  brushedSilverMat,
  curbMat,
  rampFloorMat,
  rampGlowMat,
}) {
  const grp = new THREE.Group();
  grp.name = 'GarageRamp_1BF';

  const rx = 59.5;
  const rz = -91.2;
  const rampLen = 20.5;
  const rampW = 7.0;
  const slopeAngle = 0.155; // 正值：东端 (+X) 高于西端 (-X)，车辆由东侧引道平滑下行入地下 1BF！

  const pitWallMat = new THREE.MeshStandardMaterial({ color: '#40464E', roughness: 0.74, metalness: 0.08 });

  // 1. 东侧精简过渡引道（修剪至与坡道/消防环道等宽 6.6m：x ∈ [69.6, 76.2], z ∈ [-105.0, -87.6]）并配倒角暖石侧路缘
  const apronTopY = ROAD_Y.BRANCH_APRON; // 0.058（与 FireRing 0.062 错开 4mm，零 Z-Fighting）
  const apronH = apronTopY + 0.08;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(6.6, apronH, 17.4), rampFloorMat);
  apron.position.set(72.9, apronTopY - apronH * 0.5, -96.3);
  apron.receiveShadow = true;
  grp.add(apron);

  // 引道东/南/西三侧精雕倒角暖石路缘（无缝对接北侧消防环道与坡道混凝土挡墙端头）
  const addRampApronCurb = (cx, cz, pw, pd) => {
    const cTop = ROAD_Y.BRANCH_CURB;
    const cBot = -0.06;
    const cH = cTop - cBot;
    const bev = 0.028;
    const body = new THREE.Mesh(new THREE.BoxGeometry(pw, cH - bev, pd), curbMat);
    body.position.set(cx, cBot + (cH - bev) * 0.5, cz);
    body.receiveShadow = true;
    grp.add(body);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.08, pw - 0.06), bev, Math.max(0.08, pd - 0.06)),
      curbMat
    );
    cap.position.set(cx, cTop - bev * 0.5, cz);
    cap.receiveShadow = true;
    grp.add(cap);
  };
  // 东侧路缘 (z ∈ [-103.10, -87.18]，精准衔接南移后的 FireRing 路缘外沿，零侵占车行道)
  addRampApronCurb(76.41, -95.14, 0.42, 15.92);
  // 南侧收口路缘 (x ∈ [70.0, 76.62]，无缝衔接南挡墙端头)
  addRampApronCurb(73.31, -87.39, 6.62, 0.42);
  // 西侧北段路缘 (z ∈ [-103.50, -94.90]，精准衔接 FireRing 南路缘外沿，零侵占车行道)
  addRampApronCurb(69.39, -99.20, 0.42, 8.60);

  // 2. 正向由东向西下沉车道坡板（东端顶面精准落于 y = +0.058 与引道严丝合缝，西端深入至 y = -3.106）
  const slopeThick = 0.24;
  const yEastOffset = (rampLen * 0.5) * Math.sin(slopeAngle) + (slopeThick * 0.5) * Math.cos(slopeAngle);
  const slopeMidY = apronTopY - yEastOffset; // -1.643

  const slopeMesh = new THREE.Mesh(new THREE.BoxGeometry(rampLen, slopeThick, rampW - 0.44), rampFloorMat);
  slopeMesh.position.set(rx, slopeMidY, rz);
  slopeMesh.rotation.z = slopeAngle;
  slopeMesh.receiveShadow = true;
  grp.add(slopeMesh);

  // 3. 两侧精工清水混凝土挡墙（深入基坑 y = -3.50m 至地面以上 +0.72m，配暖石倒角压顶与斜向防撞暖金灯带）
  const wallBot = -3.50;
  const wallTop = 0.72;
  const wallH = wallTop - wallBot; // 4.22m
  for (const side of [-1, 1]) {
    const wz = rz + side * (rampW * 0.5);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(rampLen + 0.8, wallH, 0.46), curbMat);
    wall.position.set(rx, wallBot + wallH * 0.5, wz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    grp.add(wall);

    // 顶部缎面陶土灰压顶盖板 + 深石墨细缝收边
    const coping = new THREE.Mesh(new THREE.BoxGeometry(rampLen + 0.92, 0.08, 0.54), satinClayMat);
    coping.position.set(rx, wallTop + 0.04, wz);
    coping.receiveShadow = true;
    grp.add(coping);

    // 沿坡道内侧同步倾斜的夜间暖金引导灯条
    if (rampGlowMat) {
      const wallStrip = new THREE.Mesh(new THREE.BoxGeometry(rampLen - 1.4, 0.08, 0.07), rampGlowMat);
      wallStrip.position.set(rx, slopeMidY + 0.52, rz + side * (rampW * 0.5 - 0.25));
      wallStrip.rotation.z = slopeAngle;
      grp.add(wallStrip);
    }
  }

  // 4. 西端地下车库门洞封框（[-3.45, +0.65] 彻底封堵基坑端面）与内透暖光面
  const portalX = rx - rampLen * 0.5;
  const portalBack = new THREE.Mesh(new THREE.BoxGeometry(0.76, 4.10, rampW + 0.5), pitWallMat);
  portalBack.position.set(portalX, -1.40, rz);
  grp.add(portalBack);

  const portalFrameTop = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.24, rampW + 0.6), darkGraphiteMat);
  portalFrameTop.position.set(portalX + 0.08, 0.68, rz);
  grp.add(portalFrameTop);

  if (rampGlowMat) {
    const tunnelMouthGlow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.15, rampW - 1.15), rampGlowMat);
    tunnelMouthGlow.position.set(portalX + 0.46, -1.90, rz);
    grp.add(tunnelMouthGlow);
  }

  // 5. 冰青磨砂玻璃雨棚 + 深石墨金属边框 + 逐根精确计算高度的立柱（0 间隙，0 穿透！）
  const canopyCenterX = rx - 3.6;
  const canopyCenterY = 2.38;
  const canopyTiltZ = -0.07;
  const canopyLenX = 11.6;
  const canopyWidthZ = rampW + 1.2;

  const canopyGlassMat = new THREE.MeshStandardMaterial({
    color: '#7ECAD6',
    emissive: new THREE.Color('#ffbe66'),
    emissiveIntensity: 0.0,
    roughness: 0.14,
    metalness: 0.10,
    transparent: true,
    opacity: 0.48,
    envMapIntensity: 1.25,
  });

  const canopyGrp = new THREE.Group();
  canopyGrp.position.set(canopyCenterX, canopyCenterY, rz);
  canopyGrp.rotation.z = canopyTiltZ;

  const canopyGlass = new THREE.Mesh(new THREE.BoxGeometry(canopyLenX, 0.08, canopyWidthZ), canopyGlassMat);
  canopyGrp.add(canopyGlass);

  // 阳极深石墨雨棚外框与横向龙骨
  for (const sz of [-1, 1]) {
    const sideRail = new THREE.Mesh(new THREE.BoxGeometry(canopyLenX + 0.24, 0.14, 0.14), darkGraphiteMat);
    sideRail.position.set(0, -0.01, sz * (canopyWidthZ * 0.5));
    canopyGrp.add(sideRail);
  }
  for (const sx of [-canopyLenX * 0.5, -2.0, 2.0, canopyLenX * 0.5]) {
    const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, canopyWidthZ + 0.14), darkGraphiteMat);
    crossBeam.position.set(sx, -0.03, 0);
    canopyGrp.add(crossBeam);
  }

  // 雨棚底面嵌入式暖金灯管
  if (rampGlowMat) {
    for (const dx of [-4.0, 0.0, 3.8]) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, rampW - 0.6), rampGlowMat);
      tube.position.set(dx, -0.09, 0);
      canopyGrp.add(tube);
    }
  }
  grp.add(canopyGrp);

  // 逐根精确计算每对立柱高度：底部埋入挡墙压顶 y = 0.72，顶端精准接抵斜雨棚纵梁底面
  const postBaseY = wallTop + 0.02; // 0.74（紧贴压顶盖板）
  const tanCanopy = Math.tan(-canopyTiltZ); // +tan(0.07)
  for (const sx of [-8.8, -4.0, 0.8]) {
    const localDx = sx - -3.6; // 相对雨棚中心 X 偏移
    const glassUnderY = canopyCenterY - localDx * tanCanopy - 0.07;
    const postH = Math.max(0.6, glassUnderY - postBaseY);

    for (const sz of [-1, 1]) {
      const pz = rz + sz * (rampW * 0.5);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.105, postH, 10), darkGraphiteMat);
      post.position.set(rx + sx, postBaseY + postH * 0.5, pz);
      post.castShadow = true;
      grp.add(post);

      const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.08, 10), brushedSilverMat);
      flange.position.set(rx + sx, postBaseY + 0.04, pz);
      grp.add(flange);
    }
  }

  return { group: grp, canopyGlassMat };
}

/**
 * 工业设计级全园区 CNC 路灯系统（全量 InstancedMesh：9 次 Draw Call，0 PointLight！）
 * 参考目标图微缩硬件工艺：
 * 1. 加权双阶倒角基座（y = -0.04m..+0.44m，严格消除草坪/广场/路缘一切悬空，修复 R6）
 * 2. 渐细 12 边阳极深石墨主杆 + 机加工拉丝银法兰颈环
 * 3. 优雅平滑曲臂挑梁
 * 4. 顶部带 5 片 CNC 散热鳍片的倒角流线刀锋灯头外壳
 * 5. 内嵌温润磨砂乳白压克力柔光透镜（日间温润乳白，暮光/星夜 3000K 暖金）
 * 6. 微型冰青硬件状态指示灯点（呼应参考图精致微发光细节）
 * 7. 底座柔和接地 AO 阴影盘 + 夜间羽化地面光池与轻柔体积光锥
 */
function buildRoadStreetlights(streetlightPlacements, maxAnisotropy) {
  const grp = new THREE.Group();
  grp.name = 'RoadStreetlightSystem';
  const count = streetlightPlacements.length;
  if (count === 0) {
    return { group: grp, setDuskFactor() {} };
  }

  const graphiteMat = new THREE.MeshStandardMaterial({
    color: '#333840',
    roughness: 0.38,
    metalness: 0.65,
  });
  const plinthMat = new THREE.MeshStandardMaterial({
    color: '#B6B0A6',
    roughness: 0.56,
    metalness: 0.08,
  });
  const silverCollarMat = new THREE.MeshStandardMaterial({
    color: '#A5ABB3',
    roughness: 0.30,
    metalness: 0.68,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: '#F5EFE4',
    emissive: new THREE.Color('#FFCA7A'),
    emissiveIntensity: 0.14,
    roughness: 0.24,
    metalness: 0.02,
  });
  const ledDotMat = new THREE.MeshStandardMaterial({
    color: '#7CEEF8',
    emissive: new THREE.Color('#38E8F8'),
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });

  const aoTex = createContactShadowTexture(Math.min(maxAnisotropy, 4));
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    transparent: true,
    opacity: 0.31,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
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

  // 1. 加权倒角双阶石材基座（绝对局部 Y 从 -0.04 到 +0.20，无论落于 0.00 草坪、0.072 广场或 0.085 路缘均牢牢扎根！）
  const plinthGeo = (() => {
    const lower = new THREE.CylinderGeometry(0.24, 0.29, 0.20, 8);
    lower.rotateY(Math.PI / 8);
    lower.translate(0, 0.06, 0); // [-0.04, +0.16]
    const bevelTop = new THREE.CylinderGeometry(0.19, 0.24, 0.06, 8);
    bevelTop.rotateY(Math.PI / 8);
    bevelTop.translate(0, 0.19, 0); // [+0.16, +0.22]
    return mergeIndexedParts([lower, bevelTop]);
  })();

  // 2. 渐细 12 边阳极石墨主杆（含底部加厚套筒，单位高度 y ∈ [0, 1]）
  const poleGeo = (() => {
    const boot = new THREE.CylinderGeometry(0.145, 0.175, 0.06, 12);
    boot.translate(0, 0.03, 0);
    const shaft = new THREE.CylinderGeometry(0.076, 0.132, 0.96, 12);
    shaft.translate(0, 0.52, 0);
    return mergeIndexedParts([boot, shaft]);
  })();

  // 3. 拉丝银法兰装饰环（底环 + 杆顶转接环）
  const collarGeo = new THREE.CylinderGeometry(0.115, 0.138, 0.14, 12);

  // 4. 优雅平滑曲臂挑梁（局部 +X 朝道路内侧弯曲悬挑 1.92m）
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 0.0, 0),
    new THREE.Vector3(0.16, 0.54, 0),
    new THREE.Vector3(0.74, 0.92, 0),
    new THREE.Vector3(1.88, 0.96, 0),
  ]);
  const armGeo = new THREE.TubeGeometry(armCurve, 14, 0.055, 8, false);

  // 5. CNC 散热鳍片倒角流线灯头外壳（ExtrudeGeometry 倒角壳体 + 5 片横向精密散热鳍片）
  const housingGeo = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.46, -0.05);
    shape.lineTo(0.42, -0.05);
    shape.quadraticCurveTo(0.54, -0.04, 0.52, 0.02);
    shape.lineTo(0.32, 0.085);
    shape.lineTo(-0.36, 0.085);
    shape.quadraticCurveTo(-0.52, 0.06, -0.46, -0.05);

    const body = new THREE.ExtrudeGeometry(shape, {
      depth: 0.34,
      curveSegments: 4,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.028,
      bevelThickness: 0.028,
    });
    body.translate(0, 0, -0.17);

    // 顶部 5 片精密 CNC 散热鳍片（微缩硬件质感点睛！）
    const parts = [body];
    for (let f = 0; f < 5; f++) {
      const fx = -0.26 + f * 0.13;
      const fin = new THREE.BoxGeometry(0.042, 0.048, 0.30);
      fin.translate(fx, 0.118, 0);
      parts.push(fin);
    }
    // 尾部连接套筒
    const neck = new THREE.CylinderGeometry(0.068, 0.072, 0.22, 8);
    neck.rotateZ(Math.PI / 2);
    neck.translate(-0.50, 0.005, 0);
    parts.push(neck);
    return mergeIndexedParts(parts);
  })();

  // 6. 底部内嵌磨砂乳白压克力柔光透镜（带圆润边角）
  const lensGeo = (() => {
    const lShape = new THREE.Shape();
    const lw = 0.36;
    const ld = 0.125;
    const r = 0.045;
    lShape.moveTo(-lw + r, -ld);
    lShape.lineTo(lw - r, -ld);
    lShape.quadraticCurveTo(lw, -ld, lw, -ld + r);
    lShape.lineTo(lw, ld - r);
    lShape.quadraticCurveTo(lw, ld, lw - r, ld);
    lShape.lineTo(-lw + r, ld);
    lShape.quadraticCurveTo(-lw, ld, -lw, ld - r);
    lShape.lineTo(-lw, -ld + r);
    lShape.quadraticCurveTo(-lw, -ld, -lw + r, -ld);

    const g = new THREE.ExtrudeGeometry(lShape, {
      depth: 0.04,
      curveSegments: 3,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.014,
      bevelThickness: 0.014,
    });
    g.rotateX(Math.PI / 2);
    return g;
  })();

  // 7. 灯头侧脊冰青微型状态指示灯点（双面可见）
  const ledDotGeo = new THREE.BoxGeometry(0.14, 0.032, 0.415);

  const aoGeo = new THREE.PlaneGeometry(1, 1);
  aoGeo.rotateX(-Math.PI / 2);

  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);

  const coneGeo = new THREE.CylinderGeometry(0.24, 3.1, 1.0, 10, 1, true);
  coneGeo.translate(0, -0.5, 0);

  const plinthInst = new THREE.InstancedMesh(plinthGeo, plinthMat, count);
  const poleInst = new THREE.InstancedMesh(poleGeo, graphiteMat, count);
  const collarInst = new THREE.InstancedMesh(collarGeo, silverCollarMat, count * 2);
  const armInst = new THREE.InstancedMesh(armGeo, graphiteMat, count);
  const housingInst = new THREE.InstancedMesh(housingGeo, graphiteMat, count);
  const lensInst = new THREE.InstancedMesh(lensGeo, lensMat, count);
  const ledDotInst = new THREE.InstancedMesh(ledDotGeo, ledDotMat, count);
  const aoInst = new THREE.InstancedMesh(aoGeo, aoMat, count);
  const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, count);
  const coneInst = new THREE.InstancedMesh(coneGeo, coneMat, count);

  poleInst.castShadow = false;
  poleInst.receiveShadow = true;
  plinthInst.receiveShadow = true;
  aoInst.renderOrder = 1;

  const dummy = new THREE.Object3D();
  streetlightPlacements.forEach((sl, i) => {
    const s = sl.scale ?? 1.0;
    const poleH = 6.0 * s;
    const surfY = sl.surfY ?? 0.0;
    const rotY = sl.rotY;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const dirX = cosY;
    const dirZ = -sinY;

    // 1. 加权倒角基座（始终以世界 y = 0 为基准向下埋深 -0.04m，上方高出至 +0.22m）
    dummy.position.set(sl.x, 0, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s, 1.0, s);
    dummy.updateMatrix();
    plinthInst.setMatrixAt(i, dummy.matrix);

    // 2. 主杆（稳坐于石材基座顶部 y = 0.21m）
    const poleBaseY = 0.21;
    dummy.position.set(sl.x, poleBaseY, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s, poleH, s);
    dummy.updateMatrix();
    poleInst.setMatrixAt(i, dummy.matrix);

    // 3. 底部与顶部两枚拉丝银法兰装饰环
    dummy.position.set(sl.x, poleBaseY + 0.28 * s, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s * 1.08, s, s * 1.08);
    dummy.updateMatrix();
    collarInst.setMatrixAt(i * 2, dummy.matrix);

    dummy.position.set(sl.x, poleBaseY + poleH - 0.06 * s, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s * 0.78, s * 0.9, s * 0.78);
    dummy.updateMatrix();
    collarInst.setMatrixAt(i * 2 + 1, dummy.matrix);

    // 4. 优雅曲臂（衔接杆顶银环）
    dummy.position.set(sl.x, poleBaseY + poleH - 0.04 * s, sl.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    armInst.setMatrixAt(i, dummy.matrix);

    // 5. CNC 散热鳍片灯头 + 柔光透镜 + 微型冰青 LED 状态点
    const headX = sl.x + dirX * 1.98 * s;
    const headZ = sl.z + dirZ * 1.98 * s;
    const headY = poleBaseY + poleH + 0.92 * s;

    dummy.position.set(headX, headY, headZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    housingInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(headX + dirX * 0.02 * s, headY - 0.048 * s, headZ + dirZ * 0.02 * s);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    lensInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(headX - dirX * 0.14 * s, headY + 0.015 * s, headZ - dirZ * 0.14 * s);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    ledDotInst.setMatrixAt(i, dummy.matrix);

    // 6. 柔和接地 AO 阴影贴花（贴合真实支撑面 +0.015m）
    dummy.position.set(sl.x, surfY + 0.015, sl.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.75 * s, 1, 1.75 * s);
    dummy.updateMatrix();
    aoInst.setMatrixAt(i, dummy.matrix);

    // 7. 羽化道路光晕池（略高于道路顶面，绝不与车底阴影/路面闪烁）
    const poolX = sl.x + dirX * (sl.poolReach ?? 2.6 * s);
    const poolZ = sl.z + dirZ * (sl.poolReach ?? 2.6 * s);
    const poolW = (sl.poolSize ?? 12.2) * s;
    const poolL = (sl.poolSize ?? 14.4) * s;
    const roadTopY = sl.roadTopY ?? ROAD_Y.FIRE_LOT;
    dummy.position.set(poolX, roadTopY + 0.015, poolZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(poolW, 1, poolL);
    dummy.updateMatrix();
    poolInst.setMatrixAt(i, dummy.matrix);

    // 8. 柔和羽化体积微光锥
    const coneH = Math.max(2.5, headY - roadTopY - 0.35);
    dummy.position.set(headX, headY - 0.08 * s, headZ);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(s * 0.95, coneH, s * 0.95);
    dummy.updateMatrix();
    coneInst.setMatrixAt(i, dummy.matrix);
  });

  plinthInst.instanceMatrix.needsUpdate = true;
  poleInst.instanceMatrix.needsUpdate = true;
  collarInst.instanceMatrix.needsUpdate = true;
  armInst.instanceMatrix.needsUpdate = true;
  housingInst.instanceMatrix.needsUpdate = true;
  lensInst.instanceMatrix.needsUpdate = true;
  ledDotInst.instanceMatrix.needsUpdate = true;
  aoInst.instanceMatrix.needsUpdate = true;
  poolInst.instanceMatrix.needsUpdate = true;
  coneInst.instanceMatrix.needsUpdate = true;

  grp.add(
    plinthInst,
    poleInst,
    collarInst,
    armInst,
    housingInst,
    lensInst,
    ledDotInst,
    aoInst,
    poolInst,
    coneInst
  );

  return {
    group: grp,
    setDuskFactor(dusk, night = dusk) {
      const active = dusk > 0.005;
      lensMat.emissiveIntensity = 0.14 + dusk * 2.9 + night * 1.35;
      ledDotMat.emissiveIntensity = 1.35 + dusk * 1.2 + night * 0.85;
      aoMat.opacity = THREE.MathUtils.lerp(0.31, 0.12, dusk);
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
  roadTopY = ROAD_Y.FIRE_LOT,
  spacing = 28,
  staggerSides = true,
  fixedSide = null,
  poleScale = 1.0,
  startMargin = 12,
  endMargin = 12,
  skipFn = null,
}) {
  const vecs = controlPoints.map(([x, z]) => {
    const [cx, cz] = clampVertexToPlinth(x, z);
    return new THREE.Vector3(cx, 0, cz);
  });
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.32);
  const totalLen = curve.getLength();
  if (totalLen <= startMargin + endMargin) return [];

  const hw = PLINTH_CONFIG.width * 0.5 - 5.5;
  const hd = PLINTH_CONFIG.depth * 0.5 - 5.5;
  const curbOffset = roadWidth * 0.5 + 0.88;
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

    const inX = -right.x * side;
    const inZ = -right.z * side;
    const rotY = Math.atan2(-inZ, inX);

    samples.push({
      x: px,
      z: pz,
      rotY,
      surfY: 0.0,
      roadTopY,
      scale: poleScale,
      poolReach: Math.min(roadWidth * 0.38, 3.2 * poleScale),
      poolSize: roadWidth >= 14 ? 13.8 : 10.2,
    });
  }
  return samples;
}

/**
 * 精工倒角停车场石材路缘框生成器（支持单边或多边开口预留进出车喉道及人行通道）
 */
function addChamferedLotCurbs(group, { cx, cz, w, d, topY = ROAD_Y.FIRE_CURB, curbMat, openGap = null, openGaps = null }) {
  const t = 0.44;
  const botY = -0.06;
  const h = topY - botY;
  const yMid = botY + h * 0.5;
  const bevH = 0.032;

  const gaps = openGaps ? [...openGaps] : openGap ? [openGap] : [];
  const gapFor = (side) => gaps.find((g) => g.side === side) || null;

  // 带顶部倒角收边的单段路缘条
  const addCurbBar = (px, pz, pw, pd) => {
    if (pw <= 0.1 || pd <= 0.1) return;
    const body = new THREE.Mesh(new THREE.BoxGeometry(pw, h - bevH, pd), curbMat);
    body.position.set(px, yMid - bevH * 0.5, pz);
    body.receiveShadow = true;
    group.add(body);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.08, pw - 0.06), bevH, Math.max(0.08, pd - 0.06)),
      curbMat
    );
    cap.position.set(px, topY - bevH * 0.5, pz);
    cap.receiveShadow = true;
    group.add(cap);
  };

  const xMin = cx - w * 0.5;
  const xMax = cx + w * 0.5;
  const zMin = cz - d * 0.5;
  const zMax = cz + d * 0.5;

  // 北侧 (zMin)
  const northGap = gapFor('north');
  if (northGap) {
    const g0 = northGap.min;
    const g1 = northGap.max;
    addCurbBar((xMin - t + g0) * 0.5, zMin - t * 0.5, g0 - (xMin - t), t);
    addCurbBar((g1 + xMax + t) * 0.5, zMin - t * 0.5, xMax + t - g1, t);
  } else {
    addCurbBar(cx, zMin - t * 0.5, w + t * 2, t);
  }

  // 南侧 (zMax)
  const southGap = gapFor('south');
  if (southGap) {
    const g0 = southGap.min;
    const g1 = southGap.max;
    addCurbBar((xMin - t + g0) * 0.5, zMax + t * 0.5, g0 - (xMin - t), t);
    addCurbBar((g1 + xMax + t) * 0.5, zMax + t * 0.5, xMax + t - g1, t);
  } else {
    addCurbBar(cx, zMax + t * 0.5, w + t * 2, t);
  }

  // 西侧 (xMin)
  const westGap = gapFor('west');
  if (westGap) {
    const g0 = westGap.min;
    const g1 = westGap.max;
    addCurbBar(xMin - t * 0.5, (zMin + g0) * 0.5, t, g0 - zMin);
    addCurbBar(xMin - t * 0.5, (g1 + zMax) * 0.5, t, zMax - g1);
  } else {
    addCurbBar(xMin - t * 0.5, cz, t, d);
  }

  // 东侧 (xMax)
  const eastGap = gapFor('east');
  if (eastGap) {
    const g0 = eastGap.min;
    const g1 = eastGap.max;
    addCurbBar(xMax + t * 0.5, (zMin + g0) * 0.5, t, g0 - zMin);
    addCurbBar(xMax + t * 0.5, (g1 + zMax) * 0.5, t, zMax - g1);
  } else {
    addCurbBar(xMax + t * 0.5, cz, t, d);
  }
}

/**
 * 建筑级圆角跑道形（Stadium / Rounded-Rect）倒角暖石种植岛（严格还原北迎宾大道南北双岛）
 */
function buildRoundedRectIsland({ cx, cz, width, length, radius, curbMat, turfMat }) {
  const grp = new THREE.Group();
  const makeRR = (w, l, r) => {
    const hw = w * 0.5;
    const hl = l * 0.5;
    const rr = Math.min(r, hw - 0.05, hl - 0.05);
    const s = new THREE.Shape();
    s.moveTo(-hw + rr, -hl);
    s.lineTo(hw - rr, -hl);
    s.quadraticCurveTo(hw, -hl, hw, -hl + rr);
    s.lineTo(hw, hl - rr);
    s.quadraticCurveTo(hw, hl, hw - rr, hl);
    s.lineTo(-hw + rr, hl);
    s.quadraticCurveTo(-hw, hl, -hw, hl - rr);
    s.lineTo(-hw, -hl + rr);
    s.quadraticCurveTo(-hw, -hl, -hw + rr, -hl);
    return s;
  };

  const curbGeo = new THREE.ExtrudeGeometry(makeRR(width, length, radius), {
    depth: 0.21,
    curveSegments: 10,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.035,
    bevelThickness: 0.03,
  });
  curbGeo.rotateX(-Math.PI / 2);
  const curbMesh = new THREE.Mesh(curbGeo, curbMat);
  curbMesh.position.set(cx, -0.04, cz);
  curbMesh.receiveShadow = true;
  grp.add(curbMesh);

  const turfGeo = new THREE.ExtrudeGeometry(makeRR(width - 0.62, length - 0.62, Math.max(0.2, radius - 0.31)), {
    depth: 0.16,
    curveSegments: 10,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.025,
    bevelThickness: 0.02,
  });
  turfGeo.rotateX(-Math.PI / 2);
  const turfMesh = new THREE.Mesh(turfGeo, turfMat);
  turfMesh.position.set(cx, 0.06, cz);
  turfMesh.receiveShadow = true;
  grp.add(turfMesh);

  return grp;
}

/**
 * 市政主干道中央绿化分隔带生成器（严格对齐 KKAA 总平图中关村大道双向六车道分幅断面）
 * - 在交叉口与园区西出入口自动断口封端，并于 d_out ∈ [18m, 30m] 平滑沉降消隐入路面
 */
function buildArterialMedianStrip({
  controlPoints,
  halfWidth = 0.90,
  segments = 160,
  roadTopY = ROAD_Y.ZGC,
  curbTopY = ROAD_Y.ZGC_CURB + 0.085,
  maxOutDist = 30,
  suppressFn = null,
  curbMat,
  turfMat,
}) {
  const grp = new THREE.Group();
  const vecs = controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.32);
  const pts = curve.getSpacedPoints(segments);
  const count = pts.length;
  const rights = [];
  for (let i = 0; i < count; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(count - 1, i + 1)];
    const tan = new THREE.Vector3().subVectors(next, prev).normalize();
    rights.push(new THREE.Vector3(-tan.z, 0, tan.x).normalize());
  }

  const activeSeg = new Array(count - 1).fill(true);
  for (let i = 0; i < count - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) * 0.5;
    const mz = (pts[i].z + pts[i + 1].z) * 0.5;
    if (calcCampusOutDist(mx, mz) > maxOutDist || (suppressFn && suppressFn(mx, mz))) {
      activeSeg[i] = false;
    }
  }

  const runs = [];
  let s = -1;
  for (let i = 0; i < count - 1; i++) {
    if (activeSeg[i] && s === -1) s = i;
    if (!activeSeg[i] && s !== -1) {
      runs.push([s, i]);
      s = -1;
    }
  }
  if (s !== -1) runs.push([s, count - 1]);

  const buildStripMesh = (hw, topHeight, botY, mat) => {
    const positions = [];
    const indices = [];
    const pCount = 6;
    const baseBev = 0.03;

    for (const [startIdx, endIdx] of runs) {
      if (endIdx - startIdx < 2) continue;
      const baseV = positions.length / 3;
      const runLen = endIdx - startIdx + 1;

      for (let i = startIdx; i <= endIdx; i++) {
        const p = pts[i];
        const r = rights[i];
        const dOut = calcCampusOutDist(p.x, p.z);
        const taper = smoothstep01(maxOutDist - 12.0, maxOutDist, dOut);
        const localTop = topHeight * (1 - taper) + (roadTopY - 0.015) * taper;
        const localBev = baseBev * (1 - taper);
        const profile = [
          [-hw, botY],
          [-hw, localTop - localBev],
          [-hw + localBev, localTop],
          [hw - localBev, localTop],
          [hw, localTop - localBev],
          [hw, botY],
        ];
        for (let k = 0; k < pCount; k++) {
          const [off, py] = profile[k];
          positions.push(p.x + r.x * off, py, p.z + r.z * off);
        }
      }

      for (let i = 0; i < runLen - 1; i++) {
        const rowA = baseV + i * pCount;
        const rowB = baseV + (i + 1) * pCount;
        for (let k = 0; k < pCount - 1; k++) {
          const a = rowA + k;
          const b = rowA + k + 1;
          const c = rowB + k;
          const d = rowB + k + 1;
          indices.push(a, b, c, b, d, c);
        }
      }

      const sRow = baseV;
      indices.push(
        sRow, sRow + 2, sRow + 1,
        sRow, sRow + 3, sRow + 2,
        sRow, sRow + 4, sRow + 3,
        sRow, sRow + 5, sRow + 4
      );
      const eRow = baseV + (runLen - 1) * pCount;
      indices.push(
        eRow, eRow + 1, eRow + 2,
        eRow, eRow + 2, eRow + 3,
        eRow, eRow + 3, eRow + 4,
        eRow, eRow + 4, eRow + 5
      );
    }

    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  };

  const curbMesh = buildStripMesh(halfWidth, curbTopY, roadTopY - 0.04, curbMat);
  const turfMesh = buildStripMesh(halfWidth - 0.24, curbTopY + 0.03, roadTopY, turfMat);
  if (curbMesh) grp.add(curbMesh);
  if (turfMesh) grp.add(turfMesh);
  return grp;
}

/**
 * 2D 射线/直线交点：pA + t*dA = pB + u*dB
 */
function intersectLines2D(ax, az, dax, daz, bx, bz, dbx, dbz) {
  const det = dax * dbz - daz * dbx;
  if (Math.abs(det) < 1e-6) return [ax, az];
  const dx = bx - ax;
  const dz = bz - az;
  const t = (dx * dbz - dz * dbx) / det;
  return [ax + t * dax, az + t * daz];
}

/**
 * 精工倒角弧形转角路缘返回段（沿二次贝塞尔转角无缝衔接交叉口两端直路缘）
 */
function buildCornerCurbReturnArc(p0, pCtrl, p1, { curbWidth = 0.42, topY = ROAD_Y.ZGC_CURB, botY = -0.06, mat, steps = 10 }) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const omt = 1 - t;
    pts.push([
      omt * omt * p0[0] + 2 * omt * t * pCtrl[0] + t * t * p1[0],
      omt * omt * p0[1] + 2 * omt * t * pCtrl[1] + t * t * p1[1],
    ]);
  }

  // 外侧方向指向控制点 pCtrl（草坪侧）
  const mid = pts[Math.floor(steps * 0.5)];
  const toCtrlX = pCtrl[0] - mid[0];
  const toCtrlZ = pCtrl[1] - mid[1];

  const positions = [];
  const indices = [];
  const pCount = 6;
  const bev = 0.03;

  for (let i = 0; i <= steps; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(steps, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tLen = Math.hypot(tx, tz) || 1;
    tx /= tLen;
    tz /= tLen;
    // 单位法线指向草坪外侧（与 toCtrl 同向）
    let nx = -tz;
    let nz = tx;
    if (nx * toCtrlX + nz * toCtrlZ < 0) {
      nx = -nx;
      nz = -nz;
    }
    const profile = [
      [0, botY],
      [0, topY - bev],
      [bev, topY],
      [curbWidth - bev, topY],
      [curbWidth, topY - bev],
      [curbWidth, botY],
    ];
    for (let k = 0; k < pCount; k++) {
      const [off, py] = profile[k];
      positions.push(pts[i][0] + nx * off, py, pts[i][1] + nz * off);
    }
  }

  // 确保法线朝外：检查首段绕序
  const t0x = pts[1][0] - pts[0][0];
  const t0z = pts[1][1] - pts[0][1];
  const nx0 = -t0z;
  const nz0 = t0x;
  const flip = nx0 * toCtrlX + nz0 * toCtrlZ < 0;

  for (let i = 0; i < steps; i++) {
    const rowA = i * pCount;
    const rowB = (i + 1) * pCount;
    for (let k = 0; k < pCount - 1; k++) {
      const a = rowA + k;
      const b = rowA + k + 1;
      const c = rowB + k;
      const d = rowB + k + 1;
      if (!flip) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 市政十字 / T 型精细交叉口生成器（定向圆角切角沥青垫层 + 转角弧形路缘 + 4 方向斑马线与停车线！）
 */
function buildArterialIntersection({
  cx,
  cz,
  dirA, // [ax, az] 单位向量（主干道 A）
  halfWA,
  roadTopYA,
  dirB, // [bx, bz] 单位向量（交叉道路 B，T 型路口指向支路方向）
  halfWB,
  roadTopYB,
  isTJunction = false,
  filletR = 4.5,
  topY = ROAD_Y.JUNCTION,
  curbTopY = ROAD_Y.ZGC_CURB,
  junctionMat,
  curbMat,
  markingMat,
}) {
  const grp = new THREE.Group();
  const [ax, az] = dirA;
  const [bx, bz] = dirB;
  const nAx = -az;
  const nAz = ax;
  const nBx = -bz;
  const nBz = bx;

  // 辅助：放置垂直于给定道路方向的斑马线 + 白色实线停止线
  const addApproachMarkings = (dx, dz, halfW, legDist, markTopY) => {
    const rotY = Math.atan2(dx, dz);
    const xwX = cx + dx * legDist;
    const xwZ = cz + dz * legDist;
    const stripes = Math.max(6, Math.round((halfW * 2 - 2.2) / 1.45));
    grp.add(
      buildCrosswalkStripes({
        x: xwX,
        z: xwZ,
        width: halfW * 2 - 2.2,
        length: 3.2,
        stripes,
        rotY,
        topY: markTopY,
        mat: markingMat,
      })
    );
    // 停止线位于斑马线外侧 2.5m，仅覆盖右侧来车半幅车道
    const stopDist = legDist + 2.55;
    const rightX = -dz;
    const rightZ = dx;
    // 注意来车方向为 -dir，右侧车道偏向 +(-right) = (dz, -dx)
    const laneCenterShift = halfW * 0.5;
    const sx = cx + dx * stopDist + rightX * laneCenterShift;
    const sz = cz + dz * stopDist + rightZ * laneCenterShift;
    const stopBar = new THREE.Mesh(new THREE.BoxGeometry(halfW - 1.2, 0.006, 0.36), markingMat);
    stopBar.position.set(sx, markTopY + 0.004, sz);
    stopBar.rotation.y = rotY;
    stopBar.receiveShadow = true;
    grp.add(stopBar);
  };

  // 计算交叉口精确多边形轮廓（XZ 平面，shape Y = -Z）
  const corners = [];
  if (!isTJunction) {
    // 4 个象限的精确路缘交点与转角圆弧切点
    const quads = [
      { sA: 1, sB: 1 },
      { sA: -1, sB: 1 },
      { sA: -1, sB: -1 },
      { sA: 1, sB: -1 },
    ];
    const cornerData = quads.map(({ sA, sB }) => {
      // 道路 A 的 sA 侧边线与道路 B 的 sB 侧边线交点
      const cPt = intersectLines2D(
        cx + nAx * sA * halfWA,
        cz + nAz * sA * halfWA,
        ax,
        az,
        cx + nBx * sB * halfWB,
        cz + nBz * sB * halfWB,
        bx,
        bz
      );
      // 从中心到交点的投影决定沿 A/B 外伸方向
      const vcx = cPt[0] - cx;
      const vcz = cPt[1] - cz;
      const signAlongA = vcx * ax + vcz * az >= 0 ? 1 : -1;
      const signAlongB = vcx * bx + vcz * bz >= 0 ? 1 : -1;
      const tA = [cPt[0] + signAlongA * ax * filletR, cPt[1] + signAlongA * az * filletR];
      const tB = [cPt[0] + signAlongB * bx * filletR, cPt[1] + signAlongB * bz * filletR];
      return { cPt, tA, tB, ang: Math.atan2(cPt[1] - cz, cPt[0] - cx) };
    });

    // 按围绕中心逆时针排序构成连续光滑圆角交叉口轮廓
    cornerData.sort((u, v) => u.ang - v.ang);
    const polyPts = [];
    for (const cd of cornerData) {
      // 判断 tA 和 tB 哪个角度更小，保证沿逆时针顺序连接
      const angA = Math.atan2(cd.tA[1] - cz, cd.tA[0] - cx);
      const angB = Math.atan2(cd.tB[1] - cz, cd.tB[0] - cx);
      let dAng = angB - angA;
      while (dAng > Math.PI) dAng -= Math.PI * 2;
      while (dAng < -Math.PI) dAng += Math.PI * 2;
      const first = dAng >= 0 ? cd.tA : cd.tB;
      const second = dAng >= 0 ? cd.tB : cd.tA;

      const arcSteps = 8;
      for (let i = 0; i <= arcSteps; i++) {
        const t = i / arcSteps;
        const omt = 1 - t;
        polyPts.push([
          omt * omt * first[0] + 2 * omt * t * cd.cPt[0] + t * t * second[0],
          omt * omt * first[1] + 2 * omt * t * cd.cPt[1] + t * t * second[1],
        ]);
      }

      // 弧形转角倒角暖石路缘
      grp.add(
        buildCornerCurbReturnArc(first, cd.cPt, second, {
          curbWidth: 0.42,
          topY: curbTopY,
          mat: curbMat,
          steps: 10,
        })
      );
      corners.push(cd);
    }

    // 挤压交叉口实心深石板沥青垫层
    const shape = new THREE.Shape();
    shape.moveTo(polyPts[0][0], -polyPts[0][1]);
    for (let i = 1; i < polyPts.length; i++) {
      shape.lineTo(polyPts[i][0], -polyPts[i][1]);
    }
    shape.closePath();
    const padH = topY + 0.06;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: padH, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const padMesh = new THREE.Mesh(geo, junctionMat);
    padMesh.position.y = topY - padH;
    padMesh.receiveShadow = true;
    grp.add(padMesh);

    // 计算四方向斑马线安全退距（严格落在圆角垫层之外，零 Z-Fighting）
    let maxProjA = 0;
    let maxProjB = 0;
    for (const pt of polyPts) {
      const px = pt[0] - cx;
      const pz = pt[1] - cz;
      maxProjA = Math.max(maxProjA, Math.abs(px * ax + pz * az));
      maxProjB = Math.max(maxProjB, Math.abs(px * bx + pz * bz));
    }
    addApproachMarkings(ax, az, halfWA, maxProjA + 2.3, roadTopYA);
    addApproachMarkings(-ax, -az, halfWA, maxProjA + 2.3, roadTopYA);
    addApproachMarkings(bx, bz, halfWB, maxProjB + 2.3, roadTopYB);
    addApproachMarkings(-bx, -bz, halfWB, maxProjB + 2.3, roadTopYB);
  } else {
    // T 型路口（如平陵西路 × 北迎宾大道）：主干道北缘完全齐平零外凸，南侧双角优雅圆弧展宽
    // 确定哪一侧法线 nA 指向支路 dirB（南侧）
    const southSign = nAx * bx + nAz * bz >= 0 ? 1 : -1;
    const sNx = nAx * southSign;
    const sNz = nAz * southSign;

    // 支路西/东边线与主干道南边线的 2 个转角交点
    const c1 = intersectLines2D(
      cx + sNx * halfWA,
      cz + sNz * halfWA,
      ax,
      az,
      cx + nBx * halfWB,
      cz + nBz * halfWB,
      bx,
      bz
    );
    const c2 = intersectLines2D(
      cx + sNx * halfWA,
      cz + sNz * halfWA,
      ax,
      az,
      cx - nBx * halfWB,
      cz - nBz * halfWB,
      bx,
      bz
    );

    const buildTCorner = (cPt) => {
      const vcx = cPt[0] - cx;
      const vcz = cPt[1] - cz;
      const signAlongA = vcx * ax + vcz * az >= 0 ? 1 : -1;
      const tA = [cPt[0] + signAlongA * ax * filletR, cPt[1] + signAlongA * az * filletR];
      const tB = [cPt[0] + bx * filletR, cPt[1] + bz * filletR];
      return { cPt, tA, tB, signAlongA };
    };
    const tc1 = buildTCorner(c1);
    const tc2 = buildTCorner(c2);
    const leftC = tc1.signAlongA < 0 ? tc1 : tc2;
    const rightC = tc1.signAlongA < 0 ? tc2 : tc1;

    // 主干道北缘两角与左右 tA 对齐投影到主干道北边线（零外凸！）
    const projToNorth = (pt) => {
      const along = (pt[0] - cx) * ax + (pt[1] - cz) * az;
      return [cx + ax * along - sNx * halfWA, cz + az * along - sNz * halfWA];
    };
    const nLeft = projToNorth(leftC.tA);
    const nRight = projToNorth(rightC.tA);

    const polyPts = [nLeft, nRight];
    const pushQuad = (p0, pc, p1) => {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const omt = 1 - t;
        polyPts.push([
          omt * omt * p0[0] + 2 * omt * t * pc[0] + t * t * p1[0],
          omt * omt * p0[1] + 2 * omt * t * pc[1] + t * t * p1[1],
        ]);
      }
    };
    pushQuad(rightC.tA, rightC.cPt, rightC.tB);
    pushQuad(leftC.tB, leftC.cPt, leftC.tA);

    const shape = new THREE.Shape();
    shape.moveTo(polyPts[0][0], -polyPts[0][1]);
    for (let i = 1; i < polyPts.length; i++) {
      shape.lineTo(polyPts[i][0], -polyPts[i][1]);
    }
    shape.closePath();
    const padH = topY + 0.06;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: padH, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const padMesh = new THREE.Mesh(geo, junctionMat);
    padMesh.position.y = topY - padH;
    padMesh.receiveShadow = true;
    grp.add(padMesh);

    grp.add(
      buildCornerCurbReturnArc(leftC.tA, leftC.cPt, leftC.tB, { curbWidth: 0.42, topY: curbTopY, mat: curbMat, steps: 10 }),
      buildCornerCurbReturnArc(rightC.tA, rightC.cPt, rightC.tB, { curbWidth: 0.42, topY: curbTopY, mat: curbMat, steps: 10 })
    );
  }

  return grp;
}

/**
 * 批量停车场混凝土轮挡（全量 InstancedMesh：2 次 Draw Call）
 */
function buildConcreteWheelStops(placements, wheelStopMat, darkGraphiteMat) {
  const grp = new THREE.Group();
  grp.name = 'ParkingWheelStops';
  const count = placements.length;
  if (count === 0) return grp;

  // 梯形倒角混凝土轮挡截面（沿局部 Z 轴长 1.72m，局部 X 轴厚 0.18m，高 0.125m）
  const stopShape = new THREE.Shape();
  stopShape.moveTo(-0.09, 0);
  stopShape.lineTo(0.09, 0);
  stopShape.lineTo(0.06, 0.125);
  stopShape.lineTo(-0.06, 0.125);
  stopShape.closePath();

  const bodyGeo = new THREE.ExtrudeGeometry(stopShape, {
    depth: 1.66,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.015,
    bevelThickness: 0.015,
  });
  bodyGeo.translate(0, 0, -0.83);

  const stripeGeo = new THREE.BoxGeometry(0.135, 0.024, 0.44);
  stripeGeo.translate(0, 0.128, 0);

  const bodyInst = new THREE.InstancedMesh(bodyGeo, wheelStopMat, count);
  const stripeInst = new THREE.InstancedMesh(stripeGeo, darkGraphiteMat, count);
  bodyInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  placements.forEach((wp, i) => {
    dummy.position.set(wp.x, ROAD_Y.FIRE_LOT, wp.z);
    dummy.rotation.set(0, wp.rotY ?? 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bodyInst.setMatrixAt(i, dummy.matrix);
    stripeInst.setMatrixAt(i, dummy.matrix);
  });
  bodyInst.instanceMatrix.needsUpdate = true;
  stripeInst.instanceMatrix.needsUpdate = true;

  grp.add(bodyInst, stripeInst);
  return grp;
}

export function buildRoadsAndParking(maxAnisotropy = 8) {
  const group = new THREE.Group();
  group.name = 'RoadsAndParking';

  const arterialTex = createAsphaltRoadTexture('arterial', maxAnisotropy);
  const campusTex = createAsphaltRoadTexture('campus', maxAnisotropy);
  const fireTex = createAsphaltRoadTexture('firelane', maxAnisotropy);
  const plazaTex = createPlazaPaverTexture(maxAnisotropy);
  const solarTex = createSolarPanelTexture(maxAnisotropy);
  const junctionTex = createInlineSlateAsphaltTexture('#404750', maxAnisotropy);
  const lotPatchTex = createInlineSlateAsphaltTexture('#565D67', maxAnisotropy);
  const walkwayTex = createInlineWalkwayStoneTexture(maxAnisotropy);

  // 严格对齐 @env-clouds #38 翠绿航拍质感与深石板沥青/自然暖灰路缘规范
  const arterialMat = new THREE.MeshStandardMaterial({ map: arterialTex, roughness: 0.78, metalness: 0.04 });
  const arterialFadeMat = createBoundlessArterialFadeMaterial(arterialMat);
  const campusRoadMat = new THREE.MeshStandardMaterial({ map: campusTex, roughness: 0.78, metalness: 0.04 });
  const fireRoadMat = new THREE.MeshStandardMaterial({ map: fireTex, roughness: 0.78, metalness: 0.04 });
  const junctionMat = new THREE.MeshStandardMaterial({ map: junctionTex, roughness: 0.78, metalness: 0.04 });
  const lotPatchMat = new THREE.MeshStandardMaterial({ map: lotPatchTex, roughness: 0.78, metalness: 0.04 });
  const rampFloorMat = new THREE.MeshStandardMaterial({ color: '#4C535D', roughness: 0.78, metalness: 0.04 });
  const pathMat = new THREE.MeshStandardMaterial({ map: walkwayTex, roughness: 0.72, metalness: 0.03 });
  const plazaMat = new THREE.MeshStandardMaterial({ map: plazaTex, roughness: 0.72, metalness: 0.03 });
  const curbMat = new THREE.MeshStandardMaterial({ color: '#BDB8AE', roughness: 0.68, metalness: 0.03 });
  const crosswalkMat = new THREE.MeshStandardMaterial({ color: '#E6E2DA', roughness: 0.74, metalness: 0.02 });
  const wheelStopMat = new THREE.MeshStandardMaterial({ color: '#A6A096', roughness: 0.66, metalness: 0.05 });

  const satinClayMat = new THREE.MeshStandardMaterial({ color: '#D2CCC3', roughness: 0.42, metalness: 0.06 });
  const darkGraphiteMat = new THREE.MeshStandardMaterial({ color: '#333840', roughness: 0.38, metalness: 0.65 });
  const brushedSilverMat = new THREE.MeshStandardMaterial({ color: '#A5ABB3', roughness: 0.30, metalness: 0.68 });
  const solarMat = new THREE.MeshStandardMaterial({ map: solarTex, roughness: 0.26, metalness: 0.35 });
  const smokedGlassMat = new THREE.MeshStandardMaterial({ color: '#1E2630', roughness: 0.12, metalness: 0.28 });
  const frostedGlassMat = new THREE.MeshStandardMaterial({
    color: '#7ECAD6',
    roughness: 0.14,
    metalness: 0.10,
    transparent: true,
    opacity: 0.46,
    envMapIntensity: 1.25,
  });

  const chargerLedMat = new THREE.MeshStandardMaterial({
    color: '#7CEEF8',
    emissive: new THREE.Color('#2ED6EE'),
    emissiveIntensity: 1.5,
    roughness: 0.2,
  });
  const microAmberMat = new THREE.MeshStandardMaterial({
    color: '#F5A623',
    emissive: new THREE.Color('#F5A623'),
    emissiveIntensity: 0.9,
    roughness: 0.25,
  });
  const carportUnderStripMat = new THREE.MeshStandardMaterial({
    color: '#8AEBF5',
    emissive: new THREE.Color('#2ED6EE'),
    emissiveIntensity: 0.22,
    roughness: 0.22,
  });
  const rampWarmGlowMat = new THREE.MeshStandardMaterial({
    color: '#FFE2B0',
    emissive: new THREE.Color('#FFAD3D'),
    emissiveIntensity: 0.10,
    roughness: 0.24,
  });
  const boothGlowMat = new THREE.MeshStandardMaterial({
    color: '#FFE6BF',
    emissive: new THREE.Color('#FFBA5E'),
    emissiveIntensity: 0.08,
    roughness: 0.4,
  });

  const islandTurfMat = new THREE.MeshStandardMaterial({ color: '#3b5f2d', roughness: 0.85, metalness: 0.0 });

  // 共享各主干道与内部环道样条控制点（与 HardwarePlinth.js / VegetationSystem.js / VehicleTrafficSystem.js 严格 1:1 同步）
  const zhongguancunPts = [
    [-208, -184],
    [-211, -92],
    [-216, 15],
    [-221, 110],
    [-224, 184],
  ];
  const zhongguancunExtendedPts = [
    [-201, -404],
    [-205, -294],
    ...zhongguancunPts,
    [-228, 294],
    [-233, 404],
  ];
  const pinglingPts = [
    [-243, -100],
    [-211, -106],
    [-130, -124],
    [-25, -144],
    [65, -162],
    [164, -184],
  ];
  const pinglingExtendedPts = [
    [-459, -59],
    [-351, -80],
    ...pinglingPts,
    [272, -208],
    [379, -232],
  ];
  // 永平大道：沿 26.2° 顺直贯穿中关村大道交叉口，彻底消除原交叉口 8.5° 生硬折弯
  const yongpingPts = [
    [-243, 111.3],
    [-221.6, 121.8],
    [-186, 139.3],
    [-138, 162.9],
    [-94, 184.6],
  ];
  const yongpingExtendedPts = [
    [-450, 9.4],
    [-346, 60.6],
    ...yongpingPts,
    [6, 233.8],
    [106, 283.0],
    [206, 332.2],
  ];
  const fireRingPts = [
    [-212.1, -66],
    [-174, -84],
    [-130, -98],
    [-58, -106],
    [26, -108],
    [96, -104],
    [98, -64],
    [97, -12],
    [96, 17.5],
  ];
  const westBranchPts = [
    [-216.2, 22],
    [-168, 22],
    [-146, 18],
    [-146, -34],
    [-144, -94.9],
  ];

  // 交叉口精确中心与单位方向向量（与转角路缘返回弧及斑马线精准咬合）
  const jPlZgc = { x: -210.5, z: -106.4 };
  const jYpZgc = { x: -221.6, z: 121.8 };
  const jNorthGate = { x: 26.0, z: -154.1 };

  const norm2 = (x, z) => {
    const l = Math.hypot(x, z) || 1;
    return [x / l, z / l];
  };
  const dirZgcN = norm2(-3, 92); // [-0.0326, 0.9995]
  const dirZgcS = norm2(-5, 95); // [-0.0526, 0.9986]
  const dirPingW = norm2(113, -24); // [0.9782, -0.2078]
  const dirPingN = norm2(90, -18); // [0.9806, -0.1961]
  const dirYong = norm2(1.0, 0.492); // [0.8973, 0.4415]

  // 精确交叉口投影盒判据：让主干道直路缘恰好止于转角圆弧切点（零断隙、零重叠！）
  const inFourWayBox = (x, z, jc, dA, hwA, dB, hwB, filletR) => {
    const dx = x - jc.x;
    const dz = z - jc.z;
    const sinT = Math.max(0.35, Math.abs(dA[0] * dB[1] - dA[1] * dB[0]));
    const cosT = Math.abs(dA[0] * dB[0] + dA[1] * dB[1]);
    const limA = (hwB + hwA * cosT) / sinT + filletR + 0.15;
    const limB = (hwA + hwB * cosT) / sinT + filletR + 0.15;
    const projA = Math.abs(dx * dA[0] + dz * dA[1]);
    const projB = Math.abs(dx * dB[0] + dz * dB[1]);
    return projA < limA && projB < limB;
  };

  const inArterialJunction = (x, z) =>
    inFourWayBox(x, z, jPlZgc, dirZgcN, 9.8, dirPingW, 7.75, 4.6) ||
    inFourWayBox(x, z, jYpZgc, dirZgcS, 9.8, dirYong, 7.5, 4.6);

  const zgcSuppress = (x, z) =>
    inArterialJunction(x, z) ||
    // 仅打开中关村大道东侧路缘以对接消防环道 (-66) 与西翼支线 (+22)，保留西侧外缘连续！
    (x > -211.0 && z > -72.0 && z < -60.0) ||
    (x > -215.0 && z > 16.5 && z < 27.5);

  const zgcMedianSuppress = (x, z) =>
    Math.hypot(x - jPlZgc.x, z - jPlZgc.z) < 20.5 ||
    Math.hypot(x - jYpZgc.x, z - jYpZgc.z) < 20.5 ||
    (z > -76.0 && z < -56.0) ||
    (z > 12.0 && z < 32.0);

  const pinglingSuppress = (x, z) =>
    inArterialJunction(x, z) ||
    // 北迎宾大道 T 型交叉口：仅打开平陵西路南侧路缘至圆弧切点，保持北侧路缘 100% 连续！
    (z > -154.5 && Math.abs(x - jNorthGate.x) < 14.8 && z < -141.0) ||
    // 环湖步道东端接入平陵西路南侧路缘精准开口（原 [-165.5,-156.5] 漏开 -155.6 南路缘，现根治！）
    (x > 69.0 && x < 76.0 && z > -158.0 && z < -153.0);

  const yongpingSuppress = (x, z) => inArterialJunction(x, z);

  const welcomeSuppress = (x, z) =>
    // 顶部平陵西路 T 型圆弧转角区（z <= -139.8）
    z < -139.8 ||
    // 迎宾十字路口与广场贯通区（z >= -111.8 起开放衔接消防环道与迎宾广场）
    z > -111.8;

  const fireRingSuppress = (x, z) =>
    // 西端接入中关村大道（匹配 19.6m 宽主干道东缘 x ≈ -202.0）
    x < -200.5 ||
    // 环湖步道西北入口 [-177, -81.5] 南侧路缘开口
    (x > -181.0 && x < -173.0 && z > -83.5 && z < -77.5) ||
    // 西翼支线 T 型汇入 (-144, -94.9) 南侧路缘开口
    (z > -96.5 && Math.hypot(x + 144, z + 94.9) < 7.6) ||
    // 北迎宾大道十字交叉口与回转广场贯通区
    (x > 7.2 && x < 44.8 && z < -80.0 && z > -112.5) ||
    // 1BF 地下车库引道南侧入口开口 (精准匹配修剪后 x ∈ [69.2, 76.6] 引道宽)
    (x > 68.8 && x < 76.9 && z > -106.0 && z < -98.0) ||
    // 东北停车场南侧入口开口 (x ∈ [84.5, 94.5])
    (x > 84.2 && x < 94.8 && z < -105.5 && z > -111.5) ||
    // 东侧装卸区西侧加宽开口
    (x < 97.4 && z > -16.8 && z < 8.8) ||
    // 东侧门洞掉头广场衔接区（杜绝与东栈桥着陆踏步穿模！）
    (x > 90.0 && z > 16.0);

  const westBranchSuppress = (x, z) =>
    // 西端接入中关村大道（匹配 19.6m 宽主干道东缘 x ≈ -206.4）
    x < -204.0 ||
    // 根治缺陷：西翼支线与环湖西北步道 WalkwayNW 在 (-184.0, 22.0) 十字平交开口！
    Math.hypot(x + 184.0, z - 22.0) < 3.6 ||
    // 西翼建筑入口人行步道东向衔接开口 (x > -145, z ∈ [19.8, 25.2])
    (x > -145.5 && z > 19.8 && z < 25.2) ||
    // 北端接入消防环道
    (z < -89.5 && Math.hypot(x + 144, z + 94.9) < 7.6) ||
    // 西侧停车场入口引道东侧开口 (z ∈ [-14.8, -5.2])
    (x > -145.0 && z > -15.0 && z < -5.0);

  // 1. 西侧市政主干道：中关村大道（19.6m 双向六车道 + 中央绿化分隔带，无界延展至南北云雾边界）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: zhongguancunExtendedPts,
      width: 19.6,
      topY: ROAD_Y.ZGC,
      curbTopY: ROAD_Y.ZGC_CURB,
      segments: 148,
      uvTileLength: 20,
      roadMaterial: arterialMat,
      fadeRoadMaterial: arterialFadeMat,
      curbMaterial: curbMat,
      clampToPlinth: false,
      curbMaxOutDist: 32,
      curbSuppressFn: zgcSuppress,
    })
  );
  group.add(
    buildArterialMedianStrip({
      controlPoints: zhongguancunExtendedPts,
      halfWidth: 0.90,
      segments: 160,
      roadTopY: ROAD_Y.ZGC,
      curbTopY: ROAD_Y.ZGC_CURB + 0.085,
      maxOutDist: 30,
      suppressFn: zgcMedianSuppress,
      curbMat,
      turfMat: islandTurfMat,
    })
  );

  // 2. 北侧市政主干道：平陵西路（15.5m 双向四车道，无界延展至东西云雾边界）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: pinglingExtendedPts,
      width: 15.5,
      topY: ROAD_Y.PINGLING,
      curbTopY: ROAD_Y.PINGLING_CURB,
      segments: 144,
      uvTileLength: 20,
      roadMaterial: arterialMat,
      fadeRoadMaterial: arterialFadeMat,
      curbMaterial: curbMat,
      clampToPlinth: false,
      curbMaxOutDist: 32,
      curbSuppressFn: pinglingSuppress,
    })
  );

  // 3. 西南市政主干道：永平大道（15.0m 双向四车道，顺直无界延展至西南与东南云雾边界）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: yongpingExtendedPts,
      width: 15.0,
      topY: ROAD_Y.YONGPING,
      curbTopY: ROAD_Y.YONGPING_CURB,
      segments: 144,
      uvTileLength: 20,
      roadMaterial: arterialMat,
      fadeRoadMaterial: arterialFadeMat,
      curbMaterial: curbMat,
      clampToPlinth: false,
      curbMaxOutDist: 32,
      curbSuppressFn: yongpingSuppress,
    })
  );

  // 市政精准定向交叉口（圆角切角沥青垫层 + 转角弧形路缘 + 斑马线与停止线，彻底告别粗放圆盘！）
  group.add(
    buildArterialIntersection({
      cx: jPlZgc.x,
      cz: jPlZgc.z,
      dirA: dirZgcN,
      halfWA: 9.8,
      roadTopYA: ROAD_Y.ZGC,
      dirB: dirPingW,
      halfWB: 7.75,
      roadTopYB: ROAD_Y.PINGLING,
      isTJunction: false,
      filletR: 4.6,
      topY: ROAD_Y.JUNCTION,
      curbTopY: ROAD_Y.ZGC_CURB,
      junctionMat,
      curbMat,
      markingMat: crosswalkMat,
    })
  );
  group.add(
    buildArterialIntersection({
      cx: jYpZgc.x,
      cz: jYpZgc.z,
      dirA: dirZgcS,
      halfWA: 9.8,
      roadTopYA: ROAD_Y.ZGC,
      dirB: dirYong,
      halfWB: 7.5,
      roadTopYB: ROAD_Y.YONGPING,
      isTJunction: false,
      filletR: 4.6,
      topY: ROAD_Y.JUNCTION,
      curbTopY: ROAD_Y.ZGC_CURB,
      junctionMat,
      curbMat,
      markingMat: crosswalkMat,
    })
  );
  group.add(
    buildArterialIntersection({
      cx: jNorthGate.x,
      cz: jNorthGate.z,
      dirA: dirPingN,
      halfWA: 7.75,
      roadTopYA: ROAD_Y.PINGLING,
      dirB: [0, 1],
      halfWB: 8.4,
      roadTopYB: ROAD_Y.WELCOME,
      isTJunction: true,
      filletR: 4.8,
      topY: ROAD_Y.JUNCTION,
      curbTopY: ROAD_Y.PINGLING_CURB,
      junctionMat,
      curbMat,
      markingMat: crosswalkMat,
    })
  );

  // 4. 北侧迎宾大道、南北分幅种植岛与开敞四向消防环道十字路口（100% 对齐 IOPLY 航拍实景与 KKAA 一层总图！）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [26, -154.1],
        [26, -124],
        [26, -104.2],
      ],
      width: 16.8,
      topY: ROAD_Y.WELCOME,
      curbTopY: ROAD_Y.WELCOME_CURB,
      segments: 28,
      uvTileLength: 14,
      roadMaterial: plazaMat,
      curbMaterial: curbMat,
      curbSuppressFn: welcomeSuppress,
    })
  );

  // 迎宾大道北口人行横道（位于平陵路口南侧、北中分岛北端之间，零压岛！）
  group.add(
    buildCrosswalkStripes({
      x: 26,
      z: -142.2,
      width: 14.6,
      length: 3.0,
      stripes: 8,
      topY: ROAD_Y.WELCOME,
      mat: crosswalkMat,
    })
  );

  // 中央大入口迎宾广场（z ∈ [-104.6, -81.0]，紧贴北侧消防环道南边线，零遮挡消防环道！）
  const plazaH = ROAD_Y.PLAZA + 0.06;
  const plazaBox = new THREE.Mesh(new THREE.BoxGeometry(36.0, plazaH, 23.6), plazaMat);
  plazaBox.position.set(26, ROAD_Y.PLAZA - plazaH * 0.5, -92.8);
  plazaBox.receiveShadow = true;
  group.add(plazaBox);

  // 中央 32m 大门廊北前区人行礼仪过街标线（呼应 IOPLY 园区鸟瞰实景入口石材纹带）
  group.add(
    buildCrosswalkStripes({
      x: 26,
      z: -84.2,
      width: 15.2,
      length: 2.6,
      stripes: 8,
      topY: ROAD_Y.PLAZA,
      mat: crosswalkMat,
    })
  );

  // 北中分绿化岛（z ∈ [-138.4, -115.0]，清晰让出 z = -108 消防环道十字交叉口！）
  group.add(
    buildRoundedRectIsland({
      cx: 26,
      cz: -126.7,
      width: 4.2,
      length: 23.4,
      radius: 2.0,
      curbMat,
      turfMat: islandTurfMat,
    })
  );

  // 南落客回转绿化岛（z ∈ [-101.6, -92.6]，还原 Eiichi Kano 07 与航拍实景中的门廊前圆角草坪落客岛！）
  group.add(
    buildRoundedRectIsland({
      cx: 26,
      cz: -97.1,
      width: 4.6,
      length: 9.0,
      radius: 2.2,
      curbMat,
      turfMat: islandTurfMat,
    })
  );

  // 5. 环绕建筑内部消防车道、西翼支线、东门洞掉头广场与装卸区
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: fireRingPts,
      width: 6.8,
      topY: ROAD_Y.FIRE_LOT,
      curbTopY: ROAD_Y.FIRE_CURB,
      segments: 90,
      uvTileLength: 12,
      roadMaterial: fireRoadMat,
      curbMaterial: curbMat,
      curbSuppressFn: fireRingSuppress,
    })
  );

  // 东侧门洞圆形掉头广场 + 无缝东栈桥 / 东门洞步行衔接（彻底消除原 [96,24] 钝端截断与路缘穿东栈桥！）
  const eastTurnX = 96.0;
  const eastTurnZ = 21.8;
  const eastTurnR = 5.0;
  const eastTurnTopY = ROAD_Y.BRANCH_APRON; // 0.058，与 FireRing 0.062 错开 4mm 零闪烁
  const eastTurnH = eastTurnTopY + 0.06;
  const eastTurnNeck = new THREE.Mesh(new THREE.BoxGeometry(6.8, eastTurnH, 5.2), fireRoadMat);
  eastTurnNeck.position.set(eastTurnX, eastTurnTopY - eastTurnH * 0.5, 19.2);
  eastTurnNeck.receiveShadow = true;
  group.add(eastTurnNeck);

  const eastTurnBulb = new THREE.Mesh(
    new THREE.CylinderGeometry(eastTurnR, eastTurnR + 0.14, eastTurnH, 28),
    lotPatchMat
  );
  eastTurnBulb.position.set(eastTurnX, eastTurnTopY - eastTurnH * 0.5, eastTurnZ);
  eastTurnBulb.receiveShadow = true;
  group.add(eastTurnBulb);

  // 东掉头广场暖石弧形外路缘（仅封合南/西南段，东侧留口平顺衔接东栈桥，西侧留口直通东门洞！）
  const addTurnaroundCurbArc = (aStart, aEnd, steps = 12) => {
    const pStart = [eastTurnX + Math.cos(aStart) * eastTurnR, eastTurnZ + Math.sin(aStart) * eastTurnR];
    const pEnd = [eastTurnX + Math.cos(aEnd) * eastTurnR, eastTurnZ + Math.sin(aEnd) * eastTurnR];
    const aMid = (aStart + aEnd) * 0.5;
    const ctrlR = eastTurnR / Math.cos((aEnd - aStart) * 0.5);
    const pCtrl = [eastTurnX + Math.cos(aMid) * ctrlR, eastTurnZ + Math.sin(aMid) * ctrlR];
    group.add(
      buildCornerCurbReturnArc(pStart, pCtrl, pEnd, {
        curbWidth: 0.42,
        topY: ROAD_Y.FIRE_CURB,
        mat: curbMat,
        steps,
      })
    );
  };
  // 南弧段（+44° 到 +132°，避让东栈桥着陆口与西侧东门洞步道口）
  addTurnaroundCurbArc(0.76, 2.30, 14);
  // 东门洞衔接暖洞石步行平台（x ∈ [85.6, 91.6], z ∈ [20.4, 24.6]，无缝连接掉头广场西口与 EastPortal！）
  const eastPortalWalkH = ROAD_Y.WALKWAY + 0.06;
  const eastPortalWalk = new THREE.Mesh(new THREE.BoxGeometry(6.0, eastPortalWalkH, 4.2), pathMat);
  eastPortalWalk.position.set(88.6, ROAD_Y.WALKWAY - eastPortalWalkH * 0.5, 22.5);
  eastPortalWalk.receiveShadow = true;
  group.add(eastPortalWalk);

  // 西翼消防环道 / 西翼支线接入中关村大道东口人行横道
  group.add(
    buildCrosswalkStripes({
      x: -199.8,
      z: -71.2,
      width: 5.8,
      length: 2.6,
      stripes: 5,
      rotY: Math.atan2(36, -18),
      topY: ROAD_Y.FIRE_LOT,
      mat: crosswalkMat,
    })
  );
  group.add(
    buildCrosswalkStripes({
      x: -202.8,
      z: 22.0,
      width: 5.2,
      length: 2.6,
      stripes: 4,
      rotY: Math.PI / 2,
      topY: ROAD_Y.BRANCH_APRON,
      mat: crosswalkMat,
    })
  );

  // 西翼消防支线（直通西停车场与中关村大道，北端精准锁合消防环道）
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: westBranchPts,
      width: 6.2,
      topY: ROAD_Y.BRANCH_APRON,
      curbTopY: ROAD_Y.BRANCH_CURB,
      segments: 52,
      uvTileLength: 12,
      roadMaterial: campusRoadMat,
      curbMaterial: curbMat,
      curbSuppressFn: westBranchSuppress,
    })
  );

  // 西翼支线 × 环湖西北步道 (-184.0, 22.0) 十字平交斑马线（彻底消除双路缘互相切割车行道！）
  group.add(
    buildCrosswalkStripes({
      x: -184.0,
      z: 22.0,
      width: 5.2,
      length: 3.2,
      stripes: 4,
      rotY: Math.PI / 2,
      topY: ROAD_Y.BRANCH_APRON,
      mat: crosswalkMat,
    })
  );

  // 西翼支线停车场斑马线提示
  group.add(
    buildCrosswalkStripes({
      x: -146.0,
      z: -16.8,
      width: 5.0,
      length: 2.2,
      stripes: 4,
      topY: ROAD_Y.BRANCH_APRON,
      mat: crosswalkMat,
    })
  );

  // 西停车场无缝入口引道（x ∈ [-143.0, -137.0] 严格对接西翼支线与西停车场西界，与西停车场错开 4mm 杜绝闪烁）
  const westApronH = ROAD_Y.BRANCH_APRON + 0.06;
  const westApron = new THREE.Mesh(new THREE.BoxGeometry(6.2, westApronH, 9.0), campusRoadMat);
  westApron.position.set(-140.0, ROAD_Y.BRANCH_APRON - westApronH * 0.5, -10.0);
  westApron.receiveShadow = true;
  group.add(westApron);

  // 西停车场入口内喉道平整沥青覆盖带（精准完整覆盖西排第 3–5 车位带 z ∈ [-16.68, -3.32], x ∈ [-137.0, -124.2]，零半截冰青车位外露！）
  const throatTopY = ROAD_Y.WELCOME; // 0.066（高于停车场 0.062 精确 4mm，零 Z-Fighting）
  const throatH = throatTopY + 0.06;
  const westThroat = new THREE.Mesh(new THREE.BoxGeometry(12.8, throatH, 13.36), lotPatchMat);
  westThroat.position.set(-130.6, throatTopY - throatH * 0.5, -10.0);
  westThroat.receiveShadow = true;
  group.add(westThroat);

  // 入口喉道两侧精致白边线与中央出入分道虚线
  for (const lz of [-16.46, -3.54]) {
    const edgeLine = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.005, 0.14), crosswalkMat);
    edgeLine.position.set(-130.6, throatTopY + 0.0025, lz);
    edgeLine.receiveShadow = true;
    group.add(edgeLine);
  }
  for (const lx of [-134.8, -131.6, -128.4]) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.005, 0.12), crosswalkMat);
    dash.position.set(lx, throatTopY + 0.0025, -10.0);
    dash.receiveShadow = true;
    group.add(dash);
  }

  // 东侧装卸区平滑加宽泊位（y = 0.058，与 FireRing 0.062 错开 4mm 零闪烁）
  const loadingH = ROAD_Y.BRANCH_APRON + 0.06;
  const loadingBay = new THREE.Mesh(new THREE.BoxGeometry(9.6, loadingH, 24.0), fireRoadMat);
  loadingBay.position.set(92.0, ROAD_Y.BRANCH_APRON - loadingH * 0.5, -4.0);
  loadingBay.receiveShadow = true;
  group.add(loadingBay);

  // 6. 环湖暖洞石慢行绿道 + 西翼门洞步行廊道（对接 KKAA 一层总图 W1-W2 / W2-W3 底层架空入口门洞！）
  const walkwaySuppress = (x, z) =>
    // 避让西北接入消防环道与东端接入平陵西路的接缝端头
    Math.hypot(x + 177, z + 81.5) < 4.5 ||
    Math.hypot(x - 72.5, z + 155.8) < 4.2 ||
    // 根治缺陷：避让 WalkwayNW 与 WestBranch 在 (-184.0, 22.0) 十字平交车行道！
    Math.hypot(x + 184.0, z - 22.0) < 5.0 ||
    // 避让东侧亲水栈桥东端着陆点 (154.4, 2.4) 西侧路缘，无缝上桥
    (x < 156.2 && Math.hypot(x - 155.2, z - 2.2) < 4.2);

  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [-177, -81.5], // 精确对接消防环道！
        [-184, -18],
        [-184, 52],
        [-181, 78],
        [-179, 95], // 精确对接西南拱桥北桥台！
      ],
      width: 3.6,
      topY: ROAD_Y.WALKWAY,
      curbTopY: ROAD_Y.WALKWAY_CURB,
      curbWidth: 0.24,
      segments: 44,
      uvTileLength: 8,
      roadMaterial: pathMat,
      curbMaterial: curbMat,
      curbSuppressFn: walkwaySuppress,
    })
  );

  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [-161, 122], // 精确对接西南拱桥南桥台！
        [-144, 110], // 无缝绕过新西南草坡北麓
        [-114, 106],
        [-84, 126],
        [-64, 146],
        [-22, 165],
        [28, 168],
        [88, 152],
        [136, 114],
        [168, 74],
        [172, 34],
        [156, 2], // 保持不变，严丝合缝对接东岸亲水栈桥 (154.4, 2.4)！
        [160.5, -24], // 优雅绕行东岸六角亭 (146,-24, r=11.6) 外缘，零穿插！
        [154, -76],
        [136, -132],
        [98, -142],
        [72.5, -155.8], // 精准齐平止于平陵西路南缘（彻底消除探入机动车道 4m！）
      ],
      width: 3.6,
      topY: ROAD_Y.WALKWAY,
      curbTopY: ROAD_Y.WALKWAY_CURB,
      curbWidth: 0.24,
      segments: 120,
      uvTileLength: 8,
      roadMaterial: pathMat,
      curbMaterial: curbMat,
      curbSuppressFn: walkwaySuppress,
    })
  );

  // 西翼入口步行连廊（连通西翼支线、西侧停车场南口、W1-W2 门洞与 W2-W3 门洞，还原 KKAA 一层总图步行流线）
  const westPorchSuppress = (x, z) =>
    Math.hypot(x + 130.0, z - 22.5) < 2.6 ||
    x < -141.0 ||
    x > -81.2 ||
    z < 13.0 ||
    z > 29.2;

  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [-143.0, 22.5],
        [-112.0, 22.5],
        [-80.0, 22.5],
      ],
      width: 3.2,
      topY: ROAD_Y.WALKWAY,
      curbTopY: ROAD_Y.WALKWAY_CURB,
      curbWidth: 0.22,
      segments: 24,
      uvTileLength: 8,
      roadMaterial: pathMat,
      curbMaterial: curbMat,
      curbSuppressFn: westPorchSuppress,
    })
  );
  group.add(
    buildExtrudedRoadRibbon({
      controlPoints: [
        [-130.0, 12.2],
        [-130.0, 22.5],
        [-130.0, 30.2],
      ],
      width: 3.2,
      topY: ROAD_Y.WALKWAY - 0.004,
      curbTopY: ROAD_Y.WALKWAY_CURB,
      curbWidth: 0.22,
      segments: 16,
      uvTileLength: 8,
      roadMaterial: pathMat,
      curbMaterial: curbMat,
      curbSuppressFn: westPorchSuppress,
    })
  );

  // 7. 西侧与东北侧地面停车场（修复 R3 入口断口 + 修复 R7 车棚与泊位彻底零碰撞 + 混凝土轮挡 + 门岗道闸！）
  const westParkTex = createParkingLotTexture(2, 9, 6, maxAnisotropy);
  const westParkMat = new THREE.MeshStandardMaterial({ map: westParkTex, roughness: 0.76, metalness: 0.04 });
  const lotH = ROAD_Y.FIRE_LOT + 0.06;
  const westLot = new THREE.Mesh(new THREE.BoxGeometry(34.0, lotH, 44.0), westParkMat);
  westLot.position.set(-120.0, ROAD_Y.FIRE_LOT - lotH * 0.5, -10.0);
  westLot.receiveShadow = true;
  group.add(westLot);

  // 西停车场四面完整倒角暖石路缘（西侧 z ∈ [-14.5, -5.5] 留出 9m 车行入口 + 南侧 x ∈ [-131.8, -128.2] 留出 3.6m 人行门洞通道）
  addChamferedLotCurbs(group, {
    cx: -120.0,
    cz: -10.0,
    w: 34.0,
    d: 44.0,
    curbMat,
    openGaps: [
      { side: 'west', min: -14.5, max: -5.5 },
      { side: 'south', min: -131.8, max: -128.2 },
    ],
  });

  // 西停车场双联太阳能 EV 充电车棚（北翼 [-30.2, -16.8] & 南翼 [-3.2, +10.2]，精准对齐车位分界线并让出完整入口喉道！）
  // 立柱 x = -134.20，充电桩 x = -133.64；泊车位于 x = -129.0（车尾 -131.45），净距 >= 1.75m 绝无碰撞！
  const carportSharedMats = {
    solarMat,
    satinClayMat,
    darkGraphiteMat,
    brushedSilverMat,
    curbMat,
    smokedGlassMat,
    ledMat: chargerLedMat,
    microAmberMat,
    underStripMat: carportUnderStripMat,
  };
  group.add(
    buildSolarCarport({
      x: -131.6,
      z: -23.5,
      lengthZ: 13.4,
      widthX: 6.2,
      ...carportSharedMats,
    })
  );
  group.add(
    buildSolarCarport({
      x: -131.6,
      z: 3.5,
      lengthZ: 13.4,
      widthX: 6.2,
      ...carportSharedMats,
    })
  );

  // 西停车场智能门岗亭（坐落于西翼支线与西停车场之间的草坪安全岛，100% 避让路面与车道）+ 抬起式双侧智能道闸（精准退入入口净喉道内，远离南北车位！）
  group.add(
    buildParkingGateAssembly({
      kioskPos: [-139.8, -16.6],
      kioskRotY: 0,
      barriers: [
        { x: -136.4, z: -13.9, rotY: -Math.PI / 2, hasArm: true, armLen: 3.0, armTilt: 1.16 },
        { x: -136.4, z: -6.1, rotY: Math.PI / 2, hasArm: true, armLen: 3.0, armTilt: 1.16 },
      ],
      satinClayMat,
      darkGraphiteMat,
      brushedSilverMat,
      curbMat,
      frostedGlassMat,
      ledMat: chargerLedMat,
      microAmberMat,
      boothGlowMat,
    })
  );

  // 东北侧地面停车场（北移至 z ∈ [-129.0, -110.0]，彻底与南侧消防环道 z ≈ -105.85 清晰分离，修复 R3！）
  const neParkTex = createParkingLotTexture(2, 5, 3, maxAnisotropy);
  const neParkMat = new THREE.MeshStandardMaterial({ map: neParkTex, roughness: 0.76, metalness: 0.04 });
  const neLot = new THREE.Mesh(new THREE.BoxGeometry(30.0, lotH, 19.0), neParkMat);
  neLot.position.set(89.5, ROAD_Y.FIRE_LOT - lotH * 0.5, -119.5);
  neLot.receiveShadow = true;
  group.add(neLot);

  // 东北停车场四面完整倒角路缘（南侧 x ∈ [85.0, 94.0] 预留 9m 清晰进出车口！）
  addChamferedLotCurbs(group, {
    cx: 89.5,
    cz: -119.5,
    w: 30.0,
    d: 19.0,
    curbMat,
    openGap: { side: 'south', min: 85.0, max: 94.0 },
  });

  // 东北停车场南向衔接引道（x ∈ [85.0, 94.0], z ∈ [-110.2, -105.6]，y = 0.058 严丝合缝连通消防环道！）
  const neApronH = ROAD_Y.BRANCH_APRON + 0.06;
  const neApron = new THREE.Mesh(new THREE.BoxGeometry(9.0, neApronH, 4.8), lotPatchMat);
  neApron.position.set(89.5, ROAD_Y.BRANCH_APRON - neApronH * 0.5, -107.9);
  neApron.receiveShadow = true;
  group.add(neApron);

  // 东北太阳能 EV 充电车棚（x = 79.4 -> 立柱 x = 76.96, 充电桩 x = 77.52；泊车 x = 81.2 车尾 78.75 -> 净距 >= 1.07m！）
  group.add(
    buildSolarCarport({
      x: 79.4,
      z: -119.5,
      lengthZ: 15.0,
      widthX: 5.8,
      ...carportSharedMats,
    })
  );

  // 东北停车场入口双侧智能识别柱与抬杆道闸
  group.add(
    buildParkingGateAssembly({
      barriers: [
        { x: 84.4, z: -109.2, rotY: 0, hasArm: true, armLen: 3.1, armTilt: 1.16 },
        { x: 94.6, z: -109.2, rotY: Math.PI, hasArm: false },
      ],
      satinClayMat,
      darkGraphiteMat,
      brushedSilverMat,
      curbMat,
      frostedGlassMat,
      ledMat: chargerLedMat,
      microAmberMat,
      boothGlowMat,
    })
  );

  // 全场停车位混凝土轮挡（与 VehicleTrafficSystem.js 泊位精准对齐）
  const wheelStopPlacements = [
    // 西停车场西排北段 & 南段（车体 x = -129.0 朝东，轮挡在后轮后方 x = -130.92）
    ...[-27.8, -23.0, -18.2, -1.8, 3.0, 7.8].map((z) => ({ x: -130.92, z, rotY: 0 })),
    // 西停车场东排（车体 x = -109.6 朝西，轮挡在后轮后方 x = -107.68）
    ...[-27.5, -20.5, -11.5, -2.5, 6.8].map((z) => ({ x: -107.68, z, rotY: 0 })),
    // 东北停车场西排（车体 x = 81.2 朝东，轮挡在 x = 79.28）
    ...[-124.8, -119.5, -114.2].map((z) => ({ x: 79.28, z, rotY: 0 })),
    // 东北停车场东排（车体 x = 98.2 朝西，轮挡在 x = 100.12）
    ...[-124.5, -119.5, -114.5].map((z) => ({ x: 100.12, z, rotY: 0 })),
  ];
  group.add(buildConcreteWheelStops(wheelStopPlacements, wheelStopMat, darkGraphiteMat));

  // 8. 北侧地下车库（1BF）入口下沉坡道（100% 修复 R1！）
  const garageRamp = buildUndergroundGarageRamp({
    satinClayMat,
    darkGraphiteMat,
    brushedSilverMat,
    curbMat,
    rampFloorMat,
    rampGlowMat: rampWarmGlowMat,
  });
  group.add(garageRamp.group);

  // 9. 全园区工业设计级 CNC 道路路灯系统（同步 19.6m 中关村大道、顺直永平大道与精准交叉口净空！）
  const nearJunction = (px, pz, cx, cz) => {
    const avoidPts = [
      [jPlZgc.x, jPlZgc.z, 22.0],
      [jYpZgc.x, jYpZgc.z, 22.0],
      [jNorthGate.x, jNorthGate.z, 19.5],
      [-212.1, -66, 13.5],
      [-216.2, 22, 13.5],
      [-184.0, 22, 6.5],
      [96.0, 21.8, 7.5],
    ];
    for (const [ax, az, rad] of avoidPts) {
      if (Math.hypot(px - ax, pz - az) < rad || Math.hypot(cx - ax, cz - az) < rad) return true;
    }
    return false;
  };

  const streetlightPlacements = [
    ...sampleStreetlightsAlongRoad({
      controlPoints: zhongguancunPts,
      roadWidth: 19.6,
      roadTopY: ROAD_Y.ZGC,
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
      roadTopY: ROAD_Y.PINGLING,
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
      roadTopY: ROAD_Y.YONGPING,
      spacing: 24,
      staggerSides: true,
      poleScale: 0.98,
      startMargin: 14,
      endMargin: 12,
      skipFn: nearJunction,
    }),
    // 北侧迎宾大道对称双侧礼仪 CNC 路灯
    ...[
      { x: 16.5, z: -138, rotY: 0, surfY: 0.0, roadTopY: ROAD_Y.WELCOME, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 35.5, z: -138, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.WELCOME, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 16.5, z: -120, rotY: 0, surfY: 0.0, roadTopY: ROAD_Y.WELCOME, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 35.5, z: -120, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.WELCOME, scale: 0.92, poolReach: 3.4, poolSize: 13.6 },
      { x: 16.5, z: -102, rotY: 0, surfY: ROAD_Y.PLAZA, roadTopY: ROAD_Y.PLAZA, scale: 0.88, poolReach: 3.2, poolSize: 13.0 },
      { x: 35.5, z: -102, rotY: Math.PI, surfY: ROAD_Y.PLAZA, roadTopY: ROAD_Y.PLAZA, scale: 0.88, poolReach: 3.2, poolSize: 13.0 },
    ],
    // 内部消防环道单排精工园区路灯
    ...sampleStreetlightsAlongRoad({
      controlPoints: fireRingPts,
      roadWidth: 6.8,
      roadTopY: ROAD_Y.FIRE_LOT,
      spacing: 22,
      fixedSide: 1,
      poleScale: 0.82,
      startMargin: 16,
      endMargin: 8,
      skipFn: (px, pz, cx, cz) =>
        (cx > 6 && cx < 46 && cz < -82) ||
        (cx > 63 && cx < 82 && cz < -88 && cz > -110) ||
        (cx > 76 && cz < -94) ||
        (cx > 86 && cz > -17 && cz < 9) ||
        cx < -196,
    }),
    // 东侧装卸区外缘草坪补位路灯（安全净距 >= 3m）
    { x: 101.8, z: -6.0, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 3.0, poolSize: 11.4 },
    // 西翼消防支线单排园区路灯
    ...sampleStreetlightsAlongRoad({
      controlPoints: westBranchPts,
      roadWidth: 6.2,
      roadTopY: ROAD_Y.BRANCH_APRON,
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
    // 西侧地面停车场外缘照明路灯（东缘 4 盏 + 北南端中轴各 1 盏，100% 避让西侧双联太阳能车棚挑檐！）
    { x: -102.0, z: -26, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -102.0, z: -13, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -102.0, z: 0, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -102.0, z: 10, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -120.0, z: -32.8, rotY: -Math.PI / 2, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    { x: -120.0, z: 12.8, rotY: Math.PI / 2, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.82, poolReach: 2.8, poolSize: 11.4 },
    // 东北侧地面停车场外缘照明路灯（对齐新停车场范围 z ∈ [-129.0, -110.0]）
    { x: 105.2, z: -124.5, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.8, poolReach: 2.8, poolSize: 11.0 },
    { x: 105.2, z: -114.0, rotY: Math.PI, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.8, poolReach: 2.8, poolSize: 11.0 },
    { x: 89.5, z: -129.9, rotY: -Math.PI / 2, surfY: 0.0, roadTopY: ROAD_Y.FIRE_LOT, scale: 0.8, poolReach: 2.8, poolSize: 11.0 },
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
  const carportPools = new THREE.InstancedMesh(cyanPoolGeo, cyanPoolMat, 3);
  const cpDummy = new THREE.Object3D();
  [
    { x: -130.6, z: -23.5, sx: 10.2, sz: 15.2 },
    { x: -130.6, z: 3.5, sx: 10.2, sz: 15.2 },
    { x: 80.2, z: -119.5, sx: 9.6, sz: 17.5 },
  ].forEach((p, idx) => {
    cpDummy.position.set(p.x, ROAD_Y.FIRE_LOT + 0.015, p.z);
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
  const rampPoolMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 10.0), rampPoolMat);
  rampPoolMesh.userData.noMerge = true;
  rampPoolMesh.rotation.x = -Math.PI / 2;
  rampPoolMesh.position.set(72.9, ROAD_Y.BRANCH_APRON + 0.015, -95.6);
  group.add(rampPoolMesh);

  return {
    group,
    setDuskFactor(dusk, night = dusk) {
      const active = dusk > 0.005;
      streetlights.setDuskFactor(dusk, night);
      chargerLedMat.emissiveIntensity = 1.5 + dusk * 1.3 + night * 0.65;
      microAmberMat.emissiveIntensity = 0.9 + dusk * 1.0 + night * 0.6;
      carportUnderStripMat.emissiveIntensity = 0.22 + dusk * 2.35 + night * 0.85;
      rampWarmGlowMat.emissiveIntensity = 0.10 + dusk * 2.85 + night * 0.95;
      boothGlowMat.emissiveIntensity = 0.08 + dusk * 1.45 + night * 0.75;
      garageRamp.canopyGlassMat.emissiveIntensity = dusk * 0.48 + night * 0.28;

      cyanPoolMat.visible = active;
      cyanPoolMat.opacity = dusk * 0.24 + night * 0.16;
      rampPoolMat.visible = active;
      rampPoolMat.opacity = dusk * 0.34 + night * 0.20;
    },
  };
}
