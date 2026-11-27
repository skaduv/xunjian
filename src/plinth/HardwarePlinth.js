import * as THREE from 'three';
import { PLINTH_CONFIG } from '../config/campusConfig.js';
import { createMowedLawnTexture } from '../core/ProceduralTextures.js';

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

// 三条外延市政主干道精准中心折线（与 @road-horizon / @lush-trees 规范 #38 严格一致）
const EXTENDED_ARTERIAL_POLYLINES = [
  // 1. 中关村大道 (width = 17.5m)
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
  // 3. 永平大道 (width = 15.0m)
  [
    [-554, 2],
    [-450, 39],
    [-346, 76],
    [-243, 114],
    [-221, 122],
    [-186, 138],
    [-138, 164],
    [-94, 184],
    [6, 230],
    [106, 275],
    [206, 320],
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
  if (dOut <= 22) return 0;

  const roadDist = minDistToExtendedRoads(x, z);
  if (roadDist <= 26) return 0;
  const mRoad = smoothstep(26, 56, roadDist);

  const mEdge = smoothstep(22, 75, dOut) * smoothstep(520, 320, dOut);
  if (mEdge <= 1e-4) return 0;

  const roll = Math.max(
    0,
    (Math.sin(x * 0.0095 + z * 0.0062) * 0.5 +
      Math.cos(x * 0.0068 - z * 0.0105) * 0.35 +
      Math.sin((x - z) * 0.014) * 0.15 +
      0.55) *
      5.2
  );

  // 东侧龙蟠山外延柔缓丘陵余脉
  const east =
    smoothstep(250, 340, x) *
    smoothstep(520, 380, x) *
    (12.0 * Math.exp(-Math.pow((z + 55) / 145, 2)) + 10.5 * Math.exp(-Math.pow((z - 85) / 130, 2)));

  return Math.max(0, (roll + east) * mEdge * mRoad);
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
      const wy = k === 0 ? -0.05 : dist <= 22.0 ? 0.0 : sampleOuterTerrainHeight(wx, wz);

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
  for (let k = 0; k <= 1; k++) {
    for (let s = 0; s < P; s++) {
      normAttr.setXYZ(k * P + s, 0, 1, 0);
    }
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

  terrainMat.customProgramCacheKey = () => 'ioply-boundless-outer-terrain-v2';

  // 将外围参考图色板预先由 sRGB 精确转换至线性空间传入着色器
  const colWoodFloor = new THREE.Color('#22481f');
  const colMidMeadow = new THREE.Color('#34622a');
  const colSunField = new THREE.Color('#4d7b34');
  const colDeepShade = new THREE.Color('#193818');

  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uDayWeight = sharedUniforms.uDayWeight;
    shader.uniforms.uColWoodFloor = { value: colWoodFloor };
    shader.uniforms.uColMidMeadow = { value: colMidMeadow };
    shader.uniforms.uColSunField = { value: colSunField };
    shader.uniforms.uColDeepShade = { value: colDeepShade };

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
        uniform vec3 uColWoodFloor;
        uniform vec3 uColMidMeadow;
        uniform vec3 uColSunField;
        uniform vec3 uColDeepShade;
        varying vec3 vOuterWorldPos;

        float ot_hash( vec2 p ) {
          p = fract( p * vec2( 127.1, 311.7 ) );
          p += dot( p, p + 34.5 );
          return fract( p.x * p.y );
        }

        float ot_vnoise( vec2 p ) {
          vec2 i = floor( p );
          vec2 f = fract( p );
          vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix(
            mix( ot_hash( i ), ot_hash( i + vec2( 1.0, 0.0 ) ), u.x ),
            mix( ot_hash( i + vec2( 0.0, 1.0 ) ), ot_hash( i + vec2( 1.0, 1.0 ) ), u.x ),
            u.y
          );
        }

        float ot_fbm( vec2 p ) {
          float v = 0.0;
          float a = 0.5;
          mat2 m = mat2( 0.80, -0.60, 0.60, 0.80 );
          for ( int i = 0; i < 4; i ++ ) {
            v += a * ot_vnoise( p );
            p = m * p * 2.04 + vec2( 17.3, 9.2 );
            a *= 0.5;
          }
          return v;
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

        // 0..18m 与园区草坪 100% 同源无缝；18..78m 平滑淡出周期草坪贴图，转入纯非周期航拍田野/深林地色阶（零平铺重复感！）
        float outerBlend = smoothstep( 18.0, 78.0, otDOut );
        if ( outerBlend > 0.001 ) {
          // 顺应园区外围干道走势 (~21°) 的自然生态农林地块与柔和微地形肌理
          vec2 rotXz = vec2( otXz.x * 0.9336 - otXz.y * 0.3584, otXz.x * 0.3584 + otXz.y * 0.9336 );
          vec2 plotScale = vec2( 104.0, 74.0 );
          vec2 cellId = floor( rotXz / plotScale );
          vec2 cellUv = fract( rotXz / plotScale );

          float plotSeed = ot_hash( cellId + vec2( 7.3, 13.1 ) );
          float plotWarm = ot_hash( cellId * 1.41 + vec2( 3.1, 19.7 ) );

          // 地块边缘柔和林带暗影（参考图田埂与树篱间的浓郁深绿过渡）
          float hedgeX = smoothstep( 0.0, 0.07, cellUv.x ) * smoothstep( 0.0, 0.07, 1.0 - cellUv.x );
          float hedgeY = smoothstep( 0.0, 0.08, cellUv.y ) * smoothstep( 0.0, 0.08, 1.0 - cellUv.y );
          float hedgeBand = hedgeX * hedgeY;

          // 非周期多尺度自然植被与林下地表起伏
          float macroBio = ot_fbm( otXz * 0.0052 + vec2( 2.4, -1.8 ) );
          float midBio = ot_fbm( otXz * 0.019 + vec2( -5.1, 3.7 ) );
          float microStipple = ( ot_vnoise( otXz * 0.14 ) - 0.5 ) * 0.10;
          // 极细腻随机方向农田微耕作肌理（仅部分向阳田块可见，绝非全局斑马纹）
          float fineRow = sin( ( plotWarm > 0.5 ? rotXz.y : rotXz.x ) * 0.42 + plotSeed * 6.2831 ) * 0.025 * smoothstep( 0.48, 0.85, plotSeed );

          float toneT = clamp( plotSeed * 0.52 + macroBio * 0.46 + ( midBio - 0.5 ) * 0.24 + microStipple + fineRow, 0.0, 1.0 );
          vec3 countryCol = mix( uColWoodFloor, uColMidMeadow, smoothstep( 0.10, 0.56, toneT ) );
          countryCol = mix( countryCol, uColSunField, smoothstep( 0.56, 0.95, toneT ) * ( 0.60 + 0.40 * plotWarm ) );
          // 林缘树篱与林下加深浓郁暗绿
          countryCol = mix( uColDeepShade, countryCol, mix( 0.62, 1.0, hedgeBand ) );

          // 丘陵坡度与坡顶自然叶绿素亮暗层次
          float hillT = smoothstep( 0.5, 11.5, vOuterWorldPos.y );
          countryCol *= mix( vec3( 0.94, 0.97, 0.95 ), vec3( 1.12, 1.08, 0.90 ), hillT );

          // 柔和飘动的高空流云地面微投影（与 35° 风缕流云同向同步）
          vec2 windXz = vec2( otXz.x * 0.8192 + otXz.y * 0.5736, -otXz.x * 0.5736 + otXz.y * 0.8192 );
          float cloudShadow = ot_fbm( windXz * vec2( 0.0028, 0.0058 ) - vec2( uTime * 0.0065, 0.0 ) );
          float dapple = mix( 1.0, mix( 0.80, 1.04, smoothstep( 0.34, 0.68, cloudShadow ) ), smoothstep( 40.0, 140.0, otDOut ) * uDayWeight );
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
          vec2 mistWindXz = vec2( vOuterWorldPos.x * 0.8192 + vOuterWorldPos.z * 0.5736, -vOuterWorldPos.x * 0.5736 + vOuterWorldPos.z * 0.8192 );
          float mistWarp = ( ot_fbm( mistWindXz * vec2( 0.0032, 0.0062 ) - vec2( uTime * 0.0055, 0.0 ) ) - 0.5 ) * 92.0;
          float outerMist = smoothstep( 185.0, 435.0, mistDOut + mistWarp );
          outerMist = max( outerMist, smoothstep( 495.0, 675.0, mistDOut ) );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, clamp( outerMist, 0.0, 1.0 ) );
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
 * 共用 GLSL 风缕羽化体积云函数块（35° 航拍风向拉伸 + 5 阶域翘曲 FBM + 细腻云边羽化侵蚀）
 */
const CLOUD_GLSL_COMMON = `
  float cl_hash( vec2 p ) {
    p = fract( p * vec2( 123.34, 456.21 ) );
    p += dot( p, p + 45.32 );
    return fract( p.x * p.y );
  }

  float cl_vnoise( vec2 p ) {
    vec2 i = floor( p );
    vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix(
      mix( cl_hash( i ), cl_hash( i + vec2( 1.0, 0.0 ) ), u.x ),
      mix( cl_hash( i + vec2( 0.0, 1.0 ) ), cl_hash( i + vec2( 1.0, 1.0 ) ), u.x ),
      u.y
    );
  }

  float cl_fbm( vec2 p ) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2( 0.80, -0.60, 0.60, 0.80 );
    for ( int i = 0; i < 5; i ++ ) {
      v += a * cl_vnoise( p );
      p = m * p * 2.03 + vec2( 11.7, 23.1 );
      a *= 0.5;
    }
    return v;
  }

  // 旋转至 ~35° 航拍主风向（由左下拂向右上，呼应参考图斜向飘逸流云动势）
  vec2 cl_toWindSpace( vec2 xz ) {
    return vec2( xz.x * 0.8192 - xz.y * 0.5736, xz.x * 0.5736 + xz.y * 0.8192 );
  }

  // 飘逸风缕体积云密度场：沿风向柔和拉伸 + 细腻多尺度羽化侵蚀，彻底告别圆团状棉球感
  float cl_windCloud( vec2 windP ) {
    vec2 stretched = vec2( windP.x * 0.56, windP.y * 1.32 );
    vec2 warp = vec2(
      cl_fbm( stretched * 0.72 + vec2( 3.1, 1.7 ) ),
      cl_fbm( stretched * 0.72 + vec2( -2.4, 5.3 ) )
    );
    float body = cl_fbm( stretched + ( warp - 0.5 ) * 1.35 );
    float wispErode = cl_fbm( stretched * 2.45 + warp * 0.85 );
    float ribbon = body * 0.76 + wispErode * 0.28 - 0.04;
    return clamp( ribbon, 0.0, 1.0 );
  }

  float cl_distOutsideCampus( vec2 xz ) {
    vec2 q = max( vec2( 0.0 ), abs( xz ) - vec2( 217.0, 158.0 ) );
    return length( q ) - 26.0;
  }
`;

/**
 * 3. 构建地形自适应无缝风缕体积云海层（3000×3000 大幅面 + 严格高于全部外围丘陵 + 双重外缘归零防方形黑边）
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
  // 3000×3000 超大幅面（半宽 1500m >> outerFadeEnd <= 820m & radialGuard 1260m），杜绝一切缩放视角方形云角！
  const geo = new THREE.PlaneGeometry(3000, 3000, 76, 76);
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
    side: THREE.DoubleSide,
    fog: true,
  });

  mat.customProgramCacheKey = () => `ioply-volumetric-cloud-veil-${name}-v2`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cloudUniforms.uTime;
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
        float cRad = length( cXz );
        // 严格圆形远界归零守卫（在 3000×3000 半宽 1500m 之前彻底消失，星夜/昼间拉远零方形硬边！）
        float radialGuard = 1.0 - smoothstep( 820.0, 1260.0, cRad );
        if ( radialGuard < 0.002 ) discard;

        float cDOut = cl_distOutsideCampus( cXz );
        vec2 windXz = cl_toWindSpace( cXz );
        vec2 cP = windXz * uLayerParams.x - vec2( uDrift.x * uTime, uDrift.y * uTime );

        // 风向拉长的有机云岸扰动，让飘逸云带柔和轻拂外围林缘与视角四角
        float shoreWarp = ( cl_fbm( vec2( windXz.x * 0.0024, windXz.y * 0.0054 ) - vec2( uDrift.x * uTime * 0.35, 0.0 ) + vec2( 4.2, -3.1 ) ) - 0.5 ) * 124.0;
        float innerWindow = smoothstep( uMaskRange.x, uMaskRange.y, cDOut + shoreWarp );
        // 严格保护核心园区（cDOut < -8m 100% 透明通透）
        innerWindow *= smoothstep( -8.0, 32.0, cDOut );

        float outerFade = ( 1.0 - smoothstep( uMaskRange.z, uMaskRange.w, cDOut ) ) * radialGuard;

        float rawDens = cl_windCloud( cP );
        // 向外围逐渐汇聚成柔润无界云海，边缘呈轻盈羽毛状消散
        float farThick = smoothstep( 155.0, 395.0, cDOut ) * 0.30;
        float featherErode = ( cl_fbm( cP * 2.9 + vec2( 9.4, -4.1 ) ) - 0.45 ) * 0.16;
        float dens = clamp( ( rawDens + uLayerParams.y + farThick + featherErode ) * innerWindow, 0.0, 1.0 );
        dens = pow( smoothstep( 0.12, 0.88, dens ), uLayerParams.z );

        // 沿阳光方向单步体积自阴影，刻画柔亮向阳云脊与清润暗底
        float sunSample = cl_windCloud( cP + uSunDirWind * 0.17 );
        float directionalLit = clamp( 0.52 + ( rawDens - sunSample ) * 2.55 + uDrift.z, 0.0, 1.0 );
        float silverRim = smoothstep( 0.04, 0.34, dens ) * ( 1.0 - smoothstep( 0.34, 0.78, dens ) );

        vec3 cloudCol = mix( uCloudShadow, uCloudMid, smoothstep( 0.14, 0.62, directionalLit ) );
        cloudCol = mix( cloudCol, uCloudLit, smoothstep( 0.46, 0.94, directionalLit ) );
        cloudCol = mix( cloudCol, uCloudRim, silverRim * 0.36 );

        float finalAlpha = clamp( dens * outerFade * uLayerParams.w * uOpacityMul, 0.0, 0.94 );
        if ( finalAlpha < 0.004 ) discard;

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
 * 4. 构建细长风缕轻薄云带层（18 条 ~2.6:1 顺风细长羽化薄雾云带，双片层轻柔融于连续云海，彻底消除棉球/薄饼斑点）
 */
function buildSculptedMistRibbons(cloudUniforms) {
  // 全部顺应 ~35° 主风向 (-0.61 rad ± 微幅变化)，长宽比 2.4:1 ~ 2.9:1，大幅面低透明羽化融于连续云海
  const ribbons = [
    // 右上 / 东侧龙蟠山外缘丘陵带（呼应参考图右上风缕飘云）
    { x: 355, y: 31, z: 42, sx: 330, sz: 128, h: 7, rot: -0.58, seed: 1.3 },
    { x: 465, y: 36, z: 128, sx: 380, sz: 146, h: 8, rot: -0.64, seed: 2.7 },
    { x: 345, y: 32, z: -125, sx: 340, sz: 132, h: 7, rot: -0.52, seed: 4.1 },
    { x: 495, y: 38, z: -55, sx: 410, sz: 158, h: 8, rot: -0.60, seed: 5.5 },
    // 右下 / 东南外围草甸（呼应参考图右下角细长羽化前景流云）
    { x: 205, y: 27, z: 275, sx: 300, sz: 112, h: 6, rot: -0.56, seed: 7.2 },
    { x: 335, y: 31, z: 235, sx: 345, sz: 132, h: 7, rot: -0.63, seed: 8.8 },
    { x: 82, y: 28, z: 325, sx: 315, sz: 118, h: 6, rot: -0.54, seed: 10.4 },
    // 左上 / 西北外围田野与中关村大道北延
    { x: -305, y: 32, z: -342, sx: 360, sz: 138, h: 7, rot: -0.62, seed: 12.1 },
    { x: -165, y: 31, z: -375, sx: 345, sz: 132, h: 7, rot: -0.55, seed: 13.7 },
    { x: -415, y: 34, z: -205, sx: 375, sz: 142, h: 8, rot: -0.66, seed: 15.2 },
    // 东北 / 平陵西路东延
    { x: 145, y: 32, z: -315, sx: 350, sz: 134, h: 7, rot: -0.59, seed: 16.8 },
    { x: 345, y: 36, z: -285, sx: 390, sz: 148, h: 8, rot: -0.53, seed: 18.4 },
    // 西侧与西南外围林带
    { x: -390, y: 30, z: -42, sx: 345, sz: 130, h: 7, rot: -0.61, seed: 20.1 },
    { x: -380, y: 30, z: 145, sx: 340, sz: 128, h: 7, rot: -0.57, seed: 21.7 },
    { x: -245, y: 30, z: 315, sx: 355, sz: 134, h: 7, rot: -0.64, seed: 23.3 },
    // 远环柔和延伸带（始终在 radialGuard 范围内无缝消融）
    { x: 560, y: 38, z: 255, sx: 420, sz: 164, h: 8, rot: -0.58, seed: 25.0 },
    { x: -35, y: 35, z: -475, sx: 410, sz: 158, h: 8, rot: -0.60, seed: 26.6 },
    { x: -510, y: 35, z: 305, sx: 415, sz: 160, h: 8, rot: -0.55, seed: 28.2 },
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
    side: THREE.DoubleSide,
    fog: true,
  });

  mat.customProgramCacheKey = () => 'ioply-volumetric-mist-ribbons-v2';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cloudUniforms.uTime;
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

        float seed = vPuffData.x;
        float sliceT = vPuffData.y;
        float sliceDens = vPuffData.z;

        // 顺风细长羽化薄云丝：边缘以极高频率自然侵蚀，无缝融进连续云海（零圆斑/零堆叠硬边）
        vec2 nPos = vec2( centered.x * 1.35, centered.y * 2.85 ) + vec2( seed * 1.73, seed * 2.41 ) - vec2( uTime * 0.011, 0.0 );
        float shapeNoise = cl_windCloud( nPos );
        float wispDetail = cl_fbm( nPos * 2.6 + vec2( 2.1, -3.7 ) );
        float featherEnv = 1.0 - smoothstep( 0.06, 0.96, rad + ( 0.52 - shapeNoise ) * 0.58 + ( 0.5 - wispDetail ) * 0.22 );
        float safeEdge = 1.0 - smoothstep( 0.72, 0.98, rad );

        float campusGuard = smoothstep( 14.0, 82.0, cl_distOutsideCampus( vPuffWorldPos.xz ) );
        float radialGuard = 1.0 - smoothstep( 780.0, 1180.0, length( vPuffWorldPos.xz ) );

        float dens = clamp( featherEnv * safeEdge * ( 0.45 + shapeNoise * 0.75 ) * sliceDens * campusGuard * radialGuard, 0.0, 1.0 );
        dens = pow( smoothstep( 0.08, 0.86, dens ), 1.45 );
        if ( dens < 0.004 ) discard;

        float sunNoise = cl_windCloud( nPos + uSunDirWind * 0.20 );
        float horizLit = clamp( 0.52 + ( shapeNoise - sunNoise ) * 2.2, 0.0, 1.0 );
        float totalLit = clamp( sliceT * 0.42 + horizLit * 0.62, 0.0, 1.0 );
        float rimGlow = smoothstep( 0.05, 0.32, dens ) * ( 1.0 - smoothstep( 0.34, 0.76, dens ) );

        vec3 col = mix( uCloudShadow, uCloudMid, smoothstep( 0.12, 0.60, totalLit ) );
        col = mix( col, uCloudLit, smoothstep( 0.46, 0.95, totalLit ) );
        col = mix( col, uCloudRim, rimGlow * 0.34 );

        float alpha = clamp( dens * uBankOpacity * ( 0.46 + sliceT * 0.16 ), 0.0, 0.72 );
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

  const sharedUniforms = {
    uTime: { value: 0 },
    uDayWeight: { value: 1 },
  };

  // 昼/暮/夜三态云层色板（QA #44 深度校准：白昼清透暖白、暮光克制微暖、星夜静谧深靛零斑点）
  const palettes = {
    day: {
      lit: new THREE.Color('#fffef9').multiplyScalar(2.10),
      mid: new THREE.Color('#e6efea').multiplyScalar(1.24),
      shadow: new THREE.Color('#a2b6ae').multiplyScalar(0.92),
      rim: new THREE.Color('#ffffff').multiplyScalar(2.35),
      veilOpacity: 0.86,
      bankOpacity: 0.38,
    },
    dusk: {
      lit: new THREE.Color('#c98c68').multiplyScalar(1.12),
      mid: new THREE.Color('#3d5069'),
      shadow: new THREE.Color('#1a2638'),
      rim: new THREE.Color('#dfa47c').multiplyScalar(1.18),
      veilOpacity: 0.72,
      bankOpacity: 0.24,
    },
    night: {
      lit: new THREE.Color('#172740'),
      mid: new THREE.Color('#0d182b'),
      shadow: new THREE.Color('#070f1d'),
      rim: new THREE.Color('#233b5e'),
      veilOpacity: 0.45,
      bankOpacity: 0.14,
    },
  };

  // 将主太阳水平方向 (-265, 165) 旋转至与 cl_toWindSpace 一致的风向坐标系
  const sunRaw = new THREE.Vector2(-265, 165).normalize();
  const sunDirWind = new THREE.Vector2(
    sunRaw.x * 0.8192 - sunRaw.y * 0.5736,
    sunRaw.x * 0.5736 + sunRaw.y * 0.8192
  ).normalize();

  const cloudUniforms = {
    uTime: sharedUniforms.uTime,
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

  // 2. 底层风缕云海主帷幕（y >= max(24.0, terrain+13.5)，严防任何丘陵或林冠切穿，3000×3000 + 双重外缘归零）
  group.add(
    buildCloudVeilSheet({
      name: 'PerimeterCloudSeaLower',
      minAltitude: 24.0,
      terrainClearance: 13.5,
      scaleXZ: 0.0046,
      windSpeed: 0.0072,
      crossDrift: -0.0014,
      innerClear: 44.0,
      innerFull: 228.0,
      outerFadeStart: 560.0,
      outerFadeEnd: 820.0,
      densityBias: -0.03,
      densityPow: 1.08,
      heightLitBoost: -0.03,
      opacityScale: 0.84,
      renderOrder: 10,
      cloudUniforms,
    })
  );

  // 3. 中层飘逸体积云海带（y >= max(36.0, terrain+21.0)，丰富体积视差与向阳亮白流云脊）
  group.add(
    buildCloudVeilSheet({
      name: 'PerimeterCloudSeaUpper',
      minAltitude: 36.0,
      terrainClearance: 21.0,
      scaleXZ: 0.0058,
      windSpeed: 0.0108,
      crossDrift: -0.0020,
      innerClear: 68.0,
      innerFull: 270.0,
      outerFadeStart: 540.0,
      outerFadeEnd: 800.0,
      densityBias: -0.10,
      densityPow: 1.18,
      heightLitBoost: 0.14,
      opacityScale: 0.72,
      renderOrder: 11,
      cloudUniforms,
    })
  );

  // 4. 细长风缕轻薄云带层（单次 Draw Call，柔和融汇于连续云海之中，零棉球零分层硬边）
  group.add(buildSculptedMistRibbons(cloudUniforms));

  // 5. 高空轻纱薄云丝缕（y >= max(56.0, terrain+30.0)，精致航拍透亮薄雾云缕）
  group.add(
    buildCloudVeilSheet({
      name: 'HighAltitudeCirrusWisps',
      minAltitude: 56.0,
      terrainClearance: 30.0,
      scaleXZ: 0.0072,
      windSpeed: 0.0155,
      crossDrift: -0.0028,
      innerClear: 34.0,
      innerFull: 205.0,
      outerFadeStart: 510.0,
      outerFadeEnd: 770.0,
      densityBias: -0.22,
      densityPow: 1.42,
      heightLitBoost: 0.22,
      opacityScale: 0.42,
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
