import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_CAMERA_VIEW } from '../config/campusConfig.js';
import { createStudioBackdropTexture } from './ProceduralTextures.js';

/**
 * 无界航拍生态光影 WebGL 渲染底座（丰润健康翡翠自然光 + 无缝云雾远景 + 昼/暮/夜三态平滑切换）
 * 核心渲染与 GPU 保护策略：
 * 1. 关闭 logarithmicDepthBuffer，配合精准 near=8 / far=2800 恢复硬件 Early-Z / Hi-Z 剔除且保持亚毫米零闪烁
 * 2. pixelRatio 智能限幅 <= 1.5（叠加 MSAA 抗锯齿）
 * 3. 按需更新阴影贴图（shadowMap.autoUpdate = false）+ 2048 柔化 PCFShadowMap，交互旋转 0 次阴影重绘
 * 4. 约 4.5:1 低仰角斜射暖阳主辅光比 + 深翡翠林地反射半球光 + 三套（白昼航拍天光/暮光/星夜）定制 PMREM 环境贴图
 * 5. 动态镜头自适应远景大气雾（保持核心园区 100% 通透清晰，远端绿野与云海自然溶入地平线）
 * 6. 暴露完整 dispose() 回收所有 GPU 几何体、贴图、PMREM 帧缓冲与 WebGL 上下文
 */

export class StudioScene {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    // 清理可能残留的旧 Canvas
    container.innerHTML = '';

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#dde5e0', 1220, 2150);

    this.dayBackdrop = createStudioBackdropTexture('day');
    this.duskBackdrop = createStudioBackdropTexture('dusk');
    this.nightBackdrop = createStudioBackdropTexture('night');
    this.scene.background = this.dayBackdrop;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'default',
      logarithmicDepthBuffer: false,
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 4);

    // 24° 长焦等轴测主镜头，near=8 / far=2800 完整覆盖 2km 无界外围绿野与云雾地平线
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_VIEW.fov,
      this.width / this.height,
      8.0,
      2800
    );
    this.camera.position.set(...DEFAULT_CAMERA_VIEW.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...DEFAULT_CAMERA_VIEW.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.72;
    this.controls.panSpeed = 0.85;
    this.controls.zoomSpeed = 0.95;
    this.controls.minDistance = 42;
    this.controls.maxDistance = 1550;
    this.controls.maxPolarAngle = Math.PI * 0.465;
    this.controls.minPolarAngle = 0.08;
    this.controls.update();

    this._buildHighContrastStudioEnv();
    this._buildLightingRig();
    this._syncFogRange();

    this.lightingMode = 'day';
    this.duskFactor = 0;
    this.nightFactor = 0;
    this.lightMix = { dusk: 0, night: 0 };
    this.targetMix = { dusk: 0, night: 0 };
    this.duskListeners = [];
    this.cameraAnim = null;
    this._tmpProj = new THREE.Vector3();
    this._lastCamPos = this.camera.position.clone();
    this._lastTarget = this.controls.target.clone();
    this.activeUntil = performance.now() + 1800;

    this.controls.addEventListener('start', () => {
      this.cameraAnim = null;
      this.wake(1200);
    });
    this.controls.addEventListener('change', () => {
      this.wake(450);
    });

    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  wake(durationMs = 800) {
    this.activeUntil = Math.max(this.activeUntil, performance.now() + durationMs);
  }

  isInteractiveActive() {
    if (this.cameraAnim) return true;
    if (
      Math.abs(this.targetMix.dusk - this.lightMix.dusk) > 0.0005 ||
      Math.abs(this.targetMix.night - this.lightMix.night) > 0.0005
    ) {
      return true;
    }
    return performance.now() < this.activeUntil;
  }

  markShadowsDirty() {
    this.renderer.shadowMap.needsUpdate = true;
    this.wake(500);
  }

  _buildHighContrastStudioEnv() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    const roomGeo = new THREE.BoxGeometry(120, 80, 120);
    const floorGeo = new THREE.PlaneGeometry(118, 118);
    const disposables = [roomGeo, floorGeo];

    const addSoftboxes = (targetScene, boxes) => {
      boxes.forEach((box) => {
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(box.color).multiplyScalar(box.intensity),
          side: THREE.DoubleSide,
        });
        const geo = new THREE.PlaneGeometry(box.size[0], box.size[1]);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(...box.pos);
        mesh.rotation.set(...box.rot);
        targetScene.add(mesh);
        disposables.push(geo, mat);
      });
    };

    // 1. 白昼航拍生态天光环境贴图（深翠林地吸光底面 + 清透云雾天穹 + 斜射暖金日光高光带，赋予水面/玻璃真实航拍天光倒影）
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#6f8984');

    const roomMat = new THREE.MeshBasicMaterial({
      color: '#768f8b',
      side: THREE.BackSide,
    });
    envScene.add(new THREE.Mesh(roomGeo, roomMat));
    disposables.push(roomMat);

    // 深翡翠森林吸光底板（为树冠底面、建筑挑檐与玻璃下部注入浓郁生态暗绿环境反射，彻底告别发白发灰）
    const darkFloorMat = new THREE.MeshBasicMaterial({
      color: '#172d1a',
      side: THREE.DoubleSide,
    });
    const darkFloor = new THREE.Mesh(floorGeo, darkFloorMat);
    darkFloor.rotation.x = -Math.PI / 2;
    darkFloor.position.y = -39.4;
    envScene.add(darkFloor);
    disposables.push(darkFloorMat);

    // 明亮云雾天穹顶面（赋予湖泊与幕墙通透清亮的蓝白航拍天光镜面光泽）
    const ceilMat = new THREE.MeshBasicMaterial({
      color: '#c8dcdc',
      side: THREE.DoubleSide,
    });
    const ceilPlane = new THREE.Mesh(floorGeo, ceilMat);
    ceilPlane.rotation.x = Math.PI / 2;
    ceilPlane.position.y = 39.4;
    envScene.add(ceilPlane);
    disposables.push(ceilMat);

    addSoftboxes(envScene, [
      // 斜射暖金航拍主太阳高光带（对齐低仰角日光方向，点亮草坪叶绿素与树冠向阳面）
      { pos: [-34, 30, 22], rot: [Math.PI / 2.6, 0.32, 0.2], size: [52, 16], color: '#fff4dc', intensity: 3.05 },
      // 顶部晴空薄云天顶反射面（为湖水与玻璃屋面提供自然柔亮天空高光）
      { pos: [4, 36, -6], rot: [Math.PI / 2, 0, 0], size: [64, 24], color: '#eaf5f6', intensity: 1.95 },
      // 东北侧清透蔚蓝天光补光反射条（在阴影暗面注入高级冷调深度）
      { pos: [48, 22, -24], rot: [0, -Math.PI / 2, 0], size: [52, 12], color: '#b4daf2', intensity: 1.55 },
      // 远景云雾地平线微亮勾边
      { pos: [10, 14, -48], rot: [0.18, 0, 0], size: [60, 10], color: '#e4eeea', intensity: 1.45 },
      // 极轻柔湖畔翠青水光反射
      { pos: [0, -18, 44], rot: [-0.22, 0, 0], size: [44, 5], color: '#3a7a6a', intensity: 0.42 },
    ]);

    const rt = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = rt.texture;
    if ('environmentIntensity' in this.scene) {
      this.scene.environmentIntensity = 0.44;
    }
    this.envRenderTarget = rt;

    // 2. 暮光黄金时刻环境贴图（深靛蓝穹顶 + 暖琥珀夕照地平线 + 冰青建筑边缘反光）
    const duskEnvScene = new THREE.Scene();
    duskEnvScene.background = new THREE.Color('#101928');
    const duskRoomMat = new THREE.MeshBasicMaterial({
      color: '#121c2c',
      side: THREE.BackSide,
    });
    duskEnvScene.add(new THREE.Mesh(roomGeo, duskRoomMat));
    disposables.push(duskRoomMat);

    addSoftboxes(duskEnvScene, [
      { pos: [-18, 35, 16], rot: [Math.PI / 2, 0, 0.2], size: [54, 14], color: '#6b9ce0', intensity: 1.65 },
      { pos: [-48, 13, 24], rot: [0, Math.PI / 2, 0], size: [54, 8], color: '#ff9b5a', intensity: 2.05 },
      { pos: [48, 14, -18], rot: [0, -Math.PI / 2, 0], size: [48, 7], color: '#4784d4', intensity: 1.35 },
      { pos: [12, 12, -48], rot: [0.18, 0, 0], size: [56, 6], color: '#4cd2ef', intensity: 1.15 },
    ]);
    this.duskEnvRenderTarget = pmrem.fromScene(duskEnvScene, 0.04);

    // 3. 专属星夜环境贴图（深蓝黑天穹 + 银蓝月光柔箱 + 低位暖金地平线反光，让夜湖与幕墙折射真实夜景高光）
    const nightEnvScene = new THREE.Scene();
    nightEnvScene.background = new THREE.Color('#040812');
    const nightRoomMat = new THREE.MeshBasicMaterial({
      color: '#050b18',
      side: THREE.BackSide,
    });
    nightEnvScene.add(new THREE.Mesh(roomGeo, nightRoomMat));
    disposables.push(nightRoomMat);

    addSoftboxes(nightEnvScene, [
      { pos: [-22, 36, 20], rot: [Math.PI / 2, 0, 0.2], size: [54, 14], color: '#8ab8ff', intensity: 2.1 },
      { pos: [44, 14, 24], rot: [0, -Math.PI / 2, 0], size: [52, 6], color: '#ffbe6b', intensity: 1.55 },
      { pos: [-44, 12, -20], rot: [0, Math.PI / 2, 0], size: [48, 6], color: '#ffba66', intensity: 1.35 },
      { pos: [8, 10, -48], rot: [0.15, 0, 0], size: [58, 5], color: '#58d4ff', intensity: 1.2 },
      { pos: [0, 12, 48], rot: [-0.15, 0, 0], size: [58, 5], color: '#ffca7a', intensity: 1.25 },
    ]);
    this.nightEnvRenderTarget = pmrem.fromScene(nightEnvScene, 0.04);

    pmrem.dispose();
    disposables.forEach((d) => d.dispose());
  }

  _buildLightingRig() {
    // 清透晴空天光 + 更深沉的森林暗绿反射半球光：强对比航拍质感，适配深色磨砂玻璃仪表盘美学
    this.hemiLight = new THREE.HemisphereLight('#d4e9ff', '#152e18', 0.42);
    this.scene.add(this.hemiLight);

    // 低仰角斜射暖金航拍日光 + 紧包围 2048×2048 柔化按需刷新阴影（约 5.5:1 戏剧航拍光影反差，雕塑感树影与浓郁叶绿素高光）
    this.sunLight = new THREE.DirectionalLight('#fff0d4', 2.65);
    this.sunLight.position.set(-265, 205, 165);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.radius = 2.4;
    this.sunLight.shadow.camera.near = 40;
    this.sunLight.shadow.camera.far = 980;
    this.sunLight.shadow.camera.left = -310;
    this.sunLight.shadow.camera.right = 310;
    this.sunLight.shadow.camera.top = 255;
    this.sunLight.shadow.camera.bottom = -255;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.045;
    this.scene.add(this.sunLight);

    // 东北侧冷蓝晴空辅助补光（克制补光，留足深林暗部反差）
    this.fillLight = new THREE.DirectionalLight('#96bfe0', 0.21);
    this.fillLight.position.set(245, 135, -185);
    this.scene.add(this.fillLight);

    // 柔和叶绿素轮廓背光（轻提树冠向光轮廓与建筑倒角立体感）
    this.rimLight = new THREE.DirectionalLight('#dff2e6', 0.20);
    this.rimLight.position.set(145, 95, 240);
    this.scene.add(this.rimLight);

    this.dayLighting = {
      hemiSky: new THREE.Color('#d4e9ff'),
      hemiGround: new THREE.Color('#152e18'),
      hemiIntensity: 0.42,
      sunColor: new THREE.Color('#fff0d4'),
      sunIntensity: 2.65,
      sunPos: new THREE.Vector3(-265, 205, 165),
      fillColor: new THREE.Color('#96bfe0'),
      fillIntensity: 0.21,
      rimColor: new THREE.Color('#dff2e6'),
      rimIntensity: 0.20,
      exposure: 0.96,
      envIntensity: 0.44,
      fogColor: new THREE.Color('#dde5e0'),
      fogNear: 1220,
      fogFar: 2150,
    };

    this.duskLighting = {
      hemiSky: new THREE.Color('#2a4672'),
      hemiGround: new THREE.Color('#111c18'),
      hemiIntensity: 0.34,
      sunColor: new THREE.Color('#ff9e5e'),
      sunIntensity: 0.86,
      sunPos: new THREE.Vector3(-268, 86, 138),
      fillColor: new THREE.Color('#3d72be'),
      fillIntensity: 0.38,
      rimColor: new THREE.Color('#52d6f0'),
      rimIntensity: 0.48,
      exposure: 1.02,
      envIntensity: 0.42,
      fogColor: new THREE.Color('#1b283a'),
      fogNear: 1240,
      fogFar: 2200,
    };

    // 深邃午夜月光灯光组（冷银蓝月光勾勒雕塑体块，让暖金灯海、湖面倒影与深空星夜形成极致反差）
    this.nightLighting = {
      hemiSky: new THREE.Color('#142544'),
      hemiGround: new THREE.Color('#060c12'),
      hemiIntensity: 0.25,
      sunColor: new THREE.Color('#8ab6f8'),
      sunIntensity: 0.46,
      sunPos: new THREE.Vector3(-210, 222, 165),
      fillColor: new THREE.Color('#1d3866'),
      fillIntensity: 0.22,
      rimColor: new THREE.Color('#46c8ff'),
      rimIntensity: 0.34,
      exposure: 1.08,
      envIntensity: 0.38,
      fogColor: new THREE.Color('#070f1d'),
      fogNear: 1260,
      fogFar: 2250,
    };

    this._baseFogNear = this.dayLighting.fogNear;
    this._baseFogFar = this.dayLighting.fogFar;
  }

  _syncFogRange() {
    if (!this.scene.fog) return;
    const camDist = this.camera.position.distanceTo(this.controls.target);
    const span = Math.max(820, (this._baseFogFar ?? 2150) - (this._baseFogNear ?? 1220));
    const near = Math.max(920, camDist + 300);
    this.scene.fog.near = near;
    this.scene.fog.far = near + span;
  }

  onDuskChange(cb) {
    this.duskListeners.push(cb);
  }

  onLightingChange(cb) {
    this.duskListeners.push(cb);
  }

  setLightingMode(mode, { immediate = false } = {}) {
    const normalized = mode === 'night' ? 'night' : mode === 'dusk' ? 'dusk' : 'day';
    this.lightingMode = normalized;
    this.targetMix.dusk = normalized === 'dusk' ? 1 : 0;
    this.targetMix.night = normalized === 'night' ? 1 : 0;

    document.body.classList.toggle('mode-dusk', normalized === 'dusk');
    document.body.classList.toggle('mode-night', normalized === 'night');

    this.scene.background =
      normalized === 'night'
        ? this.nightBackdrop
        : normalized === 'dusk'
          ? this.duskBackdrop
          : this.dayBackdrop;

    this.scene.environment =
      normalized === 'night' && this.nightEnvRenderTarget
        ? this.nightEnvRenderTarget.texture
        : normalized === 'dusk' && this.duskEnvRenderTarget
          ? this.duskEnvRenderTarget.texture
          : this.envRenderTarget.texture;

    if (immediate) {
      this.lightMix.dusk = this.targetMix.dusk;
      this.lightMix.night = this.targetMix.night;
      this.duskFactor = Math.min(1, this.lightMix.dusk * 0.68 + this.lightMix.night);
      this.nightFactor = this.lightMix.night;
      this._applyLightingBlend(this.lightMix.dusk, this.lightMix.night);
      for (const cb of this.duskListeners) cb(this.duskFactor, this.nightFactor);
    }

    this.markShadowsDirty();
    this.wake(1600);
  }

  flyTo(targetPos, targetLookAt, durationMs = 900) {
    this.cameraAnim = {
      startTime: performance.now(),
      duration: Math.max(150, durationMs),
      fromPos: this.camera.position.clone(),
      toPos: targetPos.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: targetLookAt.clone(),
    };
    this.wake(durationMs + 400);
  }

  resetView(durationMs = 900) {
    this.flyTo(
      new THREE.Vector3(...DEFAULT_CAMERA_VIEW.position),
      new THREE.Vector3(...DEFAULT_CAMERA_VIEW.target),
      durationMs
    );
  }

  projectToScreen(worldPos) {
    const v = this._tmpProj.copy(worldPos).project(this.camera);
    const visible = v.z >= -1 && v.z <= 1 && v.x >= -1.05 && v.x <= 1.05 && v.y >= -1.05 && v.y <= 1.05;
    return {
      x: Math.round(((v.x + 1) * 0.5) * this.width * 100) / 100,
      y: Math.round(((-v.y + 1) * 0.5) * this.height * 100) / 100,
      visible,
      ndcZ: Number(v.z.toFixed(5)),
    };
  }

  getPerfStats() {
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  update(dt) {
    if (this.cameraAnim) {
      const elapsed = performance.now() - this.cameraAnim.startTime;
      const rawT = Math.min(1, elapsed / this.cameraAnim.duration);
      const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
      this.camera.position.lerpVectors(this.cameraAnim.fromPos, this.cameraAnim.toPos, t);
      this.controls.target.lerpVectors(this.cameraAnim.fromTarget, this.cameraAnim.toTarget, t);
      if (rawT >= 1) this.cameraAnim = null;
    }

    this.controls.update();
    this._syncFogRange();

    // 检测阻尼惯性是否仍在滑动，滑停后自动进入低功耗节能态
    if (
      this.camera.position.distanceToSquared(this._lastCamPos) > 1e-4 ||
      this.controls.target.distanceToSquared(this._lastTarget) > 1e-4
    ) {
      this._lastCamPos.copy(this.camera.position);
      this._lastTarget.copy(this.controls.target);
      this.wake(280);
    }

    const diffDusk = this.targetMix.dusk - this.lightMix.dusk;
    const diffNight = this.targetMix.night - this.lightMix.night;
    if (Math.abs(diffDusk) > 0.0005 || Math.abs(diffNight) > 0.0005) {
      const step = Math.min(1, dt * 4.5);
      this.lightMix.dusk += diffDusk * step;
      this.lightMix.night += diffNight * step;
      if (Math.abs(this.targetMix.dusk - this.lightMix.dusk) < 0.001) {
        this.lightMix.dusk = this.targetMix.dusk;
      }
      if (Math.abs(this.targetMix.night - this.lightMix.night) < 0.001) {
        this.lightMix.night = this.targetMix.night;
      }
      this.duskFactor = Math.min(1, this.lightMix.dusk * 0.68 + this.lightMix.night);
      this.nightFactor = this.lightMix.night;
      this._applyLightingBlend(this.lightMix.dusk, this.lightMix.night);
      this.markShadowsDirty();
      for (const cb of this.duskListeners) cb(this.duskFactor, this.nightFactor);
    }
  }

  _applyLightingBlend(wDusk, wNight) {
    const wDay = Math.max(0, 1 - wDusk - wNight);
    const D = this.dayLighting;
    const K = this.duskLighting;
    const N = this.nightLighting;

    const blendColor = (out, cD, cK, cN) => {
      out.setRGB(
        cD.r * wDay + cK.r * wDusk + cN.r * wNight,
        cD.g * wDay + cK.g * wDusk + cN.g * wNight,
        cD.b * wDay + cK.b * wDusk + cN.b * wNight
      );
    };
    const blendScalar = (vD, vK, vN) => vD * wDay + vK * wDusk + vN * wNight;

    blendColor(this.hemiLight.color, D.hemiSky, K.hemiSky, N.hemiSky);
    blendColor(this.hemiLight.groundColor, D.hemiGround, K.hemiGround, N.hemiGround);
    this.hemiLight.intensity = blendScalar(D.hemiIntensity, K.hemiIntensity, N.hemiIntensity);

    blendColor(this.sunLight.color, D.sunColor, K.sunColor, N.sunColor);
    this.sunLight.intensity = blendScalar(D.sunIntensity, K.sunIntensity, N.sunIntensity);
    this.sunLight.position.set(
      D.sunPos.x * wDay + K.sunPos.x * wDusk + N.sunPos.x * wNight,
      D.sunPos.y * wDay + K.sunPos.y * wDusk + N.sunPos.y * wNight,
      D.sunPos.z * wDay + K.sunPos.z * wDusk + N.sunPos.z * wNight
    );

    blendColor(this.fillLight.color, D.fillColor, K.fillColor, N.fillColor);
    this.fillLight.intensity = blendScalar(D.fillIntensity, K.fillIntensity, N.fillIntensity);

    blendColor(this.rimLight.color, D.rimColor, K.rimColor, N.rimColor);
    this.rimLight.intensity = blendScalar(D.rimIntensity, K.rimIntensity, N.rimIntensity);

    this.renderer.toneMappingExposure = blendScalar(D.exposure, K.exposure, N.exposure);
    if ('environmentIntensity' in this.scene) {
      this.scene.environmentIntensity = blendScalar(D.envIntensity, K.envIntensity, N.envIntensity);
    }

    if (this.scene.fog) {
      blendColor(this.scene.fog.color, D.fogColor, K.fogColor, N.fogColor);
      this._baseFogNear = blendScalar(D.fogNear, K.fogNear, N.fogNear);
      this._baseFogFar = blendScalar(D.fogFar, K.fogFar, N.fogFar);
      this._syncFogRange();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  _handleResize() {
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.wake(600);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.dayBackdrop?.dispose();
    this.duskBackdrop?.dispose();
    this.nightBackdrop?.dispose();
    this.envRenderTarget?.dispose();
    this.duskEnvRenderTarget?.dispose();
    this.nightEnvRenderTarget?.dispose();

    const disposedMats = new Set();
    const disposedTex = new Set();
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        if (disposedMats.has(m)) continue;
        disposedMats.add(m);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
          if (m[key] && !disposedTex.has(m[key])) {
            disposedTex.add(m[key]);
            m[key].dispose();
          }
        }
        m.dispose();
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement?.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
