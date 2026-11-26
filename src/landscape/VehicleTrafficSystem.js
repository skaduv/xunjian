import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ELEVATIONS } from '../config/campusConfig.js';

/**
 * IOPLY 园区精工白模多车型建模 + 真实连通道路图随机起终点动态行车系统
 *
 * 视觉与工程核心规格：
 * 1. 三款独立雕塑感偏白模车型（全量 InstancedMesh，日间 12 DC / 夜间 13 DC，总三角面 < 17k）：
 *    - sedan  : 行政溜背新能源轿跑（Executive Fastback EV Sedan），收腰内倾侧窗（Tumblehome）+ 溜背车尾 + 后视镜
 *    - suv    : 现代建筑感跨界 SUV（Modern Architectural SUV），悬浮全景玻璃舱 + 车顶行李架 + 大尺寸轮毂
 *    - patrol : 园区智能安全巡检无人车（Autonomous Patrol Shuttle），圆角方盒车身 + 360° 全景舱 + 车顶冰青 (#38f2ff) 雷达巡检灯带
 * 2. 完整连通园区路网有向图 + Dijkstra 随机起点→终点路径规划：
 *    - 覆盖中关村大道、平陵西路、永平大道、北迎宾大道（精准绕行中央种植岛！）、消防环道、西翼支线及西/东北停车场
 *    - 严格靠右行驶（Right-Hand Traffic）、交叉口二次贝塞尔平滑圆角转弯、弯道曲率自动减速、防追尾跟车与路口礼让、刹车灯联动
 * 3. 昼夜模式无缝联动：
 *    - 接收 update(dt, nightFactor)：夜间平滑点亮暖白前照灯、宝石红尾灯与地面柔边羽化双光束贴花（0 PointLight！）
 *    - 零 per-frame GC 分配、全量移动车辆 castShadow = false 严防静态阴影重绘与残影
 */

// ============================================================================
// 1. 精致陶瓷白模车漆与公共常量
// ============================================================================

const PAINT_PALETTE = [
  '#f7f8fa', // 陶瓷珠光白
  '#eaeff5', // 极光雾银
  '#dce2ec', // 冷灰釉白
  '#cfd7e3', // 浅钛灰蓝
  '#e8e4dc', // 温润暖石白
];

const PATROL_PAINT = '#f5f8fc';

const ARCHETYPE_SPECS = {
  sedan: {
    length: 4.82,
    width: 1.90,
    wheelRadius: 0.33,
    wheelScale: 1.0,
    wheelX: 1.43,
    wheelZ: 0.87,
    headlightPos: [2.36, 0.63, 0],
    headlightScale: [0.10, 0.085, 1.50],
    taillightPos: [-2.37, 0.77, 0],
    taillightScale: [0.09, 0.075, 1.58],
    shadowScale: [5.35, 1, 2.26],
    beamOriginX: 2.38,
    beamLength: 14.2,
    beamWidth: 5.4,
  },
  suv: {
    length: 4.92,
    width: 2.02,
    wheelRadius: 0.38,
    wheelScale: 1.15,
    wheelX: 1.48,
    wheelZ: 0.92,
    headlightPos: [2.42, 0.84, 0],
    headlightScale: [0.11, 0.105, 1.66],
    taillightPos: [-2.42, 0.96, 0],
    taillightScale: [0.10, 0.095, 1.70],
    shadowScale: [5.50, 1, 2.40],
    beamOriginX: 2.44,
    beamLength: 15.2,
    beamWidth: 5.8,
  },
  patrol: {
    length: 3.96,
    width: 1.78,
    wheelRadius: 0.30,
    wheelScale: 0.91,
    wheelX: 1.22,
    wheelZ: 0.81,
    headlightPos: [1.94, 0.66, 0],
    headlightScale: [0.09, 0.095, 1.36],
    taillightPos: [-1.94, 0.70, 0],
    taillightScale: [0.09, 0.085, 1.36],
    beaconPos: [0.04, 1.93, 0],
    shadowScale: [4.42, 1, 2.12],
    beamOriginX: 1.96,
    beamLength: 12.0,
    beamWidth: 4.7,
  },
};

// ============================================================================
// 2. 参数化汽车曲面放样生成器（100% 索引化封闭实体，真实 Tumblehome 收腰）
// ============================================================================

/**
 * 按纵向截面站位表放样闭合索引网格（局部坐标：+X 车头，-X 车尾，+Y 向上，±Z 车宽）
 * 每个截面定义 10 个对称轮廓环点，严格保证外法线朝外、零裂缝、低面数高雕塑感
 */
function buildLoftedHull(stations) {
  const ringPts = 10;
  const n = stations.length;
  const positions = [];
  const indices = [];

  for (let i = 0; i < n; i++) {
    const s = stations[i];
    const wBot = s.wBot;
    const wLow = s.wLow ?? s.wBelt * 0.97;
    const wBelt = s.wBelt;
    const wRoof = s.wRoof ?? s.wBelt * 0.78;
    const wCrown = s.wCrown ?? wRoof * 0.62;

    const yBot = s.yBot;
    const yLow = s.yLow ?? yBot + (s.yBelt - yBot) * 0.38;
    const yBelt = s.yBelt;
    const yRoof = s.yRoof;
    const yCrown = s.yCrown ?? yRoof + 0.025;

    // 顺着底面(-Z -> +Z) -> 右侧向上 -> 顶面(+Z -> -Z) -> 左侧向下，保证 (eX × eRing) 严格指向体外
    const ring = [
      [-wBot, yBot],     // 0 底左
      [wBot, yBot],      // 1 底右
      [wLow, yLow],      // 2 右下裙
      [wBelt, yBelt],    // 3 右腰线
      [wRoof, yRoof],    // 4 右顶边
      [wCrown, yCrown],  // 5 右车顶弧
      [-wCrown, yCrown], // 6 左车顶弧
      [-wRoof, yRoof],   // 7 左顶边
      [-wBelt, yBelt],   // 8 左腰线
      [-wLow, yLow],     // 9 左下裙
    ];

    for (let k = 0; k < ringPts; k++) {
      positions.push(s.x, ring[k][1], ring[k][0]);
    }
  }

  // 纵向侧面四边形连接
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
  positions.push(s0.x, (s0.yBot + s0.yRoof) * 0.5, 0);
  for (let k = 0; k < ringPts; k++) {
    const kNext = (k + 1) % ringPts;
    indices.push(rearCenterIdx, k, kNext);
  }

  // 车头端盖（法线指向 +X）
  const frontCenterIdx = positions.length / 3;
  const sLast = stations[n - 1];
  const lastRow = (n - 1) * ringPts;
  positions.push(sLast.x, (sLast.yBot + sLast.yRoof) * 0.5, 0);
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
 * 统一合并带法线与索引的局部组件几何（清除多余 UV 属性防止 mergeGeometries 报错）
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
 * 构建 1 号车型：行政溜背新能源轿跑（Executive Fastback EV Sedan）
 */
function createSedanGeometries() {
  const bodyStations = [
    { x: -2.40, yBot: 0.34, yBelt: 0.78, yRoof: 0.85, yCrown: 0.86, wBot: 0.68, wLow: 0.82, wBelt: 0.84, wRoof: 0.78, wCrown: 0.52 },
    { x: -2.26, yBot: 0.27, yBelt: 0.88, yRoof: 0.93, yCrown: 0.94, wBot: 0.78, wLow: 0.91, wBelt: 0.92, wRoof: 0.84, wCrown: 0.58 },
    { x: -1.78, yBot: 0.25, yBelt: 0.91, yRoof: 1.07, yCrown: 1.09, wBot: 0.82, wLow: 0.95, wBelt: 0.96, wRoof: 0.78, wCrown: 0.54 },
    { x: -1.16, yBot: 0.24, yBelt: 0.91, yRoof: 1.29, yCrown: 1.32, wBot: 0.83, wLow: 0.95, wBelt: 0.95, wRoof: 0.71, wCrown: 0.48 },
    { x: -0.42, yBot: 0.24, yBelt: 0.90, yRoof: 1.36, yCrown: 1.38, wBot: 0.83, wLow: 0.94, wBelt: 0.94, wRoof: 0.69, wCrown: 0.46 },
    { x: 0.32, yBot: 0.24, yBelt: 0.89, yRoof: 1.35, yCrown: 1.37, wBot: 0.83, wLow: 0.94, wBelt: 0.94, wRoof: 0.70, wCrown: 0.47 },
    { x: 1.08, yBot: 0.24, yBelt: 0.86, yRoof: 0.92, yCrown: 0.94, wBot: 0.82, wLow: 0.94, wBelt: 0.95, wRoof: 0.84, wCrown: 0.54 },
    { x: 1.82, yBot: 0.25, yBelt: 0.79, yRoof: 0.83, yCrown: 0.85, wBot: 0.80, wLow: 0.92, wBelt: 0.92, wRoof: 0.82, wCrown: 0.52 },
    { x: 2.26, yBot: 0.27, yBelt: 0.66, yRoof: 0.72, yCrown: 0.74, wBot: 0.74, wLow: 0.86, wBelt: 0.85, wRoof: 0.75, wCrown: 0.48 },
    { x: 2.41, yBot: 0.33, yBelt: 0.56, yRoof: 0.61, yCrown: 0.62, wBot: 0.64, wLow: 0.76, wBelt: 0.75, wRoof: 0.66, wCrown: 0.40 },
  ];

  // 两侧精致流体后视镜
  const mirrorL = new THREE.BoxGeometry(0.18, 0.09, 0.18);
  mirrorL.translate(0.62, 0.95, -0.98);
  const mirrorR = new THREE.BoxGeometry(0.18, 0.09, 0.18);
  mirrorR.translate(0.62, 0.95, 0.98);

  const bodyGeo = mergeIndexedParts([buildLoftedHull(bodyStations), mirrorL, mirrorR]);

  // 全景熏黑玻璃舱（比车体上部微凸 2.4cm，零 Z-Fighting，自带倾斜前挡/侧窗/溜背天幕）
  const cabinStations = [
    { x: -1.86, yBot: 0.94, yBelt: 0.98, yRoof: 1.05, yCrown: 1.06, wBot: 0.77, wLow: 0.79, wBelt: 0.80, wRoof: 0.74, wCrown: 0.50 },
    { x: -1.16, yBot: 0.91, yBelt: 0.94, yRoof: 1.28, yCrown: 1.32, wBot: 0.88, wLow: 0.90, wBelt: 0.91, wRoof: 0.73, wCrown: 0.50 },
    { x: -0.40, yBot: 0.90, yBelt: 0.93, yRoof: 1.35, yCrown: 1.39, wBot: 0.89, wLow: 0.91, wBelt: 0.92, wRoof: 0.71, wCrown: 0.48 },
    { x: 0.32, yBot: 0.89, yBelt: 0.92, yRoof: 1.34, yCrown: 1.38, wBot: 0.89, wLow: 0.91, wBelt: 0.92, wRoof: 0.72, wCrown: 0.49 },
    { x: 1.12, yBot: 0.89, yBelt: 0.92, yRoof: 0.95, yCrown: 0.96, wBot: 0.81, wLow: 0.83, wBelt: 0.84, wRoof: 0.78, wCrown: 0.50 },
  ];
  const cabinGeo = buildLoftedHull(cabinStations);

  return { bodyGeo, cabinGeo };
}

/**
 * 构建 2 号车型：现代建筑感跨界 SUV（Modern Architectural SUV）
 */
function createSuvGeometries() {
  const bodyStations = [
    { x: -2.45, yBot: 0.40, yBelt: 0.96, yRoof: 1.08, yCrown: 1.10, wBot: 0.76, wLow: 0.90, wBelt: 0.92, wRoof: 0.84, wCrown: 0.58 },
    { x: -2.28, yBot: 0.34, yBelt: 1.02, yRoof: 1.36, yCrown: 1.38, wBot: 0.84, wLow: 0.97, wBelt: 0.99, wRoof: 0.82, wCrown: 0.58 },
    { x: -1.82, yBot: 0.33, yBelt: 1.03, yRoof: 1.63, yCrown: 1.66, wBot: 0.87, wLow: 1.00, wBelt: 1.01, wRoof: 0.79, wCrown: 0.56 },
    { x: -0.78, yBot: 0.33, yBelt: 1.02, yRoof: 1.66, yCrown: 1.68, wBot: 0.87, wLow: 1.00, wBelt: 1.01, wRoof: 0.78, wCrown: 0.56 },
    { x: 0.36, yBot: 0.33, yBelt: 1.01, yRoof: 1.64, yCrown: 1.66, wBot: 0.87, wLow: 1.00, wBelt: 1.00, wRoof: 0.78, wCrown: 0.56 },
    { x: 1.10, yBot: 0.33, yBelt: 1.01, yRoof: 1.06, yCrown: 1.08, wBot: 0.86, wLow: 1.00, wBelt: 1.01, wRoof: 0.90, wCrown: 0.62 },
    { x: 1.98, yBot: 0.34, yBelt: 0.96, yRoof: 1.01, yCrown: 1.03, wBot: 0.84, wLow: 0.98, wBelt: 0.98, wRoof: 0.88, wCrown: 0.60 },
    { x: 2.34, yBot: 0.36, yBelt: 0.86, yRoof: 0.94, yCrown: 0.96, wBot: 0.78, wLow: 0.92, wBelt: 0.92, wRoof: 0.82, wCrown: 0.56 },
    { x: 2.46, yBot: 0.42, yBelt: 0.74, yRoof: 0.82, yCrown: 0.84, wBot: 0.70, wLow: 0.84, wBelt: 0.84, wRoof: 0.74, wCrown: 0.48 },
  ];

  // 车顶纵置建筑感行李架 + 两侧后视镜
  const railL = new THREE.BoxGeometry(1.92, 0.06, 0.07);
  railL.translate(-0.72, 1.68, -0.64);
  const railR = new THREE.BoxGeometry(1.92, 0.06, 0.07);
  railR.translate(-0.72, 1.68, 0.64);
  const mirrorL = new THREE.BoxGeometry(0.20, 0.11, 0.20);
  mirrorL.translate(0.72, 1.09, -1.06);
  const mirrorR = new THREE.BoxGeometry(0.20, 0.11, 0.20);
  mirrorR.translate(0.72, 1.09, 1.06);

  const bodyGeo = mergeIndexedParts([buildLoftedHull(bodyStations), railL, railR, mirrorL, mirrorR]);

  // 悬浮式环绕全景玻璃舱（留出顶部白色陶瓷车顶框架，侧窗/前挡/尾窗利落连贯）
  const cabinStations = [
    { x: -2.26, yBot: 1.05, yBelt: 1.08, yRoof: 1.34, yCrown: 1.36, wBot: 0.86, wLow: 0.89, wBelt: 0.90, wRoof: 0.82, wCrown: 0.58 },
    { x: -1.80, yBot: 1.04, yBelt: 1.06, yRoof: 1.57, yCrown: 1.59, wBot: 0.94, wLow: 0.96, wBelt: 0.97, wRoof: 0.82, wCrown: 0.58 },
    { x: -0.76, yBot: 1.03, yBelt: 1.05, yRoof: 1.59, yCrown: 1.61, wBot: 0.95, wLow: 0.97, wBelt: 0.98, wRoof: 0.81, wCrown: 0.58 },
    { x: 0.36, yBot: 1.02, yBelt: 1.04, yRoof: 1.58, yCrown: 1.60, wBot: 0.95, wLow: 0.97, wBelt: 0.98, wRoof: 0.81, wCrown: 0.58 },
    { x: 1.13, yBot: 1.03, yBelt: 1.05, yRoof: 1.10, yCrown: 1.11, wBot: 0.88, wLow: 0.90, wBelt: 0.91, wRoof: 0.84, wCrown: 0.58 },
  ];

  // 车顶全景天幕玻璃板（略高于车顶面 1.8cm，与白色行李架相映）
  const sunroof = new THREE.BoxGeometry(1.62, 0.03, 1.06);
  sunroof.translate(-0.74, 1.685, 0);

  const cabinGeo = mergeIndexedParts([buildLoftedHull(cabinStations), sunroof]);

  return { bodyGeo, cabinGeo };
}

/**
 * 构建 3 号车型：园区智能安全巡检无人车（Campus Autonomous Security Patrol Shuttle）
 */
function createPatrolGeometries() {
  const bodyStations = [
    { x: -1.97, yBot: 0.34, yBelt: 0.84, yRoof: 1.54, yCrown: 1.62, wBot: 0.68, wLow: 0.80, wBelt: 0.82, wRoof: 0.72, wCrown: 0.52 },
    { x: -1.78, yBot: 0.28, yBelt: 0.86, yRoof: 1.76, yCrown: 1.84, wBot: 0.77, wLow: 0.87, wBelt: 0.89, wRoof: 0.76, wCrown: 0.58 },
    { x: -1.10, yBot: 0.27, yBelt: 0.87, yRoof: 1.82, yCrown: 1.88, wBot: 0.79, wLow: 0.88, wBelt: 0.89, wRoof: 0.76, wCrown: 0.60 },
    { x: 1.10, yBot: 0.27, yBelt: 0.87, yRoof: 1.82, yCrown: 1.88, wBot: 0.79, wLow: 0.88, wBelt: 0.89, wRoof: 0.76, wCrown: 0.60 },
    { x: 1.78, yBot: 0.28, yBelt: 0.86, yRoof: 1.76, yCrown: 1.84, wBot: 0.77, wLow: 0.87, wBelt: 0.89, wRoof: 0.76, wCrown: 0.58 },
    { x: 1.97, yBot: 0.34, yBelt: 0.84, yRoof: 1.54, yCrown: 1.62, wBot: 0.68, wLow: 0.80, wBelt: 0.82, wRoof: 0.72, wCrown: 0.52 },
  ];

  // 车顶流线型多传感器 LiDAR 巡检舱外壳（陶瓷白顶帽 + 激光雷达底座）
  const sensorPod = new THREE.BoxGeometry(1.38, 0.13, 0.96);
  sensorPod.translate(0.04, 1.94, 0);
  const lidarDome = new THREE.CylinderGeometry(0.14, 0.17, 0.12, 10);
  lidarDome.translate(0.42, 2.04, 0);

  const bodyGeo = mergeIndexedParts([buildLoftedHull(bodyStations), sensorPod, lidarDome]);

  // 360° 环绕熏黑全景巡检视野窗带
  const cabinStations = [
    { x: -1.94, yBot: 0.89, yBelt: 0.92, yRoof: 1.54, yCrown: 1.58, wBot: 0.76, wLow: 0.80, wBelt: 0.82, wRoof: 0.74, wCrown: 0.54 },
    { x: -1.72, yBot: 0.89, yBelt: 0.92, yRoof: 1.70, yCrown: 1.74, wBot: 0.86, wLow: 0.89, wBelt: 0.91, wRoof: 0.79, wCrown: 0.60 },
    { x: 1.72, yBot: 0.89, yBelt: 0.92, yRoof: 1.70, yCrown: 1.74, wBot: 0.86, wLow: 0.89, wBelt: 0.91, wRoof: 0.79, wCrown: 0.60 },
    { x: 1.94, yBot: 0.89, yBelt: 0.92, yRoof: 1.54, yCrown: 1.58, wBot: 0.76, wLow: 0.80, wBelt: 0.82, wRoof: 0.74, wCrown: 0.54 },
  ];
  const cabinGeo = buildLoftedHull(cabinStations);

  return { bodyGeo, cabinGeo };
}

/**
 * 共享低面数高质感轮毂与轮胎（8 边宽胎 + 双面 8 边合金轮毂盘，省去胎内不可见筒壁，32 车总面数 < 17.5k）
 */
function createSharedWheelGeometries() {
  const tireGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8, 1, false);
  tireGeo.rotateX(Math.PI / 2);

  // 仅构建左右两侧外露 8 边形合金轮毂面（胎体内壁完全不可见，画质更圆润且面数直降 33%）
  const faceR = new THREE.CircleGeometry(0.205, 8);
  faceR.translate(0, 0, 0.126);
  const faceL = new THREE.CircleGeometry(0.205, 8);
  faceL.rotateY(Math.PI);
  faceL.translate(0, 0, -0.126);
  const rimGeo = mergeIndexedParts([faceR, faceL]);

  return { tireGeo, rimGeo };
}

// ============================================================================
// 3. 程序化柔边贴花纹理（车底柔和接触阴影 + 夜间双前照灯路面光束，0 PointLight！）
// ============================================================================

function createContactShadowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, size * 0.14, size * 0.5, size * 0.5, size * 0.48);
  grad.addColorStop(0.0, 'rgba(18, 26, 38, 0.62)');
  grad.addColorStop(0.58, 'rgba(18, 26, 38, 0.36)');
  grad.addColorStop(0.84, 'rgba(18, 26, 38, 0.10)');
  grad.addColorStop(1.0, 'rgba(18, 26, 38, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 羽化双前照灯地面光束贴图（UV: U=0 为车头前端，U=1 为光束最远端；V=0..1 为横向宽度）
 * 边缘完全衰减至 0，绝对不会出现生硬多边形边界！
 */
function createHeadlightBeamTexture() {
  const w = 256;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, w, h);

  // 左右双光束柔和叠加，模拟真实新能源汽车双 LED 透镜前照光型
  const drawSingleBeam = (startY, endY) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(4, startY - 12);
    ctx.lineTo(w - 6, endY - 58);
    ctx.lineTo(w - 6, endY + 58);
    ctx.lineTo(4, startY + 12);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, startY, w, endY);
    grad.addColorStop(0.0, 'rgba(255, 246, 220, 0.72)');
    grad.addColorStop(0.18, 'rgba(255, 241, 206, 0.46)');
    grad.addColorStop(0.55, 'rgba(255, 232, 184, 0.16)');
    grad.addColorStop(0.85, 'rgba(255, 224, 168, 0.03)');
    grad.addColorStop(1.0, 'rgba(255, 220, 160, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  };

  ctx.filter = 'blur(12px)';
  drawSingleBeam(h * 0.38, h * 0.33);
  drawSingleBeam(h * 0.62, h * 0.67);
  ctx.filter = 'none';

  // 顶部与底部边缘再做柔和遮罩，确保 100% 羽化无硬边
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
// 4. 园区真实连通道路有向图（100% 精准对齐 RoadAndParking.js 坐标与标高）
// ============================================================================

const ROAD_NODES = {
  // ---- 6 个市政主干道边界出入口（考虑靠右外侧车道偏移，确保整车 100% 落在底座瓷白压边内） ----
  P_ZGC_N: { x: -208.3, z: -177.5, kind: 'portal' },
  P_ZGC_S: { x: -223.7, z: 177.5, kind: 'portal' },
  P_PL_W: { x: -236.5, z: -101.2, kind: 'portal' },
  P_PL_NE: { x: 143.0, z: -176.2, kind: 'portal' },
  P_YP_W: { x: -236.5, z: 116.3, kind: 'portal' },
  P_YP_S: { x: -105.5, z: 176.0, kind: 'portal' },

  // ---- 市政主干道主交叉口 ----
  J_PL_ZGC: { x: -211.0, z: -106.0, kind: 'junction' },
  J_FIRE_W: { x: -212.2, z: -66.0, kind: 'junction' },
  J_WEST_BR: { x: -216.2, z: 22.0, kind: 'junction' },
  J_YP_ZGC: { x: -221.0, z: 122.0, kind: 'junction' },
  J_NORTH_GATE: { x: 26.0, z: -153.8, kind: 'junction' },

  // ---- 北迎宾大道分道与中央大入口门廊回转广场（精准绕避 (26,-112) 种植岛与 (16.5/35.5,-102) 礼仪路灯） ----
  N_WELC_S: { x: 20.1, z: -134.0, kind: 'campus' },
  N_WELC_N: { x: 31.9, z: -134.0, kind: 'campus' },
  J_PLAZA_SW: { x: 20.1, z: -94.5, kind: 'campus', patrolGoal: true },
  J_PLAZA_SE: { x: 31.9, z: -94.5, kind: 'campus', patrolGoal: true },
  J_PLAZA_W: { x: 10.0, z: -104.5, kind: 'campus' },
  J_PLAZA_E: { x: 42.0, z: -104.5, kind: 'campus' },

  // ---- 内部消防环道、西翼支线与停车场喉道 ----
  J_WEST_FIRE: { x: -144.0, z: -93.5, kind: 'campus', patrolGoal: true },
  J_WPARK_GATE: { x: -146.0, z: -10.0, kind: 'campus', patrolGoal: true },
  D_WPARK: { x: -123.5, z: -10.0, kind: 'terminal', patrolGoal: true },
  J_NEPARK_GATE: { x: 89.5, z: -104.3, kind: 'campus', patrolGoal: true },
  D_NEPARK: { x: 89.5, z: -117.5, kind: 'terminal', patrolGoal: true },
  J_EAST_CORNER: { x: 96.5, z: -102.0, kind: 'campus' },
  J_EAST_MID: { x: 97.6, z: -42.0, kind: 'campus', patrolGoal: true },
  D_EAST_PORTAL: { x: 96.0, z: 19.0, kind: 'terminal', patrolGoal: true },
};

// 末端掉头平滑圆弧（杜绝 180° 原地折返）
const TERMINAL_TURNAROUNDS = {
  // 西侧停车场宽阔中央通廊内柔和回转（远离西排 -127.8 与东排 -112.0 停放车辆）
  D_WPARK: [
    [-123.5, -8.55],
    [-118.2, -6.8],
    [-116.4, -10.0],
    [-118.2, -13.2],
    [-123.5, -11.45],
  ],
  // 东北停车场中央通廊柔和回转（远离西排 82.9 与东排 95.8 停放车辆）
  D_NEPARK: [
    [90.95, -117.5],
    [91.8, -121.2],
    [89.5, -123.3],
    [87.2, -121.2],
    [88.05, -117.5],
  ],
  // 东侧消防环道尽头装卸区外顺畅掉头（严格保持在 [92.6, 99.4] 路面内）
  D_EAST_PORTAL: [
    [94.45, 19.0],
    [94.65, 21.8],
    [96.0, 22.9],
    [97.35, 21.8],
    [97.55, 19.0],
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
      laneOffset: opts.laneOffset,
      speedLimit: opts.speedLimit,
      patrolAllowed: opts.patrolAllowed ?? false,
    });
  };

  const addBidirectional = (u, v, via, opts) => {
    addDirected(u, v, via, opts);
    addDirected(v, u, via ? [...via].reverse() : null, opts);
  };

  // 1. 西侧市政主干道：中关村大道（双黄线四车道，靠右行驶偏移 ±3.6m）
  const zgcOpts = { roadClass: 'arterial', laneOffset: 3.6, speedLimit: 13.8, patrolAllowed: false };
  addBidirectional('P_ZGC_N', 'J_PL_ZGC', null, zgcOpts);
  addBidirectional('J_PL_ZGC', 'J_FIRE_W', [[-211.2, -92]], zgcOpts);
  addBidirectional('J_FIRE_W', 'J_WEST_BR', [[-214.0, -24], [-216.0, 15]], zgcOpts);
  addBidirectional('J_WEST_BR', 'J_YP_ZGC', [[-218.8, 72], [-221.0, 110]], zgcOpts);
  addBidirectional('J_YP_ZGC', 'P_ZGC_S', null, zgcOpts);

  // 2. 北侧市政主干道：平陵西路（四车道，靠右行驶偏移 ±3.4m）
  const plOpts = { roadClass: 'arterial', laneOffset: 3.4, speedLimit: 13.5, patrolAllowed: false };
  addBidirectional('P_PL_W', 'J_PL_ZGC', null, plOpts);
  addBidirectional('J_PL_ZGC', 'J_NORTH_GATE', [[-130, -124], [-25, -144]], plOpts);
  addBidirectional('J_NORTH_GATE', 'P_PL_NE', [[65, -162]], plOpts);

  // 3. 西南市政主干道：永平大道（四车道，靠右行驶偏移 ±3.3m）
  const ypOpts = { roadClass: 'arterial', laneOffset: 3.3, speedLimit: 13.0, patrolAllowed: false };
  addBidirectional('P_YP_W', 'J_YP_ZGC', null, ypOpts);
  addBidirectional('J_YP_ZGC', 'P_YP_S', [[-186, 138], [-138, 164]], ypOpts);

  // 4. 北迎宾大道（单向分流绕过中央种植岛，绝不穿岛！）
  addDirected('J_NORTH_GATE', 'N_WELC_S', [[21.4, -145]], {
    roadClass: 'campus',
    laneOffset: 0.0,
    speedLimit: 7.4,
    patrolAllowed: false,
  });
  addDirected('N_WELC_S', 'J_PLAZA_SW', [[20.1, -114]], {
    roadClass: 'campus',
    laneOffset: 0.0,
    speedLimit: 6.8,
    patrolAllowed: false,
  });
  addDirected('J_PLAZA_SE', 'N_WELC_N', [[31.9, -114]], {
    roadClass: 'campus',
    laneOffset: 0.0,
    speedLimit: 6.8,
    patrolAllowed: false,
  });
  addDirected('N_WELC_N', 'J_NORTH_GATE', [[30.6, -145]], {
    roadClass: 'campus',
    laneOffset: 0.0,
    speedLimit: 7.4,
    patrolAllowed: false,
  });

  // 5. 中央门廊迎宾广场横穿段（位于种植岛及广场入口路灯南侧宽阔铺装区，靠右行驶 ±1.55m）
  const plazaOpts = { roadClass: 'plaza', laneOffset: 1.55, speedLimit: 5.8, patrolAllowed: true };
  addBidirectional('J_PLAZA_SW', 'J_PLAZA_SE', null, plazaOpts);
  addBidirectional('J_PLAZA_W', 'J_PLAZA_SW', [[12.0, -96.5]], plazaOpts);
  addBidirectional('J_PLAZA_SE', 'J_PLAZA_E', [[40.0, -96.5]], plazaOpts);

  // 6. 内部消防环道（靠右行驶 ±1.55m）
  const fireOpts = { roadClass: 'campus', laneOffset: 1.55, speedLimit: 7.2, patrolAllowed: true };
  addBidirectional('J_FIRE_W', 'J_WEST_FIRE', [[-174, -84]], fireOpts);
  addBidirectional('J_WEST_FIRE', 'J_PLAZA_W', [[-130, -98], [-58, -106]], fireOpts);
  addBidirectional('J_PLAZA_E', 'J_NEPARK_GATE', [[66, -105.4]], fireOpts);
  addBidirectional('J_NEPARK_GATE', 'J_EAST_CORNER', null, fireOpts);
  addBidirectional('J_EAST_CORNER', 'J_EAST_MID', [[98.0, -68]], fireOpts);
  addBidirectional('J_EAST_MID', 'D_EAST_PORTAL', [[97.0, -12]], fireOpts);

  // 7. 西翼支线（连接中关村大道、西停车场与消防环道）
  const branchOpts = { roadClass: 'campus', laneOffset: 1.55, speedLimit: 6.8, patrolAllowed: true };
  addBidirectional('J_WEST_BR', 'J_WPARK_GATE', [[-168, 22], [-146, 18]], branchOpts);
  addBidirectional('J_WPARK_GATE', 'J_WEST_FIRE', [[-146, -34], [-145, -66]], branchOpts);

  // 8. 停车场出入口引道
  const parkOpts = { roadClass: 'parking', laneOffset: 1.45, speedLimit: 5.0, patrolAllowed: true };
  addBidirectional('J_WPARK_GATE', 'D_WPARK', null, parkOpts);
  addBidirectional('J_NEPARK_GATE', 'D_NEPARK', null, parkOpts);

  return adj;
}

/**
 * Dijkstra 最短路求解（支持巡检车限定在园区内部路网巡航，以及可选禁止起步立刻掉头）
 */
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
      // 微量随机扰动 (0.94..1.06) 让相同起终点偶尔呈现丰富多样的合理路径
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
// 5. 靠右车道偏移 + 二次贝塞尔平滑圆角路径生成（零生硬 90° 折角）
// ============================================================================

/**
 * 精准匹配 RoadAndParking.js 的真实路面标高（消除任何悬浮或轮胎吃进广场现象）
 */
function sampleRoadSurfaceY(x, z) {
  // 三个市政交叉口圆角过渡垫层（顶面 0.073m）
  const d1 = (x + 211) * (x + 211) + (z + 106) * (z + 106);
  const d2 = (x + 221) * (x + 221) + (z - 122) * (z - 122);
  const d3 = (x - 26) * (x - 26) + (z + 153) * (z + 153);
  if (d1 < 112 || d2 < 106 || d3 < 98) {
    return ELEVATIONS.ROAD_TOP + 0.011;
  }
  // 北迎宾广场（PLAZA_TOP = 0.072m）
  if (x >= 8 && x <= 44 && z >= -107 && z <= -81) {
    return ELEVATIONS.PLAZA_TOP;
  }
  // 西侧中关村大道
  if (x < -199) {
    return ELEVATIONS.ROAD_TOP + 0.004;
  }
  // 北侧平陵西路 / 西南永平大道
  if (z < -120 || z > 110) {
    return ELEVATIONS.ROAD_TOP + 0.002;
  }
  return ELEVATIONS.ROAD_TOP;
}

/**
 * 将路段列表展开为：靠右偏移点列 -> 二次贝塞尔拐角圆弧过渡 -> 等弧长重采样 + 曲率表
 */
function compileSmoothRoute(edgePath, { arterialLaneDelta = 0, prependTurnaround = null } = {}) {
  const rawPts = [];

  // 若从停车场/东端掉头出发，先无缝衔接末端圆弧
  if (prependTurnaround && prependTurnaround.length > 0) {
    for (const [tx, tz] of prependTurnaround) {
      rawPts.push({ x: tx, z: tz, speedLimit: 4.2, isCorner: false, fillet: 2.2 });
    }
  }

  // 对每条有向边按自身右向法线执行严格靠右偏移
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
      // 司机右手方向 R = (-tz, tx)
      const rx = -dz / len;
      const rz = dx / len;
      const ox = pts[i][0] + rx * offset;
      const oz = pts[i][1] + rz * offset;

      // 避免相邻边接口过近导致折返尖刺
      if (rawPts.length > 0) {
        const last = rawPts[rawPts.length - 1];
        const gap = Math.hypot(ox - last.x, oz - last.z);
        if (gap < 0.9) continue;
      }

      rawPts.push({
        x: ox,
        z: oz,
        speedLimit: edge.speedLimit,
        fillet,
      });
    }
  }

  if (rawPts.length < 2) return null;

  // 清除任何可能因大偏移在锐角内弯产生的小回折点
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
    // 剔除极短的 150°+ 倒钩毛刺（保留正常宽圆弧）
    if (dot < -0.82 && Math.min(l1, l2) < 4.5) continue;
    cleanPts.push(b);
  }
  cleanPts.push(rawPts[rawPts.length - 1]);
  if (cleanPts.length < 2) return null;

  // 二次贝塞尔平滑圆角（Fillet）
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
      });
    }
  }
  filleted.push(cleanPts[cleanPts.length - 1]);

  // 等弧长重采样（步长 ~1.25m）+ 计算切向角与局部曲率（驱动进弯提前减速）
  const samples = [];
  let accumS = 0;
  samples.push({ x: filleted[0].x, z: filleted[0].z, s: 0, speedLimit: filleted[0].speedLimit });

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
    samples[i].y = sampleRoadSurfaceY(samples[i].x, samples[i].z);
  }

  // 计算每点局部曲率 |Δyaw| / Δs，供弯道丝滑减速使用
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

/**
 * 二分查找平滑采样路径上的精准位置、朝向与前方弯道限速（零对象分配！）
 */
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

  // 球面/最短角插值方向，弯道转动如丝般顺滑
  let dYaw = b.rotY - a.rotY;
  while (dYaw > Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;
  out.rotY = a.rotY + dYaw * t;
  out.fx = Math.cos(out.rotY);
  out.fz = -Math.sin(out.rotY);

  // 前瞻 10 米曲率与限速，提前平稳入弯减速
  let maxCurv = a.curvature;
  let minSpeed = a.speedLimit;
  const lookAheadEnd = Math.min(lastIdx, lo + 9);
  for (let k = lo + 1; k <= lookAheadEnd; k++) {
    if (samples[k].curvature > maxCurv) maxCurv = samples[k].curvature;
    if (samples[k].speedLimit < minSpeed) minSpeed = samples[k].speedLimit;
  }

  // 舒适向心加速度 a_lat = 2.6 m/s² -> v_curve = sqrt(a_lat / curv)
  const curveCap = maxCurv > 0.015 ? Math.sqrt(2.6 / maxCurv) : minSpeed;
  out.targetSpeed = Math.max(3.2, Math.min(minSpeed, curveCap));
}

// ============================================================================
// 6. 停车场静态泊车点位（西侧充电车棚排/东排 + 东北访客停车场，共 16 台）
// ============================================================================

const PARKED_VEHICLES_CONFIG = [
  // 西侧太阳能充电车棚排（朝东停放）
  { x: -130.2, z: -25.2, rotY: 0, type: 'sedan', colorIdx: 0 },
  { x: -130.2, z: -20.6, rotY: 0, type: 'suv', colorIdx: 1 },
  { x: -130.2, z: -11.4, rotY: 0, type: 'sedan', colorIdx: 2 },
  { x: -130.2, z: -6.8, rotY: 0, type: 'patrol', colorIdx: 0 }, // 1 台充电待命巡检无人车
  { x: -130.2, z: 2.2, rotY: 0, type: 'suv', colorIdx: 4 },
  { x: -130.2, z: 6.8, rotY: 0, type: 'sedan', colorIdx: 3 },
  // 西侧东排（朝西停放）
  { x: -109.6, z: -25.2, rotY: Math.PI, type: 'suv', colorIdx: 0 },
  { x: -109.6, z: -16.0, rotY: Math.PI, type: 'sedan', colorIdx: 4 },
  { x: -109.6, z: -11.4, rotY: Math.PI, type: 'sedan', colorIdx: 1 },
  { x: -109.6, z: -2.2, rotY: Math.PI, type: 'suv', colorIdx: 2 },
  { x: -109.6, z: 6.8, rotY: Math.PI, type: 'sedan', colorIdx: 0 },
  // 东北侧地面停车场（西侧太阳能车棚排 + 东排）
  { x: 80.5, z: -122.0, rotY: 0, type: 'sedan', colorIdx: 1 },
  { x: 80.5, z: -117.6, rotY: 0, type: 'suv', colorIdx: 3 },
  { x: 80.5, z: -109.2, rotY: 0, type: 'sedan', colorIdx: 4 },
  { x: 98.2, z: -122.0, rotY: Math.PI, type: 'suv', colorIdx: 0 },
  { x: 98.2, z: -113.5, rotY: Math.PI, type: 'sedan', colorIdx: 2 },
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

  const lightBarGeo = new THREE.BoxGeometry(1, 1, 1);
  // 巡检车顶冰青环形传感器光带（包绕顶舱外缘，从鸟瞰与近景皆清晰辨识）
  const beaconStripGeo = (() => {
    const front = new THREE.BoxGeometry(0.05, 0.055, 1.01);
    front.translate(0.70, 0, 0);
    const back = new THREE.BoxGeometry(0.05, 0.055, 1.01);
    back.translate(-0.70, 0, 0);
    const left = new THREE.BoxGeometry(1.42, 0.055, 0.05);
    left.translate(0, 0, -0.49);
    const right = new THREE.BoxGeometry(1.42, 0.055, 0.05);
    right.translate(0, 0, 0.49);
    return mergeIndexedParts([front, back, left, right]);
  })();

  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);

  // 光束平面原点在后端中点 (0, 0, 0)，向前 (+X) 延伸至 +1
  const beamGeo = new THREE.PlaneGeometry(1, 1);
  beamGeo.rotateX(-Math.PI / 2);
  beamGeo.translate(0.5, 0, 0);

  // ---- 2. 高级白模材质与自发光车灯材质 ----
  const bodyMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.25,
    metalness: 0.22,
    envMapIntensity: 1.15,
  });
  const cabinMat = new THREE.MeshStandardMaterial({
    color: '#2e3c4e',
    roughness: 0.11,
    metalness: 0.36,
    envMapIntensity: 1.45,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    color: '#2c333d',
    roughness: 0.86,
    metalness: 0.04,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: '#dfe5ee',
    roughness: 0.24,
    metalness: 0.80,
  });

  // 车灯采用 MeshBasicMaterial + instanceColor 驱动单台精细亮度（日间镜片/夜间暖白/刹车高亮红）
  const headlightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const taillightMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const beaconMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  const shadowTex = createContactShadowTexture();
  shadowTex.anisotropy = Math.min(maxAnisotropy, 4);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.72,
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

  // ---- 3. 统计各车型实例槽位（静态泊车 + 动态行驶统一合批为极简 InstancedMesh） ----
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
      colorHex: cfg.type === 'patrol' ? PATROL_PAINT : PAINT_PALETTE[(i * 2 + 1) % PAINT_PALETTE.length],
      x: 0,
      y: ELEVATIONS.ROAD_TOP,
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
    inst.castShadow = false; // 严禁移动车辆参与静态 shadowMap 避免残影与重绘开销
    inst.receiveShadow = receiveShadow;
    inst.frustumCulled = false; // 动态车辆遍布 486×368m 底座，防止局部原点出视锥后整体被裁剪
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
    tireInst,
    rimInst,
    headlightInst,
    taillightInst,
    patrolBeaconInst,
    contactShadowInst,
    headlightConeInst
  );

  // 初始化车漆颜色
  const tmpColor = new THREE.Color();
  for (const v of allVehicles) {
    tmpColor.set(v.colorHex);
    bodyInsts[v.type].setColorAt(v.typeIdx, tmpColor);
  }
  for (const inst of Object.values(bodyInsts)) {
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }

  // ---- 4. Mulberry32 高分布质量伪随机 + 随机起终点路径分配器 ----
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
      // 巡检无人车始终在园区内部巡航，不驶离底座边界
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
      // 社会/访客车辆：到达边界入口时从随机边界入口重入；到达内部节点则原位衔接发车
      const needFreshOrigin = !startId || ROAD_NODES[startId]?.kind === 'portal';
      if (needFreshOrigin) {
        // 尽量挑一个附近无车遮挡的随机边界起点
        let candidate = pickRandom(portalIds, startId);
        for (let tries = 0; tries < 6; tries++) {
          if (isOriginClear(candidate, v)) break;
          candidate = pickRandom(portalIds, startId);
        }
        startId = candidate;
      } else if (TERMINAL_TURNAROUNDS[startId]) {
        prependTurnaround = TERMINAL_TURNAROUNDS[startId];
      }

      // 根据角色权重随机选取目标终点（覆盖主干道跨区通行 + 进入园区迎宾广场/停车场/东装卸区）
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

  // ---- 5. 预分配零 GC 临时工作对象 ----
  const dummy = new THREE.Object3D();
  const tmpSample = { x: 0, y: 0, z: 0, rotY: 0, fx: 1, fz: 0, targetSpeed: 8 };
  const WHEEL_SIGNS = [
    [1, -1],
    [1, 1],
    [-1, -1],
    [-1, 1],
  ];

  // 初始化所有移动车辆的随机行程并错峰散布在路网上（打开画面立刻有生动车流！）
  for (let i = 0; i < movingVehicles.length; i++) {
    assignNewTrip(movingVehicles[i], { initialSpread: true });
    // 微调防止两车初始落点过近重叠
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

  // 写入单台车的所有 InstancedMesh 矩阵（零 new 分配）
  function writeVehicleMatrices(v, patrolSlotMap) {
    const spec = ARCHETYPE_SPECS[v.type];
    const s = v.scale;
    const baseY = v.y;
    const cosY = Math.cos(v.rotY);
    const sinY = Math.sin(v.rotY);

    // 车身 + 玻璃座舱
    dummy.position.set(v.x, baseY, v.z);
    dummy.rotation.set(0, v.rotY, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    bodyInsts[v.type].setMatrixAt(v.typeIdx, dummy.matrix);
    cabinInsts[v.type].setMatrixAt(v.typeIdx, dummy.matrix);

    // 4 只轮毂与轮胎（带真实滚动角 wheelSpin）
    const wBase = v.globalIdx * 4;
    const ws = spec.wheelScale * s;
    const wy = baseY + spec.wheelRadius * s;
    for (let wi = 0; wi < 4; wi++) {
      const lx = WHEEL_SIGNS[wi][0] * spec.wheelX * s;
      const lz = WHEEL_SIGNS[wi][1] * spec.wheelZ * s;
      const wx = v.x + lx * cosY + lz * sinY;
      const wz = v.z - lx * sinY + lz * cosY;
      dummy.position.set(wx, wy, wz);
      // Y-Z 顺序：先朝车头 yaw，再绕轮轴（局部 Z 轴）滚动
      dummy.rotation.set(0, v.rotY, -v.wheelSpin, 'YXZ');
      dummy.scale.set(ws, ws, ws);
      dummy.updateMatrix();
      tireInst.setMatrixAt(wBase + wi, dummy.matrix);
      rimInst.setMatrixAt(wBase + wi, dummy.matrix);
    }

    // 前照灯条
    const [hlx, hly, hlz] = spec.headlightPos;
    const hx = v.x + hlx * s * cosY + hlz * s * sinY;
    const hz = v.z - hlx * s * sinY + hlz * s * cosY;
    dummy.position.set(hx, baseY + hly * s, hz);
    dummy.rotation.set(0, v.rotY, 0, 'XYZ');
    dummy.scale.set(spec.headlightScale[0] * s, spec.headlightScale[1] * s, spec.headlightScale[2] * s);
    dummy.updateMatrix();
    headlightInst.setMatrixAt(v.globalIdx, dummy.matrix);

    // 尾部贯穿红灯条
    const [tlx, tly, tlz] = spec.taillightPos;
    const tx = v.x + tlx * s * cosY + tlz * s * sinY;
    const tz = v.z - tlx * s * sinY + tlz * s * cosY;
    dummy.position.set(tx, baseY + tly * s, tz);
    dummy.rotation.set(0, v.rotY, 0, 'XYZ');
    dummy.scale.set(spec.taillightScale[0] * s, spec.taillightScale[1] * s, spec.taillightScale[2] * s);
    dummy.updateMatrix();
    taillightInst.setMatrixAt(v.globalIdx, dummy.matrix);

    // 巡检车顶冰青雷达灯带
    if (v.type === 'patrol') {
      const pIdx = patrolSlotMap.get(v);
      const [bx, by, bz] = spec.beaconPos;
      dummy.position.set(v.x + bx * s * cosY + bz * s * sinY, baseY + by * s, v.z - bx * s * sinY + bz * s * cosY);
      dummy.rotation.set(0, v.rotY, 0, 'XYZ');
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      patrolBeaconInst.setMatrixAt(pIdx, dummy.matrix);
    }

    // 柔和接地接触阴影贴花（始终贴合当前真实路面标高 +0.011m）
    dummy.position.set(v.x, baseY + 0.011, v.z);
    dummy.rotation.set(0, v.rotY, 0, 'XYZ');
    dummy.scale.set(spec.shadowScale[0] * s, 1, spec.shadowScale[2] * s);
    dummy.updateMatrix();
    contactShadowInst.setMatrixAt(v.globalIdx, dummy.matrix);

    // 夜间前照灯路面羽化光束（仅行驶车辆）
    if (v.isMoving) {
      const ox = v.x + spec.beamOriginX * s * cosY;
      const oz = v.z - spec.beamOriginX * s * sinY;
      // 标高取路面 +0.025m，安全越过路灯地面光晕与交叉口垫层，绝对零 Z-Fighting
      dummy.position.set(ox, baseY + 0.025, oz);
      dummy.rotation.set(0, v.rotY, 0, 'XYZ');
      dummy.scale.set(spec.beamLength * s, 1, spec.beamWidth * s);
      dummy.updateMatrix();
      headlightConeInst.setMatrixAt(v.movingIdx, dummy.matrix);
    }
  }

  const patrolSlotMap = new Map();
  patrolList.forEach((v, idx) => patrolSlotMap.set(v, idx));

  // 更新全部车辆灯光色彩（根据 nightFactor、是否行驶、刹车强度与巡检脉冲）
  let currentNight = 0;
  let elapsedTime = 0;

  function updateVehicleLights(nightFactor, timeSec) {
    const nf = Math.max(0, Math.min(1, nightFactor));
    const pulse = 0.86 + 0.14 * Math.sin(timeSec * 3.8);

    // 接触阴影随夜幕变柔和，路面大灯光束随夜幕平滑显现
    shadowMat.opacity = THREE.MathUtils.lerp(0.70, 0.26, nf);
    headlightConeInst.visible = nf > 0.02;
    if (headlightConeInst.visible) {
      beamMat.opacity = nf * 0.56;
    }

    for (let i = 0; i < totalCount; i++) {
      const v = allVehicles[i];
      if (!v.isMoving) {
        // 停放车辆：车灯熄灭/极暗反光镜片，凸显动态车流
        const hlDim = THREE.MathUtils.lerp(0.76, 0.24, nf);
        tmpColor.setRGB(hlDim * 0.96, hlDim, hlDim * 1.06);
        headlightInst.setColorAt(i, tmpColor);

        const tlDim = THREE.MathUtils.lerp(0.42, 0.16, nf);
        tmpColor.setRGB(tlDim, tlDim * 0.22, tlDim * 0.24);
        taillightInst.setColorAt(i, tmpColor);
      } else {
        // 移动车辆前照灯：日间清透 DRL，夜间明亮暖白 LED（高亮度值适配 ACES Filmic）
        const hr = THREE.MathUtils.lerp(1.04, 2.38, nf);
        const hg = THREE.MathUtils.lerp(1.08, 2.16, nf);
        const hb = THREE.MathUtils.lerp(1.14, 1.70, nf);
        tmpColor.setRGB(hr, hg, hb);
        headlightInst.setColorAt(i, tmpColor);

        // 移动车辆尾灯：日间微红示廓，夜间宝石红常亮，刹车时骤然高亮！
        const bk = v.brakeIntensity;
        const baseR = THREE.MathUtils.lerp(0.82, 1.60, nf);
        const baseG = THREE.MathUtils.lerp(0.14, 0.14, nf);
        const baseB = THREE.MathUtils.lerp(0.16, 0.17, nf);
        tmpColor.setRGB(
          THREE.MathUtils.lerp(baseR, 2.55, bk),
          THREE.MathUtils.lerp(baseG, 0.19, bk),
          THREE.MathUtils.lerp(baseB, 0.22, bk)
        );
        taillightInst.setColorAt(i, tmpColor);
      }
    }

    // 巡检无人车车顶冰青雷达灯带
    for (let p = 0; p < patrolList.length; p++) {
      const pv = patrolList[p];
      if (!pv.isMoving) {
        // 充电待命巡检车柔和呼吸
        const idle = 0.72 + 0.18 * Math.sin(timeSec * 1.8);
        tmpColor.setRGB(0.18 * idle, 0.78 * idle, 0.92 * idle);
      } else {
        const gain = THREE.MathUtils.lerp(1.15, 2.05, nf) * pulse;
        tmpColor.setRGB(0.22 * gain, 0.95 * gain, 1.05 * gain);
      }
      patrolBeaconInst.setColorAt(p, tmpColor);
    }

    if (headlightInst.instanceColor) headlightInst.instanceColor.needsUpdate = true;
    if (taillightInst.instanceColor) taillightInst.instanceColor.needsUpdate = true;
    if (patrolBeaconInst.instanceColor) patrolBeaconInst.instanceColor.needsUpdate = true;
  }

  // 先为全部静态 + 动态车辆写入首帧矩阵与色彩
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

  // ---- 6. 实时交通动力学更新（防追尾跟车 + 路口礼让 + 弯道减速 + 边界淡入淡出） ----
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

      // 到达园区内目标点时的短暂停靠（模拟上下客 / 无人车安全巡检停驻扫描）
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

      // 抵达内部停靠点前平滑降速入站
      const remaining = v.route.totalLength - v.dist;
      const endKind = ROAD_NODES[v.route.endNode].kind;
      if (endKind !== 'portal' && remaining < 12.0) {
        desiredSpeed = Math.min(desiredSpeed, Math.max(1.6, remaining * 0.48));
      }

      // 防追尾跟车间距检测 + 交叉口横向来车防碰撞礼让
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
          // 同向跟车
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
          // 交叉口横向让行（距离冲突点更近或索引更小者优先，杜绝路口互锁死锁）
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

      // 防死锁保护：若在复杂交叉口等待超过 3.8s，缓慢蠕行脱困
      if (blocked && v.speed < 0.4) {
        v.stuckTimer += safeDt;
        if (v.stuckTimer > 3.8) {
          desiredSpeed = Math.max(desiredSpeed, 2.8);
        }
      } else {
        v.stuckTimer = Math.max(0, v.stuckTimer - safeDt * 2);
      }

      // 车辆纵轴平滑加减速动力学
      const deltaV = desiredSpeed - v.speed;
      if (deltaV >= 0) {
        v.speed += Math.min(deltaV, 3.6 * safeDt);
      } else {
        v.speed += Math.max(deltaV, -7.2 * safeDt);
      }
      v.speed = Math.max(0, v.speed);

      // 刹车灯平滑响应（急减速或排队停等时高亮）
      const braking = deltaV < -1.1 || (blocked && v.speed < 1.2);
      const targetBrake = braking ? 1.0 : 0.0;
      v.brakeIntensity += (targetBrake - v.brakeIntensity) * Math.min(1, safeDt * 8.0);

      // 沿弧长前进 + 车轮滚动
      const step = v.speed * safeDt;
      v.dist += step;
      v.wheelSpin = (v.wheelSpin + step / ARCHETYPE_SPECS[v.type].wheelRadius) % (Math.PI * 2);

      // 抵达终点判定
      if (v.dist >= v.route.totalLength - 0.2) {
        if (endKind === 'portal') {
          assignNewTrip(v);
        } else {
          // 停靠在迎宾广场/停车场/东装卸区短暂驻留后再发往下一随机终点
          v.dist = v.route.totalLength;
          v.pauseTimer = v.role === 'patrol' ? 1.6 + rand() * 1.4 : 1.1 + rand() * 1.5;
        }
      }

      // 重新采样最新位姿
      sampleRouteInto(v.route, v.dist, tmpSample);
      v.x = tmpSample.x;
      v.y = tmpSample.y;
      v.z = tmpSample.z;
      v.rotY = tmpSample.rotY;
      v.fx = tmpSample.fx;
      v.fz = tmpSample.fz;

      // 市政底座边界柔和缩放入场/离场（仅边界 portal 节点生效，园内行驶恒为 1.0）
      let scale = 1.0;
      const startKind = ROAD_NODES[v.route.startNode].kind;
      if (startKind === 'portal' && v.dist < 5.0) {
        const t = Math.max(0.01, v.dist / 5.0);
        scale = Math.min(scale, t * (2 - t));
      }
      if (endKind === 'portal' && v.route.totalLength - v.dist < 5.0) {
        const t = Math.max(0.01, (v.route.totalLength - v.dist) / 5.0);
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
      drawCallsDay: 12,
      drawCallsNight: 13,
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
