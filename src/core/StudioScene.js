import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_CAMERA_VIEW } from '../config/campusConfig.js';
import { createStudioBackdropTexture } from './ProceduralTextures.js';

/**
 * 高级工业设计棚拍 WebGL 渲染底座（温暖瓷砂棚拍影调 + 充沛体积光影反差 + 零发白过曝）
 * 核心渲染与 GPU 保护策略：
 * 1. 关闭 logarithmicDepthBuffer，配合精准 near=8 / far=2600 恢复硬件 Early-Z / Hi-Z 剔除且保持亚毫米零闪烁
 * 2. pixelRatio 智能限幅 <= 1.5（叠加 MSAA 抗锯齿）
 * 3. 按需更新阴影贴图（shadowMap.autoUpdate = false）+ 2048 柔化 PCFShadowMap，交互旋转 0 次阴影重绘
 * 4. 约 3.8:1 主辅光比 + 克制暖石地反射半球光 + 三套（白昼/暮光/星夜）定制棚拍 PMREM 环境贴图，塑造奶油感接触阴影与雕塑体积
 * 5. 暴露完整 dispose() 回收所有 GPU 几何体、贴图、PMREM 帧缓冲与 WebGL 上下文
 */

export class StudioScene {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    // 清理可能残留的旧 Canvas
    container.innerHTML = '';

    this.scene = new THREE.Scene();
    this.scene.fog = null;

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
    this.renderer.toneMappingExposure = 0.94;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.maxAnisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 4);

    // 24° 长焦等轴测主镜头，合理 near=8 / far=2600 保证 24-bit 深度精度无任何 Z-Fighting
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_VIEW.fov,
      this.width / this.height,
      8.0,
      2600
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
    this.controls.maxDistance = 1350;
    this.controls.maxPolarAngle = Math.PI * 0.478;
    this.controls.minPolarAngle = 0.08;
    this.controls.update();

    this._buildHighContrastStudioEnv();
    this._buildLightingRig();

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

    // 1. 白昼工业设计棚拍环境贴图（暗暖地板吸光 + 中暖灰棚壁 + 精准高反差柔光条，拒绝泛白雾化）
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#3F3B37');

    const roomMat = new THREE.MeshBasicMaterial({
      color: '#48443F',
      side: THREE.BackSide,
    });
    envScene.add(new THREE.Mesh(roomGeo, roomMat));
    disposables.push(roomMat);

    // 暖暗吸光底板（为建筑挑檐、车辆底盘与树木冠底提供真实自然暗部反光）
    const darkFloorMat = new THREE.MeshBasicMaterial({
      color: '#25221F',
      side: THREE.DoubleSide,
    });
    const darkFloor = new THREE.Mesh(floorGeo, darkFloorMat);
    darkFloor.rotation.x = -Math.PI / 2;
    darkFloor.position.y = -39.4;
    envScene.add(darkFloor);
    disposables.push(darkFloorMat);

    // 暖瓷白顶棚柔和反光面（让屋顶与磨砂玻璃具备细腻渐变层次）
    const ceilMat = new THREE.MeshBasicMaterial({
      color: '#888178',
      side: THREE.DoubleSide,
    });
    const ceilPlane = new THREE.Mesh(floorGeo, ceilMat);
    ceilPlane.rotation.x = Math.PI / 2;
    ceilPlane.position.y = 39.4;
    envScene.add(ceilPlane);
    disposables.push(ceilMat);

    addSoftboxes(envScene, [
      // 主顶柔光箱（微暖瓷白，塑造丝缎与金属质感高光）
      { pos: [-20, 35, 18], rot: [Math.PI / 2, 0, 0.25], size: [56, 15], color: '#fff7ec', intensity: 2.55 },
      // 右前侧暖光轮廓柔光条
      { pos: [48, 22, 20], rot: [0, -Math.PI / 2, 0], size: [46, 10], color: '#ffeed8', intensity: 1.85 },
      // 左后侧冷青天光补光反射条（与暖主光形成冷暖体积过渡）
      { pos: [-48, 18, -24], rot: [0, Math.PI / 2, 0], size: [48, 9], color: '#c8e2f4', intensity: 1.7 },
      // 后上方利落背光勾边条
      { pos: [10, 26, -48], rot: [0.3, 0, 0], size: [54, 7], color: '#f2f6fa', intensity: 1.95 },
      // 低位极克制冰青亚克力反光带（呼应参考图底座冰青灯槽反光）
      { pos: [0, -16, 44], rot: [-0.22, 0, 0], size: [44, 4], color: '#7adceb', intensity: 0.55 },
    ]);

    const rt = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = rt.texture;
    if ('environmentIntensity' in this.scene) {
      this.scene.environmentIntensity = 0.48;
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
    // 克制暖瓷天光 + 暖暗石地面反射：释放建筑挑檐、树冠与庭院的立体奶油感 AO 暗部
    this.hemiLight = new THREE.HemisphereLight('#faf4ec', '#6e6860', 0.42);
    this.scene.add(this.hemiLight);

    // 紧包围 2048×2048 柔化按需刷新阴影（约 3.8:1 高级棚拍主辅光比，旋转/静止 0 阴影重绘开销）
    this.sunLight = new THREE.DirectionalLight('#fff4e4', 2.05);
    this.sunLight.position.set(-205, 255, 170);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.radius = 2.6;
    this.sunLight.shadow.camera.near = 60;
    this.sunLight.shadow.camera.far = 860;
    this.sunLight.shadow.camera.left = -264;
    this.sunLight.shadow.camera.right = 264;
    this.sunLight.shadow.camera.top = 208;
    this.sunLight.shadow.camera.bottom = -208;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.04;
    this.scene.add(this.sunLight);

    // 冷青天光辅助补光（克制强度，给暗面注入清透冷灰层次而非洗白阴影）
    this.fillLight = new THREE.DirectionalLight('#c8dcef', 0.30);
    this.fillLight.position.set(235, 145, -170);
    this.scene.add(this.fillLight);

    // 利落棚拍轮廓背光（轻柔提亮倒角边缘与金属质感）
    this.rimLight = new THREE.DirectionalLight('#e4f2fc', 0.26);
    this.rimLight.position.set(135, 105, 235);
    this.scene.add(this.rimLight);

    this.dayLighting = {
      hemiSky: new THREE.Color('#faf4ec'),
      hemiGround: new THREE.Color('#6e6860'),
      hemiIntensity: 0.42,
      sunColor: new THREE.Color('#fff4e4'),
      sunIntensity: 2.05,
      sunPos: new THREE.Vector3(-205, 255, 170),
      fillColor: new THREE.Color('#c8dcef'),
      fillIntensity: 0.30,
      rimColor: new THREE.Color('#e4f2fc'),
      rimIntensity: 0.26,
      exposure: 0.94,
      envIntensity: 0.48,
    };

    this.duskLighting = {
      hemiSky: new THREE.Color('#2a4672'),
      hemiGround: new THREE.Color('#12161e'),
      hemiIntensity: 0.32,
      sunColor: new THREE.Color('#ff9e5e'),
      sunIntensity: 0.78,
      sunPos: new THREE.Vector3(-248, 92, 132),
      fillColor: new THREE.Color('#3d72be'),
      fillIntensity: 0.40,
      rimColor: new THREE.Color('#52d6f0'),
      rimIntensity: 0.52,
      exposure: 1.0,
      envIntensity: 0.42,
    };

    // 深邃午夜月光灯光组（冷银蓝月光勾勒雕塑体块，让暖金灯海、湖面倒影与底座冰青辉光形成极致反差）
    this.nightLighting = {
      hemiSky: new THREE.Color('#142544'),
      hemiGround: new THREE.Color('#060a14'),
      hemiIntensity: 0.24,
      sunColor: new THREE.Color('#8ab6f8'),
      sunIntensity: 0.44,
      sunPos: new THREE.Vector3(-190, 232, 162),
      fillColor: new THREE.Color('#1d3866'),
      fillIntensity: 0.22,
      rimColor: new THREE.Color('#46c8ff'),
      rimIntensity: 0.34,
      exposure: 1.08,
      envIntensity: 0.38,
    };
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
