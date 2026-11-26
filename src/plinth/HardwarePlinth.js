import * as THREE from 'three';
import { PLINTH_CONFIG } from '../config/campusConfig.js';

/**
 * 精工双阶圆角倒角哑光陶瓷白硬件底座（参考上传硬件白模参考图底层工艺）
 * - 主体：哑光陶瓷白 (#F3F5F8) 精密圆角托盘外壳 + 顶部细腻微倒角收边圈
 * - 底部：内凹隐藏式冰青色发光灯槽 + 外溢柔美冰青色棚拍光晕
 * - 侧面：InstancedMesh 精密工业风散热栅格槽 + 微距三色状态 LED
 */

export function createRoundedRectShape(width, depth, radius) {
  const hw = width / 2;
  const hd = depth / 2;
  const r = Math.min(radius, hw, hd);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  return shape;
}

export function buildHardwarePlinth() {
  const group = new THREE.Group();
  group.name = 'HardwarePlinth';

  const { width, depth, cornerRadius, skirtDepth, bevelSize, undercutInset, undercutHeight } = PLINTH_CONFIG;

  const ceramicMat = new THREE.MeshStandardMaterial({
    color: '#f3f5f8',
    roughness: 0.36,
    metalness: 0.04,
    envMapIntensity: 0.85,
  });

  // 1. 精密陶瓷白托盘外壳（中空内腔容纳草坪、三层湖盆与 1BF 车库下沉坡道）
  const outerShape = createRoundedRectShape(width + 12, depth + 12, cornerRadius + 4);
  const trayCavity = createRoundedRectShape(width - 1.5, depth - 1.5, Math.max(8, cornerRadius - 1));
  outerShape.holes.push(trayCavity);

  const upperThickness = skirtDepth - undercutHeight;
  const upperGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: upperThickness - bevelSize * 2,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize,
    bevelThickness: bevelSize,
    curveSegments: 20,
  });
  upperGeo.rotateX(Math.PI / 2);
  upperGeo.translate(0, -bevelSize, 0);

  const upperMesh = new THREE.Mesh(upperGeo, ceramicMat);
  upperMesh.position.y = -0.04;
  upperMesh.castShadow = true;
  upperMesh.receiveShadow = true;
  group.add(upperMesh);

  // 实心湖盆下底封板（位于 y = -3.85 以下）
  const bottomPlugShape = createRoundedRectShape(width + 6, depth + 6, cornerRadius + 2);
  const bottomPlugGeo = new THREE.ExtrudeGeometry(bottomPlugShape, {
    depth: upperThickness - 3.9,
    bevelEnabled: false,
    curveSegments: 18,
  });
  bottomPlugGeo.rotateX(Math.PI / 2);
  const bottomPlug = new THREE.Mesh(bottomPlugGeo, ceramicMat);
  bottomPlug.position.y = -3.85;
  group.add(bottomPlug);

  // 顶部双阶微倒角陶瓷压边（完美包裹草坪与市政主干道断面边缘，零缝隙）
  const trimOuter = createRoundedRectShape(width + 12.4, depth + 12.4, cornerRadius + 4.2);
  const trimHole = createRoundedRectShape(width - 0.8, depth - 0.8, cornerRadius - 0.5);
  trimOuter.holes.push(trimHole);
  const trimGeo = new THREE.ExtrudeGeometry(trimOuter, {
    depth: 0.44,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.16,
    bevelThickness: 0.16,
    curveSegments: 20,
  });
  trimGeo.rotateX(Math.PI / 2);
  trimGeo.translate(0, -0.16, 0);
  const trimMat = new THREE.MeshStandardMaterial({
    color: '#e6eaf1',
    roughness: 0.3,
    metalness: 0.18,
  });
  const trimMesh = new THREE.Mesh(trimGeo, trimMat);
  trimMesh.position.y = 0.28;
  trimMesh.receiveShadow = true;
  group.add(trimMesh);

  // 2. 参考图同款底盘托脚 + 隐藏式冰青微光灯槽
  const subPlinthShape = createRoundedRectShape(
    width + 16,
    depth + 16,
    cornerRadius + 6
  );
  const subPlinthGeo = new THREE.ExtrudeGeometry(subPlinthShape, {
    depth: 1.8,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.9,
    bevelThickness: 0.8,
    curveSegments: 20,
  });
  subPlinthGeo.rotateX(Math.PI / 2);
  subPlinthGeo.translate(0, -0.8, 0);
  const subPlinth = new THREE.Mesh(subPlinthGeo, ceramicMat);
  subPlinth.position.y = -upperThickness - undercutHeight + 1.8;
  subPlinth.receiveShadow = true;
  group.add(subPlinth);

  // 隐藏内凹发光冰青色灯带（位于主外壳与底盘托脚之间的回形灯槽内）
  const glowOuter = createRoundedRectShape(
    width + 12 - undercutInset * 0.65,
    depth + 12 - undercutInset * 0.65,
    cornerRadius + 2
  );
  const glowHole = createRoundedRectShape(
    width + 12 - undercutInset * 1.9,
    depth + 12 - undercutInset * 1.9,
    Math.max(8, cornerRadius - 2)
  );
  glowOuter.holes.push(glowHole);
  const glowGeo = new THREE.ExtrudeGeometry(glowOuter, {
    depth: undercutHeight - 0.6,
    bevelEnabled: false,
    curveSegments: 20,
  });
  glowGeo.rotateX(Math.PI / 2);

  const cyanCoveMat = new THREE.MeshStandardMaterial({
    color: '#9bf6ff',
    emissive: new THREE.Color('#3de6ff'),
    emissiveIntensity: 2.1,
    roughness: 0.18,
    metalness: 0.05,
  });
  const coveMesh = new THREE.Mesh(glowGeo, cyanCoveMat);
  coveMesh.position.y = -upperThickness + 0.1;
  group.add(coveMesh);

  // 底层冰青色漫射棚拍投影光晕
  const haloCanvas = document.createElement('canvas');
  haloCanvas.width = 256;
  haloCanvas.height = 256;
  const hctx = haloCanvas.getContext('2d');
  const rGrad = hctx.createRadialGradient(128, 128, 76, 128, 128, 126);
  rGrad.addColorStop(0, 'rgba(26, 38, 56, 0.18)');
  rGrad.addColorStop(0.7, 'rgba(30, 46, 66, 0.10)');
  rGrad.addColorStop(0.84, 'rgba(72, 230, 255, 0.28)');
  rGrad.addColorStop(0.95, 'rgba(72, 230, 255, 0.06)');
  rGrad.addColorStop(1, 'rgba(72, 230, 255, 0.0)');
  hctx.fillStyle = rGrad;
  hctx.fillRect(0, 0, 256, 256);

  const haloTex = new THREE.CanvasTexture(haloCanvas);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });
  const haloPlane = new THREE.Mesh(new THREE.PlaneGeometry(width + 128, depth + 128), haloMat);
  haloPlane.rotation.x = -Math.PI / 2;
  haloPlane.position.y = -skirtDepth - 1.4;
  group.add(haloPlane);

  // 夜景专属叠加冰青色底槽外溢光环（白模日间完全不可见，夜间让硬件底座在深黑天幕下浮现惊艳冰青辉光）
  const nightHaloCanvas = document.createElement('canvas');
  nightHaloCanvas.width = 256;
  nightHaloCanvas.height = 256;
  const nhctx = nightHaloCanvas.getContext('2d');
  const nrGrad = nhctx.createRadialGradient(128, 128, 72, 128, 128, 128);
  nrGrad.addColorStop(0.0, 'rgba(34, 211, 238, 0.0)');
  nrGrad.addColorStop(0.64, 'rgba(34, 211, 238, 0.08)');
  nrGrad.addColorStop(0.8, 'rgba(64, 236, 255, 0.65)');
  nrGrad.addColorStop(0.91, 'rgba(34, 211, 238, 0.22)');
  nrGrad.addColorStop(1.0, 'rgba(34, 211, 238, 0.0)');
  nhctx.fillStyle = nrGrad;
  nhctx.fillRect(0, 0, 256, 256);

  const nightHaloTex = new THREE.CanvasTexture(nightHaloCanvas);
  nightHaloTex.colorSpace = THREE.SRGBColorSpace;
  const nightHaloMat = new THREE.MeshBasicMaterial({
    map: nightHaloTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.0,
  });
  const nightHaloPlane = new THREE.Mesh(new THREE.PlaneGeometry(width + 148, depth + 148), nightHaloMat);
  nightHaloPlane.userData.noMerge = true;
  nightHaloPlane.rotation.x = -Math.PI / 2;
  nightHaloPlane.position.y = -skirtDepth - 1.32;
  nightHaloPlane.visible = false;
  group.add(nightHaloPlane);

  // 3. 侧面精密工业风散热开槽阵列（InstancedMesh）
  const slotGeo = new THREE.BoxGeometry(1.1, 4.2, 0.55);
  const slotMat = new THREE.MeshStandardMaterial({
    color: '#4b5563',
    roughness: 0.55,
    metalness: 0.4,
  });

  const slotTransforms = [];
  const halfW = (width + 12) / 2 + bevelSize - 0.12;
  const halfD = (depth + 12) / 2 + bevelSize - 0.12;
  const slotY = -upperThickness * 0.52;

  for (const side of [-1, 1]) {
    for (const clusterCenter of [-144, 144]) {
      for (let i = -8; i <= 8; i++) {
        slotTransforms.push({ pos: [clusterCenter + i * 2.5, slotY, side * halfD], rotY: 0 });
      }
    }
  }
  for (const side of [-1, 1]) {
    for (const clusterCenter of [-84, 84]) {
      for (let i = -6; i <= 6; i++) {
        slotTransforms.push({ pos: [side * halfW, slotY, clusterCenter + i * 2.5], rotY: Math.PI / 2 });
      }
    }
  }

  const slotInst = new THREE.InstancedMesh(slotGeo, slotMat, slotTransforms.length);
  const dummy = new THREE.Object3D();
  slotTransforms.forEach((t, idx) => {
    dummy.position.set(...t.pos);
    dummy.rotation.set(0, t.rotY, 0);
    dummy.updateMatrix();
    slotInst.setMatrixAt(idx, dummy.matrix);
  });
  slotInst.instanceMatrix.needsUpdate = true;
  group.add(slotInst);

  // 4. 前缘精致微距状态 LED（复刻参考图青/黄/白三颗硬件指示微点）
  const ledGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.45, 12);
  ledGeo.rotateX(Math.PI / 2);
  const ledSpecs = [
    { x: -198, color: '#38f2ff', emissive: '#1fe8ff' },
    { x: -194.2, color: '#fbbf24', emissive: '#f59e0b' },
    { x: -190.4, color: '#f8fafc', emissive: '#bae6fd' },
  ];
  const ledMats = [];
  ledSpecs.forEach((spec) => {
    const lMat = new THREE.MeshStandardMaterial({
      color: spec.color,
      emissive: new THREE.Color(spec.emissive),
      emissiveIntensity: 2.2,
      roughness: 0.15,
    });
    ledMats.push(lMat);
    const led = new THREE.Mesh(ledGeo, lMat);
    led.position.set(spec.x, slotY, halfD + 0.08);
    group.add(led);
  });

  return {
    group,
    update(time, duskFactor, nightFactor = duskFactor) {
      const pulse = Math.sin(time * 1.5);
      cyanCoveMat.emissiveIntensity = 1.9 + duskFactor * 1.35 + nightFactor * 0.55 + pulse * 0.14;
      haloMat.opacity = 0.85 + duskFactor * 0.15;
      const glowAlpha = Math.max(0, duskFactor * 0.35 + nightFactor * 0.45);
      nightHaloPlane.visible = glowAlpha > 0.005;
      nightHaloMat.opacity = glowAlpha * (0.94 + pulse * 0.06);

      if (ledMats[0]) ledMats[0].emissiveIntensity = 2.2 + duskFactor * 1.35;
      if (ledMats[1]) ledMats[1].emissiveIntensity = 2.2 + duskFactor * 1.25;
      if (ledMats[2]) {
        ledMats[2].emissiveIntensity = 1.5 + duskFactor * 1.0 + Math.abs(Math.sin(time * 2.0)) * 1.4;
      }
    },
  };
}
