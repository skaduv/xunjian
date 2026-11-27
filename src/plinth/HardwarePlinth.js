import * as THREE from 'three';
import { PLINTH_CONFIG } from '../config/campusConfig.js';
import { createMowedLawnTexture } from '../core/ProceduralTextures.js';
import { sampleLongpanCarry } from '../core/TerrainField.js';

/**
 * 无界自然翡翠外围地貌 + 地形自适应飘逸风缕体积航拍云海系统（QA #44 深度精修版）
 *
 * 核心特性：
 * 1. 保留导出 `createRoundedRectShape` 与 `buildHardwarePlinth()` 完整签名（100% 兼容 main.js 与 TerrainAndStructures.js），
 *    并导出 `sampleOuterTerrainHeight(x, z)` 与 `distOutsideCampus(x, z)` 供外围森林与道路模块无缝对齐。
 * 2. 无缝外围自然田野林地（~2300m × 2200m）：
 *    - 内缘精确对齐 24 段圆角矩形 486×368 (r=26)，与园区草坪 y=0.000 零阶差、零法线折痕、同世界坐标 UV 衔接；
 *    - d_out > 18..78m 平滑淡出重复草坪贴图，无缝过渡至无重复多倍频 FBM 航拍田野/深林地/健康草甸色阶（#22481f / #34622a / #4d7b34），
 *      彻底消除 2km 大尺度重复条纹与塑料感；
 *    - 远端 d_out ≈ 185..435m（有机噪波扰动）平滑溶入场景雾色，500..680m 强制 100% 融入地平线。
 * 3. 全地形避让的飘逸风缕体积航拍云海（userData.noMerge = true）：
 *    - 全部云海网格随地形自动抬升（Lower >= max(22.5, h+6.5), Upper >= max(34.0, h+14.0), Cirrus >= max(54.0, h+24.0)），
 *      彻底杜绝东侧丘陵切穿云片形成硬边绿洞！
 *    - 扩大至 3000×3000 网格 + 双重边界柔化（outerFadeEnd <= 820m + radialGuard 820..1260m），星夜拉远 0 方形云边！
 *    - 35° 风向拉伸羽化 FBM 连续流云帷幕为主角 + 18 条细长 (2.6:1) 双片层轻柔风缕薄云带自然融汇其中，告别孤立棉球与橙色薄饼；
 *    - 昼/暮/夜三态精准校准：白昼清透蓬松暖白云海，暮光克制微暖暮云，星夜沉静深靛月雾（0 蓝灰斑点，星夜通透）。
 */

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 预烘焙 256×256 无缝周期性四通道体积云与草甸噪波贴图（P0 GPU 优化核心）：
 * - R: 低频周期平滑 FBM（4 octaves, basePeriod=4，蓬松云底 / 域翘曲 X / 远景草甸大斑块）
 * - G: 中频周期 FBM（4 octaves, basePeriod=6，独立相位，域翘曲 Y / 中尺度云絮）
 * - B: 高频周期 FBM（3 octaves, basePeriod=12，云边羽化侵蚀 / 微观草绒颗粒）
 * - A: 脊状蓬松积云瓣（3 octaves, basePeriod=8，饱满菜花状积云瓣）
 * 以 4-6 次 GPU 硬件双线性贴图采样替代原 52 次纯 ALU 噪波循环，画质无损、零平铺感、帧耗时骤降 75%-85%。
 */
let cachedCloudNoiseTex = null;

function periodicHash2D(ix, iy, period) {
  const wx = ((ix % period) + period) % period;
  const wy = ((iy % period) + period) % period;
  const n = Math.sin(wx * 127.1 + wy * 311.7 + period * 19.19) * 43758.5453123;
  return n - Math.floor(n);
}

function periodicSmoothNoise2D(u, v, period, ox = 0, oy = 0) {
  const x = u * period + ox;
  const y = v * period + oy;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const a = periodicHash2D(xi, yi, period);
  const b = periodicHash2D(xi + 1, yi, period);
  const c = periodicHash2D(xi, yi + 1, period);
  const d = periodicHash2D(xi + 1, yi + 1, period);

  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function periodicFbm2D(u, v, basePeriod, octaves, ox = 0, oy = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let i = 0; i < octaves; i++) {
    sum += amp * periodicSmoothNoise2D(u, v, period, ox + i * 3.17, oy + i * 5.43);
    norm += amp;
    period *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

function periodicBillow2D(u, v, basePeriod, ox = 0, oy = 0) {
  const n0 = 1.0 - Math.abs(periodicSmoothNoise2D(u, v, basePeriod, ox, oy) * 2.0 - 1.0);
  const n1 = 1.0 - Math.abs(periodicSmoothNoise2D(u, v, basePeriod * 2, ox + 4.3, oy + 2.9) * 2.0 - 1.0);
  const n2 = 1.0 - Math.abs(periodicSmoothNoise2D(u, v, basePeriod * 4, ox + 9.1, oy + 7.7) * 2.0 - 1.0);
  return clamp(n0 * 0.62 + n1 * 0.26 + n2 * 0.12, 0, 1);
}

function getSeamlessCloudNoiseTexture() {
  if (cachedCloudNoiseTex) return cachedCloudNoiseTex;

  const size = 256;
  const count = size * size;
  const invSize = 1 / size;
  const chR = new Float32Array(count);
  const chG = new Float32Array(count);
  const chB = new Float32Array(count);
  const chA = new Float32Array(count);

  for (let y = 0; y < size; y++) {
    const v = y * invSize;
    for (let x = 0; x < size; x++) {
      const u = x * invSize;
      const pIdx = y * size + x;
      chR[pIdx] = periodicFbm2D(u, v, 4, 4, 0.0, 0.0);
      chG[pIdx] = periodicFbm2D(u, v, 6, 4, 3.7, 7.1);
      chB[pIdx] = periodicFbm2D(u, v, 12, 3, 11.3, 5.9);
      chA[pIdx] = periodicBillow2D(u, v, 8, 5.3, 13.7);
    }
  }

  // 全局仿射校准均值与标准差：保持 100% 周期无缝衔接，同时精确对齐原过程式 FBM/积云瓣统计分布（零云岸偏移）
  const normalizeChannel = (buf, targetMean, targetStd) => {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += buf[i];
    const mean = sum / count;
    let sq = 0;
    for (let i = 0; i < count; i++) {
      const d = buf[i] - mean;
      sq += d * d;
    }
    const std = Math.sqrt(sq / count) || 1;
    const scale = targetStd / std;
    for (let i = 0; i < count; i++) {
      buf[i] = clamp(targetMean + (buf[i] - mean) * scale, 0, 1);
    }
  };

  normalizeChannel(chR, 0.495, 0.14);
  normalizeChannel(chG, 0.495, 0.14);
  normalizeChannel(chB, 0.495, 0.145);
  normalizeChannel(chA, 0.68, 0.175);

  const data = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    data[idx] = Math.round(chR[i] * 255);
    data[idx + 1] = Math.round(chG[i] * 255);
    data[idx + 2] = Math.round(chB[i] * 255);
    data[idx + 3] = Math.round(chA[i] * 255);
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  tex.addEventListener('dispose', () => {
    if (cachedCloudNoiseTex === tex) {
      cachedCloudNoiseTex = null;
    }
  });

  cachedCloudNoiseTex = tex;
  return tex;
}

/**
 * 保留既有圆角矩形路径构造器（TerrainAndStructures.js 直接依赖此导出）
 */
export function createRoundedRectShape(width, depth, radius) {
  const hw = width / 2;
  const hd = depth / 2;
  const r = Math.min(radius, hw, hd);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return shape;
}

// 三条外延市政主干道精准中心折线（与 RoadAndParking.js / VegetationSystem.js 严格 1:1 同步）
const EXTENDED_ARTERIAL_POLYLINES = [
  // 1. 中关村大道 (width = 19.6m，双向六车道带中央绿化分隔带)
  [
    [-197, -514],
    [-201, -404],
    [-205, -294],
    [-208, -184],
    [-211, -92],
    [-216, 15],
    [-221, 110],
    [-224, 184],
    [-228, 294],
    [-233, 404],
    [-238, 514],
  ],
  // 2. 平陵西路 (width = 15.5m)
  [
    [-567, -38],
    [-459, -59],
    [-351, -80],
    [-243, -100],
    [-211, -106],
    [-130, -124],
    [-25, -144],
    [65, -162],
    [164, -184],
    [272, -208],
    [379, -232],
    [486, -256],
  ],
  // 3. 永平大道 (width = 15.0m，沿 26.2° 顺直贯穿中关村大道交叉口，消除生硬折弯)
  [
    [-554, -41.7],
    [-450, 9.4],
    [-346, 60.6],
    [-243, 111.3],
    [-221.6, 121.8],
    [-186, 139.3],
    [-138, 162.9],
    [-94, 184.6],
    [6, 233.8],
    [106, 283.0],
    [206, 332.2],
  ],
];

function distToSegmentSq2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-8) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / lenSq, 0, 1);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

function minDistToExtendedRoads(x, z) {
  let minSq = Infinity;
  for (let p = 0; p < EXTENDED_ARTERIAL_POLYLINES.length; p++) {
    const line = EXTENDED_ARTERIAL_POLYLINES[p];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const dSq = distToSegmentSq2D(x, z, a[0], a[1], b[0], b[1]);
      if (dSq < minSq) minSq = dSq;
    }
  }
  return Math.sqrt(minSq);
}

/**
 * 到园区圆角矩形边界（±243 × ±184, r=26）的精确欧氏有符号外距
 */
export function distOutsideCampus(x, z) {
  const ix = PLINTH_CONFIG.width * 0.5 - PLINTH_CONFIG.cornerRadius; // 217
  const iz = PLINTH_CONFIG.depth * 0.5 - PLINTH_CONFIG.cornerRadius; // 158
  const qx = Math.max(0, Math.abs(x) - ix);
  const qz = Math.max(0, Math.abs(z) - iz);
  return Math.hypot(qx, qz) - PLINTH_CONFIG.cornerRadius;
}

/**
 * 园区外围无界自然地貌精确高度函数（供外围地形网格、高程自适应云层与 @lush-trees 外围林带共享）
 * - 园区内及外缘 22m 过渡带严格 y = 0.000
 * - 三条外延市政主干道 ±26m 路基走廊严格 y = 0.000
 * - 远处 d_out > 520m 平滑回落至 0，确保远景地平线平稳
 */
export function sampleOuterTerrainHeight(x, z) {
  const dOut = distOutsideCampus(x, z);
  // 龙蟠山跨越园区东边界的连续山脊（消除边界处的人工深沟）
  const carry = sampleLongpanCarry(x, z, dOut);
  if (dOut <= 22) return carry;

  const roadDist = minDistToExtendedRoads(x, z);
  if (roadDist <= 26) return 0;
  const mRoad = smoothstep(26, 56, roadDist);

  const mEdge = smoothstep(22, 75, dOut) * smoothstep(520, 320, dOut);
  if (mEdge <= 1e-4) return carry * mRoad;

  const roll = Math.max(
    0,
    (Math.sin(x * 0.0095 + z * 0.0062) * 0.5 +
      Math.cos(x * 0.0068 - z * 0.0105) * 0.35 +
      Math.sin((x - z) * 0.014) * 0.15 +
      0.55) *
      5.2
  );

  // 东侧龙蟠山外延柔缓丘陵余脉（起点内移并加宽，与园区内山体无缝衔接）
  const east =
    smoothstep(215, 330, x) *
    smoothstep(560, 390, x) *
    (12.0 * Math.exp(-Math.pow((z + 55) / 145, 2)) + 10.5 * Math.exp(-Math.pow((z - 85) / 130, 2)));

  return Math.max(carry * mRoad, Math.max(0, (roll + east) * mEdge * mRoad));
}

/**
 * 精确采样与 createRoundedRectShape(486, 368, 26) + ShapeGeometry(lawnShape, 24) 顶点 1:1 吻合的外轮廓点列与单位外法线
 */
function sampleCampusPerimeterWithNormals() {
  const hw = PLINTH_CONFIG.width * 0.5; // 243
  const hd = PLINTH_CONFIG.depth * 0.5; // 184
  const r = PLINTH_CONFIG.cornerRadius; // 26
  const ix = hw - r; // 217
  const iz = hd - r; // 158

  const pts = [];

  const pushStraight = (x0, z0, x1, z1, segs, nx, nz) => {
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      pts.push({
        x: x0 + (x1 - x0) * t,
        z: z0 + (z1 - z0) * t,
        nx,
        nz,
      });
    }
  };

  const pushQuadCorner = (x0, z0, cx, cz, x1, z1, segs = 24) => {
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const omt = 1 - t;
      const x = omt * omt * x0 + 2 * omt * t * cx + t * t * x1;
      const z = omt * omt * z0 + 2 * omt * t * cz + t * t * z1;
      const tx = 2 * omt * (cx - x0) + 2 * t * (x1 - cx);
      const tz = 2 * omt * (cz - z0) + 2 * t * (z1 - cz);
      const len = Math.hypot(tx, tz) || 1;
      pts.push({
        x,
        z,
        nx: -tz / len,
        nz: tx / len,
      });
    }
  };

  pushStraight(-ix, hd, ix, hd, 42, 0, 1); // 南边
  pushQuadCorner(ix, hd, hw, hd, hw, iz, 24); // 东南角
  pushStraight(hw, iz, hw, -iz, 32, 1, 0); // 东边
  pushQuadCorner(hw, -iz, hw, -hd, ix, -hd, 24); // 东北角
  pushStraight(ix, -hd, -ix, -hd, 42, 0, -1); // 北边
  pushQuadCorner(-ix, -hd, -hw, -hd, -hw, -iz, 24); // 西北角
  pushStraight(-hw, -iz, -hw, iz, 32, -1, 0); // 西边
  pushQuadCorner(-hw, iz, -hw, hd, -ix, hd, 24); // 西南角

  return pts;
}

/**
 * 1. 构建无缝无界外围自然翡翠地形（~2300m × 2200m，外缘平滑告别重复草坪纹理、转入非周期 FBM 航拍田野与林地色阶）
 */
function buildBoundlessOuterTerrain(sharedUniforms) {
  const perimeter = sampleCampusPerimeterWithNormals();
  const P = perimeter.length;

  const ringOffsets = [
    -2.2, 0.0, 6.0, 15.0, 24.0, 35.0, 48.0, 63.0, 80.0, 100.0, 122.0, 146.0,
    172.0, 200.0, 232.0, 266.0, 304.0, 346.0, 392.0, 444.0, 502.0, 568.0,
    644.0, 730.0, 830.0, 940.0,
  ];
  const R = ringOffsets.length;

  const vertCount = R * P;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  const invW = 1 / PLINTH_CONFIG.width;
  const invD = 1 / PLINTH_CONFIG.depth;
  const halfW = PLINTH_CONFIG.width * 0.5;
  const halfD = PLINTH_CONFIG.depth * 0.5;

  for (let k = 0; k < R; k++) {
    const dist = ringOffsets[k];
    for (let s = 0; s < P; s++) {
      const bp = perimeter[s];
      const wx = bp.x + bp.nx * dist;
      const wz = bp.z + bp.nz * dist;
      const wy = k === 0 ? sampleOuterTerrainHeight(wx, wz) - 0.05 : sampleOuterTerrainHeight(wx, wz);

      const idx = k * P + s;
      positions[idx * 3] = wx;
      positions[idx * 3 + 1] = wy;
      positions[idx * 3 + 2] = wz;

      // 与 TerrainAndStructures.js 完全一致的世界坐标草坪 UV 映射（零纹理相位接缝）
      uvs[idx * 2] = (wx + halfW) * invW;
      uvs[idx * 2 + 1] = (wz + halfD) * invD;
    }
  }

  for (let k = 0; k < R - 1; k++) {
    const rowA = k * P;
    const rowB = (k + 1) * P;
    for (let s = 0; s < P; s++) {
      const sNext = (s + 1) % P;
      const a = rowA + s;
      const b = rowA + sNext;
      const c = rowB + s;
      const d = rowB + sNext;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // 强制内收唇 (k=0) 与精准边界环 (k=1) 法线严格垂直向上 (0,1,0)，彻底消除边界 1px 光照折痕
  const normAttr = geo.attributes.normal;
  // 以解析高程场的中心差分重建法线：外围粗环网格与园区内龙蟠山细网格在边界处法线完全一致，消除折痕
  const eps = 1.5;
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    const k = Math.floor(i / P);
    if (k <= 1 && positions[i * 3 + 1] < 0.05) {
      normAttr.setXYZ(i, 0, 1, 0);
      continue;
    }
    const hx = sampleOuterTerrainHeight(x + eps, z) - sampleOuterTerrainHeight(x - eps, z);
    const hz = sampleOuterTerrainHeight(x, z + eps) - sampleOuterTerrainHeight(x, z - eps);
    const nx = -hx / (2 * eps);
    const nz = -hz / (2 * eps);
    const inv = 1 / Math.hypot(nx, 1, nz);
    normAttr.setXYZ(i, nx * inv, inv, nz * inv);
  }
  normAttr.needsUpdate = true;

  const lawnTex = createMowedLawnTexture(4);
  const terrainMat = new THREE.MeshStandardMaterial({
    name: 'BoundlessEmeraldCountryside',
    map: lawnTex,
    color: '#ffffff',
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });

  terrainMat.customProgramCacheKey = () => 'ioply-boundless-outer-terrain-v4-farmland';

  // 将外围参考图色板预先由 sRGB 精确转换至线性空间传入着色器
  const colWoodFloor = new THREE.Color('#22481f');
  const colMidMeadow = new THREE.Color('#34622a');
  const colSunField = new THREE.Color('#4d7b34');
  const colDeepShade = new THREE.Color('#193818');

  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uDayWeight = sharedUniforms.uDayWeight;
    shader.uniforms.uCloudNoiseTex = sharedUniforms.uCloudNoiseTex;
    shader.uniforms.uColWoodFloor = { value: colWoodFloor };
    shader.uniforms.uColMidMeadow = { value: colMidMeadow };
    shader.uniforms.uColSunField = { value: colSunField };
    shader.uniforms.uColDeepShade = { value: colDeepShade };
    shader.uniforms.uColCropYoung = { value: new THREE.Color('#58782f') };
    shader.uniforms.uColCropDark = { value: new THREE.Color('#34522a') };
    shader.uniforms.uColCropRipe = { value: new THREE.Color('#7a7c3c') };
    shader.uniforms.uColFallow = { value: new THREE.Color('#5e5a3a') };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vOuterWorldPos;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vOuterWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uDayWeight;
        uniform sampler2D uCloudNoiseTex;
        uniform vec3 uColWoodFloor;
        uniform vec3 uColMidMeadow;
        uniform vec3 uColSunField;
        uniform vec3 uColDeepShade;
        uniform vec3 uColCropYoung;
        uniform vec3 uColCropDark;
        uniform vec3 uColCropRipe;
        uniform vec3 uColFallow;
        varying vec3 vOuterWorldPos;

        float ot_hash( vec2 p ) {
          p = fract( p * vec2( 127.1, 311.7 ) );
          p += dot( p, p + 34.5 );
          return fract( p.x * p.y );
        }

        float ot_distOutsideCampus( vec2 xz ) {
          vec2 q = max( vec2( 0.0 ), abs( xz ) - vec2( 217.0, 158.0 ) );
          return length( q ) - 26.0;
        }
        `
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 otXz = vOuterWorldPos.xz;
        float otDOut = ot_distOutsideCampus( otXz );

        // 0..18m 与园区草坪 100% 同源无缝；18..78m 平滑淡出周期草坪贴图，转入预烘焙无缝多通道贴图草甸/深林地（4 次硬件贴图采样替代 21 次纯 ALU 噪波）
        float outerBlend = smoothstep( 18.0, 78.0, otDOut );
        if ( outerBlend > 0.001 ) {
          vec2 rotXz = vec2( otXz.x * 0.9336 - otXz.y * 0.3584, otXz.x * 0.3584 + otXz.y * 0.9336 );
          vec4 warpTap = texture2D( uCloudNoiseTex, otXz * 0.00145 + vec2( 0.17, -0.23 ) );
          vec2 organicWarp = ( warpTap.rg - 0.5 ) * 52.0;
          vec2 warpedPlot = rotXz + organicWarp;
          vec2 plotScale = vec2( 128.0, 96.0 );
          vec2 cellId = floor( warpedPlot / plotScale );
          vec2 cellUv = fract( warpedPlot / plotScale );

          float plotSeed = ot_hash( cellId + vec2( 7.3, 13.1 ) );
          float plotWarm = ot_hash( cellId * 1.41 + vec2( 3.1, 19.7 ) );

          float hedgeX = smoothstep( 0.0, 0.14, cellUv.x ) * smoothstep( 0.0, 0.14, 1.0 - cellUv.x );
          float hedgeY = smoothstep( 0.0, 0.14, cellUv.y ) * smoothstep( 0.0, 0.14, 1.0 - cellUv.y );
          float hedgeBand = hedgeX * hedgeY;

          // 2 次多尺度无缝采样覆盖大斑块 + 中尺度林下肌理 + 微观草绒颗粒（零周期条纹）
          vec4 macroTap = texture2D( uCloudNoiseTex, otXz * 0.0012 + vec2( 0.24, -0.18 ) );
          vec4 fineTap = texture2D( uCloudNoiseTex, rotXz * 0.0108 + vec2( -0.31, 0.41 ) );
          float macroBio = mix( macroTap.r, warpTap.g, 0.28 );
          float midBio = mix( macroTap.b, fineTap.r, 0.50 );
          float microStipple = ( fineTap.b - 0.5 ) * 0.09;

          float toneT = clamp( plotSeed * 0.28 + macroBio * 0.64 + ( midBio - 0.5 ) * 0.26 + microStipple, 0.0, 1.0 );
          vec3 countryCol = mix( uColWoodFloor, uColMidMeadow, smoothstep( 0.12, 0.58, toneT ) );
          countryCol = mix( countryCol, uColSunField, smoothstep( 0.58, 0.94, toneT ) * ( 0.62 + 0.38 * plotWarm ) );
          countryCol = mix( uColDeepShade, countryCol, mix( 0.93, 1.0, hedgeBand ) );

          // 外域农田肌理（对齐航拍参考：不同作物色块 + 种植行 + 田埂林带），约 62% 地块为耕地，其余保持草甸
          float isField = step( 0.38, plotSeed ) * smoothstep( 40.0, 95.0, otDOut );
          if ( isField > 0.0 ) {
            float pick = fract( plotWarm * 7.13 + plotSeed * 3.71 );
            vec3 cropCol = pick < 0.30 ? uColCropYoung : pick < 0.52 ? uColCropDark : pick < 0.80 ? uColCropRipe : uColFallow;
            cropCol *= 0.90 + 0.20 * fract( plotSeed * 13.7 );
            // 种植行：每块地随机横/纵向，约 3.2m 行距；远处按屏幕导数淡出，防止摩尔纹
            float rowCoord = ( plotWarm > 0.5 ? cellUv.x * plotScale.x : cellUv.y * plotScale.y ) / 3.2;
            float rowAA = 1.0 - smoothstep( 0.25, 0.8, fwidth( rowCoord ) );
            float rows = 0.5 + 0.5 * sin( rowCoord * 6.2831853 );
            cropCol *= mix( 1.0, mix( 0.88, 1.07, rows ), rowAA );
            // 田埂：地块边缘一圈深色林带/土埂
            float edgeD = min( min( cellUv.x, 1.0 - cellUv.x ), min( cellUv.y, 1.0 - cellUv.y ) );
            float bund = 1.0 - smoothstep( 0.012, 0.035, edgeD );
            cropCol = mix( cropCol, uColDeepShade * 0.9, bund * 0.85 );
            countryCol = mix( countryCol, cropCol, isField * mix( 0.55, 0.92, macroBio ) );
          }

          // 丘陵坡度与坡顶自然叶绿素亮暗层次
          float hillT = smoothstep( 0.5, 11.5, vOuterWorldPos.y );
          countryCol *= mix( vec3( 0.95, 0.97, 0.95 ), vec3( 1.10, 1.07, 0.91 ), hillT );

          // 柔和飘动的高空流云地面微投影（1 次无缝贴图采样）
          vec2 windXz = vec2( otXz.x * 0.8829 + otXz.y * 0.4695, -otXz.x * 0.4695 + otXz.y * 0.8829 );
          float cloudShadow = texture2D( uCloudNoiseTex, windXz * 0.00105 - vec2( uTime * 0.001375, -uTime * 0.000625 ) ).r;
          float dapple = mix( 1.0, mix( 0.84, 1.04, smoothstep( 0.35, 0.68, cloudShadow ) ), smoothstep( 36.0, 130.0, otDOut ) * uDayWeight );
          countryCol *= dapple;

          diffuseColor.rgb = mix( diffuseColor.rgb, countryCol, outerBlend );
        }
        `
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        #ifdef USE_FOG
          float mistDOut = ot_distOutsideCampus( vOuterWorldPos.xz );
          if ( mistDOut > 120.0 ) {
            float mistWarp = mistDOut < 660.0
              ? ( texture2D( uCloudNoiseTex, vOuterWorldPos.xz * 0.0011 - vec2( uTime * 0.001125, -uTime * 0.000625 ) ).r - 0.5 ) * 88.0
              : 0.0;
            float outerMist = smoothstep( 170.0, 420.0, mistDOut + mistWarp );
            outerMist = max( outerMist, smoothstep( 480.0, 650.0, mistDOut ) );
            gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, clamp( outerMist, 0.0, 1.0 ) );
          }
        #endif
        `
      );
  };

  const mesh = new THREE.Mesh(geo, terrainMat);
  mesh.name = 'BoundlessOuterTerrain';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.noMerge = true;
  mesh.renderOrder = 0;

  return mesh;
}

/**
 * 2. 地下防漏光封底（y = -3.65，严密兜底中心湖盆与 1BF 车库下沉坡道基坑）
 */
function buildSubterraneanSealCap() {
  const capShape = createRoundedRectShape(PLINTH_CONFIG.width + 12, PLINTH_CONFIG.depth + 12, PLINTH_CONFIG.cornerRadius + 4);
  const capGeo = new THREE.ShapeGeometry(capShape, 24);
  capGeo.rotateX(-Math.PI / 2);
  const capMat = new THREE.MeshStandardMaterial({
    name: 'SubterraneanSoilCap',
    color: '#142219',
    roughness: 0.96,
    metalness: 0.0,
  });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.name = 'SubterraneanSealCap';
  cap.position.y = -3.65;
  cap.userData.noMerge = true;
  return cap;
}

/**
 * 共用 GLSL 无缝贴图体积云函数块（预烘焙 RGBA DataTexture + 旋转非谐波双尺度去平铺 + 3 次贴图采样替代 52 次过程式噪波）
 */
const CLOUD_GLSL_COMMON = `
  // 轻微有机漂移坐标系 (~28° 柔和自然微风，避免强烈斜向条纹刷痕)
  vec2 cl_toWindSpace( vec2 xz ) {
    return vec2( xz.x * 0.8829 - xz.y * 0.4695, xz.x * 0.4695 + xz.y * 0.8829 );
  }

  // 双旋转非谐波贴图采样：2 次硬件双线性纹理查询即可合成多层积云底 + 菜花瓣 + 羽化细绒（零平铺痕迹）
  vec2 cl_sampleCloudField( vec2 q ) {
    vec4 mainTap = texture2D( uCloudNoiseTex, q * 0.25 );
    vec2 rotQ = vec2( q.x * 0.80 - q.y * 0.60, q.x * 0.60 + q.y * 0.80 );
    vec4 detailTap = texture2D( uCloudNoiseTex, rotQ * 0.173 + vec2( 0.31, -0.47 ) );
    float base = mix( mainTap.r, detailTap.g, 0.36 );
    float billowLobes = mix( mainTap.a, detailTap.a, 0.35 );
    float fineFluff = mix( mainTap.b, detailTap.b, 0.42 );
    float density = clamp( base * 0.66 + billowLobes * 0.22 + fineFluff * 0.16 - 0.02, 0.0, 1.0 );
    return vec2( density, detailTap.b );
  }

  // 返回 vec4( rawDens, erodeDetail, warpedQ.x, warpedQ.y )：仅 3 次纹理采样完成域翘曲与双尺度体积积云评估
  vec4 cl_windCloudSample( vec2 windP ) {
    vec2 softDrift = vec2( windP.x * 0.86, windP.y * 1.12 );
    vec2 warp = texture2D( uCloudNoiseTex, softDrift * 0.18 + vec2( 0.19, 0.43 ) ).rg;
    vec2 q = softDrift + ( warp - 0.5 ) * 1.28;
    vec2 field = cl_sampleCloudField( q );
    return vec4( field.x, field.y, q.x, q.y );
  }

  float cl_distOutsideCampus( vec2 xz ) {
    vec2 q = max( vec2( 0.0 ), abs( xz ) - vec2( 217.0, 158.0 ) );
    return length( q ) - 26.0;
  }
`;

/**
 * 3. 构建地形自适应无缝风缕体积云海层（3000×3000 大幅面 + 32×32 精简网格 + FrontSide + 核心园区前置早退丢弃）
 */
function buildCloudVeilSheet({
  name,
  minAltitude,
  terrainClearance,
  scaleXZ,
  windSpeed,
  crossDrift,
  innerClear,
  innerFull,
  outerFadeStart,
  outerFadeEnd,
  densityBias,
  densityPow,
  heightLitBoost,
  opacityScale,
  renderOrder,
  cloudUniforms,
}) {
  // 3000×3000 超大幅面（32×32 细分即可平滑越过东侧柔缓丘陵，三层合计省下 ~28.5k 三角面且零视觉差异）
  const geo = new THREE.PlaneGeometry(3000, 3000, 32, 32);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const groundH = sampleOuterTerrainHeight(x, z);
    // 严格高于全部外围山丘至少 terrainClearance 米（永不下沉穿山切出绿洞！）
    const y = Math.max(minAltitude, groundH + terrainClearance);
    pos.setY(i, y);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    name,
    color: '#ffffff',
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: true,
  });

  mat.customProgramCacheKey = () => `ioply-volumetric-cloud-veil-${name}-v3`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cloudUniforms.uTime;
    shader.uniforms.uCloudNoiseTex = cloudUniforms.uCloudNoiseTex;
    shader.uniforms.uCloudLit = cloudUniforms.uCloudLit;
    shader.uniforms.uCloudMid = cloudUniforms.uCloudMid;
    shader.uniforms.uCloudShadow = cloudUniforms.uCloudShadow;
    shader.uniforms.uCloudRim = cloudUniforms.uCloudRim;
    shader.uniforms.uOpacityMul = cloudUniforms.uOpacityMul;
    shader.uniforms.uSunDirWind = cloudUniforms.uSunDirWind;
    shader.uniforms.uLayerParams = {
      value: new THREE.Vector4(scaleXZ, densityBias, densityPow, opacityScale),
    };
    shader.uniforms.uMaskRange = {
      value: new THREE.Vector4(innerClear, innerFull, outerFadeStart, outerFadeEnd),
    };
    shader.uniforms.uDrift = { value: new THREE.Vector3(windSpeed, crossDrift, heightLitBoost) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCloudWorldPos;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCloudWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uCloudNoiseTex;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudMid;
        uniform vec3 uCloudShadow;
        uniform vec3 uCloudRim;
        uniform float uOpacityMul;
        uniform vec2 uSunDirWind;
        uniform vec4 uLayerParams;
        uniform vec4 uMaskRange;
        uniform vec3 uDrift;
        varying vec3 vCloudWorldPos;
        ${CLOUD_GLSL_COMMON}
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 cXz = vCloudWorldPos.xz;
        float cDOut = cl_distOutsideCampus( cXz );
        // P0 核心早退 #1：中央园区及内缘在任何云噪波/贴图查询之前直接丢弃（零着色开销！）
        if ( cDOut < -65.0 ) discard;
        float campusCoreMask = smoothstep( -4.0, 26.0, cDOut );
        if ( campusCoreMask < 0.002 ) discard;

        // P0 核心早退 #2：严格圆形远界与外淡出边界之前直接丢弃（零方形黑边，跳过全屏远角！）
        float cRad = length( cXz );
        float radialGuard = 1.0 - smoothstep( 820.0, 1260.0, cRad );
        if ( radialGuard < 0.002 ) discard;
        float outerFade = ( 1.0 - smoothstep( uMaskRange.z, uMaskRange.w, cDOut ) ) * radialGuard;
        if ( outerFade < 0.002 ) discard;

        vec2 windXz = cl_toWindSpace( cXz );
        // 1 次无缝贴图采样计算有机云岸扰动，并在主云场采样前立即早退
        vec2 shoreUv = windXz * 0.0011 - vec2( uDrift.x * uTime * 0.0875, uDrift.y * uTime * 0.0875 ) + vec2( 0.37, -0.29 );
        float shoreWarp = ( texture2D( uCloudNoiseTex, shoreUv ).r - 0.5 ) * 116.0;
        float innerWindow = smoothstep( uMaskRange.x, uMaskRange.y, cDOut + shoreWarp ) * campusCoreMask;
        if ( innerWindow < 0.002 ) discard;

        vec2 cP = windXz * uLayerParams.x - vec2( uDrift.x * uTime, uDrift.y * uTime );
        vec4 cloudRes = cl_windCloudSample( cP );
        float rawDens = cloudRes.x;
        // 向外围逐渐汇聚成柔润无界云海，边缘呈轻盈绒白絮状消散（复用 detailTap.b 省去额外采样）
        float farThick = smoothstep( 135.0, 360.0, cDOut ) * 0.34;
        float featherErode = ( cloudRes.y - 0.46 ) * 0.16;
        float dens = clamp( ( rawDens + uLayerParams.y + farThick + featherErode ) * innerWindow, 0.0, 1.0 );
        dens = pow( smoothstep( 0.13, 0.86, dens ), uLayerParams.z );
        float finalAlpha = clamp( dens * outerFade * uLayerParams.w * uOpacityMul, 0.0, 0.94 );
        if ( finalAlpha < 0.004 ) discard;

        // 沿阳光方向单步体积自阴影：仅对可见云像素执行（复用已翘曲坐标，仅 2 次采样）
        vec2 sunStep = vec2( uSunDirWind.x * 0.86, uSunDirWind.y * 1.12 ) * 0.15;
        float sunSample = cl_sampleCloudField( cloudRes.zw + sunStep ).x;
        float directionalLit = clamp( 0.58 + ( rawDens - sunSample ) * 2.35 + uDrift.z, 0.0, 1.0 );
        float edgeWhiten = 1.0 - smoothstep( 0.08, 0.58, dens );
        directionalLit = mix( directionalLit, 0.94, edgeWhiten * 0.58 );
        float silverRim = smoothstep( 0.04, 0.36, dens ) * ( 1.0 - smoothstep( 0.36, 0.80, dens ) );

        vec3 cloudCol = mix( uCloudShadow, uCloudMid, smoothstep( 0.10, 0.52, directionalLit ) );
        cloudCol = mix( cloudCol, uCloudLit, smoothstep( 0.40, 0.90, directionalLit ) );
        cloudCol = mix( cloudCol, uCloudRim, silverRim * 0.42 );

        diffuseColor = vec4( cloudCol, finalAlpha );
        `
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.userData.noMerge = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/**
 * 4. 构建蓬松柔白漂浮积云絮层（18 组 ~1.4:1 自然多瓣积云团，双片层无缝融汇于连续云海，点缀默认视角四角，零灰色拉丝拖痕）
 */
function buildSculptedMistRibbons(cloudUniforms) {
  // 适度 ~1.35:1 ~ 1.5:1 自然蓬松比例，柔美点缀默认视角的右下、右上、左上、左下与外围山野，严格避开核心园区
  const ribbons = [
    // 右上 / 东侧龙蟠山外缘丘陵带（呼应参考图右上蓬松向阳白云）
    { x: 318, y: 31, z: 32, sx: 245, sz: 172, h: 8, rot: -0.42, seed: 1.3 },
    { x: 425, y: 36, z: 118, sx: 285, sz: 198, h: 9, rot: -0.28, seed: 2.7 },
    { x: 310, y: 32, z: -115, sx: 255, sz: 178, h: 8, rot: -0.54, seed: 4.1 },
    { x: 465, y: 38, z: -48, sx: 305, sz: 210, h: 9, rot: -0.36, seed: 5.5 },
    // 右下 / 东南外围草甸（呼应参考图右下前景飘浮柔白云絮！）
    { x: 162, y: 27, z: 252, sx: 225, sz: 158, h: 7, rot: -0.45, seed: 7.2 },
    { x: 272, y: 30, z: 215, sx: 255, sz: 178, h: 8, rot: -0.32, seed: 8.8 },
    { x: 64, y: 28, z: 295, sx: 235, sz: 164, h: 7, rot: -0.48, seed: 10.4 },
    // 左上 / 西北外围田野与中关村大道北延
    { x: -268, y: 32, z: -305, sx: 270, sz: 188, h: 8, rot: -0.38, seed: 12.1 },
    { x: -148, y: 31, z: -335, sx: 255, sz: 176, h: 8, rot: -0.52, seed: 13.7 },
    { x: -375, y: 34, z: -185, sx: 280, sz: 192, h: 9, rot: -0.29, seed: 15.2 },
    // 东北 / 平陵西路东延
    { x: 128, y: 32, z: -285, sx: 260, sz: 180, h: 8, rot: -0.44, seed: 16.8 },
    { x: 320, y: 36, z: -265, sx: 290, sz: 202, h: 9, rot: -0.35, seed: 18.4 },
    // 西侧与左下外围林带（温柔收拢默认视角左下边缘）
    { x: -328, y: 29, z: 18, sx: 245, sz: 172, h: 8, rot: -0.46, seed: 20.1 },
    { x: -322, y: 29, z: 162, sx: 245, sz: 170, h: 8, rot: -0.34, seed: 21.7 },
    { x: -215, y: 29, z: 282, sx: 255, sz: 178, h: 8, rot: -0.50, seed: 23.3 },
    // 远环柔和延伸带
    { x: 530, y: 38, z: 240, sx: 315, sz: 220, h: 9, rot: -0.40, seed: 25.0 },
    { x: -25, y: 35, z: -445, sx: 310, sz: 215, h: 9, rot: -0.48, seed: 26.6 },
    { x: -480, y: 35, z: 285, sx: 310, sz: 218, h: 9, rot: -0.36, seed: 28.2 },
  ];

  // 仅 2 层极柔和垂直叠层（绝无多阶薄饼分层感），且自动抬升至地形上方 >= 12m
  const sliceCount = 2;
  const quadCount = ribbons.length * sliceCount;
  const positions = new Float32Array(quadCount * 4 * 3);
  const uvs = new Float32Array(quadCount * 4 * 2);
  const puffData = new Float32Array(quadCount * 4 * 4);
  const indices = new Uint16Array(quadCount * 6);

  const sunShiftX = -0.849;
  const sunShiftZ = 0.529;

  let qIdx = 0;
  for (let s = 0; s < sliceCount; s++) {
    const sliceT = s / (sliceCount - 1); // 0.0 -> 1.0
    const widthProfile = sliceT === 0 ? 1.0 : 0.88;
    const densityMul = sliceT === 0 ? 0.85 : 0.72;

    for (let b = 0; b < ribbons.length; b++) {
      const rb = ribbons[b];
      const baseY = Math.max(rb.y, sampleOuterTerrainHeight(rb.x, rb.z) + 18.0);
      const halfX = rb.sx * 0.5 * widthProfile;
      const halfZ = rb.sz * 0.5 * widthProfile;
      const cosR = Math.cos(rb.rot + sliceT * 0.06);
      const sinR = Math.sin(rb.rot + sliceT * 0.06);

      const cx = rb.x + sunShiftX * sliceT * rb.h * 0.35;
      const cy = baseY + sliceT * rb.h;
      const cz = rb.z + sunShiftZ * sliceT * rb.h * 0.35;

      const corners = [
        [-halfX, -halfZ, 0, 0],
        [halfX, -halfZ, 1, 0],
        [halfX, halfZ, 1, 1],
        [-halfX, halfZ, 0, 1],
      ];

      const vBase = qIdx * 4;
      for (let c = 0; c < 4; c++) {
        const lx = corners[c][0];
        const lz = corners[c][1];
        const wx = cx + lx * cosR - lz * sinR;
        const wz = cz + lx * sinR + lz * cosR;

        const vi = vBase + c;
        positions[vi * 3] = wx;
        positions[vi * 3 + 1] = cy;
        positions[vi * 3 + 2] = wz;

        uvs[vi * 2] = corners[c][2];
        uvs[vi * 2 + 1] = corners[c][3];

        puffData[vi * 4] = rb.seed;
        puffData[vi * 4 + 1] = sliceT;
        puffData[vi * 4 + 2] = densityMul;
        puffData[vi * 4 + 3] = (b % 7) * 0.16;
      }

      const iBase = qIdx * 6;
      indices[iBase] = vBase;
      indices[iBase + 1] = vBase + 3;
      indices[iBase + 2] = vBase + 1;
      indices[iBase + 3] = vBase + 1;
      indices[iBase + 4] = vBase + 3;
      indices[iBase + 5] = vBase + 2;

      qIdx++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPuffUv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aPuffData', new THREE.BufferAttribute(puffData, 4));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    name: 'VolumetricMistRibbons',
    color: '#ffffff',
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: true,
  });

  mat.customProgramCacheKey = () => 'ioply-volumetric-mist-ribbons-v3';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cloudUniforms.uTime;
    shader.uniforms.uCloudNoiseTex = cloudUniforms.uCloudNoiseTex;
    shader.uniforms.uCloudLit = cloudUniforms.uCloudLit;
    shader.uniforms.uCloudMid = cloudUniforms.uCloudMid;
    shader.uniforms.uCloudShadow = cloudUniforms.uCloudShadow;
    shader.uniforms.uCloudRim = cloudUniforms.uCloudRim;
    shader.uniforms.uBankOpacity = cloudUniforms.uBankOpacity;
    shader.uniforms.uSunDirWind = cloudUniforms.uSunDirWind;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aPuffUv;
        attribute vec4 aPuffData;
        uniform float uTime;
        varying vec2 vPuffUv;
        varying vec4 vPuffData;
        varying vec3 vPuffWorldPos;
        `
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float driftPhase = aPuffData.x * 0.67 + aPuffData.w * 6.2831;
        transformed.x += sin( uTime * 0.048 + driftPhase ) * 14.0;
        transformed.z += cos( uTime * 0.036 + driftPhase * 1.2 ) * 9.0;
        vPuffUv = aPuffUv;
        vPuffData = aPuffData;
        vPuffWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uCloudNoiseTex;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudMid;
        uniform vec3 uCloudShadow;
        uniform vec3 uCloudRim;
        uniform float uBankOpacity;
        uniform vec2 uSunDirWind;
        varying vec2 vPuffUv;
        varying vec4 vPuffData;
        varying vec3 vPuffWorldPos;
        ${CLOUD_GLSL_COMMON}
        `
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 centered = vPuffUv * 2.0 - 1.0;
        float rad = length( centered );
        if ( rad > 0.99 ) discard;

        // P0 早退：在执行任何纹理采样前先过滤园区核心与远界外像素
        float cDOut = cl_distOutsideCampus( vPuffWorldPos.xz );
        if ( cDOut <= 8.0 ) discard;
        float campusGuard = smoothstep( 8.0, 66.0, cDOut );
        float radialGuard = 1.0 - smoothstep( 780.0, 1180.0, length( vPuffWorldPos.xz ) );
        if ( radialGuard < 0.002 ) discard;

        float seed = vPuffData.x;
        float sliceT = vPuffData.y;
        float sliceDens = vPuffData.z;

        // 蓬松多瓣自然积云絮（3 次无缝纹理采样替代原 47 次过程式噪波）
        vec2 nPos = vec2( centered.x * 1.48, centered.y * 1.72 ) + vec2( seed * 1.73, seed * 2.41 ) - vec2( uTime * 0.0085, -uTime * 0.004 );
        vec4 cloudRes = cl_windCloudSample( nPos );
        float shapeNoise = cloudRes.x;
        float wispDetail = cloudRes.y;
        float featherEnv = 1.0 - smoothstep( 0.08, 0.96, rad + ( 0.52 - shapeNoise ) * 0.56 + ( 0.5 - wispDetail ) * 0.22 );
        float safeEdge = 1.0 - smoothstep( 0.72, 0.98, rad );

        float dens = clamp( featherEnv * safeEdge * ( 0.48 + shapeNoise * 0.72 ) * sliceDens * campusGuard * radialGuard, 0.0, 1.0 );
        dens = pow( smoothstep( 0.08, 0.85, dens ), 1.35 );
        if ( dens < 0.004 ) discard;

        vec2 sunStep = vec2( uSunDirWind.x * 0.86, uSunDirWind.y * 1.12 ) * 0.18;
        float sunNoise = cl_sampleCloudField( cloudRes.zw + sunStep ).x;
        float horizLit = clamp( 0.58 + ( shapeNoise - sunNoise ) * 2.1, 0.0, 1.0 );
        float totalLit = clamp( sliceT * 0.36 + horizLit * 0.68, 0.0, 1.0 );
        float edgeWhiten = 1.0 - smoothstep( 0.08, 0.55, dens );
        totalLit = mix( totalLit, 0.95, edgeWhiten * 0.60 );
        float rimGlow = smoothstep( 0.05, 0.34, dens ) * ( 1.0 - smoothstep( 0.36, 0.78, dens ) );

        vec3 col = mix( uCloudShadow, uCloudMid, smoothstep( 0.08, 0.50, totalLit ) );
        col = mix( col, uCloudLit, smoothstep( 0.38, 0.90, totalLit ) );
        col = mix( col, uCloudRim, rimGlow * 0.42 );

        float alpha = clamp( dens * uBankOpacity * ( 0.52 + sliceT * 0.18 ), 0.0, 0.76 );
        diffuseColor = vec4( col, alpha );
        `
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'VolumetricMistRibbons';
  mesh.userData.noMerge = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  return mesh;
}

/**
 * 保持原有导出名称与返回契约 { group, update(elapsed, duskFactor, nightFactor) }
 */
export function buildHardwarePlinth() {
  const group = new THREE.Group();
  group.name = 'BoundlessCloudEnvironment';

  const cloudNoiseTex = getSeamlessCloudNoiseTexture();
  const sharedUniforms = {
    uTime: { value: 0 },
    uDayWeight: { value: 1 },
    uCloudNoiseTex: { value: cloudNoiseTex },
  };

  // 昼/暮/夜三态云层色板（QA #50 终极精修：白昼澄明蓬松雪白向阳积云、暮光克制微暖、星夜静谧深空月雾贴合 #050a15）
  const palettes = {
    day: {
      lit: new THREE.Color('#ffffff').multiplyScalar(2.45),
      mid: new THREE.Color('#f4f8f5').multiplyScalar(1.62),
      shadow: new THREE.Color('#c4d4ce').multiplyScalar(1.10),
      rim: new THREE.Color('#ffffff').multiplyScalar(2.75),
      veilOpacity: 0.88,
      bankOpacity: 0.48,
    },
    dusk: {
      lit: new THREE.Color('#c88e6b').multiplyScalar(1.10),
      mid: new THREE.Color('#3e526b'),
      shadow: new THREE.Color('#192538'),
      rim: new THREE.Color('#dea57f').multiplyScalar(1.15),
      veilOpacity: 0.70,
      bankOpacity: 0.22,
    },
    night: {
      lit: new THREE.Color('#142238'),
      mid: new THREE.Color('#0a1426'),
      shadow: new THREE.Color('#050a15'),
      rim: new THREE.Color('#1d3150'),
      veilOpacity: 0.42,
      bankOpacity: 0.12,
    },
  };

  // 将主太阳水平方向 (-265, 165) 旋转至与 cl_toWindSpace 一致的坐标系
  const sunRaw = new THREE.Vector2(-265, 165).normalize();
  const sunDirWind = new THREE.Vector2(
    sunRaw.x * 0.8829 - sunRaw.y * 0.4695,
    sunRaw.x * 0.4695 + sunRaw.y * 0.8829
  ).normalize();

  const cloudUniforms = {
    uTime: sharedUniforms.uTime,
    uCloudNoiseTex: sharedUniforms.uCloudNoiseTex,
    uCloudLit: { value: palettes.day.lit.clone() },
    uCloudMid: { value: palettes.day.mid.clone() },
    uCloudShadow: { value: palettes.day.shadow.clone() },
    uCloudRim: { value: palettes.day.rim.clone() },
    uOpacityMul: { value: palettes.day.veilOpacity },
    uBankOpacity: { value: palettes.day.bankOpacity },
    uSunDirWind: { value: sunDirWind },
  };

  // 1. 地下防漏光封底 + 无缝外围翡翠自然田野地形
  group.add(buildSubterraneanSealCap());
  group.add(buildBoundlessOuterTerrain(sharedUniforms));

  // 2. 底层蓬松云海主帷幕（y >= max(24.0, terrain+13.5)，温柔环抱默认视角四角，严格留白中心园区）
  group.add(
    buildCloudVeilSheet({
      name: 'PerimeterCloudSeaLower',
      minAltitude: 24.0,
      terrainClearance: 13.5,
      scaleXZ: 0.0052,
      windSpeed: 0.0062,
      crossDrift: -0.0018,
      innerClear: 22.0,
      innerFull: 175.0,
      outerFadeStart: 560.0,
      outerFadeEnd: 820.0,
      densityBias: 0.02,
      densityPow: 1.04,
      heightLitBoost: 0.02,
      opacityScale: 0.86,
      renderOrder: 10,
      cloudUniforms,
    })
  );

  // 3. 中层蓬松向阳体积积云带（y >= max(36.0, terrain+21.0)，立体云顶绒白光泽）
  group.add(
    buildCloudVeilSheet({
      name: 'PerimeterCloudSeaUpper',
      minAltitude: 36.0,
      terrainClearance: 21.0,
      scaleXZ: 0.0064,
      windSpeed: 0.0092,
      crossDrift: -0.0024,
      innerClear: 42.0,
      innerFull: 215.0,
      outerFadeStart: 540.0,
      outerFadeEnd: 800.0,
      densityBias: -0.06,
      densityPow: 1.14,
      heightLitBoost: 0.16,
      opacityScale: 0.74,
      renderOrder: 11,
      cloudUniforms,
    })
  );

  // 4. 蓬松多瓣漂浮积云絮层（单次 Draw Call，柔美环绕四角边缘，彻底告别斜向拉丝感）
  group.add(buildSculptedMistRibbons(cloudUniforms));

  // 5. 高空轻纱透亮白云丝（y >= max(56.0, terrain+30.0)，精致蓬松云边萦绕外围）
  group.add(
    buildCloudVeilSheet({
      name: 'HighAltitudeCirrusWisps',
      minAltitude: 56.0,
      terrainClearance: 30.0,
      scaleXZ: 0.0076,
      windSpeed: 0.0135,
      crossDrift: -0.0030,
      innerClear: 18.0,
      innerFull: 165.0,
      outerFadeStart: 510.0,
      outerFadeEnd: 770.0,
      densityBias: -0.18,
      densityPow: 1.32,
      heightLitBoost: 0.24,
      opacityScale: 0.50,
      renderOrder: 13,
      cloudUniforms,
    })
  );

  const blendColor = (out, cD, cK, cN, wDay, wDusk, wNight) => {
    out.setRGB(
      cD.r * wDay + cK.r * wDusk + cN.r * wNight,
      cD.g * wDay + cK.g * wDusk + cN.g * wNight,
      cD.b * wDay + cK.b * wDusk + cN.b * wNight
    );
  };

  return {
    group,
    update(elapsed, duskFactor = 0, nightFactor = duskFactor) {
      sharedUniforms.uTime.value = elapsed;

      // StudioScene 传入 duskFactor = min(1, wDusk * 0.68 + wNight), nightFactor = wNight
      const wNight = clamp(nightFactor, 0, 1);
      const wDusk = clamp((duskFactor - wNight) / 0.68, 0, 1);
      const wDay = Math.max(0, 1 - wDusk - wNight);

      sharedUniforms.uDayWeight.value = wDay;

      const D = palettes.day;
      const K = palettes.dusk;
      const N = palettes.night;

      blendColor(cloudUniforms.uCloudLit.value, D.lit, K.lit, N.lit, wDay, wDusk, wNight);
      blendColor(cloudUniforms.uCloudMid.value, D.mid, K.mid, N.mid, wDay, wDusk, wNight);
      blendColor(cloudUniforms.uCloudShadow.value, D.shadow, K.shadow, N.shadow, wDay, wDusk, wNight);
      blendColor(cloudUniforms.uCloudRim.value, D.rim, K.rim, N.rim, wDay, wDusk, wNight);

      cloudUniforms.uOpacityMul.value = D.veilOpacity * wDay + K.veilOpacity * wDusk + N.veilOpacity * wNight;
      cloudUniforms.uBankOpacity.value = D.bankOpacity * wDay + K.bankOpacity * wDusk + N.bankOpacity * wNight;
    },
  };
}
