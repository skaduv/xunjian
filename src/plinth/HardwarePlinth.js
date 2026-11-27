import * as THREE from 'three';
import { PLINTH_CONFIG } from '../config/campusConfig.js';
import { createBrushedMetalTexture } from '../core/ProceduralTextures.js';

/**
 * 精工多阶圆角倒角丝缎陶灰硬件底座（深度复刻工业设计参考图硬件托盘工艺）
 * - 主体：丝缎暖陶灰 (#D2CCC3) 双段精密圆角外壳 + 实体内凹阳极石墨分型缝 + 顶部香槟钛铝微倒角收边与暗色内凹阴影槽
 * - 侧面：嵌入式深石墨 CNC 散热风道槽框 + InstancedMesh 拉丝钛灰精密散热鳍片阵列 + 右侧端口槽位 + 三色微距状态 LED
 * - 底部：内凹石墨暗阶 + 磨砂冰青亚克力环绕灯槽 + 加宽暖瓷底座托盘 + 精准贴合圆角轮廓的棚拍接触阴影与冰青外溢光晕
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

function drawCanvasRoundedRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * 生成精准贴合圆角矩形硬件底座轮廓的棚拍桌面接触阴影 + 紧致冰青亚克力边缘漫射贴图
 * 采用 640×512 近 1:1 等比像素画布，确保圆角半径与羽化宽度在 X/Z 方向完全均匀不拉伸
 */
function createRoundedPlinthFloorTexture({ mode = 'day', planeW, planeD, subW, subD, subR }) {
  const cw = 640;
  const ch = 512;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  const sx = cw / planeW;
  const sz = ch / planeD;
  const rw = subW * sx;
  const rh = subD * sz;
  const rx = (cw - rw) * 0.5;
  const ry = (ch - rh) * 0.5;
  const cornerR = subR * Math.min(sx, sz);

  if (mode === 'day') {
    // 1. 棚拍桌面柔和方向性暖灰投影（微向东/北偏置，贴合主光源方向）
    const passes = [
      { ox: 10, oy: 12, blur: 34, alpha: 0.14, color: '62, 53, 46' },
      { ox: 6, oy: 7, blur: 20, alpha: 0.20, color: '52, 44, 38' },
      { ox: 2, oy: 3, blur: 9, alpha: 0.26, color: '40, 34, 28' },
    ];
    for (const p of passes) {
      ctx.save();
      ctx.shadowColor = `rgba(${p.color}, ${p.alpha})`;
      ctx.shadowBlur = p.blur;
      ctx.shadowOffsetX = p.ox;
      ctx.shadowOffsetY = p.oy;
      ctx.fillStyle = `rgba(${p.color}, ${(p.alpha * 0.85).toFixed(3)})`;
      drawCanvasRoundedRect(ctx, rx + 2, ry + 2, rw - 4, rh - 4, cornerR);
      ctx.fill();
      ctx.restore();
    }

    // 2. 紧致克制的磨砂冰青亚克力外溢微光（沿加宽底座托脚外缘精准柔化绽放）
    const glowRings = [
      { expand: 4, lw: 14, blur: 22, alpha: 0.24, color: '56, 214, 236' },
      { expand: 2, lw: 8, blur: 10, alpha: 0.30, color: '108, 234, 246' },
      { expand: 0, lw: 4, blur: 4, alpha: 0.26, color: '164, 246, 255' },
    ];
    for (const g of glowRings) {
      ctx.save();
      ctx.shadowColor = `rgba(${g.color}, ${g.alpha})`;
      ctx.shadowBlur = g.blur;
      ctx.strokeStyle = `rgba(${g.color}, ${g.alpha})`;
      ctx.lineWidth = g.lw;
      drawCanvasRoundedRect(
        ctx,
        rx - g.expand,
        ry - g.expand,
        rw + g.expand * 2,
        rh + g.expand * 2,
        cornerR + g.expand
      );
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // 夜景专属圆角冰青辉光环（沿圆角外缘均匀悬停发光）
    const nightRings = [
      { expand: 8, lw: 24, blur: 34, alpha: 0.30, color: '34, 211, 238' },
      { expand: 3, lw: 13, blur: 16, alpha: 0.54, color: '64, 232, 252' },
      { expand: 0, lw: 5, blur: 6, alpha: 0.74, color: '138, 244, 255' },
    ];
    for (const g of nightRings) {
      ctx.save();
      ctx.shadowColor = `rgba(${g.color}, ${g.alpha})`;
      ctx.shadowBlur = g.blur;
      ctx.strokeStyle = `rgba(${g.color}, ${g.alpha})`;
      ctx.lineWidth = g.lw;
      drawCanvasRoundedRect(
        ctx,
        rx - g.expand,
        ry - g.expand,
        rw + g.expand * 2,
        rh + g.expand * 2,
        cornerR + g.expand
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildHardwarePlinth() {
  const group = new THREE.Group();
  group.name = 'HardwarePlinth';

  const { width, depth, cornerRadius, skirtDepth, undercutInset, undercutHeight } = PLINTH_CONFIG;

  const brushedTrimTex = createBrushedMetalTexture('#beb7ad', 4);
  const brushedFinTex = createBrushedMetalTexture('#aeb4bc', 4);

  // 核心材质表（严格对齐主控材质规范，拒绝惨白反光）
  const chassisMat = new THREE.MeshStandardMaterial({
    name: 'PlinthChassisSatinClay',
    color: '#d2ccc3',
    roughness: 0.40,
    metalness: 0.06,
    envMapIntensity: 0.92,
  });

  const subPlinthMat = new THREE.MeshStandardMaterial({
    name: 'PlinthSubBasePorcelain',
    color: '#ddd7ce',
    roughness: 0.36,
    metalness: 0.05,
    envMapIntensity: 0.95,
  });

  const trimMat = new THREE.MeshStandardMaterial({
    name: 'PlinthTopTrimChampagne',
    color: '#c8c1b7',
    map: brushedTrimTex,
    roughness: 0.34,
    metalness: 0.24,
    envMapIntensity: 1.05,
  });

  const graphiteMat = new THREE.MeshStandardMaterial({
    name: 'PlinthGraphiteSeam',
    color: '#32373f',
    roughness: 0.46,
    metalness: 0.52,
    envMapIntensity: 0.95,
  });

  const ventBezelMat = new THREE.MeshStandardMaterial({
    name: 'PlinthVentBezelGunmetal',
    color: '#4c525c',
    roughness: 0.38,
    metalness: 0.56,
    envMapIntensity: 1.05,
  });

  const cavityBackMat = new THREE.MeshStandardMaterial({
    name: 'PlinthVentCavityDark',
    color: '#323842',
    roughness: 0.68,
    metalness: 0.26,
  });

  const finMat = new THREE.MeshStandardMaterial({
    name: 'PlinthCNCFinBrushed',
    color: '#ffffff',
    map: brushedFinTex,
    roughness: 0.34,
    metalness: 0.52,
    envMapIntensity: 1.25,
  });

  // 1. 精密双段丝缎陶灰圆角托盘外壳（中空内腔容纳草坪、湖盆与 1BF 车库下沉坡道）
  //    通过上唇壳 + 实体内凹石墨分型槽 + 主下壳，形成真实物理凹槽阴影线
  const shellBevel = 1.6;
  const outerShape = createRoundedRectShape(width + 13.2, depth + 13.2, cornerRadius + 4.4);
  const trayCavity = createRoundedRectShape(width - 1.5, depth - 1.5, Math.max(8, cornerRadius - 1));
  outerShape.holes.push(trayCavity);

  // 1a. 上段倒角唇壳：y in [-3.20, -0.04]
  const upperBandH = 3.16;
  const upperBandGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: Math.max(0.2, upperBandH - shellBevel * 1.4),
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: shellBevel,
    bevelThickness: shellBevel * 0.7,
    curveSegments: 24,
  });
  upperBandGeo.rotateX(Math.PI / 2);
  upperBandGeo.translate(0, -shellBevel * 0.7, 0);
  const upperBandMesh = new THREE.Mesh(upperBandGeo, chassisMat);
  upperBandMesh.position.y = -0.04;
  upperBandMesh.castShadow = true;
  upperBandMesh.receiveShadow = true;
  group.add(upperBandMesh);

  // 1b. 实体内凹阳极石墨分型阴影槽：y in [-3.98, -3.02]（内缩 0.7m，形成参考图同款精密拼装缝）
  const grooveOuter = createRoundedRectShape(width + 15.0, depth + 15.0, cornerRadius + 5.0);
  const grooveHole = createRoundedRectShape(width - 2.0, depth - 2.0, Math.max(8, cornerRadius - 1.2));
  grooveOuter.holes.push(grooveHole);
  const grooveGeo = new THREE.ExtrudeGeometry(grooveOuter, {
    depth: 0.96,
    bevelEnabled: false,
    curveSegments: 24,
  });
  grooveGeo.rotateX(Math.PI / 2);
  const grooveMesh = new THREE.Mesh(grooveGeo, graphiteMat);
  grooveMesh.position.y = -3.02;
  grooveMesh.receiveShadow = true;
  group.add(grooveMesh);

  // 1c. 下段主侧壁外壳：y in [-13.10, -3.80]（精准对齐底座下沿与底板封口）
  const lowerBandH = 9.30;
  const lowerBandGeo = new THREE.ExtrudeGeometry(outerShape, {
    depth: lowerBandH - shellBevel * 1.6,
    bevelEnabled: true,
    bevelSegments: 4,
    steps: 1,
    bevelSize: shellBevel,
    bevelThickness: shellBevel * 0.8,
    curveSegments: 24,
  });
  lowerBandGeo.rotateX(Math.PI / 2);
  lowerBandGeo.translate(0, -shellBevel * 0.8, 0);
  const lowerBandMesh = new THREE.Mesh(lowerBandGeo, chassisMat);
  lowerBandMesh.position.y = -3.80;
  lowerBandMesh.castShadow = true;
  lowerBandMesh.receiveShadow = true;
  group.add(lowerBandMesh);

  // 实心湖盆下底封板：y in [-13.10, -3.55]（P3：严密平齐封堵草坪底 y=-3.60 与下壳底 y=-13.10，零空腔缝隙）
  const bottomPlugShape = createRoundedRectShape(width + 8, depth + 8, cornerRadius + 2.5);
  const bottomPlugGeo = new THREE.ExtrudeGeometry(bottomPlugShape, {
    depth: 9.55,
    bevelEnabled: false,
    curveSegments: 20,
  });
  bottomPlugGeo.rotateX(Math.PI / 2);
  const bottomPlug = new THREE.Mesh(bottomPlugGeo, chassisMat);
  bottomPlug.position.y = -3.55;
  group.add(bottomPlug);

  // 2. 顶部双阶精密香槟钛铝微倒角收边圈（P4 & 跨模块契约：内腔 ±242.6×±183.6，顶面降至 y=+0.16，零挡路零切边）
  const trimOuter = createRoundedRectShape(width + 13.4, depth + 13.4, cornerRadius + 4.4);
  const trimHole = createRoundedRectShape(width - 0.8, depth - 0.8, cornerRadius - 0.5);
  trimOuter.holes.push(trimHole);
  const trimGeo = new THREE.ExtrudeGeometry(trimOuter, {
    depth: 0.34,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.12,
    bevelThickness: 0.12,
    curveSegments: 24,
  });
  trimGeo.rotateX(Math.PI / 2);
  trimGeo.translate(0, -0.12, 0);
  const trimMesh = new THREE.Mesh(trimGeo, trimMat);
  trimMesh.position.y = 0.16;
  trimMesh.receiveShadow = true;
  group.add(trimMesh);

  // 内缘精密深石墨镶边细槽（y in [-0.145, +0.095]，内孔 ±242.26×±183.26 避让 ±242.2×±183.2 道路路缘，清晰勾勒硬件收边）
  const innerRevealOuter = createRoundedRectShape(width - 0.84, depth - 0.84, cornerRadius - 0.52);
  const innerRevealHole = createRoundedRectShape(width - 1.48, depth - 1.48, cornerRadius - 0.75);
  innerRevealOuter.holes.push(innerRevealHole);
  const innerRevealGeo = new THREE.ExtrudeGeometry(innerRevealOuter, {
    depth: 0.24,
    bevelEnabled: false,
    curveSegments: 24,
  });
  innerRevealGeo.rotateX(Math.PI / 2);
  const innerRevealMesh = new THREE.Mesh(innerRevealGeo, graphiteMat);
  innerRevealMesh.position.y = 0.095;
  innerRevealMesh.receiveShadow = true;
  group.add(innerRevealMesh);

  // 3. 内凹石墨阴影阶 + 磨砂冰青亚克力环绕发光槽 + 加宽暖瓷底座托盘（P1 & P2：精准嵌套于 [-16.50, -13.10]，零穿插零超深）
  const upperBottomY = -13.10;

  // 3a. 内凹石墨机械过渡阶：y in [-13.18, -12.92]
  const stepOuter = createRoundedRectShape(width + 12.2, depth + 12.2, cornerRadius + 3.6);
  const stepHole = createRoundedRectShape(width + 3.0, depth + 3.0, Math.max(8, cornerRadius - 1.5));
  stepOuter.holes.push(stepHole);
  const stepGeo = new THREE.ExtrudeGeometry(stepOuter, {
    depth: 0.26,
    bevelEnabled: false,
    curveSegments: 24,
  });
  stepGeo.rotateX(Math.PI / 2);
  const stepMesh = new THREE.Mesh(stepGeo, graphiteMat);
  stepMesh.position.y = upperBottomY + 0.18;
  group.add(stepMesh);

  // 3b. 内嵌冰青发光灯芯（P2）：y in [-14.78, -13.08]（严丝合缝嵌于凹槽内，无过度埋入）
  const glowOuter = createRoundedRectShape(
    width + 12 - undercutInset * 0.45,
    depth + 12 - undercutInset * 0.45,
    cornerRadius + 2.6
  );
  const glowHole = createRoundedRectShape(
    width + 12 - undercutInset * 1.85,
    depth + 12 - undercutInset * 1.85,
    Math.max(8, cornerRadius - 2)
  );
  glowOuter.holes.push(glowHole);
  const glowGeo = new THREE.ExtrudeGeometry(glowOuter, {
    depth: 1.70,
    bevelEnabled: false,
    curveSegments: 24,
  });
  glowGeo.rotateX(Math.PI / 2);

  const cyanCoveMat = new THREE.MeshStandardMaterial({
    name: 'PlinthCyanAcrylicCore',
    color: '#9cf0f8',
    emissive: new THREE.Color('#2ad4ee'),
    emissiveIntensity: 1.45,
    roughness: 0.20,
    metalness: 0.05,
  });
  const coveMesh = new THREE.Mesh(glowGeo, cyanCoveMat);
  coveMesh.position.y = -13.08;
  group.add(coveMesh);

  // 3c. 外包磨砂半透明冰青亚克力导光罩：y in [-14.70, -13.14]（纯露于凹槽内，零上下重叠）
  const acrylicOuter = createRoundedRectShape(
    width + 12 - undercutInset * 0.25,
    depth + 12 - undercutInset * 0.25,
    cornerRadius + 2.9
  );
  const acrylicHole = createRoundedRectShape(
    width + 12 - undercutInset * 0.55,
    depth + 12 - undercutInset * 0.55,
    cornerRadius + 2.2
  );
  acrylicOuter.holes.push(acrylicHole);
  const acrylicGeo = new THREE.ExtrudeGeometry(acrylicOuter, {
    depth: 1.56,
    bevelEnabled: false,
    curveSegments: 24,
  });
  acrylicGeo.rotateX(Math.PI / 2);

  const frostedAcrylicMat = new THREE.MeshStandardMaterial({
    name: 'PlinthFrostedAcrylicRim',
    color: '#b6f2fa',
    emissive: new THREE.Color('#42dcf2'),
    emissiveIntensity: 0.42,
    roughness: 0.16,
    metalness: 0.06,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  const acrylicSleeve = new THREE.Mesh(acrylicGeo, frostedAcrylicMat);
  acrylicSleeve.position.y = -13.14;
  group.add(acrylicSleeve);

  // 3d. 加宽暖瓷底座托脚（P1）：总厚精确 1.80m（depth 0.60 + 2×bevel 0.60），位于 y in [-16.50, -14.70]，严守 skirtDepth=16.5！
  const subPlinthShape = createRoundedRectShape(width + 20, depth + 20, cornerRadius + 7);
  const subPlinthGeo = new THREE.ExtrudeGeometry(subPlinthShape, {
    depth: 0.60,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.90,
    bevelThickness: 0.60,
    curveSegments: 24,
  });
  subPlinthGeo.rotateX(Math.PI / 2);
  subPlinthGeo.translate(0, -0.60, 0);
  const subPlinth = new THREE.Mesh(subPlinthGeo, subPlinthMat);
  subPlinth.position.y = -14.70;
  subPlinth.castShadow = true;
  subPlinth.receiveShadow = true;
  group.add(subPlinth);

  // 托盘台面冰青漫反射柔光圈（位于 subPlinth 顶面 -14.70 上方 +0.025m，呈现亚克力槽对托盘边沿的柔和染光）
  const shelfGlowOuter = createRoundedRectShape(width + 18.2, depth + 18.2, cornerRadius + 6.2);
  const shelfGlowHole = createRoundedRectShape(width + 9.2, depth + 9.2, cornerRadius + 2.4);
  shelfGlowOuter.holes.push(shelfGlowHole);
  const shelfGlowGeo = new THREE.ShapeGeometry(shelfGlowOuter, 24);
  shelfGlowGeo.rotateX(-Math.PI / 2);
  const shelfGlowMat = new THREE.MeshBasicMaterial({
    name: 'PlinthTrayCyanBounce',
    color: '#6ce8f8',
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const shelfGlowMesh = new THREE.Mesh(shelfGlowGeo, shelfGlowMat);
  shelfGlowMesh.position.y = -14.675;
  group.add(shelfGlowMesh);

  // 4. 精准贴合圆角轮廓的棚拍桌面接触阴影 + 紧致冰青光晕（P1：严格位于 subPlinth 底面 y=-16.50 下方，绝对零穿插！）
  const floorPlaneW = width + 116;
  const floorPlaneD = depth + 116;
  const subFootW = width + 21.8;
  const subFootD = depth + 21.8;
  const subFootR = cornerRadius + 7.9;
  const haloTex = createRoundedPlinthFloorTexture({
    mode: 'day',
    planeW: floorPlaneW,
    planeD: floorPlaneD,
    subW: subFootW,
    subD: subFootD,
    subR: subFootR,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    name: 'PlinthStudioFloorShadow',
    map: haloTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.96,
  });
  const haloPlane = new THREE.Mesh(new THREE.PlaneGeometry(floorPlaneW, floorPlaneD), haloMat);
  haloPlane.rotation.x = -Math.PI / 2;
  haloPlane.position.y = -16.58;
  group.add(haloPlane);

  // 夜景专属叠加冰青圆角光环（日间完全隐藏，夜间位于 y=-16.54 在深空底座下方呈现均匀柔和冰青悬停辉光）
  const nightPlaneW = floorPlaneW + 18;
  const nightPlaneD = floorPlaneD + 18;
  const nightHaloTex = createRoundedPlinthFloorTexture({
    mode: 'night',
    planeW: nightPlaneW,
    planeD: nightPlaneD,
    subW: subFootW,
    subD: subFootD,
    subR: subFootR,
  });
  const nightHaloMat = new THREE.MeshBasicMaterial({
    name: 'PlinthNightCyanHalo',
    map: nightHaloTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.0,
  });
  const nightHaloPlane = new THREE.Mesh(new THREE.PlaneGeometry(nightPlaneW, nightPlaneD), nightHaloMat);
  nightHaloPlane.userData.noMerge = true;
  nightHaloPlane.rotation.x = -Math.PI / 2;
  nightHaloPlane.position.y = -16.54;
  nightHaloPlane.visible = false;
  group.add(nightHaloPlane);

  // 5. 侧面嵌入式 CNC 精密散热栅格槽框 + 拉丝钛灰散热鳍片阵列（InstancedMesh）
  //    外侧主立面精确坐标：halfW = (width + 13.2)/2 + shellBevel = width/2 + 8.2, halfD = depth/2 + 8.2
  //    平直侧壁区间 y in [-11.82, -5.08]，风道居中 y = -8.45（P4：严格在平直侧壁内）
  const halfW = (width + 13.2) * 0.5 + shellBevel;
  const halfD = (depth + 13.2) * 0.5 + shellBevel;
  const flankCenterY = -8.45;

  const ventBays = [
    // 南侧与北侧双长散热风道（46% 亮钛鳍片 / 54% 暗槽节律，远近视角均清晰可辨）
    { axis: 'z', side: 1, center: -132, span: 54, fins: 22 },
    { axis: 'z', side: 1, center: 62, span: 48, fins: 19 },
    { axis: 'z', side: -1, center: -132, span: 54, fins: 22 },
    { axis: 'z', side: -1, center: 122, span: 54, fins: 22 },
    // 西侧与东侧散热风道
    { axis: 'x', side: -1, center: -76, span: 40, fins: 16 },
    { axis: 'x', side: -1, center: 76, span: 40, fins: 16 },
    { axis: 'x', side: 1, center: -76, span: 40, fins: 16 },
    { axis: 'x', side: 1, center: 46, span: 36, fins: 14 },
  ];

  const bayH = 4.2;
  const finTransforms = [];
  const bezelThick = 0.30;

  ventBays.forEach((bay) => {
    const isZ = bay.axis === 'z';
    // 深石板灰风道内背板（紧贴侧壁，清晰衬托丝缎钛铝竖向鳍片）
    const backGeo = isZ
      ? new THREE.BoxGeometry(bay.span, bayH, 0.16)
      : new THREE.BoxGeometry(0.16, bayH, bay.span);
    const backMesh = new THREE.Mesh(backGeo, cavityBackMat);
    backMesh.position.set(
      isZ ? bay.center : bay.side * (halfW + 0.02),
      flankCenterY,
      isZ ? bay.side * (halfD + 0.02) : bay.center
    );
    group.add(backMesh);

    // 上下左右精密枪灰外框条（勾勒嵌入式风道边框，突出侧壁 0.30m）
    const topBarGeo = isZ
      ? new THREE.BoxGeometry(bay.span + bezelThick * 2, bezelThick, 0.38)
      : new THREE.BoxGeometry(0.38, bezelThick, bay.span + bezelThick * 2);
    for (const dy of [-bayH * 0.5 - bezelThick * 0.4, bayH * 0.5 + bezelThick * 0.4]) {
      const bar = new THREE.Mesh(topBarGeo, ventBezelMat);
      bar.position.set(
        isZ ? bay.center : bay.side * (halfW + 0.12),
        flankCenterY + dy,
        isZ ? bay.side * (halfD + 0.12) : bay.center
      );
      group.add(bar);
    }

    const sideBarGeo = isZ
      ? new THREE.BoxGeometry(bezelThick, bayH + bezelThick * 1.6, 0.38)
      : new THREE.BoxGeometry(0.38, bayH + bezelThick * 1.6, bezelThick);
    for (const ds of [-bay.span * 0.5 - bezelThick * 0.45, bay.span * 0.5 + bezelThick * 0.45]) {
      const bar = new THREE.Mesh(sideBarGeo, ventBezelMat);
      bar.position.set(
        isZ ? bay.center + ds : bay.side * (halfW + 0.12),
        flankCenterY,
        isZ ? bay.side * (halfD + 0.12) : bay.center + ds
      );
      group.add(bar);
    }

    // 丝缎拉丝钛灰竖向散热鳍片阵列（齐平于外框内微收 0.04m，强光影明暗节律清晰锐利）
    const step = (bay.span - 2.6) / Math.max(1, bay.fins - 1);
    const start = bay.center - (bay.span - 2.6) * 0.5;
    for (let i = 0; i < bay.fins; i++) {
      const offset = start + i * step;
      finTransforms.push({
        pos: isZ
          ? [offset, flankCenterY, bay.side * (halfD + 0.13)]
          : [bay.side * (halfW + 0.13), flankCenterY, offset],
        rotY: isZ ? 0 : Math.PI / 2,
      });
    }
  });

  const finGeo = new THREE.BoxGeometry(1.02, bayH - 0.30, 0.28);
  const finInst = new THREE.InstancedMesh(finGeo, finMat, finTransforms.length);
  const dummy = new THREE.Object3D();
  finTransforms.forEach((t, idx) => {
    dummy.position.set(...t.pos);
    dummy.rotation.set(0, t.rotY, 0);
    dummy.updateMatrix();
    finInst.setMatrixAt(idx, dummy.matrix);
  });
  finInst.instanceMatrix.needsUpdate = true;
  group.add(finInst);

  // 6. 精密工业端口槽位与微距状态指示 LED（呼应参考图右侧硬件端口 + 琥珀/冰青微光指示点）
  const portPanels = [
    // 前立面右侧主端口与指示灯组
    { axis: 'z', side: 1, center: 162, ledDir: -1 },
    // 东立面前侧副端口与指示灯组
    { axis: 'x', side: 1, center: 112, ledDir: -1 },
  ];

  const ledSpecs = [
    { offset: -14.2, color: '#38e8f8', emissive: '#1edef8' },
    { offset: -11.4, color: '#f5a623', emissive: '#f59e0b' },
    { offset: -8.6, color: '#7ff0cb', emissive: '#44dca8' },
  ];
  const ledGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.38, 14);
  ledGeo.rotateX(Math.PI / 2);
  const grommetGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.24, 14);
  grommetGeo.rotateX(Math.PI / 2);

  const ledMats = ledSpecs.map(
    (spec, i) =>
      new THREE.MeshStandardMaterial({
        name: `PlinthStatusLED_${i}`,
        color: spec.color,
        emissive: new THREE.Color(spec.emissive),
        emissiveIntensity: 1.9,
        roughness: 0.16,
      })
  );

  portPanels.forEach((panel) => {
    const isZ = panel.axis === 'z';
    // 精致拉丝金属端口面板底托
    const plateGeo = isZ
      ? new THREE.BoxGeometry(36, 3.6, 0.18)
      : new THREE.BoxGeometry(0.18, 3.6, 36);
    const plate = new THREE.Mesh(plateGeo, graphiteMat);
    plate.position.set(
      isZ ? panel.center : panel.side * (halfW + 0.02),
      flankCenterY,
      isZ ? panel.side * (halfD + 0.02) : panel.center
    );
    group.add(plate);

    // 3 个精密水平 USB-C/数据接口深凹槽
    for (const pOff of [-2.2, 4.4, 11.0]) {
      const portCollarGeo = isZ
        ? new THREE.BoxGeometry(4.4, 1.55, 0.28)
        : new THREE.BoxGeometry(0.28, 1.55, 4.4);
      const collar = new THREE.Mesh(portCollarGeo, finMat);
      collar.position.set(
        isZ ? panel.center + pOff : panel.side * (halfW + 0.07),
        flankCenterY,
        isZ ? panel.side * (halfD + 0.07) : panel.center + pOff
      );
      group.add(collar);

      const portHoleGeo = isZ
        ? new THREE.BoxGeometry(3.6, 0.96, 0.34)
        : new THREE.BoxGeometry(0.34, 0.96, 3.6);
      const hole = new THREE.Mesh(portHoleGeo, cavityBackMat);
      hole.position.set(
        isZ ? panel.center + pOff : panel.side * (halfW + 0.09),
        flankCenterY,
        isZ ? panel.side * (halfD + 0.09) : panel.center + pOff
      );
      group.add(hole);
    }

    // 3 颗微距状态指示 LED（带微型深灰金属套环）
    ledSpecs.forEach((spec, i) => {
      const grommet = new THREE.Mesh(grommetGeo, finMat);
      const led = new THREE.Mesh(ledGeo, ledMats[i]);
      if (!isZ) {
        grommet.rotation.y = Math.PI / 2;
        led.rotation.y = Math.PI / 2;
      }
      grommet.position.set(
        isZ ? panel.center + spec.offset : panel.side * (halfW + 0.08),
        flankCenterY,
        isZ ? panel.side * (halfD + 0.08) : panel.center + spec.offset
      );
      led.position.set(
        isZ ? panel.center + spec.offset : panel.side * (halfW + 0.14),
        flankCenterY,
        isZ ? panel.side * (halfD + 0.14) : panel.center + spec.offset
      );
      group.add(grommet, led);
    });
  });

  // 前左辅助状态指示灯组（保持左右平衡呼应）
  for (let i = 0; i < 2; i++) {
    const xPos = -196 + i * 3.0;
    const grommet = new THREE.Mesh(grommetGeo, finMat);
    grommet.position.set(xPos, flankCenterY, halfD + 0.04);
    const led = new THREE.Mesh(ledGeo, ledMats[i]);
    led.position.set(xPos, flankCenterY, halfD + 0.10);
    group.add(grommet, led);
  }

  return {
    group,
    update(time, duskFactor, nightFactor = duskFactor) {
      const pulse = Math.sin(time * 1.5);
      cyanCoveMat.emissiveIntensity = 1.45 + duskFactor * 1.15 + nightFactor * 0.65 + pulse * 0.12;
      frostedAcrylicMat.emissiveIntensity = 0.42 + duskFactor * 0.55 + nightFactor * 0.48 + pulse * 0.06;
      shelfGlowMat.opacity = 0.26 + duskFactor * 0.24 + nightFactor * 0.22 + pulse * 0.03;

      // 白昼保留清晰的桌面接触阴影；夜幕加深时接触阴影柔和淡出让位于冰青光环
      haloMat.opacity = Math.max(0.28, 0.96 - nightFactor * 0.58);
      const glowAlpha = Math.max(0, duskFactor * 0.36 + nightFactor * 0.58);
      nightHaloPlane.visible = glowAlpha > 0.005;
      nightHaloMat.opacity = glowAlpha * (0.94 + pulse * 0.06);

      if (ledMats[0]) ledMats[0].emissiveIntensity = 1.9 + duskFactor * 1.1 + nightFactor * 0.5;
      if (ledMats[1]) ledMats[1].emissiveIntensity = 1.9 + duskFactor * 1.0 + nightFactor * 0.45;
      if (ledMats[2]) {
        ledMats[2].emissiveIntensity = 1.3 + duskFactor * 0.9 + Math.abs(Math.sin(time * 2.0)) * 1.2;
      }
    },
  };
}
