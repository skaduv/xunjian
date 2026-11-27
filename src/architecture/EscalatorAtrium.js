import * as THREE from 'three';
import { ELEVATIONS } from '../config/campusConfig.js';

/**
 * KKAA 标志性曲面波浪木格栅扶梯大厅（严格对照 Section 1 剖面图与实拍图 KKAA_EiichiKano_12 / 15）
 * - 精准标高衔接：全部扶梯起止于 1F 完工地坪（0.435m）与 2F 完工地坪（5.235m），配套上下齐平着陆盖板
 * - 冰青磨砂清透玻璃扶手护栏 + 拉丝钛银钢桁架 + 深石墨扶手带/端头 + 暖琥珀裙板导引灯
 * - W5 东端与 E1 西端主入口大厅扶梯直抵 2F 挑空洞口边沿（x=-7.5 / 59.5），零水平缺口
 * - E3 拱券木肋扶梯精确对齐 2F 扶梯井洞口（z=36.3, x=81.5..90.9），木肋在井口上空优雅收口不穿插
 */

function buildEscalatorFlight({
  x,
  z,
  baseY = ELEVATIONS.FLOOR_1_Y + ELEVATIONS.SLAB_THICKNESS,
  length,
  width,
  riseY,
  directionX,
  materials,
}) {
  const grp = new THREE.Group();
  const angle = Math.atan2(riseY, length);
  const diagLen = Math.hypot(length, riseY);
  const landingLen = 1.45;
  const deckMat = materials.aluminumFrame || materials.escalatorMetal;
  const trimMat = materials.darkCharcoalMetal;

  // 1. 倾斜拉丝钛银钢结构桁架基座（上下端严密嵌入起止着陆平台）
  const bodyGeo = new THREE.BoxGeometry(diagLen + 0.36, 0.68, width);
  const body = new THREE.Mesh(bodyGeo, materials.escalatorMetal);
  body.position.set(x, baseY + riseY * 0.5 - 0.30, z);
  body.rotation.z = directionX * angle;
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);

  // 两侧桁架侧饰板深石墨阴影槽
  const sideFasciaGeo = new THREE.BoxGeometry(diagLen + 0.24, 0.24, 0.05);
  for (const side of [-1, 1]) {
    const fascia = new THREE.Mesh(sideFasciaGeo, trimMat);
    fascia.position.set(x, baseY + riseY * 0.5 - 0.28, z + side * (width * 0.5 + 0.015));
    fascia.rotation.z = directionX * angle;
    grp.add(fascia);
  }

  // 2. 上下齐平梳齿着陆盖板（与 1F / 2F 完工楼板面严丝合缝）
  const landingGeo = new THREE.BoxGeometry(landingLen, 0.16, width + 0.08);
  const lowerX = x - directionX * (length * 0.5 + landingLen * 0.5 - 0.08);
  const upperX = x + directionX * (length * 0.5 + landingLen * 0.5 - 0.08);

  const lowerLanding = new THREE.Mesh(landingGeo, deckMat);
  lowerLanding.position.set(lowerX, baseY - 0.065, z);
  lowerLanding.receiveShadow = true;
  grp.add(lowerLanding);

  const upperLanding = new THREE.Mesh(landingGeo, deckMat);
  upperLanding.position.set(upperX, baseY + riseY - 0.065, z);
  upperLanding.receiveShadow = true;
  grp.add(upperLanding);

  // 上下端桁架支座封板（闭合下口与楼板衔接）
  const footBox = new THREE.Mesh(
    new THREE.BoxGeometry(landingLen * 0.86, 0.36, width - 0.08),
    materials.escalatorMetal
  );
  footBox.position.set(upperX, baseY + riseY - 0.26, z);
  grp.add(footBox);

  // 3. 精细扶梯踏步（24 级暖深灰防滑梯级 + 前端暖金防滑导引条）
  const stepCount = 24;
  const stepRun = length / stepCount;
  const stepGeo = new THREE.BoxGeometry(stepRun * 0.94, 0.14, width - 0.22);
  const stepInst = new THREE.InstancedMesh(stepGeo, materials.escalatorStep, stepCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < stepCount; i++) {
    const t = (i + 0.5) / stepCount;
    const sx = x + directionX * (-length * 0.5 + t * length);
    const sy = baseY + t * riseY - 0.03;
    dummy.position.set(sx, sy, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    stepInst.setMatrixAt(i, dummy.matrix);
  }
  stepInst.instanceMatrix.needsUpdate = true;
  grp.add(stepInst);

  // 4. 两侧冰青磨砂玻璃扶手护栏 + 深石墨扶手带 + 上下平段端头 + 3000K 暖琥珀裙板导引灯
  const railGeo = new THREE.BoxGeometry(diagLen, 1.02, 0.06);
  const handGeo = new THREE.BoxGeometry(diagLen + 0.18, 0.095, 0.125);
  const skirtLightGeo = new THREE.BoxGeometry(diagLen - 0.24, 0.08, 0.045);
  const endRailGeo = new THREE.BoxGeometry(landingLen * 0.72, 1.02, 0.06);
  const endHandGeo = new THREE.BoxGeometry(landingLen * 0.82, 0.095, 0.125);
  const newelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.125, 12);
  newelGeo.rotateX(Math.PI / 2);

  for (const side of [-1, 1]) {
    const rz = z + side * (width * 0.5 - 0.05);

    const rail = new THREE.Mesh(railGeo, materials.glassBalustrade);
    rail.position.set(x, baseY + riseY * 0.5 + 0.54, rz);
    rail.rotation.z = directionX * angle;
    grp.add(rail);

    const hand = new THREE.Mesh(handGeo, trimMat);
    hand.position.set(x, baseY + riseY * 0.5 + 1.08, rz);
    hand.rotation.z = directionX * angle;
    grp.add(hand);

    // 上下着陆平段玻璃栏板与扶手回转端头
    for (const [lx, ly, endSign] of [
      [lowerX, baseY, -directionX],
      [upperX, baseY + riseY, directionX],
    ]) {
      const eRail = new THREE.Mesh(endRailGeo, materials.glassBalustrade);
      eRail.position.set(lx, ly + 0.52, rz);
      grp.add(eRail);

      const eHand = new THREE.Mesh(endHandGeo, trimMat);
      eHand.position.set(lx, ly + 1.06, rz);
      grp.add(eHand);

      const newel = new THREE.Mesh(newelGeo, trimMat);
      newel.position.set(lx + endSign * (landingLen * 0.4), ly + 1.01, rz);
      grp.add(newel);
    }

    if (materials.warmAmberLightMat) {
      const skirtLight = new THREE.Mesh(skirtLightGeo, materials.warmAmberLightMat);
      skirtLight.position.set(x, baseY + riseY * 0.5 + 0.12, z + side * (width * 0.5 - 0.085));
      skirtLight.rotation.z = directionX * angle;
      grp.add(skirtLight);
    }
  }

  return grp;
}

/**
 * 构建 W5 东端 / E1 西端主入口对称曲面波浪木格栅扶梯大厅
 * side: 'west' (W5 东端，扶梯由东向西上行至 2F 洞口 x=-7.5) | 'east' (E1 西端，扶梯由西向东上行至 2F 洞口 x=59.5)
 */
export function buildMainEscalatorHall({ side, x1, z1, x2, z2, floor1Y, materials }) {
  const group = new THREE.Group();
  group.name = `EscalatorHall_${side}`;

  const slabT = ELEVATIONS.SLAB_THICKNESS;
  const finished1FY = floor1Y + slabT;
  const spanZ = z2 - z1;
  const dirX = side === 'west' ? -1 : 1; // 扶梯上升方向（远离中央门廊）
  const portalEdgeX = side === 'west' ? x2 - 1.2 : x1 + 1.2;
  const deepEdgeX = side === 'west' ? x1 + 1.4 : x2 - 1.4;
  const midZ = (z1 + z2) * 0.5;

  // 1. 双排平行自动扶梯（1F -> 2F）：精确对齐 2F 挑空洞口边沿（W5_N: x=-7.5, E1: x=59.5），零着陆缺口
  const escLength = 11.4;
  const upperSlabEdgeX = side === 'west' ? x1 + 2.5 : x2 - 2.5;
  const escCenterX = upperSlabEdgeX - dirX * (escLength * 0.5);

  for (const dz of [-1.48, 1.48]) {
    group.add(
      buildEscalatorFlight({
        x: escCenterX,
        z: midZ + dz,
        baseY: finished1FY,
        length: escLength,
        width: 1.56,
        riseY: ELEVATIONS.FLOOR_HEIGHT,
        directionX: dirX,
        materials,
      })
    );
  }

  // 2. KKAA 标志性 26 根曲面波浪暖雪松木格栅肋（从二层顶棚柔和下垂弯曲，直抵主入口幕墙上方）
  const ribCount = 26;
  const ceilingY = ELEVATIONS.FLOOR_3_Y - 0.16; // 紧贴 3F 楼板底面（9.695）
  const dropLowY = finished1FY + 3.05; // 在主入口门廊侧垂落至亲人尺度

  for (let i = 0; i < ribCount; i++) {
    const tZ = (i + 0.5) / ribCount;
    const rz = z1 + 1.0 + tZ * (spanZ - 2.0);
    const wave = Math.sin(tZ * Math.PI * 2.15 + (side === 'west' ? 0.3 : 1.8));
    const localDrop = dropLowY + wave * 0.72;
    const localArch = ceilingY - 0.32 + Math.cos(tZ * Math.PI * 1.6) * 0.34;

    const p0 = new THREE.Vector3(deepEdgeX, localArch, 0);
    const p1 = new THREE.Vector3(THREE.MathUtils.lerp(deepEdgeX, portalEdgeX, 0.38), localArch - 0.18, 0);
    const p2 = new THREE.Vector3(
      THREE.MathUtils.lerp(deepEdgeX, portalEdgeX, 0.72),
      THREE.MathUtils.lerp(localArch, localDrop, 0.46),
      0
    );
    const p3 = new THREE.Vector3(portalEdgeX, localDrop, 0);

    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    const pts = curve.getPoints(22);

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

  // 3. 标志性双层通高室内温瓷圆柱（严格贯通 1F 完工面 0.435 至 3F 板底 9.695，高度 9.26m 零缝隙）
  const fullColH = ELEVATIONS.FLOOR_3_Y - finished1FY;
  const colGeo = new THREE.CylinderGeometry(0.42, 0.42, fullColH, 18);
  const collarGeo = new THREE.CylinderGeometry(0.50, 0.52, 0.16, 18);
  const colX = THREE.MathUtils.lerp(portalEdgeX, deepEdgeX, 0.28);
  for (const dz of [-5.8, 5.8]) {
    const cz = midZ + dz;
    const col = new THREE.Mesh(colGeo, materials.whiteColumn);
    col.position.set(colX, finished1FY + fullColH * 0.5, cz);
    col.castShadow = true;
    col.receiveShadow = true;
    group.add(col);

    // 柱脚与柱顶深石墨阴影收边环
    const baseRing = new THREE.Mesh(collarGeo, materials.darkCharcoalMetal);
    baseRing.position.set(colX, finished1FY + 0.08, cz);
    group.add(baseRing);

    const capRing = new THREE.Mesh(collarGeo, materials.darkCharcoalMetal);
    capRing.position.set(colX, ELEVATIONS.FLOOR_3_Y - 0.08, cz);
    group.add(capRing);
  }

  // 4. 夜间波浪木格栅隐藏式 3000K 暖金洗墙灯带
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
 * - 拱券木肋底端坐落于 1F 完工地坪（0.435），拱顶精确顶贴 2F 楼板底面（4.895）
 * - 扶梯居中于北侧挑空扶梯井（z=36.3, x=81.5..90.9），穿过 2F 专属镂空井口直达 2F，不干扰南侧消防通道
 */
export function buildE3VaultedLobby({ x1, z1, x2, z2, floor1Y, materials }) {
  const group = new THREE.Group();
  group.name = 'E3_VaultedWoodLobby';

  const slabT = ELEVATIONS.SLAB_THICKNESS;
  const finished1FY = floor1Y + slabT;
  const ribHalfT = 0.14;
  // 2F 楼板底面 = ELEVATIONS.FLOOR_2_Y (4.895)，肋条中心拱顶 4.755 使其顶面严格贴合 4.895！
  const ceilingPeakY = ELEVATIONS.FLOOR_2_Y - ribHalfT;
  const ribCount = 24;
  const spanZ = z2 - z1;

  for (let i = 0; i < ribCount; i++) {
    const t = (i + 0.5) / ribCount;
    const rx = x1 + 1.8 + t * (x2 - x1 - 3.6);
    // 扶梯井口上方区间（x ∈ [81.0, 91.8]）木肋优雅收口于井口南侧边梁 z=38.0，彻底避让扶梯上升净空
    const overEscalatorWell = rx >= 81.0 && rx <= 91.8;
    const northEndZ = overEscalatorWell ? 38.05 : z1 + 0.85;
    const midZ = overEscalatorWell ? (z2 + northEndZ) * 0.5 : z2 - spanZ * 0.45;
    const northEndY = overEscalatorWell
      ? ceilingPeakY - 0.04
      : ceilingPeakY - 0.42 - Math.sin(t * Math.PI * 3) * 0.18;

    const p0 = new THREE.Vector3(z2 - 0.45, finished1FY, 0);
    const p1 = new THREE.Vector3(z2 - 0.65, finished1FY + 2.45, 0);
    const p2 = new THREE.Vector3(midZ, ceilingPeakY, 0);
    const p3 = new THREE.Vector3(northEndZ, northEndY, 0);
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    const pts = curve.getPoints(16);

    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].y + ribHalfT);
    for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k].x, pts[k].y + ribHalfT);
    for (let k = pts.length - 1; k >= 0; k--) shape.lineTo(pts[k].x, pts[k].y - ribHalfT);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false });
    // 旋转使曲线位于 Y-Z 平面
    geo.rotateY(-Math.PI / 2);
    const rib = new THREE.Mesh(geo, materials.curvedWoodRib);
    rib.position.set(rx, 0, 0);
    rib.castShadow = true;
    rib.receiveShadow = true;
    group.add(rib);
  }

  // 拱券木肋内嵌 3000K 暖琥珀线性暗藏灯槽（南侧通长 + 北侧避让扶梯井口）
  if (materials.warmAmberLightMat) {
    const southCove = new THREE.Mesh(
      new THREE.BoxGeometry(x2 - x1 - 4.4, 0.12, 0.22),
      materials.warmAmberLightMat
    );
    southCove.position.set((x1 + x2) * 0.5, ceilingPeakY - 0.36, z1 + spanZ * 0.72);
    group.add(southCove);

    // 北侧灯槽避开扶梯井 [81.0, 91.8] 分左右两段
    for (const [sx1, sx2] of [
      [x1 + 2.2, 80.6],
      [92.2, x2 - 2.2],
    ]) {
      if (sx2 - sx1 > 1.0) {
        const cove = new THREE.Mesh(
          new THREE.BoxGeometry(sx2 - sx1, 0.12, 0.22),
          materials.warmAmberLightMat
        );
        cove.position.set((sx1 + sx2) * 0.5, ceilingPeakY - 0.42, z1 + spanZ * 0.26);
        group.add(cove);
      }
    }
  }

  // 上行至 2F 报告厅/体育馆的扶梯（居中于 2F 扶梯井 z=36.3，上端精确着陆于 x=81.5）
  const e3EscLength = 9.4;
  group.add(
    buildEscalatorFlight({
      x: 81.5 + e3EscLength * 0.5, // 上端 81.5，下端 90.9
      z: 36.3,
      baseY: finished1FY,
      length: e3EscLength,
      width: 1.62,
      riseY: ELEVATIONS.FLOOR_HEIGHT,
      directionX: -1,
      materials,
    })
  );

  return group;
}
