import * as THREE from 'three';
import { BUILDING_WINGS, LAKE_SHORELINE, PLINTH_CONFIG } from '../config/campusConfig.js';
import { sampleGroundElevation } from './TerrainAndStructures.js';

/**
 * 精工偏白模写实植物体系（全量 THREE.InstancedMesh，严禁简单球体或单圆锥）：
 * 参考 IOPLY_Campus_WhiteModel.glb 高级低饱和莫兰迪植物白模色阶：
 * 1. 香樟（Camphor）：分叉树干 + 3 主枝 + 7 团分层树冠（柔和矿物鼠尾草绿，主干道配浅灰花岗岩树池）
 * 2. 银杏（Champagne Ginkgo）：分叉树干 + 3 主枝 + 7 团分层香槟象牙金冠（主干道配花岗岩树池）
 * 3. 层次雪松（Layered Cedar）：渐细树干 + 5 层错落轮生枝（雾青松绿，精准贴合龙蟠山与西南草坡高程）
 */

function pointInPolygon(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isBlockedForTree(x, z) {
  if (Math.abs(x) > PLINTH_CONFIG.width * 0.5 - 10 || Math.abs(z) > PLINTH_CONFIG.depth * 0.5 - 10) {
    return true;
  }
  for (const w of BUILDING_WINGS) {
    if (x >= w.x1 - 5.5 && x <= w.x2 + 5.5 && z >= w.z1 - 5.5 && z <= w.z2 + 5.5) return true;
  }
  if (x >= 4 && x <= 48 && z >= -108 && z <= -54) return true;
  if (x >= 56 && x <= 92 && z >= 8 && z <= 38) return true;
  if (x >= -144 && x <= -96 && z >= -38 && z <= 18) return true;
  if (x >= 68 && x <= 110 && z >= -132 && z <= -96) return true;
  if (x >= 0 && x <= 52 && z >= -156 && z <= -82) return true;
  if (x >= 88 && x <= 106 && z >= -106 && z <= 28) return true;
  if (x >= 44 && x <= 74 && z >= -98 && z <= -83) return true;
  if (Math.hypot(x - -72, z - 134) < 13) return true;
  if (Math.hypot(x - 146, z - -24) < 15) return true;
  // 排除西南拱桥及引道
  if (Math.hypot(x - -170, z - 108) < 18) return true;
  if (pointInPolygon(x, z, LAKE_SHORELINE)) return true;
  return false;
}

function seeded(i, salt = 1) {
  const n = Math.sin(i * 91.345 + salt * 47.123) * 43758.5453;
  return n - Math.floor(n);
}

function buildBroadleafSpecies({ trees, canopyColors, trunkMat, pitMat, name }) {
  const grp = new THREE.Group();
  grp.name = name;
  if (trees.length === 0) return grp;

  // 精炼有机切面团块（低面数高性能，同时绝非简单圆球）
  const puffGeo = new THREE.DodecahedronGeometry(1, 0);
  const pos = puffGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const n = 1 + Math.sin(vx * 3.8 + vz * 3.2) * 0.12;
    pos.setXYZ(i, vx * n, vy * n * 0.78, vz * n);
  }
  puffGeo.computeVertexNormals();

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1, 6);
  const branchGeo = new THREE.CylinderGeometry(0.075, 0.13, 1, 5);

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  const branchInst = new THREE.InstancedMesh(branchGeo, trunkMat, trees.length * 3);
  trunkInst.castShadow = true;

  const puffOffsets = [
    { x: -1.12, y: 0.2, z: -0.72, sx: 1.52, sy: 1.12, sz: 1.42, colorIdx: 0 },
    { x: 1.2, y: 0.25, z: -0.58, sx: 1.48, sy: 1.08, sz: 1.46, colorIdx: 0 },
    { x: 0.05, y: 0.28, z: 1.24, sx: 1.56, sy: 1.1, sz: 1.4, colorIdx: 0 },
    { x: -0.84, y: 1.14, z: 0.7, sx: 1.38, sy: 1.05, sz: 1.35, colorIdx: 1 },
    { x: 0.92, y: 1.18, z: 0.56, sx: 1.35, sy: 1.02, sz: 1.32, colorIdx: 1 },
    { x: 0.0, y: 1.24, z: -0.88, sx: 1.4, sy: 1.06, sz: 1.34, colorIdx: 1 },
    { x: 0.0, y: 1.96, z: 0.04, sx: 1.28, sy: 0.98, sz: 1.25, colorIdx: 2 },
  ];

  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.86,
    metalness: 0.01,
  });
  const canopyInst = new THREE.InstancedMesh(puffGeo, canopyMat, trees.length * 7);
  canopyInst.castShadow = true;
  canopyInst.receiveShadow = true;

  const pitTrees = trees.filter((t) => t.hasPit);
  const pitInst =
    pitTrees.length > 0
      ? new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.22, 2.1), pitMat, pitTrees.length)
      : null;
  if (pitInst) pitInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const colorObj = new THREE.Color();
  const cPalette = canopyColors.map((c) => new THREE.Color(c));

  let bIdx = 0;
  let cIdx = 0;
  let pIdx = 0;

  trees.forEach((tr, i) => {
    const s = tr.scale;
    const trunkH = 3.1 * s;
    const baseY = tr.y - 0.12;
    const rot = tr.rot;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    dummy.position.set(tr.x, baseY + trunkH * 0.5, tr.z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(s, trunkH, s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    for (let b = 0; b < 3; b++) {
      const ba = rot + (b / 3) * Math.PI * 2 + 0.35;
      const bLen = 1.95 * s;
      const tilt = 0.56;
      dummy.position.set(
        tr.x + Math.cos(ba) * Math.sin(tilt) * bLen * 0.5,
        baseY + trunkH * 0.82 + Math.cos(tilt) * bLen * 0.45,
        tr.z + Math.sin(ba) * Math.sin(tilt) * bLen * 0.5
      );
      dummy.rotation.set(0, -ba, -tilt);
      dummy.scale.set(s, bLen, s);
      dummy.updateMatrix();
      branchInst.setMatrixAt(bIdx++, dummy.matrix);
    }

    const crownBaseY = baseY + trunkH + 0.88 * s;
    for (let k = 0; k < 7; k++) {
      const po = puffOffsets[k];
      const lx = po.x * s;
      const lz = po.z * s;
      dummy.position.set(tr.x + lx * cosR - lz * sinR, crownBaseY + po.y * s, tr.z + lx * sinR + lz * cosR);
      dummy.rotation.set(seeded(i * 7 + k, 1) * 0.4, rot + k * 0.9, seeded(i * 7 + k, 2) * 0.4);
      dummy.scale.set(po.sx * s, po.sy * s, po.sz * s);
      dummy.updateMatrix();
      canopyInst.setMatrixAt(cIdx, dummy.matrix);

      colorObj.copy(cPalette[po.colorIdx]);
      const jitter = (seeded(i, k + 5) - 0.5) * 0.05;
      colorObj.offsetHSL(jitter * 0.2, jitter * 0.2, jitter);
      canopyInst.setColorAt(cIdx, colorObj);
      cIdx++;
    }

    if (tr.hasPit && pitInst) {
      dummy.position.set(tr.x, tr.y + 0.1, tr.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pitInst.setMatrixAt(pIdx++, dummy.matrix);
    }
  });

  trunkInst.instanceMatrix.needsUpdate = true;
  branchInst.instanceMatrix.needsUpdate = true;
  canopyInst.instanceMatrix.needsUpdate = true;
  if (canopyInst.instanceColor) canopyInst.instanceColor.needsUpdate = true;
  if (pitInst) pitInst.instanceMatrix.needsUpdate = true;

  grp.add(trunkInst, branchInst, canopyInst);
  if (pitInst) grp.add(pitInst);
  return grp;
}

function buildLayeredCedars(trees, trunkMat) {
  const grp = new THREE.Group();
  grp.name = 'LayeredCedars';
  if (trees.length === 0) return grp;

  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.26, 1, 6);
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);

  const whorlShape = new THREE.Shape();
  const lobes = 6;
  for (let i = 0; i < lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 1.0 : 0.48;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) whorlShape.moveTo(x, y);
    else whorlShape.lineTo(x, y);
  }
  whorlShape.closePath();

  const whorlGeo = new THREE.ExtrudeGeometry(whorlShape, {
    depth: 0.32,
    bevelEnabled: false,
  });
  whorlGeo.rotateX(-Math.PI / 2);

  const foliageMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.88,
    metalness: 0.01,
  });
  const tiers = 5;
  const whorlInst = new THREE.InstancedMesh(whorlGeo, foliageMat, trees.length * tiers);
  whorlInst.castShadow = true;
  whorlInst.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const cBase = new THREE.Color('#80968c');
  const cTop = new THREE.Color('#a4b8ae');
  const col = new THREE.Color();

  let wIdx = 0;
  trees.forEach((tr, i) => {
    const s = tr.scale;
    const totalH = 8.8 * s;
    const baseY = tr.y - 0.18;

    dummy.position.set(tr.x, baseY + totalH * 0.45, tr.z);
    dummy.rotation.set(0, tr.rot, 0);
    dummy.scale.set(s, totalH * 0.9, s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    for (let t = 0; t < tiers; t++) {
      const frac = t / (tiers - 1);
      dummy.position.set(tr.x, baseY + (2.2 + frac * 6.2) * s, tr.z);
      dummy.rotation.set(0, tr.rot + t * 0.9, 0);
      const tierR = 2.75 * (1 - frac * 0.66) * s;
      dummy.scale.set(tierR, (1.1 - frac * 0.2) * s, tierR);
      dummy.updateMatrix();
      whorlInst.setMatrixAt(wIdx, dummy.matrix);

      col.lerpColors(cBase, cTop, frac);
      col.offsetHSL(0, 0, (seeded(i, t) - 0.5) * 0.04);
      whorlInst.setColorAt(wIdx, col);
      wIdx++;
    }
  });

  trunkInst.instanceMatrix.needsUpdate = true;
  whorlInst.instanceMatrix.needsUpdate = true;
  if (whorlInst.instanceColor) whorlInst.instanceColor.needsUpdate = true;

  grp.add(trunkInst, whorlInst);
  return grp;
}

export function buildVegetationSystem() {
  const root = new THREE.Group();
  root.name = 'VegetationSystem';

  // 偏白模温润灰木树干与陶瓷白花岗岩树池
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#9c968d', roughness: 0.9 });
  const pitMat = new THREE.MeshStandardMaterial({ color: '#ebeff4', roughness: 0.58 });

  const camphors = [];
  const ginkgos = [];
  const cedars = [];

  for (let z = -150; z <= 150; z += 20) {
    const x = -196 - (z + 150) * 0.032;
    if (!isBlockedForTree(x, z)) {
      camphors.push({ x, z, y: 0, scale: 1.0 + seeded(z, 1) * 0.2, rot: seeded(z, 2) * 6.28, hasPit: true });
    }
  }

  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = THREE.MathUtils.lerp(-184, 128, t);
    const z = THREE.MathUtils.lerp(-99, -157, t);
    if (!isBlockedForTree(x, z)) {
      (i % 2 === 0 ? ginkgos : camphors).push({
        x, z, y: 0, scale: 0.98 + seeded(i, 3) * 0.2, rot: seeded(i, 4) * 6.28, hasPit: true,
      });
    }
  }

  for (const side of [-1, 1]) {
    for (const z of [-138, -124, -110]) {
      ginkgos.push({ x: 26 + side * 27.5, z, y: 0, scale: 1.08, rot: side * 0.8 + z, hasPit: true });
    }
  }

  const organicZones = [
    { xMin: -175, xMax: -16, zMin: -135, zMax: -64, count: 36, ginkgoRatio: 0.42 },
    { xMin: 108, xMax: 162, zMin: -150, zMax: -46, count: 24, ginkgoRatio: 0.38 },
    { xMin: -190, xMax: -42, zMin: 105, zMax: 158, count: 28, ginkgoRatio: 0.35 },
    { xMin: -18, xMax: 162, zMin: 102, zMax: 164, count: 26, ginkgoRatio: 0.34 },
  ];

  let seedCounter = 100;
  for (const zone of organicZones) {
    for (let k = 0; k < zone.count; k++) {
      seedCounter++;
      const x = zone.xMin + seeded(seedCounter, 7) * (zone.xMax - zone.xMin);
      const z = zone.zMin + seeded(seedCounter, 13) * (zone.zMax - zone.zMin);
      if (isBlockedForTree(x, z)) continue;
      if (Math.hypot(x - -126, z - 128) < 16) continue;

      const y = sampleGroundElevation(x, z);
      const entry = {
        x, z, y,
        scale: 0.86 + seeded(seedCounter, 19) * 0.38,
        rot: seeded(seedCounter, 23) * Math.PI * 2,
        hasPit: false,
      };
      if (seeded(seedCounter, 29) < zone.ginkgoRatio) ginkgos.push(entry);
      else camphors.push(entry);
    }
  }

  for (let k = 0; k < 58; k++) {
    seedCounter++;
    const inEastHill = k < 44;
    const x = inEastHill ? 174 + seeded(seedCounter, 31) * 56 : -178 + seeded(seedCounter, 37) * 86;
    const z = inEastHill ? -148 + seeded(seedCounter, 41) * 296 : 112 + seeded(seedCounter, 43) * 46;
    if (isBlockedForTree(x, z)) continue;
    if (Math.hypot(x - -126, z - 128) < 18) continue;

    cedars.push({
      x, z,
      y: sampleGroundElevation(x, z),
      scale: 0.88 + seeded(seedCounter, 47) * 0.48,
      rot: seeded(seedCounter, 53) * Math.PI * 2,
    });
  }

  root.add(
    buildBroadleafSpecies({
      trees: camphors,
      canopyColors: ['#92a696', '#a8baab', '#bfcebf'],
      trunkMat,
      pitMat,
      name: 'CamphorTrees',
    })
  );

  root.add(
    buildBroadleafSpecies({
      trees: ginkgos,
      canopyColors: ['#d7c39d', '#e3d3b3', '#efe3ca'],
      trunkMat,
      pitMat,
      name: 'GoldenGinkgoTrees',
    })
  );

  root.add(buildLayeredCedars(cedars, trunkMat));
  return root;
}
