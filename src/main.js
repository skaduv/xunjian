import * as THREE from 'three';
import { StudioScene } from './core/StudioScene.js';
import { batchStaticMeshes } from './core/MeshBatcher.js';
import { buildHardwarePlinth } from './plinth/HardwarePlinth.js';
import { buildArchitecture } from './architecture/ArchitectureBuilder.js';
import { buildTerrainAndStructures } from './landscape/TerrainAndStructures.js';
import { buildLakeSystem } from './landscape/LakeSystem.js';
import { buildRoadsAndParking } from './landscape/RoadAndParking.js';
import { buildVehicleTrafficSystem } from './landscape/VehicleTrafficSystem.js';
import { buildVegetationSystem } from './landscape/VegetationSystem.js';
import { buildCameraAndFovLayers } from './security/CameraLayer.js';
import { buildSafetyZonesLayer } from './security/SafetyZonesLayer.js';
import { buildHighlightLayer } from './security/HighlightLayer.js';
import { createCampusTwinAPI } from './api/CampusTwinAPI.js';
import { applyOuterMist } from './core/OuterMist.js';

/**
 * 长三角物理研究中心（IOPLY）3D 数字孪生底座主入口
 * 具备完整生命周期清理与自适应节能渲染（静止低负载、切后台暂停、交互丝滑 60FPS，严防 WebGL 上下文叠加泄漏）
 */
function bootstrap() {
  // 热更新或重载前强制销毁上一实例的 RAF 循环与 WebGL 上下文，杜绝多实例叠加爆显存
  if (typeof window.__campusTwinCleanup === 'function') {
    window.__campusTwinCleanup();
  }

  const container = document.getElementById('scene-root');
  if (!container) {
    throw new Error('#scene-root container not found');
  }

  // 1. 初始化轻量化无雾高反差棚拍渲染底座（Early-Z 开启 + 2048 按需软阴影 + DPR <= 1.5）
  const studio = new StudioScene(container);
  const aniso = studio.maxAnisotropy;

  // 2. 双阶圆角倒角哑光陶瓷白硬件底座
  const plinth = buildHardwarePlinth();
  studio.scene.add(plinth.group);

  // 3. 五层可拆解主体建筑（1F / 2F / 3F / 屋顶 / 悬浮采光顶，保留索引合批）
  const architecture = buildArchitecture(aniso);
  studio.scene.add(architecture.root);

  // 4. 园区景观、平滑样条湖泊、无缝道路停车场、CNC 微地形与写实植物体系
  const landscapeRoot = new THREE.Group();
  landscapeRoot.name = 'LandscapeRoot';

  const terrain = buildTerrainAndStructures(aniso);
  const lake = buildLakeSystem(aniso);
  const roadsAndParking = buildRoadsAndParking(aniso);
  const vehicleTraffic = buildVehicleTrafficSystem(aniso);
  const vegetation = buildVegetationSystem();

  batchStaticMeshes(terrain.group);
  batchStaticMeshes(roadsAndParking.group);
  batchStaticMeshes(lake.group);
  batchStaticMeshes(plinth.group);

  // 外域树木/车辆与外围地形同步溶入云雾，杜绝云海里的灰色幽灵树
  applyOuterMist(vegetation);
  applyOuterMist(vehicleTraffic.group);

  landscapeRoot.add(terrain.group, lake.group, roadsAndParking.group, vehicleTraffic.group, vegetation);
  studio.scene.add(landscapeRoot);

  // 5. 预埋安防业务 3D 图层（12 路 3D 摄像头 + 视锥投影体 + 四类安全防区）
  const cameraLayer = buildCameraAndFovLayers();
  const safetyZonesLayer = buildSafetyZonesLayer(aniso);
  const highlightLayer = buildHighlightLayer();
  studio.scene.add(cameraLayer.camerasGroup, cameraLayer.fovGroup, safetyZonesLayer.group, highlightLayer.group);

  // 6. 注册昼夜模式联动回调（覆盖建筑室内外灯光、全园区路灯与羽化光池、动态车辆大灯/光束、湖滨地标与底座辉光）
  studio.onLightingChange((duskFactor, nightFactor) => {
    architecture.setDuskFactor(duskFactor, nightFactor);
    terrain.setDuskFactor(duskFactor, nightFactor);
    roadsAndParking.setDuskFactor(duskFactor, nightFactor);
    vehicleTraffic.setNightFactor(duskFactor);
  });

  // 7. 暴露统一外部控制接口 window.CampusTwin
  const api = createCampusTwinAPI({
    studio,
    architecture,
    landscapeRoot,
    cameraLayer,
    safetyZonesLayer,
    highlightLayer,
  });

  // 支持 URL 参数 ?mode=night / ?mode=dusk 直达夜景/暮光（默认保持白模日间 'day'）
  const initialMode = new URLSearchParams(window.location.search).get('mode');
  if (initialMode === 'night' || initialMode === 'dusk') {
    api.setLightingMode(initialMode, { immediate: true });
  }

  // 键盘快捷键 N：丝滑 Lerp 切换白模日间 / 星夜模式
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
    if (e.key === 'n' || e.key === 'N') {
      api.setLightingMode(studio.lightingMode === 'night' ? 'day' : 'night');
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // 首次完整构建后渲染一次静态阴影贴图
  studio.markShadowsDirty();

  // 8. 自适应节能渲染循环：
  // - 后台标签页：完全暂停渲染（0% GPU）
  // - 交互/飞跃/爆炸/昼夜切换：锁帧 60FPS（避免 144Hz/165Hz 显示器无意义空烧显卡）
  // - 静止观看：锁帧 30FPS 丝滑驱动全路网动态车流、微澜水面与屋顶冷却叶轮，相比高刷屏仍大幅节能
  let rafId = 0;
  let disposed = false;
  let lastExplodeFactor = -1;
  let lastRenderMs = 0;
  let elapsed = 0;

  const ACTIVE_INTERVAL = 1000 / 60;
  const IDLE_INTERVAL = 1000 / 30;

  function animate(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(animate);

    if (document.hidden) return;

    const interactive =
      studio.isInteractiveActive() ||
      Math.abs((architecture.isExploded() ? 1 : 0) - architecture.getExplodeFactor()) > 0.001;
    const minInterval = interactive
      ? ACTIVE_INTERVAL
      : cameraLayer.hasActiveAlarms() || highlightLayer.hasActive()
        ? 1000 / 30
        : IDLE_INTERVAL;

    if (lastRenderMs > 0 && now - lastRenderMs < minInterval - 1) {
      return;
    }

    const dt = lastRenderMs > 0 ? Math.min((now - lastRenderMs) / 1000, 0.1) : 0.016;
    lastRenderMs = now;
    elapsed += dt;

    studio.update(dt);

    const explodeFactor = architecture.update(dt);
    if (Math.abs(explodeFactor - lastExplodeFactor) > 0.0001) {
      cameraLayer.syncExplosion(explodeFactor);
      safetyZonesLayer.syncExplosion(explodeFactor);
      highlightLayer.syncExplosion(explodeFactor);
      studio.markShadowsDirty();
      lastExplodeFactor = explodeFactor;
    }

    lake.update(dt, studio.duskFactor, studio.nightFactor);
    plinth.update(elapsed, studio.duskFactor, studio.nightFactor);
    vehicleTraffic.update(dt, studio.duskFactor);
    cameraLayer.update(elapsed);
    highlightLayer.update(elapsed);

    studio.render();
  }

  rafId = requestAnimationFrame(animate);

  const onVisChange = () => {
    if (!document.hidden) {
      lastRenderMs = 0;
      studio.wake(500);
    }
  };
  document.addEventListener('visibilitychange', onVisChange);

  const cleanup = () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVisChange);
    window.removeEventListener('keydown', onKeyDown);
    studio.dispose();
  };

  window.__campusTwinCleanup = cleanup;
  if (import.meta.env.DEV) window.__campusDebug = { studio, architecture, landscapeRoot, highlightLayer, THREE };
  if (import.meta.hot) {
    import.meta.hot.dispose(cleanup);
  }
}

bootstrap();
