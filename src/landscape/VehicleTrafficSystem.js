import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ELEVATIONS } from '../config/campusConfig.js';

/**
 * IOPLY 园区精工工业设计微缩多车型建模 + 真实连通道路图动态行车系统
 *
 * 工艺与工程规格（严格对齐 @art-lighting #9 与 @joint-auditor #11）：
 * 1. 三款 Blender/Dribbble 级雕塑感微缩工业设计车型（全量 InstancedMesh，日间 15 DC / 夜间 16 DC，0 PointLight）：
 *    - sedan  : 行政溜背新能源轿跑（16 点顺滑倒角截面 + 清晰腰线收腰 + 深石墨轮眉下裙/前后扩散器 + 贯穿式冰青日行灯/宝石红尾灯）
 *    - suv    : 现代建筑感跨界 SUV（饱满圆角方正雕塑体量 + 悬浮熏黑全景玻璃舱 + 阳极石墨轮眉与车顶行李架）
 *    - patrol : 园区自主巡检无人车（温润陶瓷珠光圆角胶囊车体 + 360° 环绕深色视野舱 + 车顶 LiDAR 冰青环形雷达光带）
 * 2. 6 色棚拍缎面清漆汽车色板（MeshPhysicalMaterial Clearcoat，零苍白过曝）：
 *    - Porcelain Pearl / Titanium Silver / Graphite Metallic / Deep Midnight Slate / Sage Eucalyptus / Terracotta Bronze
 * 3. 16 段圆角胎肩车轮 + 凹陷 5 辐合金轮毂（修复 R10：滚动零 2.5cm 颠簸，车胎严丝合缝贴地）
 * 4. 全部路网节点、停车位、掉头圆弧与路面标高与 RoadAndParking.js 保持毫米级 1:1 同步（修复 R7、R8、R9）
 */

// ============================================================================
// 1. 棚拍缎面清漆汽车色板与车型基准规格
// ============================================================================

const PAINT_PALETTE = [
  '#D6D2CA', // 1. Porcelain Pearl 陶瓷珠光
  '#9DA4AD', // 2. Titanium Silver 拉丝钛银
  '#454B54', // 3. Graphite Metallic 深邃石墨灰
  '#2B3B4E', // 4. Deep Midnight Slate 午夜石板蓝
  '#6B857B', // 5. Sage Eucalyptus 尤加利鼠尾草绿
  '#A8644B', // 6. Terracotta Bronze 暖陶古铜
];

const PATROL_PAINT = '#D6D2CA';

// 精确对齐 RoadAndParking.js ROAD_Y 标高表
const ROAD_Y = {
  BRANCH_APRON: 0.058,
  FIRE_LOT: ELEVATIONS.ROAD_TOP, // 0.062
  YONGPING: 0.064,
  WELCOME: 0.066,
  PINGLING: 0.068,
  ZGC: 0.072,
  PLAZA: ELEVATIONS.PLAZA_TOP, // 0.072
  JUNCTION: 0.076,
};

const ARCHETYPE_SPECS = {
  sedan: {
    length: 4.82,
    width: 1.92,
    wheelRadius: 0.33,
    wheelScale: 1.0,
    wheelX: 1.43,
    wheelZ: 0.87,
    headlightPos: [2.37, 0.64, 0],
    headlightScale: [0.11, 0.072, 1.54],
    taillightPos: [-2.38, 0.78, 0],
    taillightScale: [0.10, 0.068, 1.62],
    shadowScale: [5.40, 1, 2.34],
    beamOriginX: 2.40,
    beamLength: 14.2,
    beamWidth: 5.4,
  },
  suv: {
    length: 4.92,
    width: 2.04,
    wheelRadius: 0.38,
    wheelScale: 1.1515,
    wheelX: 1.48,
    wheelZ: 0.92,
    headlightPos: [2.43, 0.85, 0],
    headlightScale: [0.12, 0.088, 1.68],
    taillightPos: [-2.43, 0.98, 0],
    taillightScale: [0.10, 0.082, 1.74],
    shadowScale: [5.56, 1, 2.48],
    beamOriginX: 2.45,
    beamLength: 15.2,
    beamWidth: 5.8,
  },
  patrol: {
    length: 3.96,
    width: 1.80,
    wheelRadius: 0.30,
    wheelScale: 0.9091,
    wheelX: 1.22,
    wheelZ: 0.81,
    headlightPos: [1.95, 0.68, 0],
    headlightScale: [0.10, 0.082, 1.38],
    taillightPos: [-1.95, 0.72, 0],
    taillightScale: [0.10, 0.075, 1.38],
    beaconPos: [0.04, 1.94, 0],
    shadowScale: [4.48, 1, 2.18],
    beamOriginX: 1.98,
    beamLength: 12.0,
    beamWidth: 4.7,
  },
};

// ============================================================================
// 2. 16 点顺滑倒角曲面放样 + 阳极石墨轮眉/下裙精细件生成器
// ============================================================================

/**
 * 16 点对称圆润截面闭合放样器（局部坐标：+X 车头，-X 车尾，+Y 向上，±Z 车宽）
 * 内置底部倒角、圆润轮肩折线、Tumblehome 内倾侧窗与平滑拱顶，彻底告别生硬直棱方块！
 */
function buildSculptedHull(stations) {
  const ringPts = 16;
  const n = stations.length;
  const positions = [];
  const indices = [];

  for (let i = 0; i < n; i++) {
    const s = stations[i];
    const wBot = s.wBot;
    const wSill = s.wSill ?? (wBot + (s.wBelt - wBot) * 0.78);
    const wMid = s.wMid ?? s.wBelt * 0.99;
    const wBelt = s.wBelt;
    const wUpper = s.wUpper ?? (s.wBelt * 0.42 + (s.wRoof ?? s.wBelt * 0.78) * 0.58);
    const wRoof = s.wRoof ?? s.wBelt * 0.76;
    const wCrown = s.wCrown ?? wRoof * 0.56;

    const yBot = s.yBot;
    const ySill = s.ySill ?? yBot + (s.yBelt - yBot) * 0.16;
    const yMid = s.yMid ?? yBot + (s.yBelt - yBot) * 0.62;
    const yBelt = s.yBelt;
    const yUpper = s.yUpper ?? yBelt + (s.yRoof - yBelt) * 0.58;
    const yRoof = s.yRoof;
    const yCrown = s.yCrown ?? yRoof + 0.032;

    // 严格 16 点左右完全镜像轮廓（零重复点、外法线严格朝外）
    const pts16 = [
      [-wBot * 0.55, yBot],         // 0 底中左
      [wBot * 0.55, yBot],          // 1 底中右
      [wBot, yBot + 0.025],         // 2 右底倒角
      [wSill, ySill],               // 3 右下裙
      [wMid, yMid],                 // 4 右饱满车门
      [wBelt, yBelt],               // 5 右腰肩线
      [wUpper, yUpper],             // 6 右侧窗过渡
      [wRoof, yRoof],               // 7 右车顶圆角
      [wCrown, yCrown],             // 8 右车顶弧
      [-wCrown, yCrown],            // 9 左车顶弧
      [-wRoof, yRoof],              // 10 左车顶圆角
      [-wUpper, yUpper],            // 11 左侧窗过渡
      [-wBelt, yBelt],              // 12 左腰肩线
      [-wMid, yMid],                // 13 左饱满车门
      [-wSill, ySill],              // 14 左下裙
      [-wBot, yBot + 0.025],        // 15 左底倒角
    ];

    for (let k = 0; k < ringPts; k++) {
      positions.push(s.x, pts16[k][1], pts16[k][0]);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const rowA = i * ringPts;
    const rowB = (i + 1) * ringPts;
    for (let k = 0; k < ringPts; k++) {
      const kNext = (k + 1) % ringPts;
      const a = rowA + k;
      const b = rowB + k;
      const c = rowB + kNext;
      const d = rowA + kNext;
      indices.push(a, b, d, b, c, d);
    }
  }

  // 车尾端盖（法线指向 -X）
  const rearCenterIdx = positions.length / 3;
  const s0 = stations[0];
  positions.push(s0.x - 0.03, (s0.yBot + s0.yRoof) * 0.5, 0);
  for (let k = 0; k < ringPts; k++) {
    const kNext = (k + 1) % ringPts;
    indices.push(rearCenterIdx, k, kNext);
  }

  // 车头端盖（法线指向 +X）
  const frontCenterIdx = positions.length / 3;
  const sLast = stations[n - 1];
  const lastRow = (n - 1) * ringPts;
  positions.push(sLast.x + 0.03, (sLast.yBot + sLast.yRoof) * 0.5, 0);
  for (let k = 0; k < ringPts; k++) {
    const kNext = (k + 1) % ringPts;
    indices.push(frontCenterIdx, lastRow + kNext, lastRow + k);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 统一合并带法线与索引的局部组件几何
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
 * 构建圆弧形深石墨轮眉护板（左右各 2 枚，为每款车赋予精致轮拱立体感！）
 */
function buildWheelArchFlares(wheelX, wheelZ, wheelRadius, thickness = 0.055) {
  const parts = [];
  const archR = wheelRadius + 0.065;
  for (const sx of [-wheelX, wheelX]) {
    for (const side of [-1, 1]) {
      const brow = new THREE.TorusGeometry(archR, thickness, 4, 8, Math.PI * 0.92);
      brow.rotateZ(Math.PI * 0.04);
      brow.scale(1.06, 0.96, 1.0);
      brow.translate(sx, wheelRadius + 0.02, side * (wheelZ + 0.05));
      parts.push(brow);
    }
  }
  return parts;
}

/**
 * 构建精致流体水滴形外后视镜壳体
 */
function buildAeroMirrorPair(x, y, z) {
  const parts = [];
  for (const side of [-1, 1]) {
    const cap = new THREE.SphereGeometry(0.085, 6, 4);
    cap.scale(1.35, 0.65, 1.15);
    cap.translate(x, y, side * z);
    parts.push(cap);
  }
  return parts;
}

/**
 * 构建 1 号车型：行政溜背新能源轿跑（Executive Fastback EV Sedan）
 */
function createSedanGeometries() {
  const bodyStations = [
    { x: -2.39, yBot: 0.34, yBelt: 0.77, yRoof: 0.84, yCrown: 0.85, wBot: 0.64, wSill: 0.78, wBelt: 0.82, wRoof: 0.76, wCrown: 0.48 },
    { x: -2.26, yBot: 0.27, yBelt: 0.88, yRoof: 0.93, yCrown: 0.95, wBot: 0.76, wSill: 0.89, wBelt: 0.92, wRoof: 0.82, wCrown: 0.54 },
    { x: -1.84, yBot: 0.25, yBelt: 0.92, yRoof: 1.05, yCrown: 1.08, wBot: 0.82, wSill: 0.94, wBelt: 0.96, wRoof: 0.78, wCrown: 0.52 },
    { x: -1.24, yBot: 0.24, yBelt: 0.92, yRoof: 1.28, yCrown: 1.32, wBot: 0.83, wSill: 0.95, wBelt: 0.95, wRoof: 0.71, wCrown: 0.46 },
    { x: -0.46, yBot: 0.24, yBelt: 0.91, yRoof: 1.37, yCrown: 1.40, wBot: 0.83, wSill: 0.95, wBelt: 0.94, wRoof: 0.69, wCrown: 0.45 },
    { x: 0.34, yBot: 0.24, yBelt: 0.89, yRoof: 1.35, yCrown: 1.38, wBot: 0.83, wSill: 0.95, wBelt: 0.94, wRoof: 0.70, wCrown: 0.46 },
    { x: 1.08, yBot: 0.24, yBelt: 0.86, yRoof: 0.92, yCrown: 0.95, wBot: 0.82, wSill: 0.94, wBelt: 0.95, wRoof: 0.83, wCrown: 0.52 },
    { x: 1.78, yBot: 0.25, yBelt: 0.80, yRoof: 0.84, yCrown: 0.87, wBot: 0.80, wSill: 0.92, wBelt: 0.92, wRoof: 0.81, wCrown: 0.50 },
    { x: 2.24, yBot: 0.27, yBelt: 0.68, yRoof: 0.73, yCrown: 0.75, wBot: 0.74, wSill: 0.86, wBelt: 0.85, wRoof: 0.74, wCrown: 0.45 },
    { x: 2.40, yBot: 0.33, yBelt: 0.56, yRoof: 0.61, yCrown: 0.62, wBot: 0.60, wSill: 0.74, wBelt: 0.73, wRoof: 0.62, wCrown: 0.38 },
  ];

  const bodyGeo = mergeIndexedParts([
    buildSculptedHull(bodyStations),
    ...buildAeroMirrorPair(0.62, 0.96, 1.00),
  ]);

  // 全景熏黑玻璃舱（比车体上部清晰外凸 2.4cm，零 Z-Fighting）
  const cabinStations = [
    { x: -1.86, yBot: 0.94, yBelt: 0.98, yRoof: 1.05, yCrown: 1.07, wBot: 0.77, wSill: 0.79, wBelt: 0.80, wRoof: 0.74, wCrown: 0.48 },
    { x: -1.20, yBot: 0.92, yBelt: 0.95, yRoof: 1.28, yCrown: 1.33, wBot: 0.89, wSill: 0.91, wBelt: 0.92, wRoof: 0.73, wCrown: 0.49 },
    { x: -0.44, yBot: 0.91, yBelt: 0.94, yRoof: 1.36, yCrown: 1.41, wBot: 0.90, wSill: 0.92, wBelt: 0.93, wRoof: 0.71, wCrown: 0.47 },
    { x: 0.34, yBot: 0.90, yBelt: 0.93, yRoof: 1.34, yCrown: 1.39, wBot: 0.90, wSill: 0.92, wBelt: 0.93, wRoof: 0.72, wCrown: 0.48 },
    { x: 1.12, yBot: 0.89, yBelt: 0.92, yRoof: 0.96, yCrown: 0.97, wBot: 0.81, wSill: 0.83, wBelt: 0.84, wRoof: 0.78, wCrown: 0.48 },
  ];
  const cabinGeo = buildSculptedHull(cabinStations);

  // 阳极深石墨精致下装件：轮拱护眉 + 侧裙导流条 + 前进气格栅 + 尾扩散器
  const trimParts = [
    ...buildWheelArchFlares(1.43, 0.87, 0.33, 0.045),
    (() => {
      const g = new THREE.BoxGeometry(2.02, 0.09, 1.88);
      g.translate(0.0, 0.25, 0);
      return g;
    })(),
    (() => {
      const g = new THREE.BoxGeometry(0.10, 0.16, 1.24);
      g.translate(2.38, 0.42, 0);
      return g;
    })(),
    (() => {
      const g = new THREE.BoxGeometry(0.12, 0.16, 1.32);
      g.translate(-2.37, 0.40, 0);
      return g;
    })(),
  ];
  const trimGeo = mergeIndexedParts(trimParts);

  return { bodyGeo, cabinGeo, trimGeo };
}

/**
 * 构建 2 号车型：现代建筑感跨界 SUV（Modern Architectural SUV）
 */
function createSuvGeometries() {
  const bodyStations = [
    { x: -2.44, yBot: 0.40, yBelt: 0.96, yRoof: 1.09, yCrown: 1.11, wBot: 0.74, wSill: 0.88, wBelt: 0.91, wRoof: 0.83, wCrown: 0.56 },
    { x: -2.28, yBot: 0.34, yBelt: 1.03, yRoof: 1.38, yCrown: 1.41, wBot: 0.84, wSill: 0.97, wBelt: 0.99, wRoof: 0.81, wCrown: 0.56 },
    { x: -1.80, yBot: 0.33, yBelt: 1.04, yRoof: 1.64, yCrown: 1.68, wBot: 0.87, wSill: 1.00, wBelt: 1.01, wRoof: 0.79, wCrown: 0.55 },
    { x: -0.76, yBot: 0.33, yBelt: 1.03, yRoof: 1.67, yCrown: 1.71, wBot: 0.87, wSill: 1.00, wBelt: 1.01, wRoof: 0.78, wCrown: 0.55 },
    { x: 0.38, yBot: 0.33, yBelt: 1.02, yRoof: 1.65, yCrown: 1.69, wBot: 0.87, wSill: 1.00, wBelt: 1.00, wRoof: 0.78, wCrown: 0.55 },
    { x: 1.12, yBot: 0.33, yBelt: 1.01, yRoof: 1.07, yCrown: 1.09, wBot: 0.86, wSill: 1.00, wBelt: 1.01, wRoof: 0.89, wCrown: 0.60 },
    { x: 1.98, yBot: 0.34, yBelt: 0.96, yRoof: 1.01, yCrown: 1.04, wBot: 0.84, wSill: 0.98, wBelt: 0.98, wRoof: 0.87, wCrown: 0.58 },
    { x: 2.34, yBot: 0.36, yBelt: 0.86, yRoof: 0.94, yCrown: 0.96, wBot: 0.78, wSill: 0.92, wBelt: 0.92, wRoof: 0.81, wCrown: 0.54 },
    { x: 2.46, yBot: 0.42, yBelt: 0.74, yRoof: 0.82, yCrown: 0.84, wBot: 0.68, wSill: 0.82, wBelt: 0.82, wRoof: 0.72, wCrown: 0.46 },
  ];

  const bodyGeo = mergeIndexedParts([
    buildSculptedHull(bodyStations),
    ...buildAeroMirrorPair(0.72, 1.10, 1.08),
  ]);

  const cabinStations = [
    { x: -2.26, yBot: 1.06, yBelt: 1.09, yRoof: 1.35, yCrown: 1.38, wBot: 0.86, wSill: 0.89, wBelt: 0.90, wRoof: 0.82, wCrown: 0.56 },
    { x: -1.78, yBot: 1.05, yBelt: 1.07, yRoof: 1.58, yCrown: 1.61, wBot: 0.95, wSill: 0.97, wBelt: 0.98, wRoof: 0.82, wCrown: 0.56 },
    { x: -0.74, yBot: 1.04, yBelt: 1.06, yRoof: 1.60, yCrown: 1.63, wBot: 0.96, wSill: 0.98, wBelt: 0.99, wRoof: 0.81, wCrown: 0.56 },
    { x: 0.38, yBot: 1.03, yBelt: 1.05, yRoof: 1.59, yCrown: 1.62, wBot: 0.96, wSill: 0.98, wBelt: 0.99, wRoof: 0.81, wCrown: 0.56 },
    { x: 1.14, yBot: 1.03, yBelt: 1.05, yRoof: 1.10, yCrown: 1.12, wBot: 0.88, wSill: 0.90, wBelt: 0.91, wRoof: 0.84, wCrown: 0.56 },
  ];
  const sunroof = new THREE.BoxGeometry(1.66, 0.032, 1.08);
  sunroof.translate(-0.72, 1.715, 0);
  const cabinGeo = mergeIndexedParts([buildSculptedHull(cabinStations), sunroof]);

  // SUV 专属阳极石墨越野轮眉 + 下护裙 + 车顶纵轨 + 前后护板
  const railL = new THREE.BoxGeometry(1.96, 0.055, 0.065);
  railL.translate(-0.72, 1.71, -0.64);
  const railR = new THREE.BoxGeometry(1.96, 0.055, 0.065);
  railR.translate(-0.72, 1.71, 0.64);
  const rocker = new THREE.BoxGeometry(2.04, 0.12, 1.98);
  rocker.translate(0.0, 0.35, 0);
  const frontGrille = new THREE.BoxGeometry(0.11, 0.24, 1.34);
  frontGrille.translate(2.43, 0.62, 0);
  const rearSkid = new THREE.BoxGeometry(0.12, 0.20, 1.44);
  rearSkid.translate(-2.42, 0.52, 0);

  const trimGeo = mergeIndexedParts([
    ...buildWheelArchFlares(1.48, 0.92, 0.38, 0.058),
    railL,
    railR,
    rocker,
    frontGrille,
    rearSkid,
  ]);

  return { bodyGeo, cabinGeo, trimGeo };
}

/**
 * 构建 3 号车型：园区自主安全巡检无人车（Campus Autonomous Security Patrol Shuttle）
 */
function createPatrolGeometries() {
  const bodyStations = [
    { x: -1.97, yBot: 0.34, yBelt: 0.84, yRoof: 1.56, yCrown: 1.64, wBot: 0.66, wSill: 0.78, wBelt: 0.81, wRoof: 0.71, wCrown: 0.50 },
    { x: -1.78, yBot: 0.28, yBelt: 0.87, yRoof: 1.77, yCrown: 1.85, wBot: 0.77, wSill: 0.87, wBelt: 0.89, wRoof: 0.76, wCrown: 0.58 },
    { x: -1.10, yBot: 0.27, yBelt: 0.88, yRoof: 1.83, yCrown: 1.89, wBot: 0.79, wSill: 0.88, wBelt: 0.90, wRoof: 0.76, wCrown: 0.60 },
    { x: 1.10, yBot: 0.27, yBelt: 0.88, yRoof: 1.83, yCrown: 1.89, wBot: 0.79, wSill: 0.88, wBelt: 0.90, wRoof: 0.76, wCrown: 0.60 },
    { x: 1.78, yBot: 0.28, yBelt: 0.87, yRoof: 1.77, yCrown: 1.85, wBot: 0.77, wSill: 0.87, wBelt: 0.89, wRoof: 0.76, wCrown: 0.58 },
    { x: 1.97, yBot: 0.34, yBelt: 0.84, yRoof: 1.56, yCrown: 1.64, wBot: 0.66, wSill: 0.78, wBelt: 0.81, wRoof: 0.71, wCrown: 0.50 },
  ];

  // 车顶流线多传感器 LiDAR 巡检帽壳体
  const sensorPod = new THREE.BoxGeometry(1.36, 0.13, 0.96);
  sensorPod.translate(0.04, 1.95, 0);
  const bodyGeo = mergeIndexedParts([buildSculptedHull(bodyStations), sensorPod]);

  const cabinStations = [
    { x: -1.94, yBot: 0.90, yBelt: 0.93, yRoof: 1.55, yCrown: 1.59, wBot: 0.76, wSill: 0.80, wBelt: 0.82, wRoof: 0.74, wCrown: 0.52 },
    { x: -1.72, yBot: 0.90, yBelt: 0.93, yRoof: 1.71, yCrown: 1.75, wBot: 0.87, wSill: 0.90, wBelt: 0.92, wRoof: 0.79, wCrown: 0.59 },
    { x: 1.72, yBot: 0.90, yBelt: 0.93, yRoof: 1.71, yCrown: 1.75, wBot: 0.87, wSill: 0.90, wBelt: 0.92, wRoof: 0.79, wCrown: 0.59 },
    { x: 1.94, yBot: 0.90, yBelt: 0.93, yRoof: 1.55, yCrown: 1.59, wBot: 0.76, wSill: 0.80, wBelt: 0.82, wRoof: 0.74, wCrown: 0.52 },
  ];
  const cabinGeo = buildSculptedHull(cabinStations);

  // 巡检车阳极石墨轮眉 + 激光雷达底座圆塔 + 前后防撞护杠
  const lidarTower = new THREE.CylinderGeometry(0.14, 0.17, 0.14, 12);
  lidarTower.translate(0.42, 2.06, 0);
  const rearSensor = new THREE.CylinderGeometry(0.10, 0.12, 0.09, 10);
  rearSensor.translate(-0.42, 2.03, 0);
  const frontBumper = new THREE.BoxGeometry(0.10, 0.16, 1.32);
  frontBumper.translate(1.96, 0.42, 0);
  const rearBumper = new THREE.BoxGeometry(0.10, 0.16, 1.32);
  rearBumper.translate(-1.96, 0.42, 0);
  const skirt = new THREE.BoxGeometry(1.74, 0.10, 1.74);
  skirt.translate(0, 0.28, 0);

  const trimGeo = mergeIndexedParts([
    ...buildWheelArchFlares(1.22, 0.81, 0.30, 0.044),
    lidarTower,
    rearSensor,
    frontBumper,
    rearBumper,
    skirt,
  ]);

  return { bodyGeo, cabinGeo, trimGeo };
}

/**
 * 16 段圆角胎肩轮胎 + 凹陷 5 辐合金轮毂（修复 R10：cos(π/16)=0.981 彻底消除 8 边形垂直弹跳！）
 */
function createSharedWheelGeometries() {
  // 16 段圆润倒角胎面轮廓（半径严格等于 0.330m，cos(π/16)=0.981 彻底消除滚跳，同时极度轻量化）
  const tireProfile = [
    new THREE.Vector2(0.195, -0.120),
    new THREE.Vector2(0.330, -0.105),
    new THREE.Vector2(0.330, 0.105),
    new THREE.Vector2(0.195, 0.120),
  ];
  const tireGeo = new THREE.LatheGeometry(tireProfile, 16);
  tireGeo.rotateX(Math.PI / 2);

  // 凹陷立体合金轮毂（外露双面 12 边凹盘 + 5 辐精工轮辐 + 中心帽，高性能高精致度）
  const rimParts = [];
  for (const side of [-1, 1]) {
    const dish = new THREE.CircleGeometry(0.20, 12);
    if (side < 0) dish.rotateY(Math.PI);
    dish.translate(0, 0, side * 0.118);
    rimParts.push(dish);

    const hub = new THREE.CircleGeometry(0.06, 8);
    if (side < 0) hub.rotateY(Math.PI);
    hub.translate(0, 0, side * 0.128);
    rimParts.push(hub);

    for (let sp = 0; sp < 5; sp++) {
      const a = (sp / 5) * Math.PI * 2;
      const spoke = new THREE.PlaneGeometry(0.165, 0.032);
      if (side < 0) spoke.rotateY(Math.PI);
      spoke.translate(0.092, 0, 0);
      spoke.rotateZ(a);
      spoke.translate(0, 0, side * 0.124);
      rimParts.push(spoke);
    }
  }
  const rimGeo = mergeIndexedParts(rimParts);

  return { tireGeo, rimGeo };
}

/**
 * 现代雕塑感贯穿式 LED 车灯条（微弯包裹两侧端点，告别硬棱 1×1×1 方块）
 */
function createSculptedLightBarGeometry() {
  const center = new THREE.BoxGeometry(0.76, 0.72, 0.82);
  const podL = new THREE.BoxGeometry(1.0, 1.0, 0.18);
  podL.translate(-0.08, 0, -0.43);
  const podR = new THREE.BoxGeometry(1.0, 1.0, 0.18);
  podR.translate(-0.08, 0, 0.43);
  return mergeIndexedParts([center, podL, podR]);
}

// ============================================================================
// 3. 程序化柔边贴花纹理（暖棕灰接地 AO 接触阴影 + 夜间双前照灯羽化光束）
// ============================================================================

function createContactShadowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  // 严格匹配 @art-lighting #9 暖灰褐 AO 阴影色 #2C2824
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.15, size * 0.5, size * 0.5, size * 0.48);
  grad.addColorStop(0.0, 'rgba(44, 40, 36, 0.68)');
  grad.addColorStop(0.56, 'rgba(44, 40, 36, 0.40)');
  grad.addColorStop(0.84, 'rgba(44, 40, 36, 0.12)');
  grad.addColorStop(1.0, 'rgba(44, 40, 36, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createHeadlightBeamTexture() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);

  const drawSingleBeam = (startY, endY) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(4, startY - 12);
    ctx.lineTo(w - 6, endY - 58);
    ctx.lineTo(w - 6, endY + 58);
    ctx.lineTo(4, startY + 12);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, startY, w, endY);
    grad.addColorStop(0.0, 'rgba(255, 242, 214, 0.74)');
    grad.addColorStop(0.18, 'rgba(255, 238, 202, 0.46)');
    grad.addColorStop(0.55, 'rgba(255, 230, 182, 0.16)');
    grad.addColorStop(0.85, 'rgba(255, 222, 166, 0.03)');
    grad.addColorStop(1.0, 'rgba(255, 220, 160, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  };

  ctx.filter = 'blur(12px)';
  drawSingleBeam(h * 0.38, h * 0.33);
  drawSingleBeam(h * 0.62, h * 0.67);
  ctx.filter = 'none';

  ctx.globalCompositeOperation = 'destination-in';
  const maskY = ctx.createLinearGradient(0, 0, 0, h);
  maskY.addColorStop(0.0, 'rgba(0,0,0,0)');
  maskY.addColorStop(0.18, 'rgba(0,0,0,1)');
  maskY.addColorStop(0.82, 'rgba(0,0,0,1)');
  maskY.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = maskY;
  ctx.fillRect(0, 0, w, h);

  const maskX = ctx.createLinearGradient(0, 0, w, 0);
  maskX.addColorStop(0.0, 'rgba(0,0,0,0.45)');
  maskX.addColorStop(0.08, 'rgba(0,0,0,1)');
  maskX.addColorStop(0.82, 'rgba(0,0,0,0.8)');
  maskX.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = maskX;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ============================================================================
// 4. 园区真实连通道路有向图（100% 精准对齐 RoadAndParking.js 无界主干道与南北双岛十字路口！）
// ============================================================================

const ROAD_NODES = {
  // ---- 6 个市政主干道无界外延出入口（深入云雾渐隐区 d_out ≈ 140–155m，彻底消除园区边沿突兀刷新！） ----
  P_ZGC_N: { x: -203.4, z: -338.0, kind: 'portal' },
  P_ZGC_S: { x: -230.0, z: 338.0, kind: 'portal' },
  P_PL_W: { x: -395.0, z: -71.5, kind: 'portal' },
  P_PL_NE: { x: 356.0, z: -226.8, kind: 'portal' },
  P_YP_W: { x: -396.0, z: 36.0, kind: 'portal' },
  P_YP_S: { x: 125.0, z: 292.3, kind: 'portal' },

  // ---- 市政主干道主交叉口（与 RoadAndParking.js 精准 0mm 对齐） ----
  J_PL_ZGC: { x: -210.5, z: -106.4, kind: 'junction' },
  J_FIRE_W: { x: -212.1, z: -66.0, kind: 'junction' },
  J_WEST_BR: { x: -216.2, z: 22.0, kind: 'junction' },
  J_YP_ZGC: { x: -221.6, z: 121.8, kind: 'junction' },
  J_NORTH_GATE: { x: 26.0, z: -154.1, kind: 'junction' },

  // ---- 北迎宾大道分幅双岛 + 开敞四向消防环道十字路口 + 中央大入口落客回转广场 ----
  N_WELC_S: { x: 20.1, z: -134.0, kind: 'campus' },
  N_WELC_N: { x: 31.9, z: -134.0, kind: 'campus' },
  N_CROSS_W: { x: 20.1, z: -108.0, kind: 'campus' },
  N_CROSS_E: { x: 31.9, z: -108.0, kind: 'campus' },
  J_PLAZA_C: { x: 26.0, z: -108.0, kind: 'campus' },
  J_PLAZA_SW: { x: 20.1, z: -88.2, kind: 'campus', patrolGoal: true },
  J_PLAZA_SE: { x: 31.9, z: -88.2, kind: 'campus', patrolGoal: true },
  J_PLAZA_W: { x: 10.0, z: -108.0, kind: 'campus' },
  J_PLAZA_E: { x: 42.0, z: -108.0, kind: 'campus' },

  // ---- 内部消防环道、西翼支线与停车场喉道 ----
  J_WEST_FIRE: { x: -144.0, z: -94.9, kind: 'campus', patrolGoal: true },
  J_WPARK_GATE: { x: -145.35, z: -10.0, kind: 'campus', patrolGoal: true },
  D_WPARK: { x: -123.5, z: -10.0, kind: 'terminal', patrolGoal: true },
  J_NEPARK_GATE: { x: 89.5, z: -105.85, kind: 'campus', patrolGoal: true },
  D_NEPARK: { x: 89.5, z: -119.5, kind: 'terminal', patrolGoal: true },
  J_EAST_CORNER: { x: 96.1, z: -103.95, kind: 'campus' },
  J_EAST_MID: { x: 97.6, z: -42.0, kind: 'campus', patrolGoal: true },
  D_EAST_PORTAL: { x: 96.0, z: 17.5, kind: 'terminal', patrolGoal: true },
};

// 末端掉头平滑圆弧（与停车场车位、东掉头广场 (96,21.8,r=5.0) 及东栈桥留足 >= 1.5m~3.0m 安全净距）
const TERMINAL_TURNAROUNDS = {
  D_WPARK: [
    [-123.5, -8.55],
    [-118.2, -6.8],
    [-116.4, -10.0],
    [-118.2, -13.2],
    [-123.5, -11.45],
  ],
  D_NEPARK: [
    [90.95, -119.5],
    [91.8, -123.2],
    [89.5, -125.3],
    [87.2, -123.2],
    [88.05, -119.5],
  ],
  // 东侧门洞圆形掉头广场 (96.0, 21.8, r=5.0)：SUV 外缘距圆弧路缘 >= 1.5m，距东栈桥零侵入！
  D_EAST_PORTAL: [
    [94.45, 17.5],
    [93.8, 21.8],
    [96.0, 24.1],
    [98.2, 21.8],
    [97.55, 17.5],
  ],
};

function buildRoadGraph() {
  const adj = {};
  for (const id of Object.keys(ROAD_NODES)) {
    adj[id] = [];
  }

  const addDirected = (from, to, via, opts) => {
    const a = ROAD_NODES[from];
    const b = ROAD_NODES[to];
    const pts = [[a.x, a.z], ...(via || []), [b.x, b.z]];
    let length = 0;
    for (let i = 1; i < pts.length; i++) {
      length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    adj[from].push({
      from,
      to,
      pts,
      length,
      roadClass: opts.roadClass,
      roadTopY: opts.roadTopY,
      laneOffset: opts.laneOffset,
      speedLimit: opts.speedLimit,
      patrolAllowed: opts.patrolAllowed ?? false,
    });
  };

  const addBidirectional = (u, v, via, opts) => {
    addDirected(u, v, via, opts);
    addDirected(v, u, via ? [...via].reverse() : null, opts);
  };

  // 1. 西侧市政主干道：中关村大道（19.6m 双向六车道 + 中央绿化分隔带，laneOffset = 4.6m，距中分带 >=1.68m、距外路缘 >=2.98m）
  const zgcOpts = { roadClass: 'arterial', roadTopY: ROAD_Y.ZGC, laneOffset: 4.6, speedLimit: 14.5, patrolAllowed: false };
  addBidirectional('P_ZGC_N', 'J_PL_ZGC', [[-205.0, -294.0], [-208.0, -184.0]], zgcOpts);
  addBidirectional('J_PL_ZGC', 'J_FIRE_W', [[-211.0, -92.0]], zgcOpts);
  addBidirectional('J_FIRE_W', 'J_WEST_BR', [[-214.0, -24.0], [-216.0, 15.0]], zgcOpts);
  addBidirectional('J_WEST_BR', 'J_YP_ZGC', [[-218.8, 72.0], [-221.0, 110.0]], zgcOpts);
  addBidirectional('J_YP_ZGC', 'P_ZGC_S', [[-224.0, 184.0], [-228.0, 294.0]], zgcOpts);

  // 2. 北侧市政主干道：平陵西路（15.5m 双向四车道）
  const plOpts = { roadClass: 'arterial', roadTopY: ROAD_Y.PINGLING, laneOffset: 3.4, speedLimit: 14.0, patrolAllowed: false };
  addBidirectional('P_PL_W', 'J_PL_ZGC', [[-351.0, -80.0], [-243.0, -100.0]], plOpts);
  addBidirectional('J_PL_ZGC', 'J_NORTH_GATE', [[-130.0, -124.0], [-25.0, -144.0]], plOpts);
  addBidirectional('J_NORTH_GATE', 'P_PL_NE', [[65.0, -162.0], [164.0, -184.0], [272.0, -208.0]], plOpts);

  // 3. 西南市政主干道：永平大道（15.0m 顺直 26.2° 双向四车道）
  const ypOpts = { roadClass: 'arterial', roadTopY: ROAD_Y.YONGPING, laneOffset: 3.3, speedLimit: 13.5, patrolAllowed: false };
  addBidirectional('P_YP_W', 'J_YP_ZGC', [[-346.0, 60.6], [-243.0, 111.3]], ypOpts);
  addBidirectional('J_YP_ZGC', 'P_YP_S', [[-186.0, 139.3], [-138.0, 162.9], [-94.0, 184.6], [6.0, 233.8]], ypOpts);

  // 4. 北迎宾大道（南北分幅双岛单向分流，经开敞四向十字路口衔接中央大入口落客广场）
  const welcOpts = { roadClass: 'campus', roadTopY: ROAD_Y.WELCOME, laneOffset: 0.0, speedLimit: 7.4, patrolAllowed: false };
  const dropoffOpts = { roadClass: 'plaza', roadTopY: ROAD_Y.PLAZA, laneOffset: 0.0, speedLimit: 5.8, patrolAllowed: true };

  // 北段进出（平陵西路 <-> 消防环道十字路口）
  addDirected('J_NORTH_GATE', 'N_WELC_S', [[21.4, -145.0]], welcOpts);
  addDirected('N_WELC_S', 'N_CROSS_W', null, welcOpts);
  addDirected('N_CROSS_E', 'N_WELC_N', null, welcOpts);
  addDirected('N_WELC_N', 'J_NORTH_GATE', [[30.6, -145.0]], welcOpts);

  // 十字路口转接（允许北迎宾大道与消防环道自由互通）
  addDirected('N_CROSS_W', 'J_PLAZA_C', null, { ...welcOpts, patrolAllowed: true });
  addDirected('J_PLAZA_C', 'N_CROSS_E', null, { ...welcOpts, patrolAllowed: true });
  addDirected('J_PLAZA_C', 'N_CROSS_W', null, { ...welcOpts, patrolAllowed: true });
  addDirected('N_CROSS_E', 'J_PLAZA_C', null, { ...welcOpts, patrolAllowed: true });

  // 南落客岛逆时针 VIP 落客回转环（完美绕行南岛 z ∈ [-101.6, -92.6]，零侵占路缘与柱灯！）
  addDirected('N_CROSS_W', 'J_PLAZA_SW', null, dropoffOpts);
  addDirected('J_PLAZA_SW', 'J_PLAZA_SE', null, dropoffOpts);
  addDirected('J_PLAZA_SE', 'N_CROSS_E', null, dropoffOpts);

  // 5. 内部消防环道（于 z = -108.0 径直贯通北迎宾四向十字路口，彻底告别强行绕道南广场！）
  const fireOpts = { roadClass: 'campus', roadTopY: ROAD_Y.FIRE_LOT, laneOffset: 1.55, speedLimit: 7.2, patrolAllowed: true };
  addBidirectional('J_FIRE_W', 'J_WEST_FIRE', [[-174.0, -84.0]], fireOpts);
  addBidirectional('J_WEST_FIRE', 'J_PLAZA_W', [[-130.0, -98.0], [-58.0, -106.0]], fireOpts);
  addBidirectional('J_PLAZA_W', 'J_PLAZA_C', null, fireOpts);
  addBidirectional('J_PLAZA_C', 'J_PLAZA_E', null, fireOpts);
  addBidirectional('J_PLAZA_E', 'J_NEPARK_GATE', [[66.0, -107.2]], fireOpts);
  addBidirectional('J_NEPARK_GATE', 'J_EAST_CORNER', null, fireOpts);
  addBidirectional('J_EAST_CORNER', 'J_EAST_MID', [[99.1, -99.1], [99.95, -91.0], [99.4, -80.2], [98.2, -68.0]], fireOpts);
  addBidirectional('J_EAST_MID', 'D_EAST_PORTAL', [[97.0, -12.0]], fireOpts);

  // 6. 西翼支线
  const branchOpts = { roadClass: 'campus', roadTopY: ROAD_Y.BRANCH_APRON, laneOffset: 1.55, speedLimit: 6.8, patrolAllowed: true };
  addBidirectional('J_WEST_BR', 'J_WPARK_GATE', [[-168.0, 22.0], [-153.0, 21.9], [-148.0, 20.4], [-146.1, 18.2], [-145.0, 6.0]], branchOpts);
  addBidirectional('J_WPARK_GATE', 'J_WEST_FIRE', [[-146.0, -34.0], [-145.0, -66.0]], branchOpts);

  // 7. 停车场出入口引道
  const parkOpts = { roadClass: 'parking', roadTopY: ROAD_Y.FIRE_LOT, laneOffset: 1.45, speedLimit: 5.0, patrolAllowed: true };
  addBidirectional('J_WPARK_GATE', 'D_WPARK', null, parkOpts);
  addBidirectional('J_NEPARK_GATE', 'D_NEPARK', null, parkOpts);

  return adj;
}

function findShortestPath(adj, startId, goalId, { patrolOnly = false, avoidFirstNode = null } = {}) {
  if (startId === goalId) return null;
  const dist = new Map();
  const prevEdge = new Map();
  const visited = new Set();
  const queue = [{ id: startId, d: 0 }];
  dist.set(startId, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.d - b.d);
    const { id, d } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === goalId) break;

    const edges = adj[id] || [];
    for (const edge of edges) {
      if (patrolOnly && !edge.patrolAllowed) continue;
      if (id === startId && avoidFirstNode && edge.to === avoidFirstNode) continue;
      const weight = edge.length * (edge.roadClass === 'arterial' ? 0.85 : 1.0);
      const nd = d + weight;
      if (nd < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nd);
        prevEdge.set(edge.to, edge);
        queue.push({ id: edge.to, d: nd });
      }
    }
  }

  if (!prevEdge.has(goalId)) return null;
  const edgePath = [];
  let cur = goalId;
  while (cur !== startId) {
    const e = prevEdge.get(cur);
    edgePath.push(e);
    cur = e.from;
  }
  edgePath.reverse();
  return edgePath;
}

// ============================================================================
// 5. 靠右车道偏移 + 二次贝塞尔平滑圆角 + 精确 0mm 误差路面标高采样（修复 R9！）
// ============================================================================

function sampleRoadSurfaceY(x, z, edgeRoadTopY = null) {
  // 1. 三个市政精细交叉口沥青垫层 (0.076)
  const d1 = (x + 210.5) * (x + 210.5) + (z + 106.4) * (z + 106.4);
  const d2 = (x + 221.6) * (x + 221.6) + (z - 121.8) * (z - 121.8);
  const d3 = (x - 26.0) * (x - 26.0) + (z + 154.1) * (z + 154.1);
  if (d1 < 13.8 * 13.8 || d2 < 13.8 * 13.8 || (d3 < 10.5 * 10.5 && z >= -161.8)) {
    return ROAD_Y.JUNCTION;
  }
  // 2. 中央门廊北迎宾广场 (0.072，精确对齐 plazaBox z ∈ [-104.6, -81.0])
  if (x >= 8 && x <= 44 && z >= -104.6 && z <= -81) {
    return ROAD_Y.PLAZA;
  }
  // 3. 北迎宾大道及十字交叉口铺装面 (0.066，精确覆盖 x ∈ [17.6, 34.4], z ∈ [-154.1, -104.2])
  if (x >= 17.6 && x <= 34.4 && z >= -154.1 && z < -104.6) {
    return ROAD_Y.WELCOME;
  }
  // 4. 西停车场入口沥青过渡喉道 (0.066)
  if (x >= -137.0 && x <= -124.2 && z >= -16.68 && z <= -3.32) {
    return ROAD_Y.WELCOME;
  }
  // 5. 东侧门洞圆形掉头广场 (0.058，精确匹配 eastTurnBulb)
  if (x >= 90.5 && x <= 101.5 && z >= 17.5 && z <= 27.2) {
    return ROAD_Y.BRANCH_APRON;
  }
  // 6. 西停车场与东北停车场 (0.062)
  if (x >= -137.0 && x <= -103.0 && z >= -32.0 && z <= 12.0) {
    return ROAD_Y.FIRE_LOT;
  }
  if (x >= 74.5 && x <= 104.5 && z >= -129.0 && z <= -110.0) {
    return ROAD_Y.FIRE_LOT;
  }
  // 7. 东北停车场入口衔接引道 (0.058)
  if (x >= 85.0 && x <= 94.0 && z > -110.0 && z < -107.6) {
    return ROAD_Y.BRANCH_APRON;
  }
  // 8. 精确使用当前路段的原生路面标高（根治平陵西路/永平大道外延与交界处的 4~8mm 悬浮/下陷！）
  if (edgeRoadTopY !== null) {
    return edgeRoadTopY;
  }
  // 静态泊车等无路段上下文回退
  return ROAD_Y.FIRE_LOT;
}

function compileSmoothRoute(edgePath, { arterialLaneDelta = 0, prependTurnaround = null } = {}) {
  const rawPts = [];

  if (prependTurnaround && prependTurnaround.length > 0) {
    const startEdgeY = edgePath[0]?.roadTopY ?? ROAD_Y.FIRE_LOT;
    for (const [tx, tz] of prependTurnaround) {
      rawPts.push({ x: tx, z: tz, speedLimit: 4.2, roadTopY: startEdgeY, isCorner: false, fillet: 2.2 });
    }
  }

  for (let ei = 0; ei < edgePath.length; ei++) {
    const edge = edgePath[ei];
    const pts = edge.pts;
    const m = pts.length;
    const offset =
      edge.roadClass === 'arterial'
        ? Math.max(2.1, edge.laneOffset + arterialLaneDelta)
        : edge.laneOffset;
    const fillet = edge.roadClass === 'arterial' ? 6.8 : 4.2;

    for (let i = 0; i < m; i++) {
      const pPrev = pts[Math.max(0, i - 1)];
      const pNext = pts[Math.min(m - 1, i + 1)];
      const dx = pNext[0] - pPrev[0];
      const dz = pNext[1] - pPrev[1];
      const len = Math.hypot(dx, dz) || 1;
      const rx = -dz / len;
      const rz = dx / len;
      const ox = pts[i][0] + rx * offset;
      const oz = pts[i][1] + rz * offset;

      if (rawPts.length > 0) {
        const last = rawPts[rawPts.length - 1];
        if (Math.hypot(ox - last.x, oz - last.z) < 0.9) continue;
      }

      rawPts.push({ x: ox, z: oz, speedLimit: edge.speedLimit, roadTopY: edge.roadTopY, fillet });
    }
  }

  if (rawPts.length < 2) return null;

  const cleanPts = [rawPts[0]];
  for (let i = 1; i < rawPts.length - 1; i++) {
    const a = cleanPts[cleanPts.length - 1];
    const b = rawPts[i];
    const c = rawPts[i + 1];
    const v1x = b.x - a.x;
    const v1z = b.z - a.z;
    const v2x = c.x - b.x;
    const v2z = c.z - b.z;
    const l1 = Math.hypot(v1x, v1z);
    const l2 = Math.hypot(v2x, v2z);
    if (l1 < 0.8) continue;
    const dot = (v1x * v2x + v1z * v2z) / (l1 * l2 + 1e-6);
    if (dot < -0.82 && Math.min(l1, l2) < 4.5) continue;
    cleanPts.push(b);
  }
  cleanPts.push(rawPts[rawPts.length - 1]);
  if (cleanPts.length < 2) return null;

  const filleted = [cleanPts[0]];
  for (let i = 1; i < cleanPts.length - 1; i++) {
    const prev = cleanPts[i - 1];
    const curr = cleanPts[i];
    const next = cleanPts[i + 1];
    const inX = curr.x - prev.x;
    const inZ = curr.z - prev.z;
    const outX = next.x - curr.x;
    const outZ = next.z - curr.z;
    const inLen = Math.hypot(inX, inZ);
    const outLen = Math.hypot(outX, outZ);
    if (inLen < 0.4 || outLen < 0.4) continue;

    const uInX = inX / inLen;
    const uInZ = inZ / inLen;
    const uOutX = outX / outLen;
    const uOutZ = outZ / outLen;
    const dot = Math.max(-1, Math.min(1, uInX * uOutX + uInZ * uOutZ));
    const turnAngle = Math.acos(dot);

    if (turnAngle < 0.08) {
      filleted.push(curr);
      continue;
    }

    const r = Math.min(curr.fillet, inLen * 0.42, outLen * 0.42);
    const ax = curr.x - uInX * r;
    const az = curr.z - uInZ * r;
    const bx = curr.x + uOutX * r;
    const bz = curr.z + uOutZ * r;
    const steps = turnAngle > 0.7 ? 7 : 4;
    const cornerSpeed = Math.min(prev.speedLimit, curr.speedLimit, next.speedLimit);

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const omt = 1 - t;
      filleted.push({
        x: omt * omt * ax + 2 * omt * t * curr.x + t * t * bx,
        z: omt * omt * az + 2 * omt * t * curr.z + t * t * bz,
        speedLimit: cornerSpeed,
        roadTopY: t < 0.5 ? prev.roadTopY : next.roadTopY,
      });
    }
  }
  filleted.push(cleanPts[cleanPts.length - 1]);

  const samples = [];
  let accumS = 0;
  samples.push({
    x: filleted[0].x,
    z: filleted[0].z,
    s: 0,
    speedLimit: filleted[0].speedLimit,
    roadTopY: filleted[0].roadTopY,
  });

  for (let i = 1; i < filleted.length; i++) {
    const a = filleted[i - 1];
    const b = filleted[i];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 0.05) continue;
    const sub = Math.max(1, Math.round(segLen / 1.25));
    for (let k = 1; k <= sub; k++) {
      const t = k / sub;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      const last = samples[samples.length - 1];
      accumS += Math.hypot(px - last.x, pz - last.z);
      samples.push({
        x: px,
        z: pz,
        s: accumS,
        speedLimit: Math.min(a.speedLimit, b.speedLimit),
        roadTopY: b.roadTopY,
      });
    }
  }

  const count = samples.length;
  if (count < 2) return null;

  for (let i = 0; i < count; i++) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(count - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    samples[i].fx = dx / len;
    samples[i].fz = dz / len;
    samples[i].rotY = Math.atan2(-samples[i].fz, samples[i].fx);
    samples[i].y = sampleRoadSurfaceY(samples[i].x, samples[i].z, samples[i].roadTopY);
  }

  for (let i = 0; i < count; i++) {
    const iPrev = Math.max(0, i - 2);
    const iNext = Math.min(count - 1, i + 2);
    const ds = Math.max(0.5, samples[iNext].s - samples[iPrev].s);
    let dYaw = samples[iNext].rotY - samples[iPrev].rotY;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    samples[i].curvature = Math.abs(dYaw) / ds;
  }

  return {
    samples,
    totalLength: accumS,
    startNode: edgePath[0].from,
    endNode: edgePath[edgePath.length - 1].to,
    prevToEndNode: edgePath[edgePath.length - 1].from,
  };
}

function sampleRouteInto(route, dist, out) {
  const samples = route.samples;
  const lastIdx = samples.length - 1;
  const clamped = Math.max(0, Math.min(route.totalLength, dist));

  let lo = 0;
  let hi = lastIdx;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s <= clamped) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = b.s - a.s;
  const t = span > 1e-5 ? (clamped - a.s) / span : 0;

  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.y = a.y + (b.y - a.y) * t;

  let dYaw = b.rotY - a.rotY;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  out.rotY = a.rotY + dYaw * t;
  out.fx = Math.cos(out.rotY);
  out.fz = -Math.sin(out.rotY);

  let maxCurv = a.curvature;
  let minSpeed = a.speedLimit;
  const lookAheadEnd = Math.min(lastIdx, lo + 9);
  for (let k = lo + 1; k <= lookAheadEnd; k++) {
    if (samples[k].curvature > maxCurv) maxCurv = samples[k].curvature;
    if (samples[k].speedLimit < minSpeed) minSpeed = samples[k].speedLimit;
  }

  const curveCap = maxCurv > 0.015 ? Math.sqrt(2.6 / maxCurv) : minSpeed;
  out.targetSpeed = Math.max(3.2, Math.min(minSpeed, curveCap));
}

// ============================================================================
// 6. 停车场静态泊车点位（修复 R7：100% 避让车棚立柱、充电桩、轮挡与进出车道！）
// ============================================================================

const PARKED_VEHICLES_CONFIG = [
  // 西侧太阳能充电车棚北翼（x = -129.0 朝东；立柱 -134.2 / 充电桩 -133.64 -> 车尾 -131.45 净距 >= 1.75m！）
  { x: -129.0, z: -27.8, rotY: 0, type: 'sedan', colorIdx: 0 },
  { x: -129.0, z: -23.0, rotY: 0, type: 'suv', colorIdx: 3 },
  { x: -129.0, z: -18.2, rotY: 0, type: 'sedan', colorIdx: 4 },
  // 西侧太阳能充电车棚南翼（彻底让出中间 z ∈ [-14.5, -5.5] 入口行车道！）
  { x: -129.0, z: -1.8, rotY: 0, type: 'patrol', colorIdx: 0 }, // 充电待命巡检无人车
  { x: -129.0, z: 3.0, rotY: 0, type: 'suv', colorIdx: 5 },
  { x: -129.0, z: 7.8, rotY: 0, type: 'sedan', colorIdx: 1 },
  // 西侧东排（x = -109.6 朝西，距 D_WPARK 掉头圆弧 >= 3.3m）
  { x: -109.6, z: -27.5, rotY: Math.PI, type: 'suv', colorIdx: 2 },
  { x: -109.6, z: -20.5, rotY: Math.PI, type: 'sedan', colorIdx: 0 },
  { x: -109.6, z: -11.5, rotY: Math.PI, type: 'sedan', colorIdx: 3 },
  { x: -109.6, z: -2.5, rotY: Math.PI, type: 'suv', colorIdx: 4 },
  { x: -109.6, z: 6.8, rotY: Math.PI, type: 'sedan', colorIdx: 5 },
  // 东北侧地面停车场西排太阳能车棚（x = 81.2 朝东；立柱 76.96 / 充电桩 77.52 -> 净距 >= 1.07m，距掉头区 >= 2.5m！）
  { x: 81.2, z: -124.8, rotY: 0, type: 'sedan', colorIdx: 1 },
  { x: 81.2, z: -119.5, rotY: 0, type: 'suv', colorIdx: 2 },
  { x: 81.2, z: -114.2, rotY: 0, type: 'sedan', colorIdx: 4 },
  // 东北侧地面停车场东排（x = 98.2 朝西）
  { x: 98.2, z: -124.5, rotY: Math.PI, type: 'suv', colorIdx: 0 },
  { x: 98.2, z: -114.5, rotY: Math.PI, type: 'sedan', colorIdx: 5 },
];

// 动态行驶编队（16 台：8 行政溜背轿跑 + 6 跨界 SUV + 2 园区自主安全巡检无人车）
const MOVING_FLEET_CONFIG = [
  { type: 'patrol', role: 'patrol', speedBias: 0.92, laneDelta: 0 },
  { type: 'patrol', role: 'patrol', speedBias: 0.86, laneDelta: 0 },
  { type: 'sedan', role: 'campus', speedBias: 1.04, laneDelta: -0.9 },
  { type: 'suv', role: 'campus', speedBias: 0.96, laneDelta: 1.1 },
  { type: 'sedan', role: 'campus', speedBias: 1.00, laneDelta: -0.9 },
  { type: 'suv', role: 'campus', speedBias: 0.92, laneDelta: 1.1 },
  { type: 'sedan', role: 'mixed', speedBias: 1.08, laneDelta: -1.0 },
  { type: 'sedan', role: 'mixed', speedBias: 0.98, laneDelta: 1.2 },
  { type: 'suv', role: 'mixed', speedBias: 1.02, laneDelta: -1.0 },
  { type: 'sedan', role: 'mixed', speedBias: 1.10, laneDelta: 1.2 },
  { type: 'suv', role: 'mixed', speedBias: 0.94, laneDelta: -0.9 },
  { type: 'sedan', role: 'mixed', speedBias: 1.05, laneDelta: 1.1 },
  { type: 'sedan', role: 'arterial', speedBias: 1.12, laneDelta: -1.0 },
  { type: 'suv', role: 'arterial', speedBias: 1.00, laneDelta: 1.2 },
  { type: 'sedan', role: 'arterial', speedBias: 1.06, laneDelta: -0.9 },
  { type: 'suv', role: 'arterial', speedBias: 0.95, laneDelta: 1.1 },
];

// ============================================================================
// 7. 主构建函数：buildVehicleTrafficSystem()
// ============================================================================

export function buildVehicleTrafficSystem(maxAnisotropy = 4) {
  const group = new THREE.Group();
  group.name = 'VehicleTrafficSystem';
  group.userData.noMerge = true;

  const roadAdj = buildRoadGraph();
  const portalIds = Object.keys(ROAD_NODES).filter((k) => ROAD_NODES[k].kind === 'portal');
  const campusGoalIds = [
    'J_PLAZA_SW',
    'J_PLAZA_SE',
    'J_WEST_FIRE',
    'J_WPARK_GATE',
    'D_WPARK',
    'J_NEPARK_GATE',
    'D_NEPARK',
    'J_EAST_MID',
    'D_EAST_PORTAL',
  ];
  const patrolGoalIds = Object.keys(ROAD_NODES).filter((k) => ROAD_NODES[k].patrolGoal);
  const allGeneralDestinations = [...portalIds, ...campusGoalIds];

  // ---- 1. 构建三款雕塑感车型与共享零部件几何 ----
  const sedanGeos = createSedanGeometries();
  const suvGeos = createSuvGeometries();
  const patrolGeos = createPatrolGeometries();
  const { tireGeo, rimGeo } = createSharedWheelGeometries();

  const lightBarGeo = createSculptedLightBarGeometry();
  const beaconStripGeo = (() => {
    const front = new THREE.BoxGeometry(0.055, 0.058, 1.01);
    front.translate(0.70, 0, 0);
    const back = new THREE.BoxGeometry(0.055, 0.058, 1.01);
    back.translate(-0.70, 0, 0);
    const left = new THREE.BoxGeometry(1.42, 0.058, 0.055);
    left.translate(0, 0, -0.49);
    const right = new THREE.BoxGeometry(1.42, 0.058, 0.055);
    right.translate(0, 0, 0.49);
    return mergeIndexedParts([front, back, left, right]);
  })();

  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);

  const beamGeo = new THREE.PlaneGeometry(1, 1);
  beamGeo.rotateX(-Math.PI / 2);
  beamGeo.translate(0.5, 0, 0);

  // ---- 2. 棚拍清漆汽车材质、熏黑玻璃与阳极石墨下装件 ----
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.28,
    metalness: 0.42,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
    reflectivity: 0.9,
    envMapIntensity: 1.25,
  });
  const cabinMat = new THREE.MeshPhysicalMaterial({
    color: '#1E2630',
    roughness: 0.09,
    metalness: 0.26,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.65,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#282D35',
    roughness: 0.56,
    metalness: 0.28,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: '#24272C',
    roughness: 0.82,
    metalness: 0.04,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: '#B5BBC2',
    roughness: 0.26,
    metalness: 0.78,
  });

  const headlightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const taillightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  const shadowTex = createContactShadowTexture();
  shadowTex.anisotropy = Math.min(maxAnisotropy, 4);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const beamTex = createHeadlightBeamTexture();
  beamTex.anisotropy = Math.min(maxAnisotropy, 4);
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  // ---- 3. 统计各车型实例槽位 ----
  const allVehicles = [];
  const typeBuckets = { sedan: [], suv: [], patrol: [] };

  const registerVehicle = (entry) => {
    entry.globalIdx = allVehicles.length;
    entry.typeIdx = typeBuckets[entry.type].length;
    typeBuckets[entry.type].push(entry);
    allVehicles.push(entry);
    return entry;
  };

  for (let i = 0; i < PARKED_VEHICLES_CONFIG.length; i++) {
    const cfg = PARKED_VEHICLES_CONFIG[i];
    registerVehicle({
      isMoving: false,
      type: cfg.type,
      colorHex: cfg.type === 'patrol' ? PATROL_PAINT : PAINT_PALETTE[cfg.colorIdx % PAINT_PALETTE.length],
      x: cfg.x,
      y: sampleRoadSurfaceY(cfg.x, cfg.z),
      z: cfg.z,
      rotY: cfg.rotY,
      fx: Math.cos(cfg.rotY),
      fz: -Math.sin(cfg.rotY),
      speed: 0,
      scale: 1,
      wheelSpin: 0,
      brakeIntensity: 0,
    });
  }

  const movingVehicles = [];
  for (let i = 0; i < MOVING_FLEET_CONFIG.length; i++) {
    const cfg = MOVING_FLEET_CONFIG[i];
    const v = registerVehicle({
      isMoving: true,
      movingIdx: i,
      type: cfg.type,
      role: cfg.role,
      speedBias: cfg.speedBias,
      laneDelta: cfg.laneDelta,
      colorHex: cfg.type === 'patrol' ? PATROL_PAINT : PAINT_PALETTE[i % PAINT_PALETTE.length],
      x: 0,
      y: ROAD_Y.FIRE_LOT,
      z: 0,
      rotY: 0,
      fx: 1,
      fz: 0,
      speed: 6.0,
      scale: 1,
      wheelSpin: 0,
      brakeIntensity: 0,
      route: null,
      dist: 0,
      pauseTimer: 0,
      stuckTimer: 0,
      pendingTurnaround: null,
      lastNode: null,
      prevToLastNode: null,
    });
    movingVehicles.push(v);
  }

  const totalCount = allVehicles.length;
  const patrolList = typeBuckets.patrol;

  const makeInst = (geo, mat, count, name, receiveShadow = false) => {
    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.name = name;
    inst.castShadow = false;
    inst.receiveShadow = receiveShadow;
    inst.frustumCulled = false;
    return inst;
  };

  const bodyInsts = {
    sedan: makeInst(sedanGeos.bodyGeo, bodyMat, typeBuckets.sedan.length, 'Vehicles_SedanBody', true),
    suv: makeInst(suvGeos.bodyGeo, bodyMat, typeBuckets.suv.length, 'Vehicles_SuvBody', true),
    patrol: makeInst(patrolGeos.bodyGeo, bodyMat, typeBuckets.patrol.length, 'Vehicles_PatrolBody', true),
  };
  const cabinInsts = {
    sedan: makeInst(sedanGeos.cabinGeo, cabinMat, typeBuckets.sedan.length, 'Vehicles_SedanCabin', true),
    suv: makeInst(suvGeos.cabinGeo, cabinMat, typeBuckets.suv.length, 'Vehicles_SuvCabin', true),
    patrol: makeInst(patrolGeos.cabinGeo, cabinMat, typeBuckets.patrol.length, 'Vehicles_PatrolCabin', true),
  };
  const trimInsts = {
    sedan: makeInst(sedanGeos.trimGeo, trimMat, typeBuckets.sedan.length, 'Vehicles_SedanTrim', true),
    suv: makeInst(suvGeos.trimGeo, trimMat, typeBuckets.suv.length, 'Vehicles_SuvTrim', true),
    patrol: makeInst(patrolGeos.trimGeo, trimMat, typeBuckets.patrol.length, 'Vehicles_PatrolTrim', true),
  };

  const tireInst = makeInst(tireGeo, tireMat, totalCount * 4, 'Vehicles_Tires', false);
  const rimInst = makeInst(rimGeo, rimMat, totalCount * 4, 'Vehicles_Rims', false);
  const headlightInst = makeInst(lightBarGeo, headlightMat, totalCount, 'Vehicles_Headlights', false);
  const taillightInst = makeInst(lightBarGeo, taillightMat, totalCount, 'Vehicles_Taillights', false);
  const patrolBeaconInst = makeInst(beaconStripGeo, beaconMat, patrolList.length, 'Vehicles_PatrolBeacons', false);
  const contactShadowInst = makeInst(shadowGeo, shadowMat, totalCount, 'Vehicles_ContactShadows', false);
  const headlightConeInst = makeInst(beamGeo, beamMat, movingVehicles.length, 'Vehicles_HeadlightCones', false);
  headlightConeInst.visible = false;
  headlightConeInst.renderOrder = 3;
  contactShadowInst.renderOrder = 2;

  group.add(
    bodyInsts.sedan,
    bodyInsts.suv,
    bodyInsts.patrol,
    cabinInsts.sedan,
    cabinInsts.suv,
    cabinInsts.patrol,
    trimInsts.sedan,
    trimInsts.suv,
    trimInsts.patrol,
    tireInst,
    rimInst,
    headlightInst,
    taillightInst,
    patrolBeaconInst,
    contactShadowInst,
    headlightConeInst
  );

  // 初始化 6 色缎面车漆颜色
  const tmpColor = new THREE.Color();
  for (const v of allVehicles) {
    tmpColor.set(v.colorHex);
    bodyInsts[v.type].setColorAt(v.typeIdx, tmpColor);
  }
  for (const inst of Object.values(bodyInsts)) {
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }

  // ---- 4. 伪随机行程规划 ----
  let rngState = 0x13579bdf;
  const rand = () => {
    rngState |= 0;
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pickRandom = (arr, exclude = null) => {
    if (arr.length === 1) return arr[0];
    let choice = arr[Math.floor(rand() * arr.length)];
    for (let tries = 0; tries < 8 && choice === exclude; tries++) {
      choice = arr[Math.floor(rand() * arr.length)];
    }
    return choice;
  };

  function isOriginClear(nodeId, selfVehicle) {
    const n = ROAD_NODES[nodeId];
    for (const other of movingVehicles) {
      if (other === selfVehicle || !other.route) continue;
      const d2 = (other.x - n.x) * (other.x - n.x) + (other.z - n.z) * (other.z - n.z);
      if (d2 < 14 * 14) return false;
    }
    return true;
  }

  function assignNewTrip(v, { initialSpread = false } = {}) {
    const isPatrol = v.role === 'patrol';
    let startId = v.lastNode;
    let prependTurnaround = null;

    if (isPatrol) {
      if (!startId || ROAD_NODES[startId]?.kind === 'portal') {
        startId = pickRandom(patrolGoalIds);
      }
      if (TERMINAL_TURNAROUNDS[startId]) {
        prependTurnaround = TERMINAL_TURNAROUNDS[startId];
      }
      const goalId = pickRandom(patrolGoalIds, startId);
      let edgePath = findShortestPath(roadAdj, startId, goalId, {
        patrolOnly: true,
        avoidFirstNode: prependTurnaround ? null : v.prevToLastNode,
      });
      if (!edgePath) {
        edgePath = findShortestPath(roadAdj, startId, goalId, { patrolOnly: true });
      }
      if (edgePath) {
        v.route = compileSmoothRoute(edgePath, { arterialLaneDelta: 0, prependTurnaround });
      }
    } else {
      const needFreshOrigin = !startId || ROAD_NODES[startId]?.kind === 'portal';
      if (needFreshOrigin) {
        let candidate = pickRandom(portalIds, startId);
        for (let tries = 0; tries < 6; tries++) {
          if (isOriginClear(candidate, v)) break;
          candidate = pickRandom(portalIds, startId);
        }
        startId = candidate;
      } else if (TERMINAL_TURNAROUNDS[startId]) {
        prependTurnaround = TERMINAL_TURNAROUNDS[startId];
      }

      let goalPool = allGeneralDestinations;
      if (v.role === 'arterial') {
        goalPool = rand() < 0.72 ? portalIds : allGeneralDestinations;
      } else if (v.role === 'campus') {
        goalPool = ROAD_NODES[startId].kind === 'portal' ? campusGoalIds : allGeneralDestinations;
      } else {
        goalPool = rand() < 0.48 ? campusGoalIds : portalIds;
      }

      let edgePath = null;
      for (let attempt = 0; attempt < 10 && !edgePath; attempt++) {
        const goalId = pickRandom(goalPool, startId);
        edgePath = findShortestPath(roadAdj, startId, goalId, {
          patrolOnly: false,
          avoidFirstNode: prependTurnaround ? null : v.prevToLastNode,
        });
        if (!edgePath) {
          edgePath = findShortestPath(roadAdj, startId, goalId, { patrolOnly: false });
        }
      }
      if (edgePath) {
        v.route = compileSmoothRoute(edgePath, {
          arterialLaneDelta: v.laneDelta,
          prependTurnaround,
        });
      }
    }

    if (!v.route) return;
    v.dist = initialSpread ? (0.08 + rand() * 0.76) * v.route.totalLength : 0;
    v.speed = initialSpread ? 5.5 + rand() * 5.0 : ROAD_NODES[v.route.startNode].kind === 'portal' ? 8.5 : 1.5;
    v.pauseTimer = 0;
    v.stuckTimer = 0;
    v.lastNode = v.route.endNode;
    v.prevToLastNode = v.route.prevToEndNode;

    sampleRouteInto(v.route, v.dist, tmpSample);
    v.x = tmpSample.x;
    v.y = tmpSample.y;
    v.z = tmpSample.z;
    v.rotY = tmpSample.rotY;
    v.fx = tmpSample.fx;
    v.fz = tmpSample.fz;
  }

  // ---- 5. 预分配零 GC 工作对象 ----
  const dummy = new THREE.Object3D();
  const tmpSample = { x: 0, y: 0, z: 0, rotY: 0, fx: 1, fz: 0, targetSpeed: 8 };
  const WHEEL_SIGNS = [
    [1, -1],
    [1, 1],
    [-1, -1],
    [-1, 1],
  ];

  for (let i = 0; i < movingVehicles.length; i++) {
    assignNewTrip(movingVehicles[i], { initialSpread: true });
    const v = movingVehicles[i];
    for (let retry = 0; retry < 5; retry++) {
      let tooClose = false;
      for (let j = 0; j < i; j++) {
        const o = movingVehicles[j];
        if ((v.x - o.x) * (v.x - o.x) + (v.z - o.z) * (v.z - o.z) < 11 * 11) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) break;
      assignNewTrip(v, { initialSpread: true });
    }
  }

  function writeVehicleMatrices(v, patrolSlotMap) {
    const spec = ARCHETYPE_SPECS[v.type];
    const s = v.scale;
    const baseY = v.y;
    const cosY = Math.cos(v.rotY);
    const sinY = Math.sin(v.rotY);

    // 车身 + 玻璃座舱 + 阳极石墨轮眉下裙
    dummy.position.set(v.x, baseY, v.z);
    dummy.rotation.set(0, v.rotY, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    bodyInsts[v.type].setMatrixAt(v.typeIdx, dummy.matrix);
    cabinInsts[v.type].setMatrixAt(v.typeIdx, dummy.matrix);
    trimInsts[v.type].setMatrixAt(v.typeIdx, dummy.matrix);

    // 4 只 16 段圆润车轮（底部严丝合缝贴合 baseY，零悬空零沉陷！）
    const wBase = v.globalIdx * 4;
    const ws = spec.wheelScale * s;
    const wy = baseY + spec.wheelRadius * s;
    for (let wi = 0; wi < 4; wi++) {
      const lx = WHEEL_SIGNS[wi][0] * spec.wheelX * s;
      const lz = WHEEL_SIGNS[wi][1] * spec.wheelZ * s;
      const wx = v.x + lx * cosY + lz * sinY;
      const wz = v.z - lx * sinY + lz * cosY;
      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(0, v.rotY, -v.wheelSpin, 'YXZ');
      dummy.scale.set(ws, ws, ws);
      dummy.updateMatrix();
      tireInst.setMatrixAt(wBase + wi, dummy.matrix);
      rimInst.setMatrixAt(wBase + wi, dummy.matrix);
    }

    // 前贯穿式冰青/暖白 LED DRL 灯条
    const [hlx, hly, hlz] = spec.headlightPos;
    const hx = v.x + hlx * s * cosY + hlz * s * sinY;
    const hz = v.z - hlx * s * sinY + hlz * s * cosY;
    dummy.position.set(hx, baseY + hly * s, hz);
    dummy.rotation.set(0, v.rotY, 0, 'XYZ');
    dummy.scale.set(spec.headlightScale[0] * s, spec.headlightScale[1] * s, spec.headlightScale[2] * s);
    dummy.updateMatrix();
    headlightInst.setMatrixAt(v.globalIdx, dummy.matrix);

    // 后贯穿式宝石红尾灯条（翻转 180° 使两侧微弯端点朝内包绕）
    const [tlx, tly, tlz] = spec.taillightPos;
    const tx = v.x + tlx * s * cosY + tlz * s * sinY;
    const tz = v.z - tlx * s * sinY + tlz * s * cosY;
    dummy.position.set(tx, baseY + tly * s, tz);
    dummy.rotation.set(0, v.rotY + Math.PI, 0, 'XYZ');
    dummy.scale.set(spec.taillightScale[0] * s, spec.taillightScale[1] * s, spec.taillightScale[2] * s);
    dummy.updateMatrix();
    taillightInst.setMatrixAt(v.globalIdx, dummy.matrix);

    // 巡检车顶冰青 LiDAR 环形光带
    if (v.type === 'patrol') {
      const pIdx = patrolSlotMap.get(v);
      const [bx, by, bz] = spec.beaconPos;
      dummy.position.set(v.x + bx * s * cosY + bz * s * sinY, baseY + by * s, v.z - bx * s * sinY + bz * s * cosY);
      dummy.rotation.set(0, v.rotY, 0, 'XYZ');
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      patrolBeaconInst.setMatrixAt(pIdx, dummy.matrix);
    }

    // 柔和接地 AO 阴影贴花（高于路面 +0.018m，绝不 Z-Fighting！）
    dummy.position.set(v.x, baseY + 0.018, v.z);
    dummy.rotation.set(0, v.rotY, 0, 'XYZ');
    dummy.scale.set(spec.shadowScale[0] * s, 1, spec.shadowScale[2] * s);
    dummy.updateMatrix();
    contactShadowInst.setMatrixAt(v.globalIdx, dummy.matrix);

    // 夜间前照灯路面羽化双光束
    if (v.isMoving) {
      const ox = v.x + spec.beamOriginX * s * cosY;
      const oz = v.z - spec.beamOriginX * s * sinY;
      dummy.position.set(ox, baseY + 0.026, oz);
      dummy.rotation.set(0, v.rotY, 0, 'XYZ');
      dummy.scale.set(spec.beamLength * s, 1, spec.beamWidth * s);
      dummy.updateMatrix();
      headlightConeInst.setMatrixAt(v.movingIdx, dummy.matrix);
    }
  }

  const patrolSlotMap = new Map();
  patrolList.forEach((v, idx) => patrolSlotMap.set(v, idx));

  let currentNight = 0;
  let elapsedTime = 0;

  function updateVehicleLights(nightFactor, timeSec) {
    const nf = Math.max(0, Math.min(1, nightFactor));
    const pulse = 0.86 + 0.14 * Math.sin(timeSec * 3.8);

    shadowMat.opacity = THREE.MathUtils.lerp(0.64, 0.24, nf);
    headlightConeInst.visible = nf > 0.02;
    if (headlightConeInst.visible) {
      beamMat.opacity = nf * 0.56;
    }

    for (let i = 0; i < totalCount; i++) {
      const v = allVehicles[i];
      if (!v.isMoving) {
        // 停放车辆：精致微光磨砂冰青日行灯镜片 + 深宝石红暗镜尾灯
        const hlDim = THREE.MathUtils.lerp(0.70, 0.22, nf);
        tmpColor.setRGB(hlDim * 0.88, hlDim * 0.98, hlDim * 1.04);
        headlightInst.setColorAt(i, tmpColor);

        const tlDim = THREE.MathUtils.lerp(0.46, 0.18, nf);
        tmpColor.setRGB(tlDim, tlDim * 0.16, tlDim * 0.18);
        taillightInst.setColorAt(i, tmpColor);
      } else {
        // 行驶车辆：日间清透冰青白 DRL (#D8F6FF)，夜间明亮暖白 LED (#FFF2D6)
        const hr = THREE.MathUtils.lerp(0.92, 2.38, nf);
        const hg = THREE.MathUtils.lerp(1.06, 2.18, nf);
        const hb = THREE.MathUtils.lerp(1.14, 1.72, nf);
        tmpColor.setRGB(hr, hg, hb);
        headlightInst.setColorAt(i, tmpColor);

        // 贯穿式宝石红尾灯 (#E83A3A)，制动与夜间顺滑高亮
        const bk = v.brakeIntensity;
        const baseR = THREE.MathUtils.lerp(0.92, 1.70, nf);
        const baseG = THREE.MathUtils.lerp(0.18, 0.15, nf);
        const baseB = THREE.MathUtils.lerp(0.18, 0.16, nf);
        tmpColor.setRGB(
          THREE.MathUtils.lerp(baseR, 2.65, bk),
          THREE.MathUtils.lerp(baseG, 0.19, bk),
          THREE.MathUtils.lerp(baseB, 0.21, bk)
        );
        taillightInst.setColorAt(i, tmpColor);
      }
    }

    for (let p = 0; p < patrolList.length; p++) {
      const pv = patrolList[p];
      if (!pv.isMoving) {
        const idle = 0.72 + 0.18 * Math.sin(timeSec * 1.8);
        tmpColor.setRGB(0.20 * idle, 0.86 * idle, 0.96 * idle);
      } else {
        const gain = THREE.MathUtils.lerp(1.15, 2.05, nf) * pulse;
        tmpColor.setRGB(0.22 * gain, 0.94 * gain, 1.05 * gain);
      }
      patrolBeaconInst.setColorAt(p, tmpColor);
    }

    if (headlightInst.instanceColor) headlightInst.instanceColor.needsUpdate = true;
    if (taillightInst.instanceColor) taillightInst.instanceColor.needsUpdate = true;
    if (patrolBeaconInst.instanceColor) patrolBeaconInst.instanceColor.needsUpdate = true;
  }

  for (const v of allVehicles) {
    writeVehicleMatrices(v, patrolSlotMap);
  }
  updateVehicleLights(0, 0);

  const flushAllMatrices = () => {
    bodyInsts.sedan.instanceMatrix.needsUpdate = true;
    bodyInsts.suv.instanceMatrix.needsUpdate = true;
    bodyInsts.patrol.instanceMatrix.needsUpdate = true;
    cabinInsts.sedan.instanceMatrix.needsUpdate = true;
    cabinInsts.suv.instanceMatrix.needsUpdate = true;
    cabinInsts.patrol.instanceMatrix.needsUpdate = true;
    trimInsts.sedan.instanceMatrix.needsUpdate = true;
    trimInsts.suv.instanceMatrix.needsUpdate = true;
    trimInsts.patrol.instanceMatrix.needsUpdate = true;
    tireInst.instanceMatrix.needsUpdate = true;
    rimInst.instanceMatrix.needsUpdate = true;
    headlightInst.instanceMatrix.needsUpdate = true;
    taillightInst.instanceMatrix.needsUpdate = true;
    patrolBeaconInst.instanceMatrix.needsUpdate = true;
    contactShadowInst.instanceMatrix.needsUpdate = true;
    if (headlightConeInst.visible) {
      headlightConeInst.instanceMatrix.needsUpdate = true;
    }
  };
  flushAllMatrices();

  // ---- 6. 实时交通动力学更新 ----
  function update(dt, nightFactor = currentNight) {
    const safeDt = Math.min(Math.max(dt, 0.001), 0.1);
    elapsedTime += safeDt;
    currentNight = nightFactor;

    const mvCount = movingVehicles.length;

    for (let i = 0; i < mvCount; i++) {
      const v = movingVehicles[i];
      if (!v.route) {
        assignNewTrip(v);
        continue;
      }

      if (v.pauseTimer > 0) {
        v.pauseTimer -= safeDt;
        v.speed = Math.max(0, v.speed - 7.5 * safeDt);
        v.brakeIntensity = Math.min(1, v.brakeIntensity + safeDt * 5.0);
        if (v.pauseTimer <= 0) {
          assignNewTrip(v);
        }
        writeVehicleMatrices(v, patrolSlotMap);
        continue;
      }

      sampleRouteInto(v.route, v.dist, tmpSample);
      let desiredSpeed = tmpSample.targetSpeed * v.speedBias;
      if (v.role === 'patrol') {
        desiredSpeed = Math.min(desiredSpeed, 6.8);
      }

      const remaining = v.route.totalLength - v.dist;
      const endKind = ROAD_NODES[v.route.endNode].kind;
      if (endKind !== 'portal' && remaining < 12.0) {
        desiredSpeed = Math.min(desiredSpeed, Math.max(1.6, remaining * 0.48));
      }

      const halfLenI = ARCHETYPE_SPECS[v.type].length * 0.5;
      let blocked = false;
      for (let j = 0; j < mvCount; j++) {
        if (i === j) continue;
        const o = movingVehicles[j];
        if (!o.route || o.scale < 0.35) continue;

        const dx = o.x - v.x;
        const dz = o.z - v.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 24 * 24) continue;

        const ahead = dx * v.fx + dz * v.fz;
        if (ahead <= 0.4 || ahead > 22.0) continue;

        const lateral = Math.abs(-dx * v.fz + dz * v.fx);
        const align = v.fx * o.fx + v.fz * o.fz;

        if (align > 0.62 && lateral < 2.25) {
          const gap = ahead - (halfLenI + ARCHETYPE_SPECS[o.type].length * 0.5);
          const safeGap = 3.2 + v.speed * 0.55;
          if (gap < 2.1) {
            desiredSpeed = 0;
            blocked = true;
          } else if (gap < safeGap + 4.5) {
            const followCap = Math.max(0, o.speed * 0.92 + (gap - 2.1) * 0.95);
            desiredSpeed = Math.min(desiredSpeed, followCap);
            if (followCap < 0.8) blocked = true;
          }
        } else if (Math.abs(align) <= 0.62 && lateral < 3.8 && ahead < 12.0) {
          const oAheadOfV = -dx * o.fx - dz * o.fz;
          const oHasPriority =
            oAheadOfV < ahead - 0.6 || (Math.abs(oAheadOfV - ahead) <= 0.6 && j < i);
          if (oHasPriority && o.speed > 0.4) {
            const yieldCap = ahead < 6.2 ? 0 : (ahead - 5.2) * 0.85;
            desiredSpeed = Math.min(desiredSpeed, yieldCap);
            if (yieldCap < 0.5) blocked = true;
          }
        }
      }

      if (blocked && v.speed < 0.4) {
        v.stuckTimer += safeDt;
        if (v.stuckTimer > 3.8) {
          desiredSpeed = Math.max(desiredSpeed, 2.8);
        }
      } else {
        v.stuckTimer = Math.max(0, v.stuckTimer - safeDt * 2);
      }

      const deltaV = desiredSpeed - v.speed;
      if (deltaV >= 0) {
        v.speed += Math.min(deltaV, 3.6 * safeDt);
      } else {
        v.speed += Math.max(deltaV, -7.2 * safeDt);
      }
      v.speed = Math.max(0, v.speed);

      const braking = deltaV < -1.1 || (blocked && v.speed < 1.2);
      const targetBrake = braking ? 1.0 : 0.0;
      v.brakeIntensity += (targetBrake - v.brakeIntensity) * Math.min(1, safeDt * 8.0);

      const step = v.speed * safeDt;
      v.dist += step;
      v.wheelSpin = (v.wheelSpin + step / ARCHETYPE_SPECS[v.type].wheelRadius) % (Math.PI * 2);

      if (v.dist >= v.route.totalLength - 0.2) {
        if (endKind === 'portal') {
          assignNewTrip(v);
        } else {
          v.dist = v.route.totalLength;
          v.pauseTimer = v.role === 'patrol' ? 1.6 + rand() * 1.4 : 1.1 + rand() * 1.5;
        }
      }

      sampleRouteInto(v.route, v.dist, tmpSample);
      v.x = tmpSample.x;
      v.y = tmpSample.y;
      v.z = tmpSample.z;
      v.rotY = tmpSample.rotY;
      v.fx = tmpSample.fx;
      v.fz = tmpSample.fz;

      let scale = 1.0;
      const startKind = ROAD_NODES[v.route.startNode].kind;
      // 在无界云雾端头 24m 内丝滑渐入渐出，彻底消除突兀刷车
      if (startKind === 'portal' && v.dist < 24.0) {
        const t = Math.max(0.01, v.dist / 24.0);
        scale = Math.min(scale, t * (2 - t));
      }
      if (endKind === 'portal' && v.route.totalLength - v.dist < 24.0) {
        const t = Math.max(0.01, (v.route.totalLength - v.dist) / 24.0);
        scale = Math.min(scale, t * (2 - t));
      }
      v.scale = scale;

      writeVehicleMatrices(v, patrolSlotMap);
    }

    updateVehicleLights(nightFactor, elapsedTime);
    flushAllMatrices();
  }

  function setNightFactor(nightFactor) {
    currentNight = nightFactor;
    updateVehicleLights(nightFactor, elapsedTime);
    if (headlightConeInst.visible) {
      headlightConeInst.instanceMatrix.needsUpdate = true;
    }
  }

  function getTrafficStats() {
    return {
      parkedCount: PARKED_VEHICLES_CONFIG.length,
      movingCount: movingVehicles.length,
      totalCount,
      archetypes: {
        sedan: typeBuckets.sedan.length,
        suv: typeBuckets.suv.length,
        patrol: typeBuckets.patrol.length,
      },
      drawCallsDay: 15,
      drawCallsNight: 16,
      activeRoutes: movingVehicles.map((v) => ({
        type: v.type,
        role: v.role,
        from: v.route?.startNode ?? null,
        to: v.route?.endNode ?? null,
        speed: Number(v.speed.toFixed(1)),
      })),
    };
  }

  return {
    group,
    update,
    setNightFactor,
    getTrafficStats,
  };
}
