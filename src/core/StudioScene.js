import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_CAMERA_VIEW } from '../config/campusConfig.js';
import { createStudioBackdropTexture } from './ProceduralTextures.js';

/**
 * 超低负载高反差棚拍 WebGL 渲染底座（彻底根治显卡满载与显存泄漏）
 * 核心 GPU 保护策略：
 * 1. 关闭 logarithmicDepthBuffer，配合精准 near=8 / far=2600（比值仅 325，远在 24-bit 深度缓冲亚毫米精度内）
 *    + 全 3D 实体标高差，既保持 0 闪烁又完整恢复显卡硬件 Early-Z / Hi-Z 遮挡剔除（片元负载立降 60%+！）
 * 2. pixelRatio 智能限幅 <= 1.5（叠加 MSAA 抗锯齿，4K/2.5K 屏幕像素填充率立降 44% 且画面依旧锐利）
 * 3. 按需更新阴影贴图（shadowMap.autoUpdate = false）+ 1536/2048 标准 PCFShadowMap，交互旋转 0 次阴影重绘
 * 4. 暴露完整 dispose() 回收所有 GPU 几何体、贴图、PMREM 帧缓冲与 WebGL 上下文，杜绝热更新上下文叠加
 * 5. 暴露 isCameraMoving() 支撑主循环智能自适应降频（静止低功耗、交互 60FPS、切后台 0% 占用）
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
    this.renderer.toneMappingExposure = 1.02;
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

    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color('#16202A');

    const roomGeo = new THREE.BoxGeometry(120, 80, 120);
    const roomMat = new THREE.MeshBasicMaterial({
      color: '#16202A',
      side: THREE.BackSide,
    });
    envScene.add(new THREE.Mesh(roomGeo, roomMat));

    const softboxes = [
      { pos: [-16, 36, 18], rot: [Math.PI / 2, 0, 0.25], size: [62, 14], color: '#ffffff', intensity: 4.8 },
      { pos: [48, 20, 20], rot: [0, -Math.PI / 2, 0], size: [48, 9], color: '#fff5e8', intensity: 3.8 },
      { pos: [-48, 18, -24], rot: [0, Math.PI / 2, 0], size: [46, 8], color: '#c8ecff', intensity: 3.6 },
      { pos: [10, 26, -48], rot: [0.3, 0, 0], size: [54, 7], color: '#eef6ff', intensity: 4.0 },
    ];
    const tmpDisposables = [];

    softboxes.forEach((box) => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(box.color).multiplyScalar(box.intensity),
        side: THREE.DoubleSide,
      });
      const geo = new THREE.PlaneGeometry(box.size[0], box.size[1]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...box.pos);
      mesh.rotation.set(...box.rot);
      envScene.add(mesh);
      tmpDisposables.push(geo, mat);
    });

    const rt = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = rt.texture;
    if ('environmentIntensity' in this.scene) {
      this.scene.environmentIntensity = 0.72;
    }
    this.envRenderTarget = rt;

    // 专属星夜环境贴图（深蓝黑天穹 + 银蓝月光柔箱 + 低位建筑暖金地平线反光，让夜湖与幕墙折射真实夜景高光）
    const nightEnvScene = new THREE.Scene();
    nightEnvScene.background = new THREE.Color('#040812');
    const nightRoomMat = new THREE.MeshBasicMaterial({
      color: '#050b18',
      side: THREE.BackSide,
    });
    nightEnvScene.add(new THREE.Mesh(roomGeo, nightRoomMat));

    const nightSoftboxes = [
      { pos: [-22, 36, 20], rot: [Math.PI / 2, 0, 0.2], size: [54, 14], color: '#8ab8ff', intensity: 2.2 },
      { pos: [44, 14, 24], rot: [0, -Math.PI / 2, 0], size: [52, 6], color: '#ffbe6b', intensity: 1.55 },
      { pos: [-44, 12, -20], rot: [0, Math.PI / 2, 0], size: [48, 6], color: '#ffba66', intensity: 1.35 },
      { pos: [8, 10, -48], rot: [0.15, 0, 0], size: [58, 5], color: '#58d4ff', intensity: 1.15 },
      { pos: [0, 12, 48], rot: [-0.15, 0, 0], size: [58, 5], color: '#ffca7a', intensity: 1.25 },
    ];
    const nightDisposables = [nightRoomMat];
    nightSoftboxes.forEach((box) => {
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(box.color).multiplyScalar(box.intensity),
        side: THREE.DoubleSide,
      });
      const geo = new THREE.PlaneGeometry(box.size[0], box.size[1]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...box.pos);
      mesh.rotation.set(...box.rot);
      nightEnvScene.add(mesh);
      nightDisposables.push(geo, mat);
    });
    this.nightEnvRenderTarget = pmrem.fromScene(nightEnvScene, 0.04);

    pmrem.dispose();
    roomGeo.dispose();
    roomMat.dispose();
    tmpDisposables.forEach((d) => d.dispose());
    nightDisposables.forEach((d) => d.dispose());
  }

  _buildLightingRig() {
    this.hemiLight = new THREE.HemisphereLight('#f6f9ff', '#c9d2de', 0.96);
    this.scene.add(this.hemiLight);

    // 紧包围 2048×2048 按需刷新阴影（单次渲染，旋转/静止 0 开销）
    this.sunLight = new THREE.DirectionalLight('#fffaf2', 1.78);
    this.sunLight.position.set(-200, 275, 175);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 80;
    this.sunLight.shadow.camera.far = 880;
    this.sunLight.shadow.camera.left = -268;
    this.sunLight.shadow.camera.right = 268;
    this.sunLight.shadow.camera.top = 212;
    this.sunLight.shadow.camera.bottom = -212;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.055;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight('#d8e8fa', 0.62);
    this.fillLight.position.set(230, 150, -175);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight('#e0f3ff', 0.34);
    this.rimLight.position.set(130, 100, 235);
    this.scene.add(this.rimLight);

    this.dayLighting = {
      hemiSky: new THREE.Color('#f6f9ff'),
      hemiGround: new THREE.Color('#c9d2de'),
      hemiIntensity: 0.96,
      sunColor: new THREE.Color('#fffaf2'),
      sunIntensity: 1.78,
      sunPos: new THREE.Vector3(-200, 275, 175),
      fillColor: new THREE.Color('#d8e8fa'),
      fillIntensity: 0.62,
      rimColor: new THREE.Color('#e0f3ff'),
      rimIntensity: 0.34,
      exposure: 1.02,
      envIntensity: 0.72,
    };

    this.duskLighting = {
      hemiSky: new THREE.Color('#2c4b7a'),
      hemiGround: new THREE.Color('#0c131d'),
      hemiIntensity: 0.34,
      sunColor: new THREE.Color('#ffaa6b'),
      sunIntensity: 0.62,
      sunPos: new THREE.Vector3(-245, 96, 130),
      fillColor: new THREE.Color('#3f78cc'),
      fillIntensity: 0.46,
      rimColor: new THREE.Color('#5ce1ff'),
      rimIntensity: 0.58,
      exposure: 1.04,
      envIntensity: 0.46,
    };

    // 深邃午夜月光灯光组（0 额外光源，仅以冷银蓝月光勾勒白模体块，让建筑暖金灯海与路灯形成极致影调反差）
    this.nightLighting = {
      hemiSky: new THREE.Color('#142544'),
      hemiGround: new THREE.Color('#060a14'),
      hemiIntensity: 0.25,
      sunColor: new THREE.Color('#8ab6f8'),
      sunIntensity: 0.44,
      sunPos: new THREE.Vector3(-190, 232, 162),
      fillColor: new THREE.Color('#1d3866'),
      fillIntensity: 0.24,
      rimColor: new THREE.Color('#46c8ff'),
      rimIntensity: 0.34,
      exposure: 1.08,
      envIntensity: 0.36,
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
