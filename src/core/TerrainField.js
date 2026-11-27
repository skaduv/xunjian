import { PLINTH_CONFIG } from '../config/campusConfig.js';

/**
 * 园区内外共享的连续高程场（无循环依赖的纯函数模块）
 *
 * 龙蟠山（园区东缘）原先在 x≈229→241 被强制压回 0，外域丘陵又在 dOut≤22m 内强制为 0，
 * 二者之间形成一条贯穿南北的人工"深沟"（顶视图里一条笔直的暗色条带）。
 * 现在：园区内山体保留到边界，外域地形以同一山体高度为起点向外自然衰减，山脊连续越过园区边界。
 */

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function subtleTerrace(h, step = 1.65) {
  if (h <= 0.02) return 0;
  const k = h / step;
  const i = Math.floor(k);
  const f = k - i;
  const stepped = (i + smoothstep(0.18, 0.82, f)) * step;
  return h * 0.62 + stepped * 0.38;
}

const LONGPAN_PEAKS = [
  { cx: 222, cz: -78, rx: 48, rz: 82, h: 22.0 },
  { cx: 226, cz: 72, rx: 44, rz: 78, h: 18.5 },
  { cx: 234, cz: -4, rx: 32, rz: 48, h: 12.0 },
];

/** 龙蟠山高度（园区内，含东边界处的真实高度，不再向边界压零） */
export function sampleLongpanHeight(x, z) {
  if (x < 164) return 0;
  const westMask = smoothstep(166, 186, x);
  let raw = 0;
  for (const p of LONGPAN_PEAKS) {
    const nx = (x - p.cx) / p.rx;
    const nz = (z - p.cz) / p.rz;
    const r2 = nx * nx + nz * nz;
    if (r2 < 1.35) {
      raw = Math.max(raw, Math.exp(-r2 * 2.15) * p.h);
    }
  }
  // 1.35 截断处的残值做平滑归零，避免山体外缘出现细小台阶
  const hd = PLINTH_CONFIG.depth * 0.5 - 3.5;
  const edgeFadeZ = smoothstep(hd + 2.0, hd - 14.0, Math.abs(z));
  const tail = Math.exp(-1.35 * 2.15) * 22.0;
  const h = Math.max(0, raw - tail * 0.35) * westMask * edgeFadeZ;
  return subtleTerrace(h, 1.85);
}

/**
 * 龙蟠山向园区外的延续：以园区东边界处的山体高度为起点，沿外距 dOut 在 ~150m 内平滑衰减。
 * dOut 为到园区圆角矩形的外距（<=0 表示园区内）。
 */
export function sampleLongpanCarry(x, z, dOut) {
  if (x < 200) return 0;
  const edgeX = PLINTH_CONFIG.width * 0.5 - 1.2;
  const hEdge = sampleLongpanHeight(Math.min(x, edgeX), z);
  if (hEdge <= 0.02) return 0;
  const decay = smoothstep(150, 0, Math.max(0, dOut));
  return hEdge * decay;
}
