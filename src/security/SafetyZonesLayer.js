import * as THREE from 'three';
import { getFloorExplodeOffset, SAFETY_ZONES } from '../config/campusConfig.js';
import { createHazardStripeTexture } from '../core/ProceduralTextures.js';

/**
 * 园区「单画布四类安防区域」3D 空间多边形围栏/地贴图层（layers.safetyZones，默认隐藏）：
 * - restricted（禁止区域）：红色半透明立面边界 + 顶/底高亮边框
 * - parking（合规停车区）：蓝绿色地框 + 柔光地坪高亮 + 角标立柱
 * - firelane（消防通道/安全出口）：琥珀黄斜纹警示带 + 发光边界
 * - ignore（忽略区）：淡灰虚线框 + 极轻雾面地贴
 *
 * 自动同步建筑垂直爆炸时的室内防区 Y 轴高度
 */

const ZONE_TYPES = ['restricted', 'parking', 'firelane', 'ignore'];

function buildZoneMesh(zone, hazardTex) {
  const grp = new THREE.Group();
  grp.name = `SafetyZone_${zone.id}`;
  const pts = zone.polygon;
  const h = zone.height || 0.6;

  // 1. 闭合多边形底面形状
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    shape.lineTo(pts[i][0], -pts[i][1]);
  }
  shape.closePath();

  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2);

  // 准备闭合周界 3D 点列（用于立面围栏或线框）
  const perimeterPts = pts.map(([x, z]) => new THREE.Vector3(x, 0.04, z));
  perimeterPts.push(new THREE.Vector3(pts[0][0], 0.04, pts[0][1]));

  if (zone.type === 'restricted') {
    // 红色半透明立面边界 + 地面红晕 + 顶底粗边框
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const fenceH = Math.max(h, 3.8);
    // 垂直半透明立面围栏
    const wallPositions = [];
    const wallIndices = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const base = wallPositions.length / 3;
      wallPositions.push(x1, 0, z1, x2, 0, z2, x2, fenceH, z2, x1, fenceH, z1);
      wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
    wallGeo.setIndex(wallIndices);
    wallGeo.computeVertexNormals();

    const wallMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    grp.add(new THREE.Mesh(wallGeo, wallMat));

    // 顶部醒目红色实体轮廓框
    const railMat = new THREE.MeshBasicMaterial({ color: '#f87171', transparent: true, opacity: 0.95 });
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.24, 0.28), railMat);
      bar.position.set((x1 + x2) * 0.5, fenceH, (z1 + z2) * 0.5);
      bar.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      grp.add(bar);
    }
  } else if (zone.type === 'parking') {
    // 蓝绿色合规停车地框
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#0d9488',
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const borderMat = new THREE.MeshBasicMaterial({
      color: '#2dd4bf',
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.26, 0.62), borderMat);
      bar.position.set((x1 + x2) * 0.5, 0.14, (z1 + z2) * 0.5);
      bar.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      grp.add(bar);
    }
  } else if (zone.type === 'firelane') {
    // 琥珀黄警示带（斜纹半透明警示地贴 + 抬高琥珀警示光边）
    const pos = floorGeo.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = pos.getX(i) / 10;
      uvs[i * 2 + 1] = pos.getZ(i) / 10;
    }
    floorGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const fillMat = new THREE.MeshBasicMaterial({
      map: hazardTex,
      color: '#fbbf24',
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const edgeMat = new THREE.MeshBasicMaterial({
      color: '#f59e0b',
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.52, 0.45), edgeMat);
      curb.position.set((x1 + x2) * 0.5, 0.26, (z1 + z2) * 0.5);
      curb.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      grp.add(curb);
    }
  } else {
    // ignore：忽略区（淡灰虚线框 + 轻雾底膜）
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#94a3b8',
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const lineGeo = new THREE.BufferGeometry().setFromPoints(perimeterPts);
    const dashMat = new THREE.LineDashedMaterial({
      color: '#64748b',
      dashSize: 1.6,
      gapSize: 0.9,
      transparent: true,
      opacity: 0.95,
    });
    const dashedLine = new THREE.Line(lineGeo, dashMat);
    dashedLine.computeLineDistances();
    dashedLine.position.y = 0.14;
    grp.add(dashedLine);
  }

  grp.position.y = zone.baseY;
  return grp;
}

export function buildSafetyZonesLayer(maxAnisotropy = 8) {
  const root = new THREE.Group();
  root.name = 'SafetyZonesLayer';
  root.visible = false; // 默认隐藏，可通过 CampusTwin.setLayerVisible('safetyZones', true) 按需开启

  const hazardTex = createHazardStripeTexture(maxAnisotropy);

  const subGroups = {};
  const filterState = {};
  for (const type of ZONE_TYPES) {
    const sg = new THREE.Group();
    sg.name = `SafetyZoneType_${type}`;
    root.add(sg);
    subGroups[type] = sg;
    filterState[type] = true;
  }

  const zoneEntries = [];
  for (const zone of SAFETY_ZONES) {
    const meshGrp = buildZoneMesh(zone, hazardTex);
    subGroups[zone.type].add(meshGrp);
    zoneEntries.push({
      config: zone,
      meshGrp,
    });
  }

  return {
    group: root,
    setFilter(types) {
      if (Array.isArray(types)) {
        const set = new Set(types);
        for (const t of ZONE_TYPES) {
          filterState[t] = set.has(t);
          subGroups[t].visible = filterState[t];
        }
      } else if (types && typeof types === 'object') {
        for (const t of ZONE_TYPES) {
          if (t in types) {
            filterState[t] = Boolean(types[t]);
            subGroups[t].visible = filterState[t];
          }
        }
      }
      return { ...filterState };
    },
    getFilter() {
      return { ...filterState };
    },
    syncExplosion(explodeFactor) {
      for (const entry of zoneEntries) {
        const dy = entry.config.isIndoor
          ? getFloorExplodeOffset(entry.config.floor, explodeFactor)
          : 0;
        entry.meshGrp.position.y = entry.config.baseY + dy;
      }
    },
    getZoneCenter(zoneId) {
      const found = zoneEntries.find((e) => e.config.id === zoneId);
      if (!found) return null;
      const pts = found.config.polygon;
      let cx = 0;
      let cz = 0;
      for (const [x, z] of pts) {
        cx += x;
        cz += z;
      }
      return new THREE.Vector3(cx / pts.length, found.meshGrp.position.y + 0.5, cz / pts.length);
    },
    getCatalogSnapshot() {
      return zoneEntries.map((e) => ({
        ...e.config,
        currentY: Number(e.meshGrp.position.y.toFixed(3)),
        visible: root.visible && subGroups[e.config.type].visible,
      }));
    },
  };
}
