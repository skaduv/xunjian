/**
 * 长三角物理研究中心（IOPLY，江苏溧阳中关村大道 1 号）
 * 1:1 真实尺度（1 unit = 1m）数字孪生主控配置
 * 坐标系：X 东正西负，Y 竖直向上，Z 南正北负
 *
 * 零闪烁工程标高硬约束：
 * - 草坪顶面：0.000
 * - 沥青道路挤压体：0.000 -> 0.062
 * - 道路两侧抬高路缘石：0.000 -> 0.085
 * - 建筑首层地坪：0.095（三层总檐口高 14.495）
 */

export const ELEVATIONS = {
  LAWN_TOP: 0.0,
  WATER_SURFACE: -0.58,
  LAKE_TIER_1: -1.15,
  LAKE_TIER_2: -2.05,
  LAKE_TIER_3: -3.15,
  REVETMENT_TOP: 0.14,
  ROAD_TOP: 0.062,
  CURB_TOP: 0.085,
  PLAZA_TOP: 0.072,
  FLOOR_1_Y: 0.095,
  FLOOR_HEIGHT: 4.8,
  FLOOR_2_Y: 4.895,
  FLOOR_3_Y: 9.695,
  ROOF_Y: 14.495,
  SLAB_THICKNESS: 0.34,
};

export const PLINTH_CONFIG = {
  width: 486,
  depth: 368,
  cornerRadius: 26,
  topHeight: 0.0,
  skirtDepth: 16.5,
  bevelSize: 2.2,
  undercutInset: 6.5,
  undercutHeight: 3.4,
};

/**
 * 爆炸透视五层独立 Group 目标垂直偏移量（米）
 */
export const EXPLODE_OFFSETS = {
  floor1: 0,
  floor2: 14.0,
  floor3: 28.0,
  roof: 42.0,
  floatingCanopy: 55.0,
};

export function getFloorExplodeOffset(floorKey, explodeFactor) {
  const map = {
    outdoor: 0,
    '1F': EXPLODE_OFFSETS.floor1,
    '2F': EXPLODE_OFFSETS.floor2,
    '3F': EXPLODE_OFFSETS.floor3,
    roof: EXPLODE_OFFSETS.roof,
    floatingCanopy: EXPLODE_OFFSETS.floatingCanopy,
  };
  return (map[floorKey] ?? 0) * explodeFactor;
}

/**
 * 严格遵循 KKAA + 浙大院官方平剖面图的建筑分区体量（单位：米）
 * 每个体量包含 [x1, z1, x2, z2] 边界（x1 < x2, z1 < z2），以及所属楼层是否存在
 */
export const BUILDING_WINGS = [
  // ================= 西翼 W1-W5（雁行临湖错动 5 段） =================
  {
    id: 'W1',
    name: '西一楼 · 危化与电池物理实验室',
    groupId: 'grp-w1',
    x1: -162, z1: 30, x2: -138, z2: 94,
    floors: [1, 2, 3],
    corridorAxis: 'z',
    atrium: { x1: -155.5, z1: 42, x2: -144.5, z2: 66 },
    skylightType: 'sawtooth',
    skylightAxis: 'z',
    pvZones: [
      { x1: -159, z1: 70, x2: -141, z2: 90, rows: 5 },
      { x1: -159, z1: 32, x2: -141, z2: 39, rows: 2 },
    ],
  },
  // W1-W2 之间 1F 底层架空入口门洞（2F/3F 连桥跨越）
  {
    id: 'W1_W2_BRIDGE',
    name: '西一西二连桥（底层架空门洞）',
    groupId: 'grp-w1',
    x1: -138, z1: 30, x2: -122, z2: 50,
    floors: [2, 3],
    isPorchBridge: true,
    porchColumns: [
      [-136.5, 32], [-130, 32], [-123.5, 32],
      [-136.5, 48], [-130, 48], [-123.5, 48],
    ],
    corridorAxis: 'x',
    pvZones: [{ x1: -136, z1: 33, x2: -124, z2: 47, rows: 3 }],
  },
  {
    id: 'W2',
    name: '西二楼 · 物理实验与临湖咖啡吧',
    groupId: 'grp-w2',
    x1: -122, z1: 30, x2: -52, z2: 50,
    floors: [1, 2, 3],
    corridorAxis: 'x',
    hasCafe: true,
    lakesideDeck: { x1: -76, z1: 50, x2: -52, z2: 57.5 },
    pvZones: [
      { x1: -119, z1: 33, x2: -78, z2: 47, rows: 3 },
      { x1: -74, z1: 33, x2: -56, z2: 47, rows: 3 },
    ],
  },
  // W2-W3 之间 1F 底层架空入口门洞（2F/3F 连桥跨越）
  {
    id: 'W2_W3_BRIDGE',
    name: '西二西三连桥（底层架空门洞）',
    groupId: 'grp-w2',
    x1: -80, z1: 10, x2: -52, z2: 30,
    floors: [2, 3],
    isPorchBridge: true,
    porchColumns: [
      [-78, 12], [-78, 20], [-78, 28],
      [-54, 12], [-54, 20], [-54, 28],
    ],
    corridorAxis: 'z',
    pvZones: [{ x1: -76, z1: 13, x2: -56, z2: 27, rows: 3 }],
  },
  {
    id: 'W3',
    name: '西三楼 · 中央大中庭实验楼',
    groupId: 'grp-w3',
    x1: -82, z1: -34, x2: -52, z2: 10,
    floors: [1, 2, 3],
    corridorAxis: 'z',
    atrium: { x1: -74, z1: -26, x2: -60, z2: 2 },
    skylightType: 'sawtooth',
    skylightAxis: 'z',
    pvZones: [
      { x1: -80, z1: -32, x2: -54, z2: -28, rows: 1 },
      { x1: -80, z1: 4, x2: -54, z2: 9, rows: 1 },
    ],
  },
  {
    id: 'W4',
    name: '西四楼 · 临湖折线实验连廊',
    groupId: 'grp-w4',
    x1: -82, z1: -56, x2: -34, z2: -34,
    floors: [1, 2, 3],
    corridorAxis: 'x',
    pvZones: [{ x1: -78, z1: -53, x2: -37, z2: -37, rows: 3 }],
  },
  {
    id: 'W5_S',
    name: '西五楼南段 · 多功能阶梯中庭与木平台',
    groupId: 'grp-w4',
    x1: -34, z1: -60, x2: -10, z2: -34,
    floors: [1, 2, 3],
    corridorAxis: 'z',
    hasMultifunctionSteps: true,
    lakesideDeck: { x1: -34, z1: -34, x2: -10, z2: -26.5 },
    atrium: { x1: -28, z1: -56, x2: -16, z2: -44 },
    skylightType: 'sawtooth',
    skylightAxis: 'z',
  },
  {
    id: 'W5_N',
    name: '西五楼北段 · 西主入口波浪木格栅扶梯厅',
    groupId: 'grp-portal',
    x1: -34, z1: -82, x2: 10, z2: -60,
    floors: [1, 2, 3],
    corridorAxis: 'x',
    escalatorHall: { side: 'west', x1: -10, z1: -82, x2: 10, z2: -60 },
    pvZones: [{ x1: -31, z1: -79, x2: -12, z2: -63, rows: 3 }],
  },

  // ================= 东翼 E1-E3（倒 L 型实验楼 + 东南临湖半岛） =================
  {
    id: 'E1',
    name: '东一楼 · 东主入口波浪木格栅扶梯厅',
    groupId: 'grp-portal',
    x1: 42, z1: -82, x2: 86, z2: -60,
    floors: [1, 2, 3],
    corridorAxis: 'x',
    escalatorHall: { side: 'east', x1: 42, z1: -82, x2: 62, z2: -60 },
    pvZones: [{ x1: 64, z1: -79, x2: 83, z2: -63, rows: 3 }],
  },
  {
    id: 'E2',
    name: '东二楼 · 物理实验与天窗中庭楼',
    groupId: 'grp-e2',
    x1: 62, z1: -60, x2: 86, z2: 12,
    floors: [1, 2, 3],
    corridorAxis: 'z',
    atrium: { x1: 68.5, z1: -50, x2: 79.5, z2: -18 },
    skylightType: 'sawtooth',
    skylightAxis: 'z',
    pvZones: [
      { x1: 65, z1: -14, x2: 83, z2: 9, rows: 5 },
    ],
  },
  {
    id: 'E3',
    name: '东三楼 · 临湖半岛展厅/体育馆/阶梯报告厅',
    groupId: 'grp-e3',
    x1: 62, z1: 34, x2: 110, z2: 72,
    floors: [1, 2, 3],
    isPeninsulaHall: true,
    corridorAxis: 'x',
    pvZones: [
      { x1: 66, z1: 37, x2: 106, z2: 43, rows: 2 },
      { x1: 66, z1: 64, x2: 106, z2: 69, rows: 1 },
    ],
  },
];

/**
 * 两大三层通高无围墙开放门廊（中央大入口门廊 32m 宽 + 东侧门洞 22m 跨）
 */
export const PORTAL_CANOPIES = [
  {
    id: 'GrandPortal',
    name: '中央大入口门廊（32m 三层通高）',
    x1: 10, z1: -82, x2: 42, z2: -60,
    overhangX: 0.0,
    overhangZ: 2.8,
    columns: [
      [19.2, -79.2], [19.2, -71.0], [19.2, -62.8],
      [32.8, -79.2], [32.8, -71.0], [32.8, -62.8],
    ],
    slatAxis: 'z',
  },
  {
    id: 'EastPortal',
    name: '东侧三层通高门洞',
    x1: 62, z1: 12, x2: 86, z2: 34,
    overhangX: 2.4,
    overhangZ: 0.0,
    columns: [
      [65.5, 15.2], [65.5, 23.0], [65.5, 30.8],
      [82.5, 15.2], [82.5, 23.0], [82.5, 30.8],
    ],
    slatAxis: 'x',
  },
];

/**
 * 屋顶工业风冷却风罩（LatheGeometry 喇叭口 + ExtrudeGeometry 9叶叶轮 + 铜热管 + 铝鳍片）点位
 */
export const ROOF_COOLING_UNITS = [
  { x: -150, z: 84, rotY: 0 },
  { x: -102, z: 40, rotY: Math.PI / 2 },
  { x: -67, z: -29, rotY: 0 },
  { x: -24, z: -71, rotY: Math.PI / 2 },
  { x: 74, z: -71, rotY: Math.PI / 2 },
  { x: 74, z: 2, rotY: 0 },
  { x: 96, z: 54, rotY: Math.PI / 2 },
];

/**
 * 中心湖泊岸线多边形（顺时针，精准贴合西翼、中央门廊、东翼与东南半岛驳岸，绝不侵入建筑基底）
 */
export const LAKE_SHORELINE_CONTROL = [
  [-168, 97],
  [-184, 107],
  [-174, 121],
  [-148, 105],
  [-116, 99],
  [-86, 117],
  [-58, 145],
  [-20, 157],
  [26, 159],
  [68, 147],
  [100, 120],
  [128, 94],
  [160, 74],
  [169, 44],
  [152, 20],
  [130, 6],
  [124, -24],
  [131, -64],
  [135, -102],
  [125, -124],
  [114, -118],
  [113, -72],
  [112, -18],
  [116, 18],
  [120, 44],
  [118, 79],
  [88, 84],
  [54, 80],
  [54, 34],
  [56, 10],
  [56, -54],
  [44, -56],
  [8, -56],
  [-6, -32],
  [-36, -29],
  [-47, -26],
  [-47, 28],
  [-48, 54],
  [-78, 54],
  [-128, 54],
  [-133, 96],
];

/**
 * 混合精度岸线生成：建筑临湖直岸段保持利落建筑折线，自然公园湖湾段采用平滑样条插值，
 * 彻底消除自然湖岸生硬折角，同时保证建筑边缘严丝合缝
 */
function buildSmoothLakeShoreline() {
  const pts = LAKE_SHORELINE_CONTROL;
  const out = [];
  // 索引 0..24 为自然公园湖湾（采用平滑弧段细分），25..40 为建筑亲水驳岸（保持精准直线微圆角）
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const isOrganic = i < 24;
    const sub = isOrganic ? 4 : 1;
    for (let s = 0; s < sub; s++) {
      if (!isOrganic) {
        out.push([p1[0], p1[1]]);
      } else {
        const t = s / sub;
        const t2 = t * t;
        const t3 = t2 * t;
        // Centripetal-like Catmull-Rom（张力温和，防过冲）
        const x =
          0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const z =
          0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, z]);
      }
    }
  }
  return out;
}

export const LAKE_SHORELINE = buildSmoothLakeShoreline();

export const FLOATING_ISLANDS = [
  { x: -86, z: 88, rx: 10.5, rz: 6.8, rot: 0.35, reedCount: 165 },
  { x: 6, z: 108, rx: 13.0, rz: 8.2, rot: -0.25, reedCount: 210 },
  { x: 141, z: 54, rx: 8.5, rz: 6.2, rot: 0.72, reedCount: 140 },
];

/**
 * 园区安防分组（供 AI 智能安全巡检工作台分组树与视角飞跃使用）
 */
export const SECURITY_GROUPS = [
  {
    id: 'grp-w1',
    name: '西一楼 · 危化与电池实验室',
    zoneType: 'building',
    focus: { pos: [-150, 5.5, 62], viewOffset: [-68, 56, 78] },
  },
  {
    id: 'grp-w2',
    name: '西二楼 · 消防通道与临湖平台',
    zoneType: 'building',
    focus: { pos: [-86, 5.5, 42], viewOffset: [-42, 54, 84] },
  },
  {
    id: 'grp-w3',
    name: '西三楼 · 中央挑空中庭',
    zoneType: 'building',
    focus: { pos: [-67, 8.0, -12], viewOffset: [-58, 62, 74] },
  },
  {
    id: 'grp-w4',
    name: '西四/五楼 · 临湖阶梯连廊',
    zoneType: 'building',
    focus: { pos: [-38, 6.0, -45], viewOffset: [-45, 58, 86] },
  },
  {
    id: 'grp-portal',
    name: '中央大入口门廊与双扶梯厅',
    zoneType: 'building',
    focus: { pos: [26, 7.0, -70], viewOffset: [0, 52, -96] },
  },
  {
    id: 'grp-e2',
    name: '东二楼 · 实验楼中央通廊',
    zoneType: 'building',
    focus: { pos: [74, 8.0, -24], viewOffset: [74, 58, 62] },
  },
  {
    id: 'grp-e3',
    name: '东三楼 · 报告厅与体育馆半岛',
    zoneType: 'building',
    focus: { pos: [86, 7.5, 53], viewOffset: [64, 56, 78] },
  },
  {
    id: 'grp-north-road',
    name: '北迎宾主干道与回转广场',
    zoneType: 'outdoor',
    focus: { pos: [26, 1.5, -116], viewOffset: [-52, 56, -78] },
  },
  {
    id: 'grp-west-parking',
    name: '西侧地面停车场与充电车棚',
    zoneType: 'outdoor',
    focus: { pos: [-118, 2.0, -14], viewOffset: [-72, 58, -62] },
  },
  {
    id: 'grp-east-firelane',
    name: '东侧消防环道与装卸区',
    zoneType: 'outdoor',
    focus: { pos: [98, 2.0, -18], viewOffset: [78, 56, -54] },
  },
  {
    id: 'grp-nvr-room',
    name: '东北核心机房与 NVR 汇聚间',
    zoneType: 'core',
    focus: { pos: [80, 4.0, -72], viewOffset: [68, 48, -66] },
  },
];

/**
 * 模拟大华 NVR 汇聚录像机台账（支撑 setNvrOffline 批量掉线收敛）
 */
export const NVR_DEVICES = [
  {
    id: 'NVR-01',
    name: '大华 NVR-5432-XI · 西翼汇聚节点',
    ip: '10.28.11.101',
    location: '东北核心机房 A01 机柜',
    nodePosition: [78.5, ELEVATIONS.FLOOR_1_Y + 1.6, -74.5],
    floor: '1F',
    status: 'online',
  },
  {
    id: 'NVR-02',
    name: '大华 NVR-5432-XI · 中央门廊与北广场节点',
    ip: '10.28.11.102',
    location: '东北核心机房 A02 机柜',
    nodePosition: [80.8, ELEVATIONS.FLOOR_1_Y + 1.6, -74.5],
    floor: '1F',
    status: 'online',
  },
  {
    id: 'NVR-03',
    name: '大华 NVR-5432-XI · 东翼与周界消防节点',
    ip: '10.28.11.103',
    location: '东北核心机房 A03 机柜',
    nodePosition: [83.1, ELEVATIONS.FLOOR_1_Y + 1.6, -74.5],
    floor: '1F',
    status: 'online',
  },
];

/**
 * 12 路园区关键安防摄像头元数据（3D 枪机/球机精准点位 + 视锥参数 + 所属分组与 NVR）
 * yaw: 弧度，0 表示朝 +Z（南），PI/2 表示朝 +X（东），PI 表示朝 -Z（北），-PI/2 表示朝 -X（西）
 */
export const SECURITY_CAMERAS = [
  {
    id: 'CAM-01',
    name: 'W1 危化/电池实验室禁区球机',
    type: 'dome',
    groupId: 'grp-w1',
    nvrId: 'NVR-01',
    floor: '1F',
    isIndoor: true,
    position: [-150.0, ELEVATIONS.FLOOR_1_Y + 4.1, 78.0],
    yaw: Math.PI * 0.85,
    pitch: -0.45,
    fovDeg: 58,
    range: 19,
    state: 'online',
    viewOffset: [-48, 38, 54],
  },
  {
    id: 'CAM-02',
    name: 'W2 主楼消防疏散通道枪机',
    type: 'bullet',
    groupId: 'grp-w2',
    nvrId: 'NVR-01',
    floor: '1F',
    isIndoor: true,
    position: [-112.0, ELEVATIONS.FLOOR_1_Y + 3.9, 40.0],
    yaw: Math.PI * 0.5,
    pitch: -0.22,
    fovDeg: 46,
    range: 26,
    state: 'online',
    viewOffset: [-34, 34, 52],
  },
  {
    id: 'CAM-03',
    name: 'W3 二层挑空中庭全景球机',
    type: 'dome',
    groupId: 'grp-w3',
    nvrId: 'NVR-01',
    floor: '2F',
    isIndoor: true,
    position: [-67.0, ELEVATIONS.FLOOR_2_Y + 4.2, -12.0],
    yaw: 0.2,
    pitch: -0.52,
    fovDeg: 68,
    range: 22,
    state: 'online',
    viewOffset: [-46, 44, 52],
  },
  {
    id: 'CAM-04',
    name: 'W4 临湖木平台与台阶监控枪机',
    type: 'bullet',
    groupId: 'grp-w4',
    nvrId: 'NVR-02',
    floor: 'outdoor',
    isIndoor: false,
    position: [-34.5, ELEVATIONS.FLOOR_1_Y + 4.4, -33.2],
    yaw: 0.55,
    pitch: -0.34,
    fovDeg: 54,
    range: 24,
    state: 'online',
    viewOffset: [-36, 36, 56],
  },
  {
    id: 'CAM-05',
    name: 'W5 西主入口扶梯大厅球机',
    type: 'dome',
    groupId: 'grp-portal',
    nvrId: 'NVR-02',
    floor: '1F',
    isIndoor: true,
    position: [1.5, ELEVATIONS.FLOOR_1_Y + 4.2, -71.0],
    yaw: -Math.PI * 0.55,
    pitch: -0.38,
    fovDeg: 64,
    range: 20,
    state: 'online',
    viewOffset: [-26, 34, -56],
  },
  {
    id: 'CAM-06',
    name: '中央大入口门廊南北轴线枪机',
    type: 'bullet',
    groupId: 'grp-portal',
    nvrId: 'NVR-02',
    floor: 'outdoor',
    isIndoor: false,
    position: [33.5, ELEVATIONS.FLOOR_1_Y + 5.8, -79.2],
    yaw: -0.25,
    pitch: -0.28,
    fovDeg: 54,
    range: 30,
    state: 'online',
    viewOffset: [22, 34, -64],
  },
  {
    id: 'CAM-07',
    name: 'E2 二层实验室中央走廊球机',
    type: 'dome',
    groupId: 'grp-e2',
    nvrId: 'NVR-03',
    floor: '2F',
    isIndoor: true,
    position: [74.0, ELEVATIONS.FLOOR_2_Y + 4.1, -34.0],
    yaw: 0.0,
    pitch: -0.32,
    fovDeg: 58,
    range: 26,
    state: 'online',
    viewOffset: [52, 42, 42],
  },
  {
    id: 'CAM-08',
    name: 'E3 报告厅与体育馆安全出口球机',
    type: 'dome',
    groupId: 'grp-e3',
    nvrId: 'NVR-03',
    floor: '2F',
    isIndoor: true,
    position: [86.5, ELEVATIONS.FLOOR_2_Y + 4.2, 44.5],
    yaw: 0.15,
    pitch: -0.42,
    fovDeg: 64,
    range: 24,
    state: 'online',
    viewOffset: [46, 42, 54],
  },
  {
    id: 'CAM-09',
    name: '北迎宾主干道违停监测枪机',
    type: 'bullet',
    groupId: 'grp-north-road',
    nvrId: 'NVR-02',
    floor: 'outdoor',
    isIndoor: false,
    position: [13.5, 6.2, -104.0],
    yaw: Math.PI * 0.82,
    pitch: -0.28,
    fovDeg: 50,
    range: 34,
    state: 'online',
    viewOffset: [-42, 38, -58],
  },
  {
    id: 'CAM-10',
    name: '西侧地面停车场及充电车棚枪机',
    type: 'bullet',
    groupId: 'grp-west-parking',
    nvrId: 'NVR-01',
    floor: 'outdoor',
    isIndoor: false,
    position: [-144.0, 6.4, -36.0],
    yaw: 0.72,
    pitch: -0.26,
    fovDeg: 56,
    range: 36,
    state: 'online',
    viewOffset: [-52, 42, -50],
  },
  {
    id: 'CAM-11',
    name: '东侧消防环道与装卸区枪机',
    type: 'bullet',
    groupId: 'grp-east-firelane',
    nvrId: 'NVR-03',
    floor: 'outdoor',
    isIndoor: false,
    position: [103.5, 6.2, -46.0],
    yaw: -0.22,
    pitch: -0.24,
    fovDeg: 52,
    range: 36,
    state: 'online',
    viewOffset: [58, 38, -46],
  },
  {
    id: 'CAM-12',
    name: '东北核心机房/NVR 汇聚间球机',
    type: 'dome',
    groupId: 'grp-nvr-room',
    nvrId: 'NVR-03',
    floor: '1F',
    isIndoor: true,
    position: [80.8, ELEVATIONS.FLOOR_1_Y + 4.1, -69.5],
    yaw: Math.PI,
    pitch: -0.48,
    fovDeg: 62,
    range: 16,
    state: 'online',
    viewOffset: [46, 36, -50],
  },
];

/**
 * 单画布四类安防区域 3D 空间多边形（默认隐藏，通过 CampusTwin API 按需开关与筛选）
 * type: 'restricted' | 'parking' | 'firelane' | 'ignore'
 */
export const SAFETY_ZONES = [
  // 1. 禁止区域（restricted：红色半透明立面围栏）
  {
    id: 'ZONE-R01',
    type: 'restricted',
    name: 'W1 危化品与高压电池实验禁区',
    floor: '1F',
    isIndoor: true,
    groupId: 'grp-w1',
    cameraId: 'CAM-01',
    baseY: ELEVATIONS.FLOOR_1_Y + 0.14,
    height: 3.1,
    polygon: [
      [-158, 69], [-142, 69], [-142, 91], [-158, 91],
    ],
  },
  {
    id: 'ZONE-R02',
    type: 'restricted',
    name: '东北核心机房与 NVR 涉密禁区',
    floor: '1F',
    isIndoor: true,
    groupId: 'grp-nvr-room',
    cameraId: 'CAM-12',
    baseY: ELEVATIONS.FLOOR_1_Y + 0.14,
    height: 3.1,
    polygon: [
      [75, -79], [85, -79], [85, -67], [75, -67],
    ],
  },
  {
    id: 'ZONE-R03',
    type: 'restricted',
    name: 'W4 临湖亲水边界越界禁区',
    floor: 'outdoor',
    isIndoor: false,
    groupId: 'grp-w4',
    cameraId: 'CAM-04',
    baseY: ELEVATIONS.REVETMENT_TOP + 0.08,
    height: 2.2,
    polygon: [
      [-34, -27], [-10, -27], [-10, -22], [-34, -22],
    ],
  },

  // 2. 合规停车区（parking：蓝绿色地框）
  {
    id: 'ZONE-P01',
    type: 'parking',
    name: '西侧地面新能源充电停车区',
    floor: 'outdoor',
    isIndoor: false,
    groupId: 'grp-west-parking',
    cameraId: 'CAM-10',
    baseY: ELEVATIONS.ROAD_TOP + 0.12,
    height: 0.45,
    polygon: [
      [-138, -32], [-102, -32], [-102, 12], [-138, 12],
    ],
  },
  {
    id: 'ZONE-P02',
    type: 'parking',
    name: '东北侧访客地面停车区',
    floor: 'outdoor',
    isIndoor: false,
    groupId: 'grp-east-firelane',
    cameraId: 'CAM-11',
    baseY: ELEVATIONS.ROAD_TOP + 0.12,
    height: 0.45,
    polygon: [
      [74, -126], [105, -126], [105, -104], [74, -104],
    ],
  },

  // 3. 消防通道与安全出口（firelane：琥珀黄警示带）
  {
    id: 'ZONE-F01',
    type: 'firelane',
    name: 'W2 一层主楼消防疏散通道',
    floor: '1F',
    isIndoor: true,
    groupId: 'grp-w2',
    cameraId: 'CAM-02',
    baseY: ELEVATIONS.FLOOR_1_Y + 0.14,
    height: 0.65,
    polygon: [
      [-120, 36.5], [-56, 36.5], [-56, 43.5], [-120, 43.5],
    ],
  },
  {
    id: 'ZONE-F02',
    type: 'firelane',
    name: 'E3 报告厅与体育馆安全出口通道',
    floor: '2F',
    isIndoor: true,
    groupId: 'grp-e3',
    cameraId: 'CAM-08',
    baseY: ELEVATIONS.FLOOR_2_Y + 0.14,
    height: 0.65,
    polygon: [
      [65, 36], [107, 36], [107, 42.5], [65, 42.5],
    ],
  },
  {
    id: 'ZONE-F03',
    type: 'firelane',
    name: '北迎宾主干道消防禁停段',
    floor: 'outdoor',
    isIndoor: false,
    groupId: 'grp-north-road',
    cameraId: 'CAM-09',
    baseY: ELEVATIONS.ROAD_TOP + 0.12,
    height: 0.55,
    polygon: [
      [14, -122], [38, -122], [38, -86], [14, -86],
    ],
  },
  {
    id: 'ZONE-F04',
    type: 'firelane',
    name: '东侧消防环道与装卸通道',
    floor: 'outdoor',
    isIndoor: false,
    groupId: 'grp-east-firelane',
    cameraId: 'CAM-11',
    baseY: ELEVATIONS.ROAD_TOP + 0.12,
    height: 0.55,
    polygon: [
      [90, -56], [104, -56], [104, 18], [90, 18],
    ],
  },

  // 4. 忽略区（ignore：淡灰虚线框）
  {
    id: 'ZONE-I01',
    type: 'ignore',
    name: '中央入口门廊绿化景石忽略区',
    floor: 'outdoor',
    isIndoor: false,
    groupId: 'grp-portal',
    cameraId: 'CAM-06',
    baseY: ELEVATIONS.PLAZA_TOP + 0.12,
    height: 0.35,
    polygon: [
      [18, -114], [34, -114], [34, -100], [18, -100],
    ],
  },
  {
    id: 'ZONE-I02',
    type: 'ignore',
    name: 'W3 挑空中庭绿化景观忽略区',
    floor: '2F',
    isIndoor: true,
    groupId: 'grp-w3',
    cameraId: 'CAM-03',
    baseY: ELEVATIONS.FLOOR_2_Y + 0.14,
    height: 0.35,
    polygon: [
      [-72, -20], [-62, -20], [-62, -6], [-72, -6],
    ],
  },
];

/**
 * 默认 24° 长焦棚拍等轴测主视角
 */
export const DEFAULT_CAMERA_VIEW = {
  position: [-435, 455, 645],
  target: [8, -10, 4],
  fov: 24,
};
