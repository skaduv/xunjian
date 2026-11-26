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

/**
 * 陶瓷白模级禁止区域立面渐隐着色器：
 * 底部 0.45 -> 顶部 0.02 柔和羽化透明渐变 + 极细底边定位线 + 微弱斜向安防扫光 + 昼/暮/夜自适应
 */
function createRestrictedFenceShaderMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color('#dc2626') },
      uGlowColor: { value: new THREE.Color('#fca5a5') },
      uTime: { value: 0 },
      uDusk: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uGlowColor;
      uniform float uTime;
      uniform float uDusk;
      uniform float uNight;
      varying vec2 vUv;

      void main() {
        float dark = max(uDusk, uNight);
        // 底部清晰、向上平滑渐隐（0.45 -> 0.02）
        float vFade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.9);
        float baseAlpha = mix(0.02, 0.45 + dark * 0.10, vFade);

        // 底部贴地亮线 + 极细顶沿轮廓微光
        float baseRim = smoothstep(0.09, 0.0, vUv.y) * (0.34 + dark * 0.18);
        float topRim = smoothstep(0.94, 1.0, vUv.y) * (0.14 + dark * 0.14);

        // 柔和斜向微光扫线（无刺眼闪屏）
        float wave = sin((vUv.x * 1.15 - vUv.y * 2.6 - uTime * 0.55) * 6.2831853);
        float scan = smoothstep(0.86, 1.0, wave) * (0.10 + dark * 0.08) * (1.0 - vUv.y * 0.65);

        float alpha = clamp(baseAlpha + baseRim + topRim + scan, 0.0, 0.85);
        vec3 col = mix(uColor, uGlowColor, clamp(baseRim * 1.2 + topRim * 1.6 + scan * 2.2, 0.0, 0.72));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function buildZoneMesh(zone, hazardTex, restrictedWallMat, lightingRefs) {
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
    // 红色轻薄地面红晕 + 平滑垂直渐隐立面围栏 + 纤细顶沿框线
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#dc2626',
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    lightingRefs.restrictedFillMats.push(fillMat);
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const fenceH = Math.max(h, 3.6);
    const wallPositions = [];
    const wallUvs = [];
    const wallIndices = [];
    let uAccum = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const segLen = Math.hypot(x2 - x1, z2 - z1);
      const u0 = uAccum / 8.0;
      const u1 = (uAccum + segLen) / 8.0;
      uAccum += segLen;

      const base = wallPositions.length / 3;
      wallPositions.push(x1, 0, z1, x2, 0, z2, x2, fenceH, z2, x1, fenceH, z1);
      wallUvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
      wallIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
    wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wallUvs, 2));
    wallGeo.setIndex(wallIndices);
    wallGeo.computeVertexNormals();

    grp.add(new THREE.Mesh(wallGeo, restrictedWallMat));

    // 底部与顶部极细陶瓷质感边界线框
    const railMat = new THREE.MeshBasicMaterial({
      color: '#f87171',
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    });
    lightingRefs.restrictedRailMats.push(railMat);
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const baseBar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.18), railMat);
      baseBar.position.set((x1 + x2) * 0.5, 0.08, (z1 + z2) * 0.5);
      baseBar.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      grp.add(baseBar);
    }
  } else if (zone.type === 'parking') {
    // 蓝绿色合规停车地框（日间克制清透、暮夜微亮边界）
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#0d9488',
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    lightingRefs.parkingFillMats.push(fillMat);
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const borderMat = new THREE.MeshBasicMaterial({
      color: '#14b8a6',
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    lightingRefs.parkingBorderMats.push(borderMat);
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.18, 0.42), borderMat);
      bar.position.set((x1 + x2) * 0.5, 0.1, (z1 + z2) * 0.5);
      bar.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      grp.add(bar);
    }
  } else if (zone.type === 'firelane') {
    // 琥珀黄警示带（降低日间刺眼度 0.78 -> 0.52，暮夜柔和提亮边缘）
    const pos = floorGeo.attributes.position;
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uvs[i * 2] = pos.getX(i) / 10;
      uvs[i * 2 + 1] = pos.getZ(i) / 10;
    }
    floorGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const fillMat = new THREE.MeshBasicMaterial({
      map: hazardTex,
      color: '#f59e0b',
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    lightingRefs.firelaneFillMats.push(fillMat);
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const edgeMat = new THREE.MeshBasicMaterial({
      color: '#d97706',
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    });
    lightingRefs.firelaneEdgeMats.push(edgeMat);
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const curb = new THREE.Mesh(new THREE.BoxGeometry(len, 0.28, 0.34), edgeMat);
      curb.position.set((x1 + x2) * 0.5, 0.15, (z1 + z2) * 0.5);
      curb.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
      grp.add(curb);
    }
  } else {
    // ignore：忽略区（淡灰虚线框 + 轻雾底膜）
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#94a3b8',
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    lightingRefs.ignoreFillMats.push(fillMat);
    grp.add(new THREE.Mesh(floorGeo, fillMat));

    const lineGeo = new THREE.BufferGeometry().setFromPoints(perimeterPts);
    const dashMat = new THREE.LineDashedMaterial({
      color: '#64748b',
      dashSize: 1.6,
      gapSize: 0.9,
      transparent: true,
      opacity: 0.85,
    });
    lightingRefs.ignoreDashMats.push(dashMat);
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
  const restrictedWallMat = createRestrictedFenceShaderMaterial();

  const lightingRefs = {
    restrictedFillMats: [],
    restrictedRailMats: [],
    parkingFillMats: [],
    parkingBorderMats: [],
    firelaneFillMats: [],
    firelaneEdgeMats: [],
    ignoreFillMats: [],
    ignoreDashMats: [],
  };

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
    const meshGrp = buildZoneMesh(zone, hazardTex, restrictedWallMat, lightingRefs);
    subGroups[zone.type].add(meshGrp);
    zoneEntries.push({
      config: zone,
      meshGrp,
    });
  }

  function setLightingFactor(dusk = 0, night = 0) {
    const dark = Math.max(dusk, night);
    restrictedWallMat.uniforms.uDusk.value = dusk;
    restrictedWallMat.uniforms.uNight.value = night;
    restrictedWallMat.uniforms.uColor.value.set(dark > 0.35 ? '#f43f5e' : '#dc2626');

    for (const m of lightingRefs.restrictedFillMats) {
      m.color.set(dark > 0.35 ? '#f43f5e' : '#dc2626');
      m.opacity = THREE.MathUtils.lerp(0.18, 0.28, dark);
    }
    for (const m of lightingRefs.restrictedRailMats) {
      m.color.set(dark > 0.35 ? '#fb7185' : '#ef4444');
      m.opacity = THREE.MathUtils.lerp(0.72, 0.94, dark);
    }
    for (const m of lightingRefs.parkingFillMats) {
      m.color.set(dark > 0.35 ? '#14b8a6' : '#0d9488');
      m.opacity = THREE.MathUtils.lerp(0.22, 0.32, dark);
    }
    for (const m of lightingRefs.parkingBorderMats) {
      m.color.set(dark > 0.35 ? '#2dd4bf' : '#0d9488');
      m.opacity = THREE.MathUtils.lerp(0.76, 0.94, dark);
    }
    for (const m of lightingRefs.firelaneFillMats) {
      m.color.set(dark > 0.35 ? '#fbbf24' : '#f59e0b');
      m.opacity = THREE.MathUtils.lerp(0.52, 0.66, dark);
    }
    for (const m of lightingRefs.firelaneEdgeMats) {
      m.color.set(dark > 0.35 ? '#fbbf24' : '#d97706');
      m.opacity = THREE.MathUtils.lerp(0.74, 0.92, dark);
    }
    for (const m of lightingRefs.ignoreFillMats) {
      m.opacity = THREE.MathUtils.lerp(0.16, 0.24, dark);
    }
    for (const m of lightingRefs.ignoreDashMats) {
      m.color.set(dark > 0.35 ? '#94a3b8' : '#64748b');
      m.opacity = THREE.MathUtils.lerp(0.82, 0.94, dark);
    }
  }

  return {
    group: root,
    setLightingFactor,
    setDuskFactor: setLightingFactor,
    update(time) {
      if (!root.visible || !subGroups.restricted.visible) return;
      restrictedWallMat.uniforms.uTime.value = time;
    },
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
