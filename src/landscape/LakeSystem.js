import * as THREE from 'three';
import { ELEVATIONS, FLOATING_ISLANDS, LAKE_SHORELINE } from '../config/campusConfig.js';
import { createWaterNormalTexture } from '../core/ProceduralTextures.js';

/**
 * 博物馆级精工光学中心湖泊水景系统（<= 10 Draw Calls，0 PointLights，晶莹玉青树脂光学水体，全昼夜适配）
 * - 单层深海玉青消光防漏光底板（y = -2.20，0 Z-Fighting）
 * - 细密无缝细分水面 + 逐顶点精确岸距属性 aShoreDist + 512×384 有符号岸距与夜间建筑倒影场贴图
 * - MeshStandardMaterial + onBeforeCompile 物理光学水体着色器：
 *   1. Beer-Lambert 连续光滑晶透光学水深渐变（临岸/浮岛清透翡翠碧水 -> 湖心深邃玉青琉璃 -> 暮蓝/午夜墨蓝）
 *   2. 保留 v2.1-polished 四组非正交相位扰动有机波列 + 双层错角细微法线 + 浮岛同心涟漪 + 柔和丝绸镜面高光
 *   3. 物理菲涅尔（Schlick Fresnel）掠射暖瓷棚拍柔光反射 + 浅岸微弱水底焦散光泽
 *   4. 0.0–1.25m 细腻磨砂冰青亲水半月面（Meniscus）与倒角石材驳岸挑檐接触暗影
 *   5. 保留 v2.1-polished 暮光/夜间贴岸 2–16m 柔润暖琥珀丝缕建筑倒影（中央门廊、东西翼、西南拱桥、东岸六角亭与栈桥）
 * - 连续无缝斜接 3 阶倒角暖石驳岸（水下踏台 + 深影凹槽 + 45° 精磨暖石压顶，陆侧严密埋入草坪零浮缝）
 * - 3 座稳固扎根湖底的精工生态岛与精准贴合杆顶的芦苇丛（L1 彻底修复）
 */

const REVETMENT_INNER_OFFSET = 0.55;
const ISLAND_WATERLINE_SCALE = 1.05;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function pointsToShape(pts) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], -pts[i][1]);
  }
  shape.closePath();
  return shape;
}

function distToSegmentSq(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-8) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  let t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

/**
 * 与 Three.js rotation.y 完全一致的旋转椭圆外缘近似欧氏有符号距离
 */
function signedEllipseDist(px, pz, isl) {
  const dx = px - isl.x;
  const dz = pz - isl.z;
  const cosR = Math.cos(isl.rot);
  const sinR = Math.sin(isl.rot);
  const lx = dx * cosR - dz * sinR;
  const lz = dx * sinR + dz * cosR;
  const rx = isl.rx * ISLAND_WATERLINE_SCALE;
  const rz = isl.rz * ISLAND_WATERLINE_SCALE;
  const qx = lx / rx;
  const qz = lz / rz;
  const k0 = Math.hypot(qx, qz);
  if (k0 < 1e-4) return -Math.min(rx, rz);
  const k1 = Math.hypot(lx / (rx * rx), lz / (rz * rz));
  return (k0 * (k0 - 1)) / k1;
}

function shortestDistanceToShore(px, pz, pts) {
  let minSq = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dSq = distToSegmentSq(px, pz, a[0], a[1], b[0], b[1]);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

function shortestDistanceToIslands(px, pz) {
  let minD = Infinity;
  for (let i = 0; i < FLOATING_ISLANDS.length; i++) {
    const d = signedEllipseDist(px, pz, FLOATING_ISLANDS[i]);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * 夜间/暮光临水发光建筑、门廊、拱桥、六角亭与栈桥的解析倒影发射带定义
 * 严格收紧在贴近建筑岸线 2–16m 范围，令中心开阔湖面保持沉静深邃的夜蓝镜面感；
 * 仅在初始化烘焙进 RGBA 场贴图的 B/A 通道，运行期零循环、零 PointLight！
 */
const NIGHT_REFLECTION_EMITTERS = [
  // 1. 中央 32m 三层通高木格栅大门廊（北岸主视觉温润琥珀倒影，最远 16m）
  { type: 'strip', ax: 10, az: -56, bx: 42, bz: -56, dx: 0, dz: 1, reach: 16.0, sideSpread: 4.5, intensity: 0.92, warm: 1.0 },
  // 2. W5_N 西扶梯厅 & E1 东扶梯厅北岸临水立面
  { type: 'strip', ax: -8, az: -50, bx: 10, bz: -56, dx: 0.25, dz: 0.97, reach: 13.5, sideSpread: 4.0, intensity: 0.72, warm: 0.94 },
  { type: 'strip', ax: 42, az: -56, bx: 56, bz: -54, dx: -0.14, dz: 0.99, reach: 13.5, sideSpread: 4.0, intensity: 0.72, warm: 0.94 },
  // 3. 西五楼南段多功能中庭与亲水柚木平台
  { type: 'strip', ax: -36, az: -29, bx: -8, bz: -30, dx: 0, dz: 1, reach: 13.0, sideSpread: 4.0, intensity: 0.74, warm: 0.92 },
  // 4. 西三楼 & 西二西三连桥临湖东立面
  { type: 'strip', ax: -47, az: -25, bx: -47.5, bz: 50, dx: 1, dz: 0, reach: 12.5, sideSpread: 4.0, intensity: 0.65, warm: 0.86 },
  // 5. 西二楼实验楼与临湖咖啡吧露台
  { type: 'strip', ax: -126, az: 54, bx: -48, bz: 54, dx: 0, dz: 1, reach: 14.0, sideSpread: 4.0, intensity: 0.76, warm: 0.95 },
  // 6. 西一楼实验室临湖东立面
  { type: 'strip', ax: -133, az: 55, bx: -133, bz: 95, dx: 1, dz: 0, reach: 11.5, sideSpread: 3.5, intensity: 0.60, warm: 0.84 },
  // 7. 东二楼实验楼临湖西立面
  { type: 'strip', ax: 56, az: -52, bx: 56, bz: 12, dx: -1, dz: 0, reach: 12.5, sideSpread: 4.0, intensity: 0.66, warm: 0.88 },
  // 8. 东侧三层通高门洞
  { type: 'strip', ax: 55, az: 12, bx: 54.5, bz: 34, dx: -1, dz: 0, reach: 14.0, sideSpread: 4.0, intensity: 0.76, warm: 0.96 },
  // 9. 东三楼临湖半岛展厅/体育馆（西、南、东三面临水）
  { type: 'strip', ax: 54, az: 35, bx: 54, bz: 79, dx: -1, dz: 0, reach: 13.5, sideSpread: 4.0, intensity: 0.76, warm: 0.92 },
  { type: 'strip', ax: 56, az: 80, bx: 116, bz: 81, dx: 0, dz: 1, reach: 15.0, sideSpread: 4.5, intensity: 0.80, warm: 0.90 },
  { type: 'strip', ax: 118, az: 36, bx: 118, bz: 78, dx: 1, dz: 0, reach: 11.0, sideSpread: 3.5, intensity: 0.62, warm: 0.88 },
  // 10. 西南钢拱肋玻璃拱桥（桥下冰青/暖香槟弧光倒影）
  { type: 'omniSeg', ax: -179, az: 95, bx: -161, bz: 122, reach: 10.5, intensity: 0.82, warm: 0.48 },
  // 11. 东岸亲水木栈桥（精准对齐延长后的双岸落点 (99.4,24.0) ↔ (154.4,2.4)）
  { type: 'omniSeg', ax: 99.4, az: 24.0, bx: 154.4, bz: 2.4, reach: 7.5, intensity: 0.54, warm: 0.84 },
  // 12. 东岸六角木吊顶临湖亭（东水渠温润暖金灯笼倒影）
  { type: 'point', cx: 133, cz: -24, reach: 15.5, intensity: 0.92, warm: 1.0 },
  // 13. 南岸与东岸环湖步道庭院柱灯克制金辉倒影
  { type: 'point', cx: 60, cz: 148, reach: 9.5, intensity: 0.36, warm: 1.0 },
  { type: 'point', cx: -18, cz: 157, reach: 9.5, intensity: 0.36, warm: 1.0 },
  { type: 'point', cx: -88, cz: 122, reach: 9.5, intensity: 0.36, warm: 1.0 },
  { type: 'point', cx: 132, cz: -6, reach: 9.0, intensity: 0.34, warm: 1.0 },
  { type: 'point', cx: 164, cz: 39, reach: 9.5, intensity: 0.34, warm: 1.0 },
];

function sampleNightReflectionAt(px, pz) {
  let maxMask = 0;
  let accumMask = 0;
  let warmWeighted = 0;

  for (let i = 0; i < NIGHT_REFLECTION_EMITTERS.length; i++) {
    const em = NIGHT_REFLECTION_EMITTERS[i];
    let contrib = 0;

    if (em.type === 'strip') {
      const abx = em.bx - em.ax;
      const abz = em.bz - em.az;
      const segLen = Math.hypot(abx, abz) || 1;
      const tx = abx / segLen;
      const tz = abz / segLen;
      const rx = px - em.ax;
      const rz = pz - em.az;
      const along = rx * tx + rz * tz;
      const clampedAlong = clamp(along, 0, segLen);
      const overflow = Math.abs(along - clampedAlong);
      const qx = em.ax + tx * clampedAlong;
      const qz = em.az + tz * clampedAlong;
      const vx = px - qx;
      const vz = pz - qz;
      const forward = vx * em.dx + vz * em.dz;

      if (forward > -1.4 && forward < em.reach && overflow < em.sideSpread * 1.8) {
        const fwdNorm = clamp(Math.max(0, forward) / em.reach, 0, 1);
        const fwdFalloff = Math.pow(1 - fwdNorm, 2.35) * smoothstep(-1.4, 1.2, forward);
        const sideFalloff = 1 - smoothstep(0, em.sideSpread * 1.45, overflow);
        const organicBay =
          0.90 +
          0.06 * Math.sin(clampedAlong * 0.23 + i * 1.7) +
          0.04 * Math.cos(clampedAlong * 0.59 - i * 0.9);
        contrib = em.intensity * fwdFalloff * sideFalloff * organicBay;
      }
    } else if (em.type === 'omniSeg') {
      const d = Math.sqrt(distToSegmentSq(px, pz, em.ax, em.az, em.bx, em.bz));
      if (d < em.reach) {
        const t = 1 - d / em.reach;
        contrib = em.intensity * Math.pow(t, 2.3);
      }
    } else {
      const d = Math.hypot(px - em.cx, pz - em.cz);
      if (d < em.reach) {
        const t = 1 - d / em.reach;
        contrib = em.intensity * Math.pow(t, 2.3);
      }
    }

    if (contrib > 0.001) {
      if (contrib > maxMask) maxMask = contrib;
      accumMask += contrib * 0.35;
      warmWeighted += contrib * em.warm;
    }
  }

  const totalMask = clamp(maxMask * 0.78 + Math.min(0.85, accumMask) * 0.34, 0, 1);
  const warmMix = accumMask > 1e-4 ? clamp(warmWeighted / (accumMask / 0.35), 0, 1) : 0.9;
  return [totalMask, warmMix];
}

/**
 * 预计算 512×384 RGBA 高精度湖泊光学距离场与夜间建筑倒影贴图（~8ms 启动计算，768KB 显存）
 */
function buildLakeFieldTexture(pts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0];
    const z = pts[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const pad = 8;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;

  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;

  const width = 512;
  const height = 384;
  const data = new Uint8Array(width * height * 4);
  const segCount = pts.length;

  const tilesX = 16;
  const tilesZ = 12;
  const tileW = spanX / tilesX;
  const tileH = spanZ / tilesZ;
  const tileRadius = Math.hypot(tileW * 0.5, tileH * 0.5);
  const tileLists = new Array(tilesX * tilesZ);

  for (let tz = 0; tz < tilesZ; tz++) {
    const cz = minZ + (tz + 0.5) * tileH;
    for (let tx = 0; tx < tilesX; tx++) {
      const cx = minX + (tx + 0.5) * tileW;
      let minCenterDist = Infinity;
      const dists = new Float32Array(segCount);
      for (let s = 0; s < segCount; s++) {
        const a = pts[s];
        const b = pts[(s + 1) % segCount];
        const d = Math.sqrt(distToSegmentSq(cx, cz, a[0], a[1], b[0], b[1]));
        dists[s] = d;
        if (d < minCenterDist) minCenterDist = d;
      }
      const cutoff = minCenterDist + tileRadius * 2.05;
      const list = [];
      for (let s = 0; s < segCount; s++) {
        if (dists[s] <= cutoff) list.push(s);
      }
      tileLists[tz * tilesX + tx] = list;
    }
  }

  const crossings = [];
  for (let iz = 0; iz < height; iz++) {
    const wz = minZ + ((iz + 0.5) / height) * spanZ;
    const tz = Math.min(tilesZ - 1, Math.floor(((iz + 0.5) / height) * tilesZ));

    crossings.length = 0;
    for (let s = 0; s < segCount; s++) {
      const a = pts[s];
      const b = pts[(s + 1) % segCount];
      if ((a[1] > wz) !== (b[1] > wz)) {
        const cx = a[0] + ((wz - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        crossings.push(cx);
      }
    }
    crossings.sort((u, v) => u - v);

    let crossIdx = 0;
    let inside = false;
    const rowOffset = iz * width * 4;

    for (let ix = 0; ix < width; ix++) {
      const wx = minX + ((ix + 0.5) / width) * spanX;
      while (crossIdx < crossings.length && crossings[crossIdx] <= wx) {
        inside = !inside;
        crossIdx++;
      }

      const tx = Math.min(tilesX - 1, Math.floor(((ix + 0.5) / width) * tilesX));
      const candidates = tileLists[tz * tilesX + tx];
      let minSq = Infinity;
      for (let k = 0; k < candidates.length; k++) {
        const s = candidates[k];
        const a = pts[s];
        const b = pts[(s + 1) % segCount];
        const dSq = distToSegmentSq(wx, wz, a[0], a[1], b[0], b[1]);
        if (dSq < minSq) minSq = dSq;
      }

      const rawDist = Math.sqrt(minSq);
      const signedWallDist = (inside ? rawDist : -rawDist) - REVETMENT_INNER_OFFSET;

      const rByte = Math.round(clamp((signedWallDist + 2.0) / 8.0, 0, 1) * 255);
      const gByte = Math.round(clamp(Math.max(0, signedWallDist) / 48.0, 0, 1) * 255);

      let bByte = 0;
      let aByte = 225;
      if (signedWallDist > -4.0) {
        const [reflMask, warmMix] = sampleNightReflectionAt(wx, wz);
        bByte = Math.round(reflMask * 255);
        aByte = Math.round(warmMix * 255);
      }

      const idx = rowOffset + ix * 4;
      data[idx] = rByte;
      data[idx + 1] = gByte;
      data[idx + 2] = bByte;
      data[idx + 3] = aByte;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;

  return {
    texture,
    bounds: new THREE.Vector4(minX, minZ, 1 / spanX, 1 / spanZ),
  };
}

/**
 * 对 ShapeGeometry 进行两轮水密 1-to-4 均匀细分（零 T-Junction，紧凑索引缓冲），
 * 并为每个顶点写入精确的岸距与浮岛最短距离属性 aShoreDist
 */
function buildTessellatedWaterGeometry(lakeShape, bounds) {
  const baseGeo = new THREE.ShapeGeometry(lakeShape, 1);
  baseGeo.rotateX(-Math.PI / 2);

  const posAttr = baseGeo.attributes.position;
  const vertsX = [];
  const vertsZ = [];
  for (let i = 0; i < posAttr.count; i++) {
    vertsX.push(posAttr.getX(i));
    vertsZ.push(posAttr.getZ(i));
  }

  let indices = [];
  if (baseGeo.index) {
    const idxArr = baseGeo.index.array;
    for (let i = 0; i < idxArr.length; i++) indices.push(idxArr[i]);
  } else {
    for (let i = 0; i < posAttr.count; i++) indices.push(i);
  }
  baseGeo.dispose();

  for (let pass = 0; pass < 2; pass++) {
    const nextIndices = [];
    const midpointCache = new Map();

    const getMidpoint = (i0, i1) => {
      const a = i0 < i1 ? i0 : i1;
      const b = i0 < i1 ? i1 : i0;
      const key = `${a}_${b}`;
      const existing = midpointCache.get(key);
      if (existing !== undefined) return existing;
      const idx = vertsX.length;
      vertsX.push((vertsX[a] + vertsX[b]) * 0.5);
      vertsZ.push((vertsZ[a] + vertsZ[b]) * 0.5);
      midpointCache.set(key, idx);
      return idx;
    };

    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];
      const m01 = getMidpoint(i0, i1);
      const m12 = getMidpoint(i1, i2);
      const m20 = getMidpoint(i2, i0);
      nextIndices.push(
        i0, m01, m20,
        m01, i1, m12,
        m20, m12, i2,
        m01, m12, m20
      );
    }
    indices = nextIndices;
  }

  const vCount = vertsX.length;
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  const shoreDists = new Float32Array(vCount);

  for (let i = 0; i < vCount; i++) {
    const x = vertsX[i];
    const z = vertsZ[i];
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = z;

    normals[i * 3] = 0;
    normals[i * 3 + 1] = 1;
    normals[i * 3 + 2] = 0;

    uvs[i * 2] = (x - bounds.x) * bounds.z;
    uvs[i * 2 + 1] = (z - bounds.y) * bounds.w;

    const wallDist = Math.max(0, shortestDistanceToShore(x, z, LAKE_SHORELINE) - REVETMENT_INNER_OFFSET);
    const islDist = Math.max(0, shortestDistanceToIslands(x, z));
    shoreDists[i] = Math.min(wallDist, islDist);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aShoreDist', new THREE.BufferAttribute(shoreDists, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 沿闭合岸线扫掠自定义多折线截面（[offsetFromShore, y]），生成真正水密连续、斜接无裂缝的倒角阶梯驳岸实体
 * offset > 0 表示朝陆地外扩，offset < 0 表示朝湖心内伸；每个截面折面独立法线以呈现利落 CNC 倒角高光！
 */
function buildProfiledShoreRing(pts, profile, material, castShadow = false) {
  const n = pts.length;
  const miters = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const dx1 = curr[0] - prev[0];
    const dz1 = curr[1] - prev[1];
    const l1 = Math.hypot(dx1, dz1) || 1;
    const dx2 = next[0] - curr[0];
    const dz2 = next[1] - curr[1];
    const l2 = Math.hypot(dx2, dz2) || 1;

    // LAKE_SHORELINE 在 XZ 平面（X 右、Z 下）有向面积为负（逆时针），故朝湖外（陆地侧）的法线为 (-dz, +dx)
    const n1x = -dz1 / l1;
    const n1z = dx1 / l1;
    const n2x = -dz2 / l2;
    const n2z = dx2 / l2;

    let mx = n1x + n2x;
    let mz = n1z + n2z;
    const mLen = Math.hypot(mx, mz);
    if (mLen < 0.01) {
      mx = n1x;
      mz = n1z;
    } else {
      mx /= mLen;
      mz /= mLen;
    }
    const dot = Math.max(0.48, mx * n1x + mz * n1z);
    const miterScale = Math.min(1.75, 1 / dot);
    miters[i] = [mx * miterScale, mz * miterScale];
  }

  const positions = [];
  const indices = [];

  const pushQuad = (a, b, c, d) => {
    const base = positions.length / 3;
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let p = 0; p < profile.length - 1; p++) {
    const [offA, yA] = profile[p];
    const [offB, yB] = profile[p + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const c1 = pts[i];
      const c2 = pts[j];
      const m1 = miters[i];
      const m2 = miters[j];

      const p1A = [c1[0] + m1[0] * offA, yA, c1[1] + m1[1] * offA];
      const p1B = [c1[0] + m1[0] * offB, yB, c1[1] + m1[1] * offB];
      const p2B = [c2[0] + m2[0] * offB, yB, c2[1] + m2[1] * offB];
      const p2A = [c2[0] + m2[0] * offA, yA, c2[1] + m2[1] * offA];

      // 配合逆时针岸线与陆侧法线 (-dz, +dx)：(p1A, p2A, p2B, p1B) 保证全部顶面朝 +Y、外墙朝陆、内墙朝湖
      pushQuad(p1A, p2A, p2B, p1B);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = castShadow;
  return mesh;
}

/**
 * 构建晶透玉青树脂物理光学水面材质
 * 保留 Three.js PBR 实时软阴影 + PMREM 棚拍软箱高光 + ACES 色调映射 + v2.1 有机波纹与夜景倒影
 */
function createOpticalWaterMaterial(waterNormalTex, shoreField) {
  const islandPosRot = [];
  const islandRadii = [];
  for (let i = 0; i < 3; i++) {
    const isl = FLOATING_ISLANDS[i] || { x: 9999, z: 9999, rx: 1, rz: 1, rot: 0 };
    islandPosRot.push(new THREE.Vector4(isl.x, isl.z, Math.cos(isl.rot), Math.sin(isl.rot)));
    islandRadii.push(new THREE.Vector2(isl.rx * ISLAND_WATERLINE_SCALE, isl.rz * ISLAND_WATERLINE_SCALE));
  }

  const uniforms = {
    uTime: { value: 0 },
    uDuskFactor: { value: 0 },
    uNightFactor: { value: 0 },
    uShoreSdfMap: { value: shoreField.texture },
    uWaterNormalMap: { value: waterNormalTex },
    uLakeBounds: { value: shoreField.bounds },
    // 晶莹玉青树脂微缩水体日间默认色阶（对齐 Art Spec #9）
    uShallowCol: { value: new THREE.Color('#6ec4be') },
    uMidCol: { value: new THREE.Color('#2c838f') },
    uDeepCol: { value: new THREE.Color('#1d5664') },
    uSkyReflCol: { value: new THREE.Color('#d8ecf0') },
    uMeniscusCol: { value: new THREE.Color('#c2f0f2') },
    uGlintCol: { value: new THREE.Color('#fff5e4') },
    uSunDir: { value: new THREE.Vector3(-205, 255, 170).normalize() },
    uIslandsPosRot: { value: islandPosRot },
    uIslandsRadii: { value: islandRadii },
  };

  const waterMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.085,
    metalness: 0.14,
    transparent: true,
    opacity: 0.9,
    envMapIntensity: 1.35,
    depthWrite: false,
  });

  waterMat.customProgramCacheKey = () => 'ioply-optical-lake-water-v2-crystal';

  waterMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aShoreDist;
        varying vec3 vWaterWorldPos;
        varying float vShoreDist;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWaterWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vShoreDist = aShoreDist;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uDuskFactor;
        uniform float uNightFactor;
        uniform sampler2D uShoreSdfMap;
        uniform sampler2D uWaterNormalMap;
        uniform vec4 uLakeBounds;
        uniform vec3 uShallowCol;
        uniform vec3 uMidCol;
        uniform vec3 uDeepCol;
        uniform vec3 uSkyReflCol;
        uniform vec3 uMeniscusCol;
        uniform vec3 uGlintCol;
        uniform vec3 uSunDir;
        uniform vec4 uIslandsPosRot[3];
        uniform vec2 uIslandsRadii[3];

        varying vec3 vWaterWorldPos;
        varying float vShoreDist;

        float lake_sdEllipse( vec2 p, vec2 ab ) {
          vec2 q = p / ab;
          float k0 = length( q );
          if ( k0 < 1e-4 ) return -min( ab.x, ab.y );
          float k1 = max( length( p / ( ab * ab ) ), 1e-5 );
          return k0 * ( k0 - 1.0 ) / k1;
        }

        float lake_islandDist( vec2 xz, out vec2 nearestDir ) {
          float minD = 1e5;
          nearestDir = vec2( 0.0 );
          for ( int i = 0; i < 3; i ++ ) {
            vec4 pr = uIslandsPosRot[i];
            vec2 d = xz - pr.xy;
            vec2 local = vec2( d.x * pr.z - d.y * pr.w, d.x * pr.w + d.y * pr.z );
            float sd = lake_sdEllipse( local, uIslandsRadii[i] );
            if ( sd < minD ) {
              minD = sd;
              float lenD = max( length( d ), 1e-4 );
              nearestDir = d / lenD;
            }
          }
          return minD;
        }

        float lake_hash21( vec2 p ) {
          p = fract( p * vec2( 123.34, 456.21 ) );
          p += dot( p, p + 45.32 );
          return fract( p.x * p.y );
        }

        float lake_vnoise( vec2 p ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          vec2 u = f * f * ( 3.0 - 2.0 * f );
          float a = lake_hash21( i );
          float b = lake_hash21( i + vec2( 1.0, 0.0 ) );
          float c = lake_hash21( i + vec2( 0.0, 1.0 ) );
          float d = lake_hash21( i + vec2( 1.0, 1.0 ) );
          return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
        }

        vec2 lake_sampleRipples( vec2 xz, float t, float shoreDist, float islDist, vec2 islDir ) {
          // 1. 保留 v2.1-polished 4 组非正交、非整倍频且经有机噪波相位弯曲的自然波列
          float phaseWarp = lake_vnoise( xz * 0.065 + vec2( t * 0.035, -t * 0.025 ) ) * 2.6;
          vec2 d1 = vec2( 0.9816, 0.1908 );   // 11°
          vec2 d2 = vec2( 0.6820, 0.7314 );   // 47°
          vec2 d3 = vec2( -0.3907, 0.9205 );  // 113°
          vec2 d4 = vec2( -0.9336, 0.3584 );  // 159°

          float w1 = cos( dot( xz, d1 ) * 0.23 + phaseWarp * 0.65 - t * 0.68 ) * 0.34;
          float w2 = cos( dot( xz, d2 ) * 0.41 - phaseWarp * 0.85 + t * 0.91 ) * 0.27;
          float w3 = cos( dot( xz, d3 ) * 0.67 + phaseWarp * 1.10 - t * 1.14 ) * 0.22;
          float w4 = cos( dot( xz, d4 ) * 1.19 - phaseWarp * 0.95 + t * 1.42 ) * 0.17;
          vec2 organicSlope = d1 * w1 + d2 * w2 + d3 * w3 + d4 * w4;

          // 2. 叠加两层大倾角错位细微法线贴图（精致丝绸微澜，无周期感）
          vec2 uv1 = xz * 0.0155 + vec2( t * 0.010, t * 0.007 );
          vec2 n1 = texture2D( uWaterNormalMap, uv1 ).xy * 2.0 - 1.0;

          vec2 rotXz = vec2( xz.x * 0.7986 - xz.y * 0.6018, xz.x * 0.6018 + xz.y * 0.7986 );
          vec2 uv2 = rotXz * 0.039 + vec2( -t * 0.013, t * 0.0095 );
          vec2 n2Raw = texture2D( uWaterNormalMap, uv2 ).xy * 2.0 - 1.0;
          vec2 n2 = vec2( n2Raw.x * 0.7986 + n2Raw.y * 0.6018, -n2Raw.x * 0.6018 + n2Raw.y * 0.7986 );

          float calmNearShore = mix( 0.42, 1.0, smoothstep( 0.0, 2.2, shoreDist ) );
          vec2 slope = ( organicSlope * 0.105 + ( n1 * 0.55 + n2 * 0.45 ) * 0.125 ) * calmNearShore;

          // 3. 浮岛周边极柔和同心水纹
          float ringEnv = exp( -max( 0.0, islDist ) * 0.78 ) * smoothstep( 0.0, 0.25, islDist );
          float ringWave = cos( max( 0.0, islDist ) * 4.4 - t * 1.35 ) * ringEnv * 0.034;
          slope += islDir * ringWave;

          return slope;
        }
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 lakeXz = vWaterWorldPos.xz;
        vec2 lakeSdfUv = clamp( ( lakeXz - uLakeBounds.xy ) * uLakeBounds.zw, vec2( 0.001 ), vec2( 0.999 ) );
        vec4 lakeSdf = texture2D( uShoreSdfMap, lakeSdfUv );

        float nearWallDist = lakeSdf.r * 8.0 - 2.0;
        float farWallDist = lakeSdf.g * 48.0;
        float wallDist = mix( max( 0.0, nearWallDist ), farWallDist, smoothstep( 3.2, 5.2, nearWallDist ) );

        vec2 lakeIslDir;
        float lakeIslDist = lake_islandDist( lakeXz, lakeIslDir );
        float lakeShoreDist = min( wallDist, max( 0.0, lakeIslDist ) );
        lakeShoreDist = mix( lakeShoreDist, max( 0.0, vShoreDist ), 0.015 );

        // Beer-Lambert 连续晶透树脂光学水深渐变（清透翡翠浅岸 -> 玉青中水 -> 深邃青碧湖心）
        float organicMod = 0.055 * sin( lakeXz.x * 0.028 + lakeXz.y * 0.022 )
                         + 0.040 * cos( lakeXz.x * 0.019 - lakeXz.y * 0.034 );
        float tShallowMid = 1.0 - exp( -lakeShoreDist / 5.4 );
        float tMidDeep = 1.0 - exp( -lakeShoreDist / 16.5 );
        float shallowMix = smoothstep( 0.0, 1.0, clamp( tShallowMid + organicMod * tShallowMid, 0.0, 1.0 ) );
        float deepMix = smoothstep( 0.05, 1.0, clamp( tMidDeep + organicMod * 0.45, 0.0, 1.0 ) );

        vec3 waterBodyCol = mix( uShallowCol, uMidCol, shallowMix );
        waterBodyCol = mix( waterBodyCol, uDeepCol, deepMix * 0.88 );

        // 浅岸 0–4m 极细腻晶透水底柔和焦散明度微提（仅日间呈现高端亚克力/环氧树脂通透感）
        float dayWeight = 1.0 - max( uDuskFactor, uNightFactor );
        float shallowGlowBand = ( 1.0 - smoothstep( 0.35, 4.2, lakeShoreDist ) ) * smoothstep( 0.0, 0.45, lakeShoreDist );
        float causticSoft = lake_vnoise( lakeXz * 0.28 + vec2( uTime * 0.14, -uTime * 0.11 ) );
        waterBodyCol += vec3( 0.045, 0.105, 0.105 ) * shallowGlowBand * ( 0.45 + 0.55 * causticSoft ) * dayWeight;

        // 驳岸挑檐压顶 & 浮岛下缘扎实接触暗影（强化立体微缩体量感）
        float shoreContactAO = mix( 0.74, 1.0, smoothstep( 0.0, 0.72, lakeShoreDist ) );
        float islContactAO = mix( 0.72, 1.0, smoothstep( 0.0, 0.95, max( 0.0, lakeIslDist ) ) );
        waterBodyCol *= shoreContactAO * islContactAO;

        // 白天临近 14.5m 高建筑立面的细微体量投影压暗
        waterBodyCol *= ( 1.0 - dayWeight * lakeSdf.b * 0.075 );

        // Beer-Lambert 连续晶透透明度：浅岸 0.72 透见水下石阶与岛基 -> 深水 0.945 温润半透玉质
        float beerAlpha = mix( 0.72, 0.945, 1.0 - exp( -lakeShoreDist / 3.8 ) );
        beerAlpha = mix( beerAlpha, min( 0.985, beerAlpha + 0.055 ), max( uDuskFactor, uNightFactor ) );

        diffuseColor.rgb = waterBodyCol;
        diffuseColor.a = beerAlpha;
        `
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float meniscusRough = ( 1.0 - smoothstep( 0.0, 1.15, lakeShoreDist ) ) * 0.07;
        float modeRough = mix( 0.085, 0.062, max( uDuskFactor, uNightFactor ) );
        roughnessFactor = clamp( modeRough + meniscusRough, 0.045, 0.24 );
        `
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec2 lakeWaveSlope = lake_sampleRipples( lakeXz, uTime, lakeShoreDist, lakeIslDist, lakeIslDir );
        vec3 lakeWorldNormal = normalize( vec3( lakeWaveSlope.x, 1.0, lakeWaveSlope.y ) );
        normal = normalize( ( viewMatrix * vec4( lakeWorldNormal, 0.0 ) ).xyz );
        `
      )
      .replace(
        '#include <opaque_fragment>',
        `
        // 1. 物理菲涅尔（Schlick Fresnel）掠射棚拍柔光与天幕反射（克制不泛白，保留玉青水体饱和度）
        vec3 lakeViewDir = normalize( cameraPosition - vWaterWorldPos );
        float lakeNdotV = clamp( dot( lakeWorldNormal, lakeViewDir ), 0.0, 1.0 );
        float lakeFresnel = 0.03 + 0.97 * pow( 1.0 - lakeNdotV, 4.4 );
        float reflStrength = mix( 0.36, 0.56, uDuskFactor );
        reflStrength = mix( reflStrength, 0.65, uNightFactor );
        outgoingLight = mix( outgoingLight, uSkyReflCol, lakeFresnel * reflStrength );

        // 2. 日/月微澜丝绸镜面高光（精准微光，绝不出现零碎白噪点）
        vec3 lakeHalfVec = normalize( uSunDir + lakeViewDir );
        float specBroad = pow( max( dot( lakeWorldNormal, lakeHalfVec ), 0.0 ), 110.0 );
        float specSharp = pow( max( dot( lakeWorldNormal, lakeHalfVec ), 0.0 ), 420.0 );
        float glintAmt = mix( 0.42, 0.64, uDuskFactor );
        glintAmt = mix( glintAmt, 0.42, uNightFactor );
        outgoingLight += uGlintCol * ( specBroad * 0.16 + specSharp * 0.78 ) * glintAmt;

        // 3. 精致磨砂冰青亲水半月面（0.0–1.25m 沿倒角暖石驳岸与生态岛轻柔贴合折射光边）
        float shoreBreath = 0.12 * sin( uTime * 1.1 + lakeXz.x * 0.21 + lakeXz.y * 0.17 )
                          + 0.06 * cos( uTime * 0.78 - lakeXz.x * 0.29 + lakeXz.y * 0.25 );
        float mDist = max( 0.0, lakeShoreDist + shoreBreath );
        float meniscusCore = ( 1.0 - smoothstep( 0.03, 0.50, mDist ) ) * smoothstep( 0.0, 0.08, lakeShoreDist + 0.025 );
        float meniscusHalo = ( 1.0 - smoothstep( 0.0, 1.20, mDist ) ) * 0.28;
        float islRippleVis = ( 1.0 - smoothstep( 0.0, 2.7, max( 0.0, lakeIslDist ) ) )
                           * smoothstep( 0.0, 0.28, lakeIslDist )
                           * ( 0.5 + 0.5 * sin( lakeIslDist * 4.8 - uTime * 1.35 ) ) * 0.24;
        float meniscusMask = clamp( meniscusCore * 0.52 + meniscusHalo + islRippleVis, 0.0, 0.78 );
        float meniscusVis = mix( 0.50, 0.34, uDuskFactor );
        meniscusVis = mix( meniscusVis, 0.22, uNightFactor );
        outgoingLight = mix( outgoingLight, uMeniscusCol, meniscusMask * meniscusVis );

        // 4. 保留 v2.1-polished 暮光/夜间贴岸 2–16m 柔润丝缕建筑倒影（零网格/零过曝）
        float nightReflDrive = clamp( smoothstep( 0.35, 1.0, uDuskFactor ) * 0.34 + uNightFactor * 0.96, 0.0, 1.0 );
        if ( nightReflDrive > 0.005 ) {
          vec2 reflUv = clamp(
            lakeSdfUv + vec2( lakeWaveSlope.x * 0.011, lakeWaveSlope.y * 0.015 ),
            vec2( 0.001 ),
            vec2( 0.999 )
          );
          vec4 reflSample = texture2D( uShoreSdfMap, reflUv );
          float reflMask = reflSample.b;
          float warmWeight = reflSample.a;

          if ( reflMask > 0.004 ) {
            vec2 viewHoriz = normalize( lakeViewDir.xz + vec2( 1e-4, 0.0 ) );
            vec2 viewPerp = vec2( -viewHoriz.y, viewHoriz.x );
            float acrossView = dot( lakeXz, viewPerp );
            float alongView = dot( lakeXz, viewHoriz );

            float ribbonWarp = lake_vnoise( lakeXz * 0.13 + vec2( uTime * 0.055, -uTime * 0.038 ) ) * 2.9;
            float f1 = sin( alongView * 1.38 + acrossView * 0.17 + ribbonWarp + lakeWaveSlope.y * 7.5 - uTime * 0.88 );
            float f2 = sin( alongView * 2.53 - acrossView * 0.24 + ribbonWarp * 1.41 + lakeWaveSlope.x * 8.2 + uTime * 1.21 );
            float f3 = sin( alongView * 0.74 + acrossView * 0.09 - ribbonWarp * 0.78 - uTime * 0.56 );
            float f4 = sin( alongView * 3.85 + acrossView * 0.31 - ribbonWarp * 1.15 + uTime * 1.54 );
            float calmPatch = lake_vnoise( vec2( acrossView * 0.075, alongView * 0.15 ) + vec2( 0.0, -uTime * 0.065 ) );

            float filament = 0.5 + 0.5 * ( f1 * 0.40 + f2 * 0.28 + f3 * 0.20 + f4 * 0.12 );
            float silkyMod = mix( 0.58, 1.14, smoothstep( 0.12, 0.92, filament * 0.66 + calmPatch * 0.34 ) );
            float fineSilkGlint = pow( smoothstep( 0.60, 0.98, filament * ( 0.65 + 0.55 * calmPatch ) ), 2.2 ) * 0.22;

            vec3 warmAmber = vec3( 0.95, 0.61, 0.25 );
            vec3 coolArch = vec3( 0.66, 0.80, 0.98 );
            vec3 reflCol = mix( coolArch, warmAmber, warmWeight );
            float fresnelBoost = mix( 0.72, 1.18, lakeFresnel );

            outgoingLight += reflCol * reflMask * ( silkyMod + fineSilkGlint ) * fresnelBoost * nightReflDrive * 0.34;
          }
        }

        diffuseColor.a = clamp( diffuseColor.a + lakeFresnel * 0.15 + meniscusMask * 0.10, 0.0, 0.995 );

        #include <opaque_fragment>
        `
      );
  };

  return { waterMat, uniforms };
}

export function buildLakeSystem(maxAnisotropy = 8) {
  const group = new THREE.Group();
  group.name = 'LakeSystem';

  const lakeShape = pointsToShape(LAKE_SHORELINE);

  // 1. 单层不透明深玉青防漏光湖底板（y = -2.20，与驳岸底及浮岛底座严密咬合，0 Z-Fighting）
  const basinGeo = new THREE.ShapeGeometry(lakeShape, 1);
  basinGeo.rotateX(-Math.PI / 2);
  const basinMat = new THREE.MeshStandardMaterial({
    color: '#1f4a54',
    roughness: 0.9,
    metalness: 0.02,
  });
  const basinMesh = new THREE.Mesh(basinGeo, basinMat);
  basinMesh.name = 'LakeDeepBasinBacking';
  basinMesh.position.y = -2.2;
  basinMesh.receiveShadow = true;
  basinMesh.castShadow = false;
  group.add(basinMesh);

  // 2. 高精度连续岸距晶透光学水面（1 Draw Call）
  const shoreField = buildLakeFieldTexture(LAKE_SHORELINE);
  const waterNormalTex = createWaterNormalTexture(maxAnisotropy);
  const waterGeo = buildTessellatedWaterGeometry(lakeShape, shoreField.bounds);
  const { waterMat, uniforms } = createOpticalWaterMaterial(waterNormalTex, shoreField);

  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'LakeOpticalWaterSurface';
  waterMesh.position.y = ELEVATIONS.WATER_SURFACE;
  waterMesh.receiveShadow = true;
  waterMesh.castShadow = false;
  waterMesh.renderOrder = -10;
  waterMesh.userData.noMerge = true;
  group.add(waterMesh);

  let texturesDisposed = false;
  const disposeCustomTextures = () => {
    if (texturesDisposed) return;
    texturesDisposed = true;
    shoreField.texture.dispose();
    waterNormalTex.dispose();
  };
  waterMat.addEventListener('dispose', disposeCustomTextures);

  // 3. 连续无缝斜接 3 阶精工倒角暖石驳岸（水下踏阶挡墙 + 深影凹槽 + 45° 倒角暖石压顶）
  const ashlarWallMat = new THREE.MeshStandardMaterial({
    color: '#9b9489',
    roughness: 0.68,
    metalness: 0.05,
  });
  const revealMat = new THREE.MeshStandardMaterial({
    color: '#5d5954',
    roughness: 0.62,
    metalness: 0.08,
  });
  const copingCapMat = new THREE.MeshStandardMaterial({
    color: '#c0b8ac',
    roughness: 0.56,
    metalness: 0.05,
  });

  // 3a. 下阶水下暖石挡墙 + 浅水隐约可见的水下护脚石阶（y = -0.82，稳固扎入湖底 y = -2.38）
  const wallProfile = [
    [0.64, -0.02],
    [-REVETMENT_INNER_OFFSET, -0.02],
    [-REVETMENT_INNER_OFFSET, -0.78],
    [-0.94, -0.84],
    [-0.94, -2.38],
  ];
  const ashlarWallMesh = buildProfiledShoreRing(LAKE_SHORELINE, wallProfile, ashlarWallMat, false);
  ashlarWallMesh.name = 'LakeGraniteRevetmentWall';

  // 3b. 挑檐下缘 6cm 深影建筑凹槽（#5D5954，在日间提供博物馆微缩模型锐利阴影分层）
  const revealProfile = [
    [0.58, 0.095],
    [-0.51, 0.095],
    [-0.51, -0.025],
    [-REVETMENT_INNER_OFFSET, -0.025],
  ];
  const revealMesh = buildProfiledShoreRing(LAKE_SHORELINE, revealProfile, revealMat, false);
  revealMesh.name = 'LakeEmbankmentShadowReveal';

  // 3c. 45° 精磨倒角暖石压顶（陆侧 +0.82 严密埋入草坪 y = -0.04 零漏缝，湖侧 -0.72 悬挑并封闭底面）
  const capTop = ELEVATIONS.REVETMENT_TOP + 0.06; // 0.20
  const copingProfile = [
    [0.82, -0.04],
    [0.82, capTop - 0.045],
    [0.76, capTop],
    [-0.66, capTop],
    [-0.72, capTop - 0.045],
    [-0.72, 0.09],
    [-0.50, 0.09],
  ];
  const copingCapMesh = buildProfiledShoreRing(LAKE_SHORELINE, copingProfile, copingCapMat, true);
  copingCapMesh.name = 'LakeGraniteCopingCap';

  group.add(ashlarWallMesh, revealMesh, copingCapMesh);

  // 4. 3 座扎根湖底的精工生态岛（InstancedMesh 控 Draw Call）+ 精准贴合杆顶芦苇丛（L1 修复）
  const islandSubBaseMat = new THREE.MeshStandardMaterial({ color: '#58625d', roughness: 0.82, metalness: 0.04 });
  const islandRimMat = new THREE.MeshStandardMaterial({ color: '#b4aba0', roughness: 0.62, metalness: 0.04 });
  const islandSoilMat = new THREE.MeshStandardMaterial({ color: '#617d57', roughness: 0.86, metalness: 0.0 });
  const reedStalkMat = new THREE.MeshStandardMaterial({ color: '#4d6c49', roughness: 0.80, metalness: 0.0 });
  const reedPlumeMat = new THREE.MeshStandardMaterial({ color: '#c8ae7d', roughness: 0.78, metalness: 0.0 });

  // 水下扎根湖底的石质锥台基础（y = -2.36 -> -0.52），避免晶透水面下显得漂浮
  const islandSubBaseGeo = new THREE.CylinderGeometry(1.04, 1.24, 1.84, 32);
  // 倒角暖石驳岸护圈（顶微收口呈精致倒角感）
  const islandRimGeo = new THREE.CylinderGeometry(0.98, 1.08, 0.44, 32);
  // 微隆起的丰润苔藓生态土丘
  const islandSoilGeo = new THREE.CylinderGeometry(0.84, 0.95, 0.36, 32);

  const islandSubBaseInst = new THREE.InstancedMesh(islandSubBaseGeo, islandSubBaseMat, FLOATING_ISLANDS.length);
  const islandRimInst = new THREE.InstancedMesh(islandRimGeo, islandRimMat, FLOATING_ISLANDS.length);
  const islandSoilInst = new THREE.InstancedMesh(islandSoilGeo, islandSoilMat, FLOATING_ISLANDS.length);
  islandSubBaseInst.name = 'LakeFloatingIslandFoundations';
  islandRimInst.name = 'LakeFloatingIslandRims';
  islandSoilInst.name = 'LakeFloatingIslandSoils';
  islandSubBaseInst.receiveShadow = true;
  islandRimInst.receiveShadow = true;
  islandRimInst.castShadow = true;
  islandSoilInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const reedData = [];

  FLOATING_ISLANDS.forEach((isl, idx) => {
    // 1) 水下基础：y 跨 [-2.36, -0.52]，深扎 -2.20 湖底 0.16m
    dummy.position.set(isl.x, -1.44, isl.z);
    dummy.rotation.set(0, isl.rot, 0);
    dummy.scale.set(isl.rx, 1, isl.rz);
    dummy.updateMatrix();
    islandSubBaseInst.setMatrixAt(idx, dummy.matrix);

    // 2) 水线倒角石圈：y 跨 [-0.74, -0.30]，稳稳咬合水面 -0.58 与水下基础
    dummy.position.set(isl.x, ELEVATIONS.WATER_SURFACE + 0.06, isl.z);
    dummy.updateMatrix();
    islandRimInst.setMatrixAt(idx, dummy.matrix);

    // 3) 生态苔藓草丘：y 跨 [-0.58, -0.22]
    dummy.position.set(isl.x, ELEVATIONS.WATER_SURFACE + 0.18, isl.z);
    dummy.updateMatrix();
    islandSoilInst.setMatrixAt(idx, dummy.matrix);

    const count = Math.round(isl.reedCount * 0.75);
    const cosR = Math.cos(isl.rot);
    const sinR = Math.sin(isl.rot);
    for (let k = 0; k < count; k++) {
      const a = (k * 2.399963) % (Math.PI * 2);
      const rNorm = Math.sqrt((k + 0.5) / count) * 0.80;
      const lx = Math.cos(a) * isl.rx * rNorm;
      const lz = Math.sin(a) * isl.rz * rNorm;
      reedData.push({
        wx: isl.x + lx * cosR + lz * sinR,
        wz: isl.z - lx * sinR + lz * cosR,
        h: 1.35 + ((k * 17) % 10) * 0.11,
        tiltX: (((k * 13) % 11) - 5) * 0.024,
        tiltZ: (((k * 29) % 11) - 5) * 0.024,
      });
    }
  });
  islandSubBaseInst.instanceMatrix.needsUpdate = true;
  islandRimInst.instanceMatrix.needsUpdate = true;
  islandSoilInst.instanceMatrix.needsUpdate = true;
  group.add(islandSubBaseInst, islandRimInst, islandSoilInst);

  const stalkGeo = new THREE.CylinderGeometry(0.026, 0.048, 1, 5);
  const plumeGeo = new THREE.ConeGeometry(0.088, 0.38, 5);
  const stalkInst = new THREE.InstancedMesh(stalkGeo, reedStalkMat, reedData.length);
  const plumeInst = new THREE.InstancedMesh(plumeGeo, reedPlumeMat, reedData.length);
  stalkInst.name = 'LakeIslandReedStalks';
  plumeInst.name = 'LakeIslandReedPlumes';

  const reedEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const tipOffset = new THREE.Vector3();

  reedData.forEach((rd, idx) => {
    // 芦苇根部深插土丘表面 (-0.22) 以下 0.08m（baseY = -0.30）
    const baseY = ELEVATIONS.WATER_SURFACE + 0.28;
    const rotY = idx * 0.7;
    reedEuler.set(rd.tiltX, rotY, rd.tiltZ, 'XYZ');

    const centerY = baseY + rd.h * 0.5;
    dummy.position.set(rd.wx, centerY, rd.wz);
    dummy.rotation.copy(reedEuler);
    dummy.scale.set(1, rd.h, 1);
    dummy.updateMatrix();
    stalkInst.setMatrixAt(idx, dummy.matrix);

    // L1 精确修复：沿同一 Euler 姿态求取芦苇杆顶端世界坐标，令芦苇穗严密套在杆尖（内嵌 5cm 零脱离）
    tipOffset.set(0, rd.h * 0.5 + 0.14, 0).applyEuler(reedEuler);
    dummy.position.set(rd.wx + tipOffset.x, centerY + tipOffset.y, rd.wz + tipOffset.z);
    dummy.rotation.copy(reedEuler);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    plumeInst.setMatrixAt(idx, dummy.matrix);
  });
  stalkInst.instanceMatrix.needsUpdate = true;
  plumeInst.instanceMatrix.needsUpdate = true;
  group.add(stalkInst, plumeInst);

  // 5. 预分配日间 / 暮光 / 夜间调色板（update 内零堆内存分配！）
  const palettes = {
    day: {
      shallow: new THREE.Color('#6ec4be'),
      mid: new THREE.Color('#2c838f'),
      deep: new THREE.Color('#1d5664'),
      skyRefl: new THREE.Color('#d8ecf0'),
      meniscus: new THREE.Color('#c2f0f2'),
      glint: new THREE.Color('#fff5e4'),
      basin: new THREE.Color('#1f4a54'),
      sunDir: new THREE.Vector3(-205, 255, 170).normalize(),
      envIntensity: 1.35,
    },
    dusk: {
      shallow: new THREE.Color('#2d6c7e'),
      mid: new THREE.Color('#1d4860'),
      deep: new THREE.Color('#143348'),
      skyRefl: new THREE.Color('#4f7ca8'),
      meniscus: new THREE.Color('#7ab4c6'),
      glint: new THREE.Color('#ffbe82'),
      basin: new THREE.Color('#0f2636'),
      sunDir: new THREE.Vector3(-245, 96, 130).normalize(),
      envIntensity: 1.05,
    },
    night: {
      shallow: new THREE.Color('#102c44'),
      mid: new THREE.Color('#091b2e'),
      deep: new THREE.Color('#06111f'),
      skyRefl: new THREE.Color('#183052'),
      meniscus: new THREE.Color('#3c6886'),
      glint: new THREE.Color('#bddaff'),
      basin: new THREE.Color('#040a13'),
      sunDir: new THREE.Vector3(170, 220, -145).normalize(),
      envIntensity: 0.72,
    },
  };

  const tmpCol = new THREE.Color();
  const tmpDir = new THREE.Vector3();

  function blendColorTriad(target, dayC, duskC, nightC, d, n) {
    tmpCol.copy(dayC).lerp(duskC, d);
    target.copy(tmpCol).lerp(nightC, n);
  }

  let disposed = false;

  return {
    group,
    update(dt, duskFactor = 0, nightFactor = 0) {
      if (disposed) return;
      const safeDt = Math.min(Math.max(dt || 0, 0), 0.1);
      uniforms.uTime.value += safeDt;

      const d = clamp(Number.isFinite(duskFactor) ? duskFactor : 0, 0, 1);
      const n = clamp(Number.isFinite(nightFactor) ? nightFactor : 0, 0, 1);
      uniforms.uDuskFactor.value = d;
      uniforms.uNightFactor.value = n;

      const { day, dusk, night } = palettes;
      blendColorTriad(uniforms.uShallowCol.value, day.shallow, dusk.shallow, night.shallow, d, n);
      blendColorTriad(uniforms.uMidCol.value, day.mid, dusk.mid, night.mid, d, n);
      blendColorTriad(uniforms.uDeepCol.value, day.deep, dusk.deep, night.deep, d, n);
      blendColorTriad(uniforms.uSkyReflCol.value, day.skyRefl, dusk.skyRefl, night.skyRefl, d, n);
      blendColorTriad(uniforms.uMeniscusCol.value, day.meniscus, dusk.meniscus, night.meniscus, d, n);
      blendColorTriad(uniforms.uGlintCol.value, day.glint, dusk.glint, night.glint, d, n);
      blendColorTriad(basinMat.color, day.basin, dusk.basin, night.basin, d, n);

      tmpDir.copy(day.sunDir).lerp(dusk.sunDir, d).lerp(night.sunDir, n).normalize();
      uniforms.uSunDir.value.copy(tmpDir);

      const envDayDusk = THREE.MathUtils.lerp(day.envIntensity, dusk.envIntensity, d);
      waterMat.envMapIntensity = THREE.MathUtils.lerp(envDayDusk, night.envIntensity, n);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      waterMat.removeEventListener('dispose', disposeCustomTextures);
      disposeCustomTextures();

      basinGeo.dispose();
      waterGeo.dispose();
      ashlarWallMesh.geometry.dispose();
      revealMesh.geometry.dispose();
      copingCapMesh.geometry.dispose();
      islandSubBaseGeo.dispose();
      islandRimGeo.dispose();
      islandSoilGeo.dispose();
      stalkGeo.dispose();
      plumeGeo.dispose();

      basinMat.dispose();
      waterMat.dispose();
      ashlarWallMat.dispose();
      revealMat.dispose();
      copingCapMat.dispose();
      islandSubBaseMat.dispose();
      islandRimMat.dispose();
      islandSoilMat.dispose();
      reedStalkMat.dispose();
      reedPlumeMat.dispose();
    },
  };
}
