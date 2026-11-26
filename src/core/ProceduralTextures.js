import * as THREE from 'three';

/**
 * 精工偏白模程序化纹理库（轻量化内存占用，参考 IOPLY_Campus_WhiteModel.glb 与工业硬件白模质感）
 * - 极简克制的低饱和白模色阶：矿物浅灰绿绒面草坪、暖灰微粒道路（标线直接烘焙）、香槟浅橡木百叶、清透冰青水波法线
 * - 纹理尺寸严格控制在 256–512，大幅降低显存占用同时保持高各向异性锐度
 */

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

function finalizeTexture(canvas, { repeatX = 1, repeatY = 1, srgb = true, anisotropy = 8, wrap = THREE.RepeatWrapping } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function hash2d(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

/**
 * 1. 偏白模斜纹修剪绒面草坪（低饱和矿物灰绿 #D9E1D6，保留极细腻 45° 修剪暗纹与微绒质感）
 */
export function createMowedLawnTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);

  ctx.fillStyle = '#d7dfd4';
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  const stripeW = 16;
  for (let x = -size; x < size; x += stripeW * 2) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(x, -size, stripeW, size * 2);
    ctx.fillStyle = 'rgba(130, 148, 128, 0.10)';
    ctx.fillRect(x + stripeW, -size, stripeW, size * 2);
  }
  ctx.restore();

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % size;
    const py = Math.floor(i / 4 / size);
    const n = (hash2d(px, py) - 0.5) * 7;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  return finalizeTexture(canvas, { repeatX: 20, repeatY: 16, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 2. 偏白模建筑级道路纹理（浅冷灰/银灰细粒沥青，标线直接烘焙进 UV，零 Z-Fighting）
 */
export function createAsphaltRoadTexture(variant = 'campus', maxAnisotropy = 8) {
  const w = 256;
  const h = 256;
  const { canvas, ctx } = makeCanvas(w, h);

  // 克制高级建筑白模道路灰：市政干道略深，园区环道浅冷灰，与白模无缝融合
  ctx.fillStyle = variant === 'arterial' ? '#b3bbc4' : variant === 'firelane' ? '#c2c9d1' : '#bcc3cc';
  ctx.fillRect(0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % w;
    const py = Math.floor(i / 4 / w);
    const grain = (hash2d(px, py) - 0.5) * 8;
    d[i] = Math.min(255, Math.max(0, d[i] + grain));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + grain));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + grain));
  }
  ctx.putImageData(img, 0, 0);

  // 两侧精致纯白边缘线
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(w * 0.045, 0, w * 0.015, h);
  ctx.fillRect(w * 0.94, 0, w * 0.015, h);

  if (variant === 'arterial') {
    // 柔和香槟金双中线 + 精致虚线分道线
    ctx.fillStyle = 'rgba(214, 178, 96, 0.85)';
    ctx.fillRect(w * 0.484, 0, w * 0.011, h);
    ctx.fillRect(w * 0.505, 0, w * 0.011, h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    for (let y = 14; y < h; y += 64) {
      ctx.fillRect(w * 0.265, y, w * 0.012, 32);
      ctx.fillRect(w * 0.723, y, w * 0.012, 32);
    }
  } else if (variant === 'firelane') {
    // 消防通道柔和琥珀边线与中心引导虚线
    ctx.fillStyle = 'rgba(218, 174, 84, 0.72)';
    ctx.fillRect(w * 0.072, 0, w * 0.012, h);
    ctx.fillRect(w * 0.916, 0, w * 0.012, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    for (let y = 16; y < h; y += 64) {
      ctx.fillRect(w * 0.493, y, w * 0.014, 30);
    }
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (let y = 16; y < h; y += 64) {
      ctx.fillRect(w * 0.493, y, w * 0.014, 28);
    }
  }

  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 3. 偏白模地面停车场烘焙纹理（浅灰石材沥青 + 纯白车位标线 + 冰青新能源充电位标识）
 */
export function createParkingLotTexture(cols = 2, rows = 8, evRowCount = 4, maxAnisotropy = 8) {
  const w = 512;
  const h = 512;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#c4cbd3';
  ctx.fillRect(0, 0, w, h);

  const marginX = w * 0.05;
  const marginY = h * 0.04;
  const usableH = h - marginY * 2;
  const rowH = usableH / rows;
  const stallW = cols === 2 ? w * 0.30 : w * 0.72;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 2.5;

  const drawBank = (xStart, xEnd, isEvBank) => {
    ctx.beginPath();
    ctx.moveTo(xStart, marginY);
    ctx.lineTo(xStart, h - marginY);
    ctx.moveTo(xEnd, marginY);
    ctx.lineTo(xEnd, h - marginY);
    ctx.stroke();

    for (let r = 0; r <= rows; r++) {
      const y = marginY + r * rowH;
      ctx.beginPath();
      ctx.moveTo(xStart, y);
      ctx.lineTo(xEnd, y);
      ctx.stroke();

      if (r < rows && isEvBank && r < evRowCount) {
        ctx.fillStyle = 'rgba(92, 206, 214, 0.22)';
        ctx.fillRect(xStart + 3, y + 3, xEnd - xStart - 6, rowH - 6);
      }
    }
  };

  if (cols === 2) {
    drawBank(marginX, marginX + stallW, true);
    drawBank(w - marginX - stallW, w - marginX, false);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(w * 0.5, marginY);
    ctx.lineTo(w * 0.5, h - marginY);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    drawBank(marginX, marginX + stallW, true);
  }

  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy, wrap: THREE.ClampToEdgeWrapping });
}

/**
 * 4. 迎宾石材广场铺装纹理（细腻浅白灰花岗岩拼缝）
 */
export function createPlazaPaverTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#e3e7ed';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 16;
  const cw = size / cols;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cw * 0.5);
    for (let c = -1; c <= cols; c++) {
      const shade = 230 + Math.floor((hash2d(c + 10, r + 20) - 0.5) * 10);
      ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 4})`;
      ctx.fillRect(c * cw + offset + 1, r * rh + 1, cw - 1.5, rh - 1.5);
    }
  }
  return finalizeTexture(canvas, { repeatX: 6, repeatY: 12, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 5. 偏白模香槟浅橡木纹铝板百叶纹理（呼应 KKAA 原木调与 IOPLY_Campus_WhiteModel 雅致暖木）
 */
export function createWoodLouverTexture(maxAnisotropy = 8) {
  const w = 256;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#d8cab6');
  grad.addColorStop(0.5, '#cbb99e');
  grad.addColorStop(1, '#c0ac90');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y += 2) {
    const alpha = 0.03 + hash2d(y, 4.2) * 0.06;
    ctx.fillStyle = hash2d(y, 9.1) > 0.5 ? `rgba(110, 86, 58, ${alpha})` : `rgba(255, 250, 242, ${alpha})`;
    ctx.fillRect(0, y, w, 1);
  }
  return finalizeTexture(canvas, { repeatX: 2, repeatY: 2, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 6. 雅致浅柚木亲水甲板纹理
 */
export function createTeakDeckTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#cfbfa7';
  ctx.fillRect(0, 0, size, size);

  const planks = 14;
  const ph = size / planks;
  for (let i = 0; i < planks; i++) {
    const tone = (hash2d(i, 5.1) - 0.5) * 12;
    ctx.fillStyle = `rgb(${208 + tone}, ${191 + tone * 0.9}, ${166 + tone * 0.8})`;
    ctx.fillRect(0, i * ph + 1.5, size, ph - 2);
    ctx.fillStyle = 'rgba(130, 114, 92, 0.35)';
    ctx.fillRect(0, i * ph, size, 1.5);
  }
  return finalizeTexture(canvas, { repeatX: 4, repeatY: 4, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 7. 克制建筑白模单晶硅光伏阵列纹理（深灰蓝晶格 + 浅银边框）
 */
export function createSolarPanelTexture(maxAnisotropy = 8) {
  const w = 256;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#47576a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#dbe2ea';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  const cols = 8;
  const rows = 4;
  const cw = (w - 8) / cols;
  const rh = (h - 8) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 4 + c * cw;
      const y = 4 + r * rh;
      const v = (hash2d(c, r) - 0.5) * 10;
      ctx.fillStyle = `rgb(${68 + v}, ${84 + v}, ${104 + v})`;
      ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2);
      ctx.fillStyle = 'rgba(220, 232, 245, 0.25)';
      ctx.fillRect(x + cw * 0.5, y + 1, 1, rh - 2);
    }
  }
  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 8. 细腻丝滑微澜水面法线贴图（柔和波纹，绝不杂乱发噪）
 */
export function createWaterNormalTexture(maxAnisotropy = 4) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      height[y * size + x] =
        Math.sin(u * 2 + v * 2) * 0.4 +
        Math.cos(u * 5 - v * 3 + 1.1) * 0.25 +
        Math.sin(u * 8 + v * 6) * 0.12 +
        Math.cos(u * 3 - v * 7) * 0.14;
    }
  }

  const strength = 1.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const yu = (y - 1 + size) % size;
      const yd = (y + 1) % size;
      const dx = (height[y * size + xr] - height[y * size + xl]) * strength;
      const dy = (height[yd * size + x] - height[yu * size + x]) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const idx = (y * size + x) * 4;
      d[idx] = Math.floor(((-dx / len) * 0.5 + 0.5) * 255);
      d[idx + 1] = Math.floor(((-dy / len) * 0.5 + 0.5) * 255);
      d[idx + 2] = Math.floor(((1 / len) * 0.5 + 0.5) * 255);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  return finalizeTexture(canvas, { repeatX: 12, repeatY: 10, srgb: false, anisotropy: maxAnisotropy });
}

/**
 * 9. E3 室内标准篮球体育馆浅枫木地板与柔和白模标线
 */
export function createBasketballCourtTexture(maxAnisotropy = 8) {
  const w = 512;
  const h = 256;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#9db4c4';
  ctx.fillRect(0, 0, w, h);

  const padX = 36;
  const padY = 24;
  const cw = w - padX * 2;
  const ch = h - padY * 2;

  ctx.fillStyle = '#e0cbb0';
  ctx.fillRect(padX, padY, cw, ch);
  for (let y = padY; y < padY + ch; y += 5) {
    const shade = (hash2d(y, 1.7) - 0.5) * 10;
    ctx.fillStyle = `rgb(${224 + shade}, ${203 + shade * 0.8}, ${176 + shade * 0.6})`;
    ctx.fillRect(padX, y, cw, 4);
  }

  const keyW = cw * 0.19;
  const keyH = ch * 0.34;
  ctx.fillStyle = '#7ea6bc';
  ctx.fillRect(padX, padY + (ch - keyH) / 2, keyW, keyH);
  ctx.fillRect(padX + cw - keyW, padY + (ch - keyH) / 2, keyW, keyH);

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, ch * 0.125, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(padX, padY, cw, ch);

  ctx.beginPath();
  ctx.moveTo(w / 2, padY);
  ctx.lineTo(w / 2, padY + ch);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, ch * 0.125, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeRect(padX, padY + (ch - keyH) / 2, keyW, keyH);
  ctx.strokeRect(padX + cw - keyW, padY + (ch - keyH) / 2, keyW, keyH);

  ctx.beginPath();
  ctx.arc(padX + keyW, h / 2, keyH * 0.36, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(padX + cw - keyW, h / 2, keyH * 0.36, Math.PI / 2, Math.PI * 1.5);
  ctx.stroke();

  const threeR = ch * 0.42;
  ctx.beginPath();
  ctx.arc(padX + cw * 0.06, h / 2, threeR, -Math.PI * 0.44, Math.PI * 0.44);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(padX + cw * 0.94, h / 2, threeR, Math.PI * 0.56, Math.PI * 1.44);
  ctx.stroke();

  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy, wrap: THREE.ClampToEdgeWrapping });
}

/**
 * 10. 室内哑光陶瓷白微格地板
 */
export function createInteriorFloorTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#eff1f5';
  ctx.fillRect(0, 0, size, size);

  const step = 32;
  ctx.strokeStyle = 'rgba(175, 184, 196, 0.30)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  return finalizeTexture(canvas, { repeatX: 10, repeatY: 10, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 11. 高级棚拍瓷白渐变背景（#F8F9FB -> #DDE2EC）、暮光安防背景与深邃星夜棚拍背景
 */
export function createStudioBackdropTexture(mode = 'day') {
  if (mode === 'night') {
    const w = 512;
    const h = 512;
    const { canvas, ctx } = makeCanvas(w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#040812');
    grad.addColorStop(0.38, '#081020');
    grad.addColorStop(0.68, '#0d192e');
    grad.addColorStop(0.86, '#111e34');
    grad.addColorStop(1.0, '#070e1c');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 柔和极微弱的地平线暗蓝紫空气辉光（绝不发灰、零雾感）
    const horizonGlow = ctx.createRadialGradient(w * 0.5, h * 0.72, 10, w * 0.5, h * 0.72, w * 0.65);
    horizonGlow.addColorStop(0, 'rgba(32, 62, 108, 0.22)');
    horizonGlow.addColorStop(0.6, 'rgba(18, 36, 68, 0.08)');
    horizonGlow.addColorStop(1, 'rgba(4, 8, 18, 0.0)');
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 0, w, h);

    // 细腻通透的遥远星点（上半穹顶，大小与色温自然错落）
    const starCount = 150;
    for (let i = 0; i < starCount; i++) {
      const sx = hash2d(i * 1.37, 17.3) * w;
      const sy = Math.pow(hash2d(i * 2.91, 43.1), 1.25) * (h * 0.62);
      const brightness = hash2d(i * 5.13, 89.7);
      const radius = 0.45 + brightness * 0.95;
      const alpha = (0.18 + brightness * 0.68) * (1 - sy / (h * 0.72));

      const tintSeed = hash2d(i * 7.77, 11.9);
      let rgb = '226, 238, 255';
      if (tintSeed < 0.22) rgb = '184, 214, 255';
      else if (tintSeed > 0.84) rgb = '255, 240, 214';

      ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();

      // 少数亮星叠加极细微星芒，增强午夜通透感
      if (brightness > 0.88) {
        const glowR = radius * 3.4;
        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
        sg.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.55).toFixed(3)})`);
        sg.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  const w = 16;
  const h = 256;
  const { canvas, ctx } = makeCanvas(w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  if (mode === 'dusk') {
    grad.addColorStop(0, '#0f1824');
    grad.addColorStop(0.5, '#192739');
    grad.addColorStop(1, '#121c29');
  } else {
    grad.addColorStop(0, '#F8F9FB');
    grad.addColorStop(0.58, '#EDF0F5');
    grad.addColorStop(1, '#DDE2EC');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 12. 消防通道警示斜纹贴图
 */
export function createHazardStripeTexture(maxAnisotropy = 4) {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
  for (let i = -size; i < size * 2; i += 24) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 11, 0);
    ctx.lineTo(i + 11 - size, size);
    ctx.lineTo(i - size, size);
    ctx.closePath();
    ctx.fill();
  }
  return finalizeTexture(canvas, { repeatX: 6, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 13. 羽化径向渐变地面光晕贴图（路灯 / 庭院柱灯 / 门廊下照 / 车棚微光，彻底杜绝生硬实心圆盘）
 */
export function createFeatheredLightPoolTexture(
  innerColor = '255, 232, 180',
  midColor = '255, 174, 72',
  maxAnisotropy = 4
) {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size, size);
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, `rgba(${innerColor}, 0.96)`);
  grad.addColorStop(0.18, `rgba(${innerColor}, 0.72)`);
  grad.addColorStop(0.42, `rgba(${midColor}, 0.34)`);
  grad.addColorStop(0.68, `rgba(${midColor}, 0.11)`);
  grad.addColorStop(0.88, `rgba(${midColor}, 0.025)`);
  grad.addColorStop(1.0, `rgba(${midColor}, 0.0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return finalizeTexture(canvas, {
    repeatX: 1,
    repeatY: 1,
    srgb: true,
    anisotropy: maxAnisotropy,
    wrap: THREE.ClampToEdgeWrapping,
  });
}

/**
 * 14. 路灯极柔和羽化体积光锥贴图（上亮下渐隐，仅配合 AdditiveBlending 使用，0 PointLight 开销）
 */
export function createLightConeTexture(rgb = '255, 206, 128') {
  const w = 64;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, `rgba(${rgb}, 0.85)`);
  grad.addColorStop(0.16, `rgba(${rgb}, 0.42)`);
  grad.addColorStop(0.48, `rgba(${rgb}, 0.14)`);
  grad.addColorStop(0.82, `rgba(${rgb}, 0.03)`);
  grad.addColorStop(1.0, `rgba(${rgb}, 0.0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  return finalizeTexture(canvas, {
    repeatX: 1,
    repeatY: 1,
    srgb: true,
    anisotropy: 2,
    wrap: THREE.ClampToEdgeWrapping,
  });
}

/**
 * 15. 建筑室内分间分色温光带纹理（4000K 物理实验室暖白 + 3000K 交流区暖金 + 天花格栅亮带，杜绝扁平色块！）
 */
export function createNightWindowGlowTexture(maxAnisotropy = 4) {
  const w = 512;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#24180c';
  ctx.fillRect(0, 0, w, h);

  // 8 个独立实验室/办公室开间，每间呈现微妙色温差、亮度差与顶棚柔和洗墙衰减
  const bays = 8;
  const bayW = w / bays;
  for (let b = 0; b < bays; b++) {
    const x0 = b * bayW;
    const warmMode = hash2d(b, 3.7);
    const intensity = 0.72 + hash2d(b, 9.4) * 0.28;

    // 区分 4000K 实验室暖白（清爽偏米白）与 3000K 讨论/办公区琥珀暖金
    const topCol =
      warmMode > 0.36
        ? `rgba(255, 245, 220, ${(0.98 * intensity).toFixed(2)})`
        : `rgba(255, 224, 166, ${(0.95 * intensity).toFixed(2)})`;
    const midCol =
      warmMode > 0.36
        ? `rgba(255, 220, 158, ${(0.76 * intensity).toFixed(2)})`
        : `rgba(255, 192, 108, ${(0.78 * intensity).toFixed(2)})`;
    const botCol =
      warmMode > 0.36
        ? `rgba(220, 164, 96, ${(0.44 * intensity).toFixed(2)})`
        : `rgba(196, 128, 60, ${(0.42 * intensity).toFixed(2)})`;

    // 垂直顶棚洗墙渐变（上方最亮，贴近楼板自然沉静，勾勒清晰楼层分层）
    const vGrad = ctx.createLinearGradient(0, 0, 0, h);
    vGrad.addColorStop(0.0, 'rgba(60, 42, 24, 0.65)'); // 顶部楼板投影暗边
    vGrad.addColorStop(0.11, topCol);
    vGrad.addColorStop(0.28, topCol);
    vGrad.addColorStop(0.62, midCol);
    vGrad.addColorStop(0.92, botCol);
    vGrad.addColorStop(1.0, 'rgba(54, 36, 18, 0.55)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(x0 + 2, 0, bayW - 4, h);

    // 顶棚内嵌格栅灯盘高光条（近看可见实验室顶灯韵律）
    const fixtureCount = 3;
    const fxStep = (bayW - 10) / fixtureCount;
    for (let f = 0; f < fixtureCount; f++) {
      const fx = x0 + 6 + f * fxStep;
      ctx.fillStyle = warmMode > 0.36 ? 'rgba(255, 252, 242, 0.94)' : 'rgba(255, 236, 194, 0.9)';
      ctx.fillRect(fx, 10, fxStep * 0.62, 7);
    }

    // 中部微弱实验台/隔断剪影层次（营造纵深感而非空壳发光）
    ctx.fillStyle = 'rgba(92, 62, 34, 0.24)';
    ctx.fillRect(x0 + bayW * 0.14, h * 0.72, bayW * 0.72, h * 0.2);

    // 房间隔墙细暗缝（让长立面呈现建筑分间节奏）
    ctx.fillStyle = 'rgba(28, 22, 18, 0.78)';
    ctx.fillRect(x0, 0, 3.5, h);
  }

  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
}
