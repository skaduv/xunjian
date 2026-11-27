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
└── security/                 # 实例化安防摄像头、视锥、安全防区与楼栋选中高亮图层（HighlightLayer）
```
