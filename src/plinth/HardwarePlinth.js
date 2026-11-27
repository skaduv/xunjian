import * as THREE from 'three';
import { PLINTH_CONFIG } from '../config/campusConfig.js';
import { createMowedLawnTexture } from '../core/ProceduralTextures.js';

/**
 * 无界自然翡翠外围地貌 + 多层动态体积航拍云海渐隐系统（取代旧硬件底座托盘）
 *
 * 核心设计（对齐参考图与 BOUNDLESS CLOUD-FADE & HEALTHY-EMERALD SPEC #38）：
 * 1. 保留导出 `createRoundedRectShape` 与 `buildHardwarePlinth()` 完整签名（100% 兼容 main.js 与 TerrainAndStructures.js），
 *    并新增导出 `sampleOuterTerrainHeight(x, z)` 供外围森林树木无缝生根贴地。
 * 2. 无缝外围绿野（~2300m × 2200m）：
 *    - 内缘精确对齐圆角矩形 486×368 (r=26, curveSegments=20)，与园区草坪 y=0.000 零阶差、零法线折痕、同世界坐标 UV 无缝衔接；
 *    - 2.2m 内收防裂压边沉于 y=-0.05，完全避开中心湖泊与 1BF 车库深坑，并附带 y=-3.65 地下防漏光封底；
 *    - 沿三条外延市政干道（中关村大道、平陵西路、永平大道）±26m 走廊严格保持平直 y=0.000；
 *    - 远离园区后渐变展现参考图同款健康叶绿素航拍田野/林地色阶韵律与缓坡丘陵（东侧自然延续龙蟠山余脉），
 *      在 d_out ≈ 235..540m 经有机噪波扰动平滑溶入场景雾色（白昼/暮光/星夜全同步），视觉彻底无界！
 * 3. 多层动态体积航拍云海（userData.noMerge = true，共 4 个透明渲染层，极低 Draw Call）：
 *    - 双层程序化 FBM 体积云海帷幕（y=7m & y=17m）：中心园区完全清澈通透，周边呈有机卷云浪花向阳亮顶 + 冷灰青暗底，
 *      彻底柔化园区边缘并向天际渐隐；
 *    - 3D 多片层视差积云团阵列（y=22..44m，单次 Draw Call）：沿四角与外围山麓/草甸柔和漂浮，自带体积受光与自阴影；
 *    - 高空轻盈薄云丝缕（y=52m）：精致航拍薄云飘过外缘树冠与草野，昼/暮/夜丝滑变色，星夜下转为沉静月光靛云不遮星空。
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

// 三条外延市政主干道精准中心折线（与 @road-horizon / @lush-trees 规范 #38 严格一致，并沿末端自然延续防远端隆起）
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
 * 园区外围无界自然地貌精确高度函数（供外围地形网格与 @lush-trees 外围林带树木共享，100% 同步贴地）
 * - 园区内及外缘 22m 过渡带严格 y = 0.000
 * - 三条外延市政主干道 ±26m 路基走廊严格 y = 0.000
 * - 远处 d_out > 520m 平滑回落至 0，令远景云雾地平线水平无突兀
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
 * 精确采样与 createRoundedRectShape(486, 368, 26) 顶点 1:1 吻合的圆角矩形外轮廓点列与单位外法线
 * 遍历顺序：南边(W->E) -> 东南圆角 -> 东边(S->N) -> 东北圆角 -> 北边(E->W) -> 西北圆角 -> 西边(N->S) -> 西南圆角
 * 外法线 N = (-Tz, +Tx)，确保环带网格全部三角面法线严格朝上 (+Y)
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

  // 与 THREE.Shape.quadraticCurveTo + ShapeGeometry(lawnShape, 24) 完全一致的二次贝塞尔圆角
  const pushQuadCorner = (x0, z0, cx, cz, x1, z1, segs = 24) => {
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      const omt = 1 - t;
      const x = omt * omt * x0 + 2 * omt * t * cx + t * t * x1;
      const z = omt * omt * z0 + 2 * omt * t * cz + t * t * z1;
      const tx = 2 * omt * (cx - x0) + 2 * t * (x1 - cx);
      const tz = 2 * omt * (cz - z0) + 2 * t * (z1 - cz);
      const len = Math.hypot(tx, tz) || 1;
      // 外法线 N = (-tz, +tx) / len
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
 * 1. 构建无缝无界外围自然翡翠地形（~2300m × 2200m 同心扩展环带网格，零拼缝、零台阶、自然田野林地层次 + 雾效溶边）
 */
function buildBoundlessOuterTerrain(sharedUniforms) {
  const perimeter = sampleCampusPerimeterWithNormals();
  const P = perimeter.length;

  // 径向偏移序列：k=0 内收防裂沉唇 (-2.2m @ y=-0.05)，k=1 精准边界 (0.0m @ y=0.000)，向外平滑扩展至 +940m
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

      // 与 TerrainAndStructures.js 完全一致的世界坐标草坪 UV 映射（零纹理相位接缝！）
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
      // 严格朝上 +Y 绕序：(c - a) × (b - a) = N × T = +Y
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // 关键接缝消除：强制内收唇 (k=0) 与精准边界环 (k=1) 法线严格垂直向上 (0,1,0)，杜绝边界处 1px 光照折痕
  const normAttr = geo.attributes.normal;
  for (let k = 0; k <= 1; k++) {
    for (let s = 0; s < P; s++) {
      const idx = k * P + s;
      normAttr.setXYZ(idx, 0, 1, 0);
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

  terrainMat.customProgramCacheKey = () => 'ioply-boundless-outer-terrain-v1';

  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uDayWeight = sharedUniforms.uDayWeight;

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

        // 距离边界 16m 内 100% 保持原园区草坪原色，16..70m 平滑展开参考图同款航拍田野/生态林草色阶韵律
        float patchMask = smoothstep( 16.0, 72.0, otDOut );
        if ( patchMask > 0.001 ) {
          // 顺应平陵西路/永平大道天然倾角 (~19°) 的自然生态农林地块肌理
          vec2 rotXz = vec2( otXz.x * 0.9455 - otXz.y * 0.3256, otXz.x * 0.3256 + otXz.y * 0.9455 );
          vec2 cellId = floor( rotXz / vec2( 96.0, 68.0 ) );
          vec2 cellUv = fract( rotXz / vec2( 96.0, 68.0 ) );
          float cellTone = ot_hash( cellId + vec2( 7.3, 13.1 ) );
          float cellWarm = ot_hash( cellId * 1.37 + vec2( 3.1, 19.7 ) );

          // 柔和天然田垄/修剪微纹与林缘树篱暗带
          float rowWave = sin( rotXz.y * 0.52 + cellTone * 6.2831 ) * 0.045;
          float hedgeEdgeX = smoothstep( 0.0, 0.055, cellUv.x ) * smoothstep( 0.0, 0.055, 1.0 - cellUv.x );
          float hedgeEdgeY = smoothstep( 0.0, 0.065, cellUv.y ) * smoothstep( 0.0, 0.065, 1.0 - cellUv.y );
          float hedgeShadow = mix( 0.72, 1.0, hedgeEdgeX * hedgeEdgeY );

          // 大尺度自然生态草甸与林地深浅起伏（深松翠 ↔ 健康翠绿 ↔ 阳光鲜草绿）
          float macroBio = ot_fbm( otXz * 0.0055 + vec2( 2.4, -1.8 ) );
          vec3 deepEmeraldMul = vec3( 0.66, 0.80, 0.72 );
          vec3 lushMidMul = vec3( 0.96, 1.02, 0.94 );
          vec3 sunlitMeadowMul = vec3( 1.24, 1.16, 0.84 );

          float parcelMix = clamp( cellTone * 0.62 + macroBio * 0.52 - 0.08 + rowWave, 0.0, 1.0 );
          vec3 bioTint = mix( deepEmeraldMul, lushMidMul, smoothstep( 0.12, 0.58, parcelMix ) );
          bioTint = mix( bioTint, sunlitMeadowMul, smoothstep( 0.58, 0.94, parcelMix ) * ( 0.65 + 0.35 * cellWarm ) );
          bioTint *= mix( 0.88, 1.0, hedgeShadow );

          // 丘陵起伏高度着色：坡脚深绿，向阳坡顶更显健康叶绿素生机
          float hillH = smoothstep( 0.4, 10.5, vOuterWorldPos.y );
          bioTint *= mix( vec3( 0.94, 0.97, 0.95 ), vec3( 1.09, 1.07, 0.92 ), hillH );

          // 柔和飘动的高空流云地面投影斑驳（仅在白昼外围生效，增强真实航拍纵深感）
          float cloudShadowFbm = ot_fbm( otXz * 0.0042 - vec2( uTime * 0.0075, -uTime * 0.0042 ) );
          float cloudDapple = mix( 1.0, mix( 0.82, 1.03, smoothstep( 0.34, 0.68, cloudShadowFbm ) ), smoothstep( 45.0, 145.0, otDOut ) * uDayWeight );

          diffuseColor.rgb *= mix( vec3( 1.0 ), bioTint * cloudDapple, patchMask );
        }
        `
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        #ifdef USE_FOG
          float mistDOut = ot_distOutsideCampus( vOuterWorldPos.xz );
          float mistWarp = ( ot_fbm( vOuterWorldPos.xz * 0.0046 - vec2( uTime * 0.006, -uTime * 0.0035 ) ) - 0.5 ) * 105.0;
          float outerMist = smoothstep( 225.0, 520.0, mistDOut + mistWarp );
          // 远端 620m 外强制完全融入天际雾色，确保任何缩放/俯仰角度绝不露出网格边界
          outerMist = max( outerMist, smoothstep( 560.0, 740.0, mistDOut ) );
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
  const capGeo = new THREE.ShapeGeometry(capShape, 18);
  capGeo.rotateX(-Math.PI / 2);
  const capMat = new THREE.MeshStandardMaterial({
    name: 'SubterraneanSoilCap',
    color: '#16241b',
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
 * 共用 GLSL 体积云噪声与圆角园区避让函数块
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

  // 积云团絮状高度场（结合平滑泡状轮廓与多层 FBM 细节，自然蓬松无几何硬边）
  float cl_billow( vec2 p ) {
    vec2 warp = vec2(
      cl_fbm( p * 0.65 + vec2( 3.1, 1.7 ) ),
      cl_fbm( p * 0.65 + vec2( -2.4, 5.3 ) )
    );
    float base = cl_fbm( p + ( warp - 0.5 ) * 1.15 );
    float puffs = 1.0 - abs( cl_vnoise( p * 2.25 + warp * 0.6 ) * 2.0 - 1.0 );
    return clamp( base * 0.78 + puffs * 0.24, 0.0, 1.0 );
  }

  float cl_distOutsideCampus( vec2 xz ) {
    vec2 q = max( vec2( 0.0 ), abs( xz ) - vec2( 217.0, 158.0 ) );
    return length( q ) - 26.0;
  }
`;

/**
 * 3. 构建无缝环绕式程序化 FBM 体积云海层（底层漫雾云海 / 中层翻涌积云带 / 高空轻盈薄云丝）
 */
function buildCloudVeilSheet({
  name,
  altitude,
  scaleXZ,
  driftVec,
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
  // 温和下垂的超大穹顶网格（边缘微降 6m 贴合远景地平线，中心齐平）
  const geo = new THREE.PlaneGeometry(2100, 2100, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const domeDrop = smoothstep(320, 1050, r) * 8.0;
    pos.setY(i, altitude - domeDrop);
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

  mat.customProgramCacheKey = () => `ioply-volumetric-cloud-veil-${name}-v1`;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cloudUniforms.uTime;
    shader.uniforms.uCloudLit = cloudUniforms.uCloudLit;
    shader.uniforms.uCloudMid = cloudUniforms.uCloudMid;
    shader.uniforms.uCloudShadow = cloudUniforms.uCloudShadow;
    shader.uniforms.uCloudRim = cloudUniforms.uCloudRim;
    shader.uniforms.uOpacityMul = cloudUniforms.uOpacityMul;
    shader.uniforms.uSunDirXZ = cloudUniforms.uSunDirXZ;
    shader.uniforms.uLayerParams = {
      value: new THREE.Vector4(scaleXZ, densityBias, densityPow, opacityScale),
    };
    shader.uniforms.uMaskRange = {
      value: new THREE.Vector4(innerClear, innerFull, outerFadeStart, outerFadeEnd),
    };
    shader.uniforms.uDrift = { value: new THREE.Vector3(driftVec[0], driftVec[1], heightLitBoost) };

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
        uniform vec2 uSunDirXZ;
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
        vec2 cP = cXz * uLayerParams.x - uDrift.xy * uTime;

        // 有机扰动园区清透窗口边界，使外围云雾呈自然海湾状卷曲探入外缘林带，绝无生硬几何圆环
        float shoreWarp = ( cl_fbm( cXz * 0.0042 - uDrift.xy * uTime * 0.45 + vec2( 4.2, -3.1 ) ) - 0.5 ) * 112.0;
        float innerWindow = smoothstep( uMaskRange.x, uMaskRange.y, cDOut + shoreWarp );
        // 严格保护中心建筑与湖泊区（cDOut < -14m 彻底透明零遮挡）
        innerWindow *= smoothstep( -14.0, 26.0, cDOut );

        // 最外缘柔化归零（远在平面几何边缘 1050m 之前彻底消失）
        float outerFade = 1.0 - smoothstep( uMaskRange.z, uMaskRange.w, cDOut );

        float rawDens = cl_billow( cP );
        // 向远处云海自然增厚形成无界云床
        float farThick = smoothstep( 175.0, 440.0, cDOut ) * 0.28;
        float dens = clamp( ( rawDens + uLayerParams.y + farThick ) * innerWindow, 0.0, 1.0 );
        dens = pow( smoothstep( 0.14, 0.88, dens ), uLayerParams.z );

        // 单步方向导数体积自阴影：沿阳光方向采样，塑造饱满蓬松的向阳白顶与微凉雾青暗底
        float sunSample = cl_billow( cP + uSunDirXZ * 0.16 );
        float directionalLit = clamp( 0.52 + ( rawDens - sunSample ) * 2.75 + uDrift.z, 0.0, 1.0 );
        // 越往云层边缘薄雾处透光越亮（自然散射银边）
        float silverRim = smoothstep( 0.05, 0.34, dens ) * ( 1.0 - smoothstep( 0.34, 0.78, dens ) );

        vec3 cloudCol = mix( uCloudShadow, uCloudMid, smoothstep( 0.15, 0.62, directionalLit ) );
        cloudCol = mix( cloudCol, uCloudLit, smoothstep( 0.48, 0.95, directionalLit ) );
        cloudCol = mix( cloudCol, uCloudRim, silverRim * 0.35 );

        float finalAlpha = clamp( dens * outerFade * uLayerParams.w * uOpacityMul, 0.0, 0.96 );
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
 * 4. 构建 3D 多片层视差漂浮积云团阵列（单次 Draw Call，围绕园区四角、东侧山麓与外围田野柔和漂浮）
 *    每一朵云由 4 层垂直递增的蓬松软边积云切面组成（下层暗底 -> 中层体积 -> 上层向阳亮顶），
 *    在旋转 360° 与默认等轴测视角下呈现参考图同款立体漂浮航拍积云，绝无生硬球体或方形边界！
 */
function buildSculptedCumulusBanks(cloudUniforms) {
  // 精心排布在园区外缘与远景（全部避开核心建筑与中心湖泊，自然点缀默认视角的右上、左上、右下与四周边界）
  const banks = [
    // 右上 / 东侧龙蟠山外缘丘陵带（呼应参考图右上飘浮积云）
    { x: 325, y: 26, z: 38, sx: 145, sz: 112, h: 12, rot: 0.28, seed: 1.1 },
    { x: 420, y: 33, z: 118, sx: 175, sz: 135, h: 14, rot: -0.22, seed: 2.3 },
    { x: 315, y: 27, z: -115, sx: 155, sz: 118, h: 13, rot: 0.45, seed: 3.7 },
    { x: 460, y: 36, z: -42, sx: 195, sz: 148, h: 15, rot: 0.14, seed: 4.9 },
    // 右下 / 东南外围草甸（呼应参考图右下角轻盈前景飘云！）
    { x: 188, y: 20, z: 268, sx: 132, sz: 98, h: 10, rot: -0.35, seed: 6.2 },
    { x: 295, y: 26, z: 224, sx: 158, sz: 122, h: 12, rot: 0.18, seed: 7.4 },
    { x: 96, y: 21, z: 308, sx: 136, sz: 102, h: 10, rot: 0.52, seed: 8.6 },
    // 左上 / 西北外围田野与中关村大道北延入云处
    { x: -292, y: 28, z: -348, sx: 168, sz: 128, h: 14, rot: 0.34, seed: 9.8 },
    { x: -175, y: 27, z: -372, sx: 162, sz: 120, h: 13, rot: -0.26, seed: 11.2 },
    { x: -385, y: 31, z: -215, sx: 174, sz: 132, h: 14, rot: 0.62, seed: 12.5 },
    { x: -45, y: 26, z: -318, sx: 146, sz: 108, h: 12, rot: -0.15, seed: 13.9 },
    // 东北 / 平陵西路东延入云处
    { x: 132, y: 28, z: -302, sx: 158, sz: 120, h: 13, rot: 0.41, seed: 15.1 },
    { x: 258, y: 31, z: -268, sx: 170, sz: 126, h: 14, rot: -0.32, seed: 16.4 },
    { x: 398, y: 35, z: -225, sx: 188, sz: 142, h: 15, rot: 0.24, seed: 17.8 },
    // 西侧与西南外围林带
    { x: -362, y: 25, z: -58, sx: 156, sz: 118, h: 12, rot: -0.44, seed: 19.2 },
    { x: -356, y: 25, z: 98, sx: 152, sz: 115, h: 12, rot: 0.31, seed: 20.6 },
    { x: -318, y: 26, z: 248, sx: 164, sz: 124, h: 13, rot: -0.19, seed: 22.1 },
    { x: -165, y: 24, z: 312, sx: 154, sz: 116, h: 12, rot: 0.27, seed: 23.5 },
    { x: -35, y: 25, z: 332, sx: 158, sz: 118, h: 12, rot: -0.38, seed: 24.9 },
    // 外环 360° 远景蓬松云带（缩放拉远时形成完整浪漫无界云海框景）
    { x: 545, y: 34, z: 225, sx: 225, sz: 175, h: 16, rot: 0.22, seed: 26.3 },
    { x: 565, y: 36, z: -155, sx: 235, sz: 182, h: 16, rot: -0.31, seed: 27.7 },
    { x: 355, y: 35, z: -395, sx: 220, sz: 170, h: 16, rot: 0.48, seed: 29.1 },
    { x: 25, y: 34, z: -475, sx: 230, sz: 176, h: 16, rot: -0.14, seed: 30.5 },
    { x: -345, y: 35, z: -468, sx: 235, sz: 178, h: 16, rot: 0.36, seed: 31.9 },
    { x: -535, y: 34, z: -265, sx: 228, sz: 175, h: 16, rot: -0.42, seed: 33.4 },
    { x: -545, y: 33, z: 28, sx: 224, sz: 172, h: 15, rot: 0.19, seed: 34.8 },
    { x: -495, y: 33, z: 315, sx: 222, sz: 170, h: 15, rot: -0.28, seed: 36.2 },
    { x: -245, y: 32, z: 455, sx: 226, sz: 172, h: 15, rot: 0.44, seed: 37.6 },
    { x: 115, y: 32, z: 448, sx: 225, sz: 172, h: 15, rot: -0.21, seed: 39.0 },
    { x: 385, y: 33, z: 368, sx: 220, sz: 168, h: 15, rot: 0.33, seed: 40.4 },
  ];

  // 每朵云 4 层垂直视差切片，且按 slice 层序从底到顶写入索引缓冲（航拍俯视天然自下而上正确叠加！）
  const sliceCount = 4;
  const quadCount = banks.length * sliceCount;
  const positions = new Float32Array(quadCount * 4 * 3);
  const uvs = new Float32Array(quadCount * 4 * 2);
  const puffData = new Float32Array(quadCount * 4 * 4); // (seed, sliceT, densityMul, driftPhase)
  const indices = new Uint16Array(quadCount * 6);

  // 轻微向阳光方向偏置上层云顶，形成真实积云斜向立体堆叠
  const sunShiftX = -0.849;
  const sunShiftZ = 0.529;

  let qIdx = 0;
  for (let s = 0; s < sliceCount; s++) {
    const sliceT = s / (sliceCount - 1); // 0.0 (暗底) -> 1.0 (亮顶)
    // 中下部略宽、顶部蓬松略收束
    const widthProfile = 1.0 - Math.pow(sliceT - 0.32, 2) * 0.42;
    const densityMul = 0.72 + Math.sin(sliceT * Math.PI) * 0.32;

    for (let b = 0; b < banks.length; b++) {
      const bank = banks[b];
      const halfX = bank.sx * 0.5 * widthProfile;
      const halfZ = bank.sz * 0.5 * widthProfile;
      const cosR = Math.cos(bank.rot + sliceT * 0.14);
      const sinR = Math.sin(bank.rot + sliceT * 0.14);

      const cx = bank.x + sunShiftX * sliceT * bank.h * 0.42;
      const cy = bank.y + sliceT * bank.h;
      const cz = bank.z + sunShiftZ * sliceT * bank.h * 0.42;

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

        puffData[vi * 4] = bank.seed;
        puffData[vi * 4 + 1] = sliceT;
        puffData[vi * 4 + 2] = densityMul;
        puffData[vi * 4 + 3] = (b % 7) * 0.18;
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
    name: 'VolumetricCumulusBanks',
    color: '#ffffff',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });

  mat.customProgramCacheKey = () => 'ioply-volumetric-cumulus-banks-v1';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = cloudUniforms.uTime;
    shader.uniforms.uCloudLit = cloudUniforms.uCloudLit;
    shader.uniforms.uCloudMid = cloudUniforms.uCloudMid;
    shader.uniforms.uCloudShadow = cloudUniforms.uCloudShadow;
    shader.uniforms.uCloudRim = cloudUniforms.uCloudRim;
    shader.uniforms.uBankOpacity = cloudUniforms.uBankOpacity;
    shader.uniforms.uSunDirXZ = cloudUniforms.uSunDirXZ;

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
        // 极其轻柔的周期环流微飘（永不飘离外围云带，保持画面始终构图完美）
        float driftPhase = aPuffData.x * 0.73 + aPuffData.w * 6.2831;
        transformed.x += sin( uTime * 0.055 + driftPhase ) * 11.5;
        transformed.z += cos( uTime * 0.042 + driftPhase * 1.3 ) * 8.5;
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
        uniform vec2 uSunDirXZ;
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

        // 有机多瓣积云轮廓：中心圆润饱满，外缘经 FBM 羽化出蓬松卷云丝，绝对零方形切边
        vec2 nPos = centered * 2.15 + vec2( seed * 1.73, seed * 2.41 ) - vec2( uTime * 0.012, -uTime * 0.007 );
        float shapeNoise = cl_billow( nPos );
        float radialEnv = 1.0 - smoothstep( 0.16, 0.96, rad + ( 0.5 - shapeNoise ) * 0.42 );
        // 四角硬保护，确保 quad 边缘 100% 为 0
        float safeEdge = 1.0 - smoothstep( 0.78, 0.98, rad );

        // 严防积云漂入核心园区建筑与湖泊上空
        float campusGuard = smoothstep( 8.0, 68.0, cl_distOutsideCampus( vPuffWorldPos.xz ) );

        float dens = clamp( radialEnv * safeEdge * ( 0.55 + shapeNoise * 0.65 ) * sliceDens * campusGuard, 0.0, 1.0 );
        dens = smoothstep( 0.08, 0.84, dens );
        if ( dens < 0.005 ) discard;

        // 3D 垂直分层光影 + 水平斜射日光自阴影（底层微凉雾青、顶层蓬松暖白、边缘透光银边）
        float sunNoise = cl_billow( nPos + uSunDirXZ * 0.22 );
        float horizLit = clamp( 0.50 + ( shapeNoise - sunNoise ) * 2.4 - dot( centered, -uSunDirXZ ) * 0.28, 0.0, 1.0 );
        float totalLit = clamp( sliceT * 0.62 + horizLit * 0.48, 0.0, 1.0 );
        float rimGlow = smoothstep( 0.06, 0.32, dens ) * ( 1.0 - smoothstep( 0.35, 0.78, dens ) );

        vec3 col = mix( uCloudShadow, uCloudMid, smoothstep( 0.10, 0.58, totalLit ) );
        col = mix( col, uCloudLit, smoothstep( 0.45, 0.96, totalLit ) );
        col = mix( col, uCloudRim, rimGlow * 0.38 );

        float alpha = clamp( dens * uBankOpacity * ( 0.42 + sliceT * 0.22 ), 0.0, 0.85 );
        diffuseColor = vec4( col, alpha );
        `
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'VolumetricCumulusBanks';
  mesh.userData.noMerge = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  return mesh;
}

/**
 * 保持原有导出名称与返回契约 { group, update(elapsed, duskFactor, nightFactor) }，
 * 无缝替换旧硬件托盘为无界自然翡翠外围地貌 + 动态多层体积航拍云海系统
 */
export function buildHardwarePlinth() {
  const group = new THREE.Group();
  group.name = 'BoundlessCloudEnvironment';

  const sharedUniforms = {
    uTime: { value: 0 },
    uDayWeight: { value: 1 },
  };

  // 白昼 / 暮光 / 星夜三态云层物理色板（针对 ACESFilmic 0.6 预压缩校准白昼高光，确保阳光云顶蓬松透亮洁白）
  const palettes = {
    day: {
      lit: new THREE.Color('#fffef9').multiplyScalar(2.15),
      mid: new THREE.Color('#e8f1ed').multiplyScalar(1.28),
      shadow: new THREE.Color('#a4bbb3').multiplyScalar(0.95),
      rim: new THREE.Color('#ffffff').multiplyScalar(2.45),
      veilOpacity: 0.90,
      bankOpacity: 0.80,
    },
    dusk: {
      lit: new THREE.Color('#f4a66e').multiplyScalar(1.45),
      mid: new THREE.Color('#5a708c'),
      shadow: new THREE.Color('#1d2b3e'),
      rim: new THREE.Color('#ffc088').multiplyScalar(1.65),
      veilOpacity: 0.82,
      bankOpacity: 0.62,
    },
    night: {
      lit: new THREE.Color('#2d476f'),
      mid: new THREE.Color('#14243c'),
      shadow: new THREE.Color('#07101e'),
      rim: new THREE.Color('#426494'),
      veilOpacity: 0.64,
      bankOpacity: 0.40,
    },
  };

  const cloudUniforms = {
    uTime: sharedUniforms.uTime,
    uCloudLit: { value: palettes.day.lit.clone() },
    uCloudMid: { value: palettes.day.mid.clone() },
    uCloudShadow: { value: palettes.day.shadow.clone() },
    uCloudRim: { value: palettes.day.rim.clone() },
    uOpacityMul: { value: palettes.day.veilOpacity },
    uBankOpacity: { value: palettes.day.bankOpacity },
    // 严格对齐 StudioScene 主阳光方向 (-265, 205, 165) 的水平归一化向量
    uSunDirXZ: { value: new THREE.Vector2(-265, 165).normalize() },
  };

  // 1. 地下防漏光封底 + 无缝外围翡翠绿野地形
  group.add(buildSubterraneanSealCap());
  group.add(buildBoundlessOuterTerrain(sharedUniforms));

  // 2. 底层柔润云雾地平线帷幕（y = 7m）：环抱园区外缘林带并向远景无缝溶成云海
  group.add(
    buildCloudVeilSheet({
      name: 'PerimeterCloudSeaLower',
      altitude: 7.5,
      scaleXZ: 0.0044,
      driftVec: [0.0068, -0.0038],
      innerClear: 58.0,
      innerFull: 245.0,
      outerFadeStart: 690.0,
      outerFadeEnd: 980.0,
      densityBias: -0.06,
      densityPow: 1.05,
      heightLitBoost: -0.04,
      opacityScale: 0.86,
      renderOrder: 10,
      cloudUniforms,
    })
  );

  // 3. 中层蓬松体积积云环幕（y = 17m）：增添多层视差与丰盈向阳亮白云顶层次
  group.add(
    buildCloudVeilSheet({
      name: 'PerimeterCloudSeaUpper',
      altitude: 17.5,
      scaleXZ: 0.0056,
      driftVec: [0.0102, -0.0055],
      innerClear: 82.0,
      innerFull: 295.0,
      outerFadeStart: 670.0,
      outerFadeEnd: 950.0,
      densityBias: -0.14,
      densityPow: 1.18,
      heightLitBoost: 0.14,
      opacityScale: 0.74,
      renderOrder: 11,
      cloudUniforms,
    })
  );

  // 4. 3D 多片层视差漂浮积云团阵列（y = 20..48m，单次 Draw Call，精准点缀四角与外缘山野）
  group.add(buildSculptedCumulusBanks(cloudUniforms));

  // 5. 高空轻盈透亮薄云丝（y = 52m）：航拍高级感轻纱云缕，不遮挡核心园区
  group.add(
    buildCloudVeilSheet({
      name: 'HighAltitudeCirrusWisps',
      altitude: 52.0,
      scaleXZ: 0.0068,
      driftVec: [0.0145, -0.0072],
      innerClear: 46.0,
      innerFull: 230.0,
      outerFadeStart: 620.0,
      outerFadeEnd: 910.0,
      densityBias: -0.26,
      densityPow: 1.45,
      heightLitBoost: 0.24,
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
