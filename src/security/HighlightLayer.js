import * as THREE from 'three';
import { BUILDING_WINGS, ELEVATIONS, SECURITY_GROUPS } from '../config/campusConfig.js';

/**
 * 楼栋选中高亮图层（为第二阶段仪表盘"选中地块发光描边 + 定位气泡"预埋）
 * - 按 groupId 把该楼栋全部体量做 0.5m 栅格并集，提取外轮廓（自动消除体量之间的内部接缝线）
 * - 屋面高度一圈实线描边 + 宽幅柔光晕，地面一圈淡描边，屋面半透明填充
 * - 上方悬浮定位气泡（Sprite）+ 垂直引线，呼吸脉冲动画
 * - 全部 MeshBasic / toneMapped=false，昼夜模式下亮度一致，不投射阴影
 */

const CELL = 0.5;
const ACCENT = new THREE.Color('#c9f26b');

function buildFootprintOutline(rects) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x1); minZ = Math.min(minZ, r.z1);
    maxX = Math.max(maxX, r.x2); maxZ = Math.max(maxZ, r.z2);
  }
  const nx = Math.round((maxX - minX) / CELL);
  const nz = Math.round((maxZ - minZ) / CELL);
  const grid = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const cz = minZ + (j + 0.5) * CELL;
    for (let i = 0; i < nx; i++) {
      const cx = minX + (i + 0.5) * CELL;
      for (const r of rects) {
        if (cx > r.x1 && cx < r.x2 && cz > r.z1 && cz < r.z2) { grid[j * nx + i] = 1; break; }
      }
    }
  }
  const inside = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && grid[j * nx + i] === 1;
  const segs = [];
  // 水平边（沿 X），合并连续单元
  for (let j = 0; j <= nz; j++) {
    for (const side of [0, 1]) {
      let start = -1;
      for (let i = 0; i <= nx; i++) {
        const edge = i < nx && (side === 0 ? inside(i, j) && !inside(i, j - 1) : inside(i, j - 1) && !inside(i, j));
        if (edge && start < 0) start = i;
        if (!edge && start >= 0) {
          const z = minZ + j * CELL;
          segs.push([minX + start * CELL, z, minX + i * CELL, z]);
          start = -1;
        }
      }
    }
  }
  // 竖直边（沿 Z）
  for (let i = 0; i <= nx; i++) {
    for (const side of [0, 1]) {
      let start = -1;
      for (let j = 0; j <= nz; j++) {
        const edge = j < nz && (side === 0 ? inside(i, j) && !inside(i - 1, j) : inside(i - 1, j) && !inside(i, j));
        if (edge && start < 0) start = j;
        if (!edge && start >= 0) {
          const x = minX + i * CELL;
          segs.push([x, minZ + start * CELL, x, minZ + j * CELL]);
          start = -1;
        }
      }
    }
  }
  return { segs, bounds: { minX, minZ, maxX, maxZ } };
}

function ribbonGeometry(segs, width, y, height = 0.12) {
  const geos = [];
  for (const [x1, z1, x2, z2] of segs) {
    const len = Math.hypot(x2 - x1, z2 - z1) + width; // 两端各外延半宽，转角自然闭合
    const g = new THREE.BoxGeometry(len, height, width);
    g.rotateY(-Math.atan2(z2 - z1, x2 - x1));
    g.translate((x1 + x2) / 2, y, (z1 + z2) / 2);
    geos.push(g);
  }
  const merged = mergeBoxes(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

function mergeBoxes(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    const gi = g.index.array;
    for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function makePinTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(201,242,107,0.55)');
  g.addColorStop(0.55, 'rgba(201,242,107,0.18)');
  g.addColorStop(1, 'rgba(201,242,107,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, 26, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(245,250,235,0.96)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, 26, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(201,242,107,1)';
  ctx.stroke();
  // 内部定位水滴
  ctx.fillStyle = '#2f3a22';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2 - 4, 9, Math.PI, 0);
  ctx.lineTo(s / 2, s / 2 + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(245,250,235,1)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2 - 4, 3.6, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildHighlightLayer() {
  const group = new THREE.Group();
  group.name = 'SelectionHighlightLayer';
  group.visible = false;

  const roofY = ELEVATIONS.ROOF_Y + 1.35; // 高于女儿墙
  const groundY = ELEVATIONS.PLAZA_TOP + 0.06;

  const lineMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, opacity: 1 });
  const glowMat = new THREE.MeshBasicMaterial({
    color: ACCENT, toneMapped: false, transparent: true, opacity: 0.22,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const groundMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, opacity: 0.55, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({
    color: ACCENT, toneMapped: false, transparent: true, opacity: 0.10,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const beamMat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, opacity: 0.75, depthWrite: false });
  const pinMat = new THREE.SpriteMaterial({ map: makePinTexture(), toneMapped: false, depthTest: false, transparent: true });

  const entries = new Map();
  for (const grp of SECURITY_GROUPS) {
    const rects = BUILDING_WINGS.filter((w) => w.groupId === grp.id);
    if (!rects.length) continue;
    const { segs, bounds } = buildFootprintOutline(rects);
    const sub = new THREE.Group();
    sub.name = `Highlight_${grp.id}`;
    sub.visible = false;

    sub.add(new THREE.Mesh(ribbonGeometry(segs, 1.0, roofY, 0.18), lineMat));
    sub.add(new THREE.Mesh(ribbonGeometry(segs, 3.6, roofY - 0.05, 0.04), glowMat));
    sub.add(new THREE.Mesh(ribbonGeometry(segs, 0.45, groundY, 0.05), groundMat));

    const fillShapeGeos = rects.map((r) => {
      const g = new THREE.PlaneGeometry(r.x2 - r.x1, r.z2 - r.z1);
      g.rotateX(-Math.PI / 2);
      g.translate((r.x1 + r.x2) / 2, roofY - 0.1, (r.z1 + r.z2) / 2);
      return g;
    });
    // 平面填充（体量重叠处会叠加，用很低的透明度即可）
    for (const g of fillShapeGeos) sub.add(new THREE.Mesh(g, fillMat));

    const anchor = new THREE.Vector3(
      grp.focus?.pos?.[0] ?? (bounds.minX + bounds.maxX) / 2,
      roofY + 16,
      grp.focus?.pos?.[2] ?? (bounds.minZ + bounds.maxZ) / 2
    );
    const beamGeo = new THREE.CylinderGeometry(0.16, 0.16, anchor.y - roofY, 6);
    beamGeo.translate(anchor.x, (anchor.y + roofY) / 2, anchor.z);
    sub.add(new THREE.Mesh(beamGeo, beamMat));

    const pin = new THREE.Sprite(pinMat);
    pin.position.copy(anchor);
    pin.scale.set(13, 13, 1);
    pin.renderOrder = 50;
    sub.add(pin);

    sub.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.raycast = () => {}; });
    group.add(sub);
    entries.set(grp.id, { sub, anchor, pin });
  }

  let active = null;

  return {
    group,
    setHighlight(groupId) {
      for (const [id, e] of entries) e.sub.visible = id === groupId;
      active = entries.has(groupId) ? groupId : null;
      group.visible = Boolean(active);
      return active;
    },
    getHighlight() {
      return active;
    },
    getAnchor(groupId) {
      const e = entries.get(groupId);
      return e ? e.anchor.clone() : null;
    },
    hasActive() {
      return Boolean(active);
    },
    update(elapsed) {
      if (!active) return;
      const p = 0.5 + 0.5 * Math.sin(elapsed * 2.4);
      glowMat.opacity = 0.14 + 0.16 * p;
      fillMat.opacity = 0.07 + 0.06 * p;
      const e = entries.get(active);
      if (!e) return;
      const s = 13 + 1.5 * p;
      e.pin.scale.set(s, s, 1);
    },
    syncExplosion(explodeFactor) {
      // 爆炸透视时屋面描边随屋顶层上移（roof 偏移 42m）
      for (const [, e] of entries) {
        e.sub.children.forEach((m, i) => {
          if (i === 2) return; // 地面描边不动
          if (m.userData.baseY === undefined) m.userData.baseY = m.position.y;
          m.position.y = m.userData.baseY + 42.0 * explodeFactor;
        });
      }
    },
  };
}
