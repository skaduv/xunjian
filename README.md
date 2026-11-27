# 长三角物理研究中心（IOPLY）3D 数字孪生底座

基于 **Three.js + Vite** 构建的纯程序化 3D 园区数字孪生底座，还原长三角物理研究中心（溧阳中关村大道 1 号，KKAA + UAD）建筑群、中心湖泊、周边市政路网、动态车流、外域无边界云雾渐隐与昼/暮/夜三态光照系统。

## 快速开始

```bash
npm install
npm run dev
```

生产构建与本地预览：

```bash
npm run build
npm run preview
```

## 交互说明

- **左键拖拽**：旋转视角
- **右键拖拽**：平移视角
- **滚轮**：缩放视角
- **快捷键 `N`**：平滑切换日间 / 星夜模式（亦支持 URL 参数 `?mode=night` / `?mode=dusk`）
- **外部控制接口**：页面挂载 `window.CampusTwin`，支持视角飞跃、楼层爆炸透视（`setExploded`）、图层显隐、安防点位状态及性能统计查询（`getPerfStats`）
- **楼栋选中高亮**：`CampusTwin.highlightGroup('grp-w2', { fly: true })` 屋面发光描边 + 定位气泡；`highlightGroup(null)` 取消；`getScreenPosition('grp-w2')` 返回气泡屏幕坐标，供仪表盘信息卡跟随

## 安全巡检工作台（HUD）

磨砂玻璃控制面板基于唯一组件库 **Shoelace**（Web Components，与原生 JS 无缝集成），只通过 `window.CampusTwin` 驱动三维场景。视觉规范：中性石墨玻璃（backdrop 去饱和，避免透出场景绿色）+ 电光蓝强调色，语义色只表达设备状态；顶部「总览 / 监控 / 巡航 / 楼层」切换右侧上下文面板。

- **摄像头点位**：16 路（存量 12 路 + 新增 4 路：北大门出入口、东湖观景亭与栈桥、西南湖滨步道、西门周界卡口）。点击三维点位或左侧列表即可选中，显示视锥、地面覆盖区，并在详情卡内实时渲染该摄像头画面（画中画）。
- **无人机环绕**：底部卡片一键开始/停止，可调一圈用时与飞行高度；环绕期间切换为 46° 广角航拍镜头，拖拽画面即自动退出。
- **楼层分层**：整楼 / 1F / 2F / 3F / 屋顶 剖切查看（隐藏上部楼层并联动隐藏该层摄像头、防区），可叠加「拆层展开」，各层带浮标。
- **图层**：摄像头点位、全部视锥、安全防区开关；右侧缩放 / 复位 / 昼夜 / 全屏。
- 天气与告警趋势为演示数据（`src/hud/Hud.js` 顶部 `DEMO_*`），接入业务后替换。

### 新增摄像头（复用组件）

在 `src/config/surveillanceCameras.js` 追加一条记录，或运行时调用：

```js
CampusTwin.addCamera({
  id: 'CAM-17', name: '东北访客停车场枪机', type: 'bullet',
  floor: 'outdoor', isIndoor: false,
  position: [112, 6.2, -112], groundY: 0,   // 镜头光心 / 立杆落地标高（米）
  yaw: -1.95, pitch: -0.3,                  // yaw 0 朝南、PI/2 朝东；pitch 负值俯视
  fovDeg: 60, range: 34, mount: 'pole',     // 'pole' | 'wall' | 'ceiling' | 'none'
});
```

组件（`src/security/SurveillanceCamera.js`）自带：立杆/壁挂/吊顶硬件 + 枪机/球机、屏幕恒定尺寸点位图钉与引线、渐变扫描视锥、地面覆盖投影、告警脉冲环、画中画取景相机。`SurveillanceSystem.js` 负责编排（选中、视锥模式、爆炸分层、楼层剖切、拾取）。

### 新增 API

| 方法 | 说明 |
| --- | --- |
| `listCameras()` / `addCamera(spec)` / `removeCamera(id)` | 摄像头增删查（存量 12 路不可删除） |
| `selectCamera(id \| null, { fly })` | 选中摄像头：点位高亮 + 视锥 + 覆盖区 + 画中画 |
| `setFovMode('selected' \| 'all' \| 'none')` / `setMarkersVisible(bool)` | 视锥 / 点位显示 |
| `startDroneOrbit({ periodSec, height, radius, fov })` / `stopDroneOrbit()` / `setDroneOrbitParams()` / `isDroneOrbiting()` | 无人机环绕 |
| `setFloorView('all' \| '1F' \| '2F' \| '3F' \| 'roof', { fly })` / `getFloorView()` / `getFloorAnchors()` | 分层剖切 |
| `zoomBy(factor)` / `getViewHeading()` | 推拉镜头 / 机位方位角 |
| `on(type, cb)` | 事件：`select` `state` `orbit` `floor` `explode` `fovMode` `add` `remove` |

## 目录结构

```text
src/
├── main.js                   # 入口与自适应节能渲染循环
├── api/CampusTwinAPI.js      # window.CampusTwin 对外控制接口
├── config/campusConfig.js    # 园区坐标、标高、楼栋、安防与视角配置
├── core/                     # 渲染底座、程序化贴图、静态合批、共享高程场（TerrainField）与外域云雾遮蔽（OuterMist）
├── architecture/             # 建筑五层结构、立面木格栅、扶梯中庭与屋顶细节
├── landscape/                # 湖泊、地形桥亭、道路停车场、动态交通与两级 LOD 植被
├── plinth/                   # 无边界外域地形与流动体积云海着色器
├── security/                 # 存量安防摄像头合批模型、可复用摄像头组件（SurveillanceCamera / SurveillanceSystem）、安全防区与楼栋高亮
└── hud/                      # Shoelace 磨砂玻璃控制面板（Hud.js / hud.css / icons.js）
```
