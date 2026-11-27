/**
 * 新增摄像头台账（复用 SurveillanceCamera 组件：立杆硬件 + 点位 + 视锥 + 地面覆盖投影 + 画中画）
 *
 * 新增一路摄像头 = 在此数组追加一条记录（或运行时调用 CampusTwin.addCamera(spec)），无需改动任何 3D 代码。
 * 字段说明：
 * - position: 镜头光心世界坐标（米），X 东正西负，Z 南正北负
 * - groundY:  立杆落地标高（也是视锥地面投影平面）
 * - yaw:      弧度，0 朝 +Z（南），PI/2 朝 +X（东），PI 朝 -Z（北），-PI/2 朝 -X（西）
 * - pitch:    弧度，负值为俯视
 * - fovDeg:   水平视场角；aspect 默认 16:9；range 为视锥可视距离（米）
 * - mount:    'pole' | 'wall' | 'ceiling' | 'none'
 */
export const EXTRA_SURVEILLANCE_CAMERAS = [
  {
    id: 'CAM-13',
    name: '北大门主出入口车牌抓拍枪机',
    type: 'bullet',
    groupId: 'grp-north-road',
    nvrId: 'NVR-02',
    floor: 'outdoor',
    isIndoor: false,
    position: [35.5, 6.4, -121.0],
    groundY: 0.09,
    yaw: -2.86,
    pitch: -0.3,
    fovDeg: 58,
    range: 36,
    mount: 'pole',
    state: 'online',
    viewOffset: [42, 34, 38],
  },
  {
    id: 'CAM-14',
    name: '东湖观景亭与亲水栈桥枪机',
    type: 'bullet',
    groupId: 'grp-e3',
    nvrId: 'NVR-03',
    floor: 'outdoor',
    isIndoor: false,
    position: [166.0, 6.2, 2.0],
    groundY: 0.0,
    yaw: -1.82,
    pitch: -0.24,
    fovDeg: 72,
    range: 44,
    mount: 'pole',
    state: 'online',
    viewOffset: [52, 36, 44],
  },
  {
    id: 'CAM-15',
    name: '西南湖滨步道与亲水平台球机',
    type: 'dome',
    groupId: 'grp-w1',
    nvrId: 'NVR-01',
    floor: 'outdoor',
    isIndoor: false,
    position: [-100.0, 5.6, 122.0],
    groundY: 0.0,
    yaw: -2.05,
    pitch: -0.24,
    fovDeg: 80,
    range: 40,
    mount: 'pole',
    state: 'online',
    viewOffset: [38, 36, 52],
  },
  {
    id: 'CAM-16',
    name: '西门周界入口卡口枪机',
    type: 'bullet',
    groupId: 'grp-west-parking',
    nvrId: 'NVR-01',
    floor: 'outdoor',
    isIndoor: false,
    position: [-190.0, 6.2, -86.0],
    groundY: 0.0,
    yaw: -0.96,
    pitch: -0.3,
    fovDeg: 60,
    range: 34,
    mount: 'pole',
    state: 'online',
    viewOffset: [44, 36, -40],
  },
];
