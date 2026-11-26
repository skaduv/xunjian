import * as THREE from 'three';
import { ELEVATIONS } from '../config/campusConfig.js';

/**
 * KKAA 标志性曲面波浪木格栅扶梯大厅（严格对照 Section 1 剖面图与实拍图 KKAA_EiichiKano_12 / 15）
 * - W5 东端主入口大厅（X: [-10, 10], Z: [-82, -60]）：向东朝中央门廊打开，金色原木曲面肋条如海浪般倾泻覆盖扶梯上方
 * - E1 西端主入口大厅（X: [42, 62], Z: [-82, -60]）：东西完全镜像对称
 * - E3 北侧入口拱券木肋扶梯大厅（X: [64, 108], Z: [34, 42]）：致敬 KKAA_EiichiKano_15 拱形曲面木格栅长廊
 */

function buildEscalatorFlight({ x, z, length, width, riseY, directionX, materials }) {
  const grp = new THREE.Group();
  const angle = Math.atan2(riseY, length);
  const diagLen = Math.hypot(length, riseY);

  // 倾斜钢结构桁架基座
  const bodyGeo = new THREE.BoxGeometry(diagLen, 0.72, width);
  const body = new THREE.Mesh(bodyGeo, materials.escalatorMetal);
  body.position.set(x, riseY * 0.5 - 0.15, z);
  body.rotation.z = directionX * angle;
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  // 扶梯踏步肌理（深灰锯齿梯级条）
  const stepCount = 18;
  const stepGeo = new THREE.BoxGeometry(length / stepCount * 0.9, 0.12, width - 0.24);
  const stepInst = new THREE.InstancedMesh(stepGeo, materials.escalatorStep, stepCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < stepCount; i++) {
    const t = (i + 0.5) / stepCount;
    const sx = x + directionX * (-length * 0.5 + t * length);
    const sy = t * riseY + 0.22;
    dummy.position.set(sx, sy, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    stepInst.setMatrixAt(i, dummy.matrix);
  }
  stepInst.instanceMatrix.needsUpdate = true;
  grp.add(stepInst);

  // 两侧透明玻璃扶手护栏 + 黑色扶手带 + 夜间暖琥珀裙板导引光带
  const railGeo = new THREE.BoxGeometry(diagLen, 1.02, 0.06);
  const handGeo = new THREE.BoxGeometry(diagLen + 0.3, 0.1, 0.12);
  const skirtLightGeo = new THREE.BoxGeometry(diagLen - 0.3, 0.09, 0.05);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, materials.glassBalustrade);
    rail.position.set(x, riseY * 0.5 + 0.65, z + side * (width * 0.5 - 0.05));
    rail.rotation.z = directionX * angle;
    grp.add(rail);

    const hand = new THREE.Mesh(handGeo, materials.darkCharcoalMetal);
    hand.position.set(x, riseY * 0.5 + 1.18, z + side * (width * 0.5 - 0.05));
    hand.rotation.z = directionX * angle;
    grp.add(hand);

    if (materials.warmAmberLightMat) {
      const skirtLight = new THREE.Mesh(skirtLightGeo, materials.warmAmberLightMat);
      skirtLight.position.set(x, riseY * 0.5 + 0.24, z + side * (width * 0.5 - 0.08));
      skirtLight.rotation.z = directionX * angle;
      grp.add(skirtLight);
    }
  }

  return grp;
}

/**
 * 构建 W5 东端 / E1 西端主入口对称曲面波浪木格栅扶梯大厅
 * side: 'west' (W5 东端，扶梯由东向西上行至 2F) | 'east' (E1 西端，扶梯由西向东上行至 2F)
 */
export function buildMainEscalatorHall({ side, x1, z1, x2, z2, floor1Y, materials }) {
  const group = new THREE.Group();
  group.name = `EscalatorHall_${side}`;

  const spanX = x2 - x1;
  const spanZ = z2 - z1;
  const dirX = side === 'west' ? -1 : 1; // 扶梯上升方向（远离中央门廊）
  const portalEdgeX = side === 'west' ? x2 - 1.2 : x1 + 1.2;
  const deepEdgeX = side === 'west' ? x1 + 1.4 : x2 - 1.4;
  const midZ = (z1 + z2) * 0.5;

  // 1. 双排平行自动扶梯（1F -> 2F，居中排布）
  const escLength = 10.6;
  const escCenterX = (portalEdgeX + deepEdgeX) * 0.5 + dirX * 1.1;
  for (const dz of [-1.45, 1.45]) {
    group.add(
      buildEscalatorFlight({
        x: escCenterX,
        z: midZ + dz,
        length: escLength,
        width: 1.55,
        riseY: ELEVATIONS.FLOOR_HEIGHT,
        directionX: dirX,
        materials,
      })
    );
  }

  // 2. KKAA 标志性 26 根曲面波浪原木格栅肋（从二层顶棚柔和下垂弯曲，直抵主入口幕墙上方）
  const ribCount = 26;
  const ceilingY = floor1Y + ELEVATIONS.FLOOR_HEIGHT * 1.88; // 跨越 1F-2F 双层通高顶部
  const dropLowY = floor1Y + 2.95; // 在主入口门廊侧垂落至亲人尺度

  for (let i = 0; i < ribCount; i++) {
    const tZ = (i + 0.5) / ribCount;
    const rz = z1 + 1.0 + tZ * (spanZ - 2.0);
    // 沿 Z 向波浪起伏相位，呈现 KKAA_EiichiKano_12 的立体动感波峰波谷
    const wave = Math.sin(tZ * Math.PI * 2.15 + (side === 'west' ? 0.3 : 1.8));
    const localDrop = dropLowY + wave * 0.75;
    const localArch = ceilingY - 0.35 + Math.cos(tZ * Math.PI * 1.6) * 0.45;

    const p0 = new THREE.Vector3(deepEdgeX, localArch, 0);
    const p1 = new THREE.Vector3(THREE.MathUtils.lerp(deepEdgeX, portalEdgeX, 0.38), localArch - 0.18, 0);
    const p2 = new THREE.Vector3(THREE.MathUtils.lerp(deepEdgeX, portalEdgeX, 0.72), THREE.MathUtils.lerp(localArch, localDrop, 0.46), 0);
    const p3 = new THREE.Vector3(portalEdgeX, localDrop, 0);

    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    const pts = curve.getPoints(22);

    // 将曲线加厚为真实矩形截面的弯曲木格栅肋条（Shape 2D 挤出，棱角清晰锐利）
    const ribThickness = 0.24;
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].y + ribThickness * 0.5);
    for (let k = 1; k < pts.length; k++) {
      shape.lineTo(pts[k].x, pts[k].y + ribThickness * 0.5);
    }
    for (let k = pts.length - 1; k >= 0; k--) {
      shape.lineTo(pts[k].x, pts[k].y - ribThickness * 0.5);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.16,
      bevelEnabled: false,
    });
    const rib = new THREE.Mesh(geo, materials.curvedWoodRib);
    rib.position.z = rz - 0.08;
    rib.castShadow = true;
    rib.receiveShadow = true;
    group.add(rib);
  }

  // 3. 标志性室内白色大圆柱（参照 KKAA_EiichiKano_12）
  const colGeo = new THREE.CylinderGeometry(0.42, 0.42, ELEVATIONS.FLOOR_HEIGHT * 2 - 0.4, 18);
  for (const dz of [-5.8, 5.8]) {
    const col = new THREE.Mesh(colGeo, materials.whiteColumn);
    col.position.set(
      THREE.MathUtils.lerp(portalEdgeX, deepEdgeX, 0.28),
      floor1Y + ELEVATIONS.FLOOR_HEIGHT,
      midZ + dz
    );
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);
  }

  // 4. 夜间波浪木格栅隐藏式 3000K 暖金洗墙灯带（勾勒曲面波浪立体光影）
  if (materials.warmAmberLightMat) {
    const coveXs = [
      THREE.MathUtils.lerp(deepEdgeX, portalEdgeX, 0.25),
      THREE.MathUtils.lerp(deepEdgeX, portalEdgeX, 0.65),
    ];
    for (let c = 0; c < coveXs.length; c++) {
      const cove = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.12, spanZ - 2.8),
        materials.warmAmberLightMat
      );
      cove.position.set(coveXs[c], c === 0 ? ceilingY - 0.55 : dropLowY + 1.85, midZ);
      group.add(cove);
    }
  }

  return group;
}

/**
 * 构建东三楼 E3 北侧入口拱券木肋扶梯长廊（参照 KKAA_EiichiKano_15）
 */
export function buildE3VaultedLobby({ x1, z1, x2, z2, floor1Y, materials }) {
  const group = new THREE.Group();
  group.name = 'E3_VaultedWoodLobby';

  const ribCount = 24;
  const ceilingY = floor1Y + ELEVATIONS.FLOOR_HEIGHT - 0.35;
  const spanZ = z2 - z1;

  for (let i = 0; i < ribCount; i++) {
    const t = (i + 0.5) / ribCount;
    const rx = x1 + 1.8 + t * (x2 - x1 - 3.6);
    // 南侧墙面直立升起后优雅弯拱掠过北厅顶棚
    const p0 = new THREE.Vector3(z2 - 0.5, floor1Y + 0.1, 0);
    const p1 = new THREE.Vector3(z2 - 0.7, floor1Y + 2.6, 0);
    const p2 = new THREE.Vector3(z2 - spanZ * 0.45, ceilingY - 0.15, 0);
    const p3 = new THREE.Vector3(z1 + 0.9, ceilingY - 0.55 - Math.sin(t * Math.PI * 3) * 0.25, 0);
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    const pts = curve.getPoints(16);

    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].y + 0.14);
    for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k].x, pts[k].y + 0.14);
    for (let k = pts.length - 1; k >= 0; k--) shape.lineTo(pts[k].x, pts[k].y - 0.14);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
    // 旋转使曲线位于 Y-Z 平面
    geo.rotateY(-Math.PI / 2);
    const rib = new THREE.Mesh(geo, materials.curvedWoodRib);
    rib.position.set(rx, 0, 0);
    group.add(rib);
  }

  // 拱券木肋内嵌 3000K 暖琥珀线性暗藏灯槽
  if (materials.warmAmberLightMat) {
    for (const tz of [0.28, 0.68]) {
      const cove = new THREE.Mesh(
        new THREE.BoxGeometry(x2 - x1 - 4.4, 0.12, 0.22),
        materials.warmAmberLightMat
      );
      cove.position.set((x1 + x2) * 0.5, ceilingY - 0.42, z1 + spanZ * tz);
      group.add(cove);
    }
  }

  // 上行至 2F 报告厅/体育馆的扶梯
  group.add(
    buildEscalatorFlight({
      x: (x1 + x2) * 0.5,
      z: (z1 + z2) * 0.5,
      length: 9.2,
      width: 1.65,
      riseY: ELEVATIONS.FLOOR_HEIGHT,
      directionX: -1,
      materials,
    })
  );

  return group;
}
