import * as THREE from 'three';

/**
 * 精工微缩棚拍程序化纹理库（温暖瓷砂 / 丝缎陶灰 / 温润暖石 / KKAA 原木 / 深石板沥青 / 鼠尾草绿绒草坪）
 * - 彻底告别漂白惨白！色阶精准匹配工业设计微缩模型棚拍标准，赋予画面丰富明暗层次与材质触感
 * - 严格保留全部已有导出函数名与参数签名（100% 向后兼容）
 * - 完整保留 v2.1 1024×512 2:1 锐利 1px 星夜棚拍背景
 */

const textureCache = new Map();

function getOrCreateCachedTexture(key, factory) {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const tex = factory();
  textureCache.set(key, tex);
  tex.addEventListener('dispose', () => {
    if (textureCache.get(key) === tex) {
      textureCache.delete(key);
    }
  });
  return tex;
}

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

function smoothNoise2d(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2d(x0, y0);
  const b = hash2d(x1, y0);
  const c = hash2d(x0, y1);
  const d = hash2d(x1, y1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * 1. 生机盎然的健康叶绿素航拍翡翠草坪（深邃自然 #36662d + 极克制微柔修剪质感 + 细腻有机草绒肌理，零斑马纹零拼缝）
 */
export function createMowedLawnTexture(maxAnisotropy = 8) {
  return getOrCreateCachedTexture(`mowedLawn:${maxAnisotropy}`, () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size, size);

    const img = ctx.createImageData(size, size);
    const d = img.data;
    const baseR = 54; // #36662d 浓郁自然航拍叶绿素翡翠绿（对齐参考图健康深绿草甸）
    const baseG = 102;
    const baseB = 45;
    const stripeCycles = 4; // 整数周期：沿 X/Y 边界严格闭合，彻底消除 tile 接缝

    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const idx = (y * size + x) * 4;

        // 极克制柔和的 45° 园林修剪微光韵律（彻底消除远近景灯芯绒/斑马条纹感）
        const phase = (u + v) * Math.PI * 2 * stripeCycles;
        const stripeWave = Math.sin(phase) * 0.85 + Math.sin(phase * 3) * 0.12;
        const stripeR = stripeWave * 1.8;
        const stripeG = stripeWave * 2.4;
        const stripeB = stripeWave * 1.0;

        // 全整数周期多尺度柔和草绒层次 + 细腻有机叶丛颗粒
        const macro = (smoothNoise2d(u * 4, v * 4, 4) - 0.5) * 10.5;
        const mid = (smoothNoise2d(u * 8 + 1.7, v * 8 + 3.1, 8) - 0.5) * 8.0;
        const fine = (smoothNoise2d(u * 16 + 4.3, v * 16 + 0.9, 16) - 0.5) * 6.5;
        const tuft = (smoothNoise2d(u * 32 + 2.1, v * 32 + 5.7, 32) - 0.5) * 5.0;
        const micro = (hash2d(x, y) - 0.5) * 7.2;
        const sunPatch = (smoothNoise2d(u * 3 + 0.6, v * 3 + 2.1, 3) - 0.5) * 7.5;

        d[idx] = Math.min(255, Math.max(0, Math.round(baseR + stripeR + macro * 0.72 + mid * 0.74 + fine * 0.72 + tuft * 0.7 + micro * 0.68 + sunPatch * 0.88)));
        d[idx + 1] = Math.min(255, Math.max(0, Math.round(baseG + stripeG + macro * 1.04 + mid * 1.0 + fine * 0.96 + tuft * 0.92 + micro * 0.88 + sunPatch * 0.62)));
        d[idx + 2] = Math.min(255, Math.max(0, Math.round(baseB + stripeB + macro * 0.52 + mid * 0.56 + fine * 0.56 + tuft * 0.54 + micro * 0.52 - sunPatch * 0.30)));
        d[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    return finalizeTexture(canvas, { repeatX: 20, repeatY: 16, srgb: true, anisotropy: maxAnisotropy });
  });
}

/**
 * 2. 丝缎石板炭灰道路纹理（市政干道深石板灰 + 园区环道暖石墨灰，清晰标线直接烘焙，零 Z-Fighting）
 */
export function createAsphaltRoadTexture(variant = 'campus', maxAnisotropy = 8) {
  const w = 256;
  const h = 256;
  const { canvas, ctx } = makeCanvas(w, h);

  // 深邃利落的深石板炭灰沥青，与浓郁翡翠草坪形成高级航拍明暗反差
  ctx.fillStyle = variant === 'arterial' ? '#404750' : variant === 'firelane' ? '#565d67' : '#4c535d';
  ctx.fillRect(0, 0, w, h);

  // 柔和车辙与细粒沥青石骨料肌理
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const u = x / w;
      const track =
        (Math.exp(-Math.pow((u - 0.28) / 0.08, 2)) + Math.exp(-Math.pow((u - 0.72) / 0.08, 2))) * 3.5;
      const grain = (hash2d(x, y) - 0.5) * 11;
      const patch = (smoothNoise2d((x / w) * 8, (y / h) * 8, 8) - 0.5) * 7;
      const delta = grain + patch + track;
      d[idx] = Math.min(255, Math.max(0, d[idx] + delta));
      d[idx + 1] = Math.min(255, Math.max(0, d[idx + 1] + delta));
      d[idx + 2] = Math.min(255, Math.max(0, d[idx + 2] + delta * 1.03));
    }
  }
  ctx.putImageData(img, 0, 0);

  // 两侧精致暖白标线
  ctx.fillStyle = 'rgba(236, 232, 224, 0.88)';
  ctx.fillRect(w * 0.045, 0, w * 0.015, h);
  ctx.fillRect(w * 0.94, 0, w * 0.015, h);

  if (variant === 'arterial') {
    // 沉稳琥珀金双黄实线 + 精致暖白虚线分道线
    ctx.fillStyle = 'rgba(218, 166, 66, 0.90)';
    ctx.fillRect(w * 0.484, 0, w * 0.011, h);
    ctx.fillRect(w * 0.505, 0, w * 0.011, h);

    ctx.fillStyle = 'rgba(236, 232, 224, 0.80)';
    for (let y = 14; y < h; y += 64) {
      ctx.fillRect(w * 0.265, y, w * 0.012, 32);
      ctx.fillRect(w * 0.723, y, w * 0.012, 32);
    }
  } else if (variant === 'firelane') {
    // 消防通道暖琥珀边线与中心引导虚线
    ctx.fillStyle = 'rgba(228, 168, 58, 0.86)';
    ctx.fillRect(w * 0.072, 0, w * 0.013, h);
    ctx.fillRect(w * 0.915, 0, w * 0.013, h);
    ctx.fillStyle = 'rgba(236, 232, 224, 0.78)';
    for (let y = 16; y < h; y += 64) {
      ctx.fillRect(w * 0.493, y, w * 0.014, 30);
    }
  } else {
    ctx.fillStyle = 'rgba(236, 232, 224, 0.78)';
    for (let y = 16; y < h; y += 64) {
      ctx.fillRect(w * 0.493, y, w * 0.014, 28);
    }
  }

  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 3. 精工丝缎石板灰地面停车场烘焙纹理（精细颗粒 + 暖白车位标线 + 晶青新能源充电位标识）
 */
export function createParkingLotTexture(cols = 2, rows = 8, evRowCount = 4, maxAnisotropy = 8) {
  const w = 512;
  const h = 512;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#59606a';
  ctx.fillRect(0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % w;
    const py = Math.floor(i / 4 / w);
    const grain = (hash2d(px, py) - 0.5) * 9;
    d[i] = Math.min(255, Math.max(0, d[i] + grain));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + grain));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + grain));
  }
  ctx.putImageData(img, 0, 0);

  const marginX = w * 0.05;
  const marginY = h * 0.04;
  const usableH = h - marginY * 2;
  const rowH = usableH / rows;
  const stallW = cols === 2 ? w * 0.30 : w * 0.72;

  ctx.strokeStyle = 'rgba(234, 230, 222, 0.88)';
  ctx.lineWidth = 2.6;

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
        ctx.fillStyle = 'rgba(56, 206, 218, 0.28)';
        ctx.fillRect(xStart + 3, y + 3, xEnd - xStart - 6, rowH - 6);
        ctx.strokeStyle = 'rgba(110, 232, 240, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(xStart + 5, y + 5, xEnd - xStart - 10, rowH - 10);
        ctx.strokeStyle = 'rgba(234, 230, 222, 0.88)';
        ctx.lineWidth = 2.6;
      }
    }
  };

  if (cols === 2) {
    drawBank(marginX, marginX + stallW, true);
    drawBank(w - marginX - stallW, w - marginX, false);
    ctx.strokeStyle = 'rgba(234, 230, 222, 0.72)';
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
 * 4. 温润洞石/花岗岩迎宾广场铺装纹理（暖灰米石拼缝与自然色阶微差）
 */
export function createPlazaPaverTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#a89f92';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 16;
  const cw = size / cols;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cw * 0.5);
    for (let c = -1; c <= cols; c++) {
      const n = (hash2d(c + 10, r + 20) - 0.5) * 14;
      const red = Math.round(201 + n);
      const grn = Math.round(193 + n * 0.95);
      const blu = Math.round(181 + n * 0.88);
      ctx.fillStyle = `rgb(${red}, ${grn}, ${blu})`;
      ctx.fillRect(c * cw + offset + 1.2, r * rh + 1.2, cw - 2.0, rh - 2.0);
    }
  }

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % size;
    const py = Math.floor(i / 4 / size);
    const speck = (hash2d(px, py) - 0.5) * 6;
    d[i] = Math.min(255, Math.max(0, d[i] + speck));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + speck));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + speck));
  }
  ctx.putImageData(img, 0, 0);

  return finalizeTexture(canvas, { repeatX: 6, repeatY: 12, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 5. KKAA 温润红雪松/橡木纹铝板百叶纹理（饱满温润原木色阶与细腻木纤维肌理）
 */
export function createWoodLouverTexture(maxAnisotropy = 8) {
  const w = 256;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#b6895e');
  grad.addColorStop(0.48, '#a87b50');
  grad.addColorStop(1, '#966a43');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 自然横向木纹纤维与柔和年轮明暗变化
  for (let y = 0; y < h; y += 2) {
    const seed = hash2d(y, 4.2);
    const alpha = 0.04 + seed * 0.09;
    ctx.fillStyle = hash2d(y, 9.1) > 0.48
      ? `rgba(74, 48, 26, ${alpha.toFixed(3)})`
      : `rgba(232, 198, 158, ${(alpha * 0.72).toFixed(3)})`;
    ctx.fillRect(0, y, w, 1.5);
  }

  // 精致百叶格栅微暗拼缝（提升远景与中景节奏感）
  const slatStep = 16;
  for (let y = 0; y < h; y += slatStep) {
    ctx.fillStyle = 'rgba(58, 38, 22, 0.26)';
    ctx.fillRect(0, y, w, 1.5);
    ctx.fillStyle = 'rgba(245, 222, 192, 0.14)';
    ctx.fillRect(0, y + 1.5, w, 1);
  }

  return finalizeTexture(canvas, { repeatX: 2, repeatY: 2, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 6. 温润蜜柚木亲水甲板纹理（清晰深色木板拼缝与丰富木板色差）
 */
export function createTeakDeckTexture(maxAnisotropy = 8) {
  return getOrCreateCachedTexture(`teakDeck:${maxAnisotropy}`, () => {
    const size = 256;
    const { canvas, ctx } = makeCanvas(size, size);
    ctx.fillStyle = '#9f764e';
    ctx.fillRect(0, 0, size, size);

    const planks = 14;
    const ph = size / planks;
    for (let i = 0; i < planks; i++) {
      const tone = (hash2d(i, 5.1) - 0.5) * 18;
      const r = Math.round(160 + tone);
      const g = Math.round(118 + tone * 0.85);
      const b = Math.round(78 + tone * 0.7);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, i * ph + 1.6, size, ph - 2.0);

      // 细腻木纹丝
      ctx.fillStyle = 'rgba(72, 48, 28, 0.12)';
      ctx.fillRect(0, i * ph + ph * 0.42, size, 1);
      ctx.fillStyle = 'rgba(235, 200, 160, 0.10)';
      ctx.fillRect(0, i * ph + ph * 0.72, size, 1);

      // 深色压缝
      ctx.fillStyle = 'rgba(54, 38, 24, 0.56)';
      ctx.fillRect(0, i * ph, size, 1.6);
    }
    return finalizeTexture(canvas, { repeatX: 4, repeatY: 4, srgb: true, anisotropy: maxAnisotropy });
  });
}

/**
 * 7. 精工单晶硅光伏阵列纹理（深靛石板蓝晶格 + 拉丝钛铝边框）
 */
export function createSolarPanelTexture(maxAnisotropy = 8) {
  return getOrCreateCachedTexture(`solarPanel:${maxAnisotropy}`, () => {
    const w = 256;
    const h = 128;
    const { canvas, ctx } = makeCanvas(w, h);

    ctx.fillStyle = '#253345';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#9ea5ae';
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
        ctx.fillStyle = `rgb(${Math.round(38 + v)}, ${Math.round(52 + v)}, ${Math.round(72 + v)})`;
        ctx.fillRect(x + 1, y + 1, cw - 2, rh - 2);
        ctx.fillStyle = 'rgba(182, 204, 224, 0.22)';
        ctx.fillRect(x + cw * 0.5, y + 1, 1, rh - 2);
      }
    }
    return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
  });
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
        Math.sin(u * 2 + v * 2) * 0.42 +
        Math.cos(u * 5 - v * 3 + 1.1) * 0.24 +
        Math.sin(u * 8 + v * 6) * 0.10 +
        Math.cos(u * 3 - v * 7) * 0.14;
    }
  }

  const strength = 1.35;
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

  return finalizeTexture(canvas, { repeatX: 10, repeatY: 8, srgb: false, anisotropy: maxAnisotropy });
}

/**
 * 9. E3 室内标准篮球体育馆温润枫木地板与石青边区
 */
export function createBasketballCourtTexture(maxAnisotropy = 8) {
  const w = 512;
  const h = 256;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#486a78';
  ctx.fillRect(0, 0, w, h);

  const padX = 36;
  const padY = 24;
  const cw = w - padX * 2;
  const ch = h - padY * 2;

  ctx.fillStyle = '#c79b6b';
  ctx.fillRect(padX, padY, cw, ch);
  for (let y = padY; y < padY + ch; y += 5) {
    const shade = (hash2d(y, 1.7) - 0.5) * 12;
    ctx.fillStyle = `rgb(${Math.round(199 + shade)}, ${Math.round(155 + shade * 0.8)}, ${Math.round(107 + shade * 0.6)})`;
    ctx.fillRect(padX, y, cw, 4);
  }

  const keyW = cw * 0.19;
  const keyH = ch * 0.34;
  ctx.fillStyle = '#3d7888';
  ctx.fillRect(padX, padY + (ch - keyH) / 2, keyW, keyH);
  ctx.fillRect(padX + cw - keyW, padY + (ch - keyH) / 2, keyW, keyH);

  ctx.beginPath();
  ctx.arc(w / 2, h / 2, ch * 0.125, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#f4efe6';
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
 * 10. 室内温润暖石水磨石微格地板
 */
export function createInteriorFloorTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#cfc9bf';
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % size;
    const py = Math.floor(i / 4 / size);
    const n = (hash2d(px, py) - 0.5) * 6;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const step = 32;
  ctx.strokeStyle = 'rgba(118, 110, 98, 0.28)';
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
 * 11. 温暖瓷砂棚拍无影墙背景（呼应参考图暖象牙瓷砂影调）、暮光安防背景与 v2.1 锐利 1px 星夜棚拍背景
 */
export function createStudioBackdropTexture(mode = 'day') {
  if (mode === 'night') {
    // 1024×512 宽屏 2:1 比例深空夜蓝渐变背景，杜绝 16:9 视口下星点被横向拉宽发糊（保留 v2.1 锐利 1px 星空）
    const w = 1024;
    const h = 512;
    const { canvas, ctx } = makeCanvas(w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#040812');
    grad.addColorStop(0.36, '#070e1d');
    grad.addColorStop(0.64, '#0a1426');
    grad.addColorStop(0.86, '#111f36');
    grad.addColorStop(1.0, '#081120');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 极克制的地平线深靛蓝微辉（丝滑渐变、绝不发灰、零雾感）
    const horizonGlow = ctx.createRadialGradient(w * 0.5, h * 0.78, 24, w * 0.5, h * 0.78, w * 0.52);
    horizonGlow.addColorStop(0.0, 'rgba(30, 58, 102, 0.18)');
    horizonGlow.addColorStop(0.55, 'rgba(16, 34, 64, 0.06)');
    horizonGlow.addColorStop(1.0, 'rgba(4, 8, 18, 0.0)');
    ctx.fillStyle = horizonGlow;
    ctx.fillRect(0, 0, w, h);

    // 极细 1px 克制微星（仅在上半深空静谧点缀，绝不加模糊光晕圈、绝不发糊）
    const starCount = 135;
    for (let i = 0; i < starCount; i++) {
      const sx = Math.floor(hash2d(i * 1.37, 17.3) * w);
      const sy = Math.floor(Math.pow(hash2d(i * 2.91, 43.1), 1.35) * (h * 0.56));
      const brightness = hash2d(i * 5.13, 89.7);
      const heightFade = Math.max(0, 1 - sy / (h * 0.62));
      const alpha = (0.12 + brightness * 0.38) * heightFade;

      const tintSeed = hash2d(i * 7.77, 11.9);
      let rgb = '224, 236, 255';
      if (tintSeed < 0.25) rgb = '178, 212, 255';
      else if (tintSeed > 0.85) rgb = '255, 240, 216';

      ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
      ctx.fillRect(sx, sy, 1, 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  if (mode === 'dusk') {
    const w = 16;
    const h = 256;
    const { canvas, ctx } = makeCanvas(w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#0c1524');
    grad.addColorStop(0.45, '#162336');
    grad.addColorStop(0.75, '#1e2c40');
    grad.addColorStop(1.0, '#1b283a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // 白昼无界云雾地平线大气背景（精准对齐场景远雾 #dde5e0 与周边体积云海，彻底消除硬地平线断层）
  const w = 512;
  const h = 512;
  const { canvas, ctx } = makeCanvas(w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, '#d8e4e2');
  grad.addColorStop(0.42, '#dde5e0');
  grad.addColorStop(0.74, '#dce4df');
  grad.addColorStop(1.0, '#d3ddd8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 柔和航拍日光大气漫射高光（呼应斜射暖阳方向，令云雾天际通透自然）
  const sunHaze = ctx.createRadialGradient(w * 0.32, h * 0.34, 18, w * 0.36, h * 0.42, w * 0.68);
  sunHaze.addColorStop(0.0, 'rgba(255, 253, 246, 0.42)');
  sunHaze.addColorStop(0.50, 'rgba(242, 248, 244, 0.14)');
  sunHaze.addColorStop(1.0, 'rgba(182, 198, 191, 0.08)');
  ctx.fillStyle = sunHaze;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
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
  return getOrCreateCachedTexture(`featheredLightPool:${innerColor}|${midColor}|${maxAnisotropy}`, () => {
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

    const vGrad = ctx.createLinearGradient(0, 0, 0, h);
    vGrad.addColorStop(0.0, 'rgba(60, 42, 24, 0.65)');
    vGrad.addColorStop(0.11, topCol);
    vGrad.addColorStop(0.28, topCol);
    vGrad.addColorStop(0.62, midCol);
    vGrad.addColorStop(0.92, botCol);
    vGrad.addColorStop(1.0, 'rgba(54, 36, 18, 0.55)');
    ctx.fillStyle = vGrad;
    ctx.fillRect(x0 + 2, 0, bayW - 4, h);

    const fixtureCount = 3;
    const fxStep = (bayW - 10) / fixtureCount;
    for (let f = 0; f < fixtureCount; f++) {
      const fx = x0 + 6 + f * fxStep;
      ctx.fillStyle = warmMode > 0.36 ? 'rgba(255, 252, 242, 0.94)' : 'rgba(255, 236, 194, 0.9)';
      ctx.fillRect(fx, 10, fxStep * 0.62, 7);
    }

    ctx.fillStyle = 'rgba(92, 62, 34, 0.24)';
    ctx.fillRect(x0 + bayW * 0.14, h * 0.72, bayW * 0.72, h * 0.2);

    ctx.fillStyle = 'rgba(28, 22, 18, 0.78)';
    ctx.fillRect(x0, 0, 3.5, h);
  }

  return finalizeTexture(canvas, { repeatX: 1, repeatY: 1, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 16. 温润预制暖石/清水陶土肌理（可选辅助纹理：赋予大面石墙与建筑构件细腻矿物触感）
 */
export function createWarmStoneTexture(maxAnisotropy = 8) {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#c8c1b6';
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const macro = (smoothNoise2d((x / size) * 5, (y / size) * 5, 5) - 0.5) * 10;
      const fine = (hash2d(x, y) - 0.5) * 6;
      const delta = macro + fine;
      d[idx] = Math.min(255, Math.max(0, d[idx] + delta));
      d[idx + 1] = Math.min(255, Math.max(0, d[idx + 1] + delta * 0.96));
      d[idx + 2] = Math.min(255, Math.max(0, d[idx + 2] + delta * 0.9));
    }
  }
  ctx.putImageData(img, 0, 0);

  return finalizeTexture(canvas, { repeatX: 4, repeatY: 4, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 17. 精密拉丝钛铝/阳极金属纹理（用于硬件底座压边、散热鳍片与屋顶机电外壳）
 */
export function createBrushedMetalTexture(baseHex = '#b8b2a8', maxAnisotropy = 8) {
  const w = 256;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < h; y++) {
    const v = hash2d(y, 13.7);
    const alpha = 0.025 + v * 0.045;
    ctx.fillStyle = v > 0.5 ? `rgba(255, 252, 246, ${alpha.toFixed(3)})` : `rgba(34, 38, 44, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, y, w, 1);
  }
  return finalizeTexture(canvas, { repeatX: 4, repeatY: 2, srgb: true, anisotropy: maxAnisotropy });
}

/**
 * 18. 柔和奶油感接触阴影 AO 圆盘贴图（用于树木、车辆、小品接地接触阴影）
 */
export function createContactShadowTexture(maxAnisotropy = 4) {
  return getOrCreateCachedTexture(`contactShadow:${maxAnisotropy}`, () => {
    const size = 128;
    const { canvas, ctx } = makeCanvas(size, size);
    const half = size * 0.5;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.0, 'rgba(18, 34, 20, 0.74)');
    grad.addColorStop(0.38, 'rgba(22, 38, 24, 0.46)');
    grad.addColorStop(0.72, 'rgba(26, 42, 26, 0.15)');
    grad.addColorStop(1.0, 'rgba(26, 42, 26, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    return finalizeTexture(canvas, {
      repeatX: 1,
      repeatY: 1,
      srgb: true,
      anisotropy: maxAnisotropy,
      wrap: THREE.ClampToEdgeWrapping,
    });
  });
}
