import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BUILDING_WINGS,
  ELEVATIONS,
  PORTAL_CANOPIES,
  ROOF_COOLING_UNITS,
} from '../config/campusConfig.js';

/**
 * 屋顶系统（第 4 层 Group：roof）与 悬浮采光顶系统（第 5 层 Group：floatingCanopy）
 * 严格落实全部屋顶与悬浮采光顶细部要求：
 * - 屋顶大挑檐 + 暖木色吊顶底面 + 深灰压顶女儿墙
 * - 分布式单晶硅光伏阵列（带铝合金 16° 倾角支架，InstancedMesh）
 * - 锯齿状采光天窗（覆盖 W1 / W3 / W5 / E2 挑空中庭）
 * - 金属检修步道与护栏
 * - 模块化工业风冷却风罩（严格使用 LatheGeometry 车削喇叭口风罩 + ExtrudeGeometry 曲面弯叶 9 叶旋转叶轮 + 铜质热管 + 高密铝鳍片）
 * - 独立第 5 层「悬浮采光顶」：中央 32m 门廊与东侧门洞的钢结构玻璃顶棚 + 悬挑木格栅顶棚 + 中庭采光顶盖
 */

/**
 * 构造单组「模块化工业风冷却风罩」
 * 严格使用 LatheGeometry（车削喇叭口风罩）+ ExtrudeGeometry（曲面弯叶 9 叶旋转叶轮）+ 铜质热管 + 高密铝鳍片
 */
function buildIndustrialCoolingUnit(materials) {
  const unit = new THREE.Group();
  unit.name = 'IndustrialCoolingUnit';

  // 1. 工业风钢结构设备底座框与换热器壳体
  const basePlate = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, 0.36, 3.4),
    materials.industrialGunmetal
  );
  basePlate.position.y = 0.18;
  basePlate.castShadow = true;
  basePlate.receiveShadow = true;
  unit.add(basePlate);

  // 2. 两侧高密度铝鳍片散热器排（InstancedMesh 高密铝鳍片）
  const finCountPerSide = 14;
  const finGeo = new THREE.BoxGeometry(0.065, 1.32, 0.85);
  const finInst = new THREE.InstancedMesh(finGeo, materials.aluminumFin, finCountPerSide * 2);
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < finCountPerSide; i++) {
      const fx = -2.35 + (i / (finCountPerSide - 1)) * 4.7;
      dummy.position.set(fx, 1.02, side * 1.18);
      dummy.rotation.set(side * 0.18, 0, 0);
      dummy.updateMatrix();
      finInst.setMatrixAt(idx++, dummy.matrix);
    }
  }
  finInst.instanceMatrix.needsUpdate = true;
  finInst.castShadow = false;
  unit.add(finInst);

  // 3. 贯穿鳍片的铜质热管（弯头 + 水平换热主管）
  const pipeGeo = new THREE.CylinderGeometry(0.075, 0.075, 5.15, 12);
  pipeGeo.rotateZ(Math.PI / 2);
  const elbowGeo = new THREE.TorusGeometry(0.24, 0.075, 10, 14, Math.PI);
  for (const side of [-1, 1]) {
    for (const py of [0.68, 1.12, 1.52]) {
      const pipe = new THREE.Mesh(pipeGeo, materials.copperPipe);
      pipe.position.set(0, py, side * 1.18);
      pipe.castShadow = true;
      unit.add(pipe);
    }
    // 两端铜质 U 型弯管
    for (const endX of [-2.58, 2.58]) {
      const elbow = new THREE.Mesh(elbowGeo, materials.copperPipe);
      elbow.position.set(endX, 0.9, side * 1.18);
      elbow.rotation.y = endX < 0 ? Math.PI / 2 : -Math.PI / 2;
      elbow.rotation.z = Math.PI / 2;
      unit.add(elbow);
    }
  }
  // 顶部铜质集液总管与压力表阀体
  const headerPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 2.45, 14),
    materials.copperPipe
  );
  headerPipe.rotation.x = Math.PI / 2;
  headerPipe.position.set(-2.55, 1.62, 0);
  unit.add(headerPipe);

  // 4. 双联 LatheGeometry 车削喇叭口风罩 + ExtrudeGeometry 曲面弯叶 9 叶旋转叶轮
  const impellers = [];

  // LatheGeometry 剖面点：底法兰 -> 喉部收缩 -> 顶部流线喇叭口外翻
  const shroudProfile = [
    new THREE.Vector2(1.06, 0.0),
    new THREE.Vector2(1.06, 0.12),
    new THREE.Vector2(0.95, 0.24),
    new THREE.Vector2(0.88, 0.56),
    new THREE.Vector2(0.92, 0.86),
    new THREE.Vector2(1.04, 1.08),
    new THREE.Vector2(1.16, 1.2),
    new THREE.Vector2(1.11, 1.24),
    new THREE.Vector2(0.98, 1.06),
    new THREE.Vector2(0.82, 0.72),
    new THREE.Vector2(0.84, 0.24),
    new THREE.Vector2(0.98, 0.0),
  ];
  const shroudGeo = new THREE.LatheGeometry(shroudProfile, 18);

  // ExtrudeGeometry 曲面弯叶轮廓（单叶气动弯掠叶片，精简曲线段数）
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.16, -0.05);
  bladeShape.bezierCurveTo(0.36, -0.14, 0.62, -0.08, 0.81, 0.04);
  bladeShape.quadraticCurveTo(0.83, 0.14, 0.76, 0.19);
  bladeShape.bezierCurveTo(0.56, 0.14, 0.34, 0.08, 0.16, 0.06);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.045,
    bevelEnabled: false,
    curveSegments: 4,
  });
  bladeGeo.rotateX(Math.PI / 2);

  // 将 9 片 ExtrudeGeometry 曲面弯叶合并为 1 份单几何体，使单叶轮仅占 1 次 Draw Call（140 -> 14）
  const mergedBladeParts = [];
  const rotMat = new THREE.Matrix4();
  const pitchMat = new THREE.Matrix4().makeRotationX(0.42);
  for (let b = 0; b < 9; b++) {
    const g = bladeGeo.index ? bladeGeo.toNonIndexed() : bladeGeo.clone();
    g.applyMatrix4(pitchMat);
    rotMat.makeRotationY((b / 9) * Math.PI * 2);
    g.applyMatrix4(rotMat);
    mergedBladeParts.push(g);
  }
  const combinedBladesGeo = mergeGeometries(mergedBladeParts, false);
  mergedBladeParts.forEach((g) => g.dispose());
  bladeGeo.dispose();

  const hubGeo = new THREE.CylinderGeometry(0.19, 0.22, 0.28, 12);
  const guardRingGeo = new THREE.TorusGeometry(0.94, 0.025, 6, 20);
  guardRingGeo.rotateX(Math.PI / 2);

  for (const fx of [-1.28, 1.28]) {
    const fanPod = new THREE.Group();
    fanPod.position.set(fx, 1.35, 0);

    // 车削喇叭口风罩
    const shroud = new THREE.Mesh(shroudGeo, materials.fanShroud);
    shroud.castShadow = true;
    shroud.receiveShadow = true;
    fanPod.add(shroud);

    // 顶部防护网环与十字支架
    const guard = new THREE.Mesh(guardRingGeo, materials.darkCharcoalMetal);
    guard.position.y = 1.18;
    fanPod.add(guard);

    for (let s = 0; s < 2; s++) {
      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(1.96, 0.04, 0.04),
        materials.darkCharcoalMetal
      );
      strut.position.y = 1.18;
      strut.rotation.y = (s * Math.PI) / 2;
      fanPod.add(strut);
    }

    // 9 叶曲面弯叶旋转叶轮（合批单 Mesh + 铜毂，标记 noMerge 保持独立旋转，零阴影重绘开销）
    const impeller = new THREE.Group();
    impeller.userData.noMerge = true;
    impeller.position.y = 0.66;
    const hub = new THREE.Mesh(hubGeo, materials.copperPipe);
    const bladesMesh = new THREE.Mesh(combinedBladesGeo, materials.impellerMetal);
    bladesMesh.castShadow = false;
    impeller.add(hub, bladesMesh);

    // 暗色风腔底井（让陶瓷白 9 叶叶轮与喇叭口形成参考图 RTX 5090 般的深邃反差！）
    const fanWell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.84, 0.84, 0.16, 16),
      materials.darkCharcoalMetal
    );
    fanWell.position.y = 0.18;
    fanPod.add(fanWell);

    fanPod.add(impeller);
    impellers.push(impeller);
    unit.add(fanPod);
  }

  return { unit, impellers };
}

/**
 * 构建第 4 层 Group（屋顶）与第 5 层 Group（悬浮采光顶）
 */
export function buildRoofAndCanopies(materials) {
  const roofGroup = new THREE.Group();
  roofGroup.name = 'RoofLayer';

  const canopyGroup = new THREE.Group();
  canopyGroup.name = 'FloatingCanopyLayer';

  const roofY = ELEVATIONS.ROOF_Y;
  const animatedImpellers = [];

  // 1. 各翼屋面顶板、深色屋面防水层、大挑檐暖木吊顶与女儿墙
  const pvPanelTransforms = [];
  const pvLegTransforms = [];

  for (const w of BUILDING_WINGS) {
    const ww = w.x2 - w.x1;
    const wd = w.z2 - w.z1;
    const cx = (w.x1 + w.x2) * 0.5;
    const cz = (w.z1 + w.z2) * 0.5;

    // 带中庭开洞的屋面板（与室内挑空中庭完全穿透连通）
    const shape = new THREE.Shape();
    const ov = 1.35; // KKAA 标志性屋顶薄挑檐
    shape.moveTo(w.x1 - ov, -(w.z1 - ov));
    shape.lineTo(w.x2 + ov, -(w.z1 - ov));
    shape.lineTo(w.x2 + ov, -(w.z2 + ov));
    shape.lineTo(w.x1 - ov, -(w.z2 + ov));
    shape.closePath();

    if (w.atrium) {
      const a = w.atrium;
      const hole = new THREE.Path();
      hole.moveTo(a.x1, -a.z1);
      hole.lineTo(a.x2, -a.z1);
      hole.lineTo(a.x2, -a.z2);
      hole.lineTo(a.x1, -a.z2);
      hole.closePath();
      shape.holes.push(hole);
    }

    const slabGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.48,
      bevelEnabled: false,
    });
    slabGeo.rotateX(-Math.PI / 2);

    const roofMesh = new THREE.Mesh(slabGeo, materials.roofMembrane);
    roofMesh.position.y = roofY;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    roofGroup.add(roofMesh);

    // 屋顶下底暖木色悬挑吊顶
    const soffitMesh = new THREE.Mesh(slabGeo, materials.warmWoodSoffit);
    soffitMesh.position.y = roofY - 0.06;
    soffitMesh.scale.y = 0.18;
    roofGroup.add(soffitMesh);

    // 女儿墙边缘金属压顶（精致收边）
    const parapetH = 0.55;
    const edges = [
      [cx, roofY + 0.48 + parapetH * 0.5, w.z1 - ov + 0.2, ww + ov * 2, parapetH, 0.36],
      [cx, roofY + 0.48 + parapetH * 0.5, w.z2 + ov - 0.2, ww + ov * 2, parapetH, 0.36],
      [w.x1 - ov + 0.2, roofY + 0.48 + parapetH * 0.5, cz, 0.36, parapetH, wd + ov * 2],
      [w.x2 + ov - 0.2, roofY + 0.48 + parapetH * 0.5, cz, 0.36, parapetH, wd + ov * 2],
    ];
    for (const [ex, ey, ez, ew, eh, ed] of edges) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, ed), materials.roofParapet);
      p.position.set(ex, ey, ez);
      p.castShadow = true;
      p.receiveShadow = true;
      roofGroup.add(p);
    }

    // 2. 锯齿状采光天窗（Sawtooth Skylights，归属于第 4 层屋顶主体，顶部玻璃窗格归属悬浮采光顶协同分层）
    if (w.atrium && w.skylightType === 'sawtooth') {
      const a = w.atrium;
      const aw = a.x2 - a.x1;
      const ad = a.z2 - a.z1;
      const bays = Math.max(3, Math.round(ad / 5.4));
      const bayD = ad / bays;
      const ridgeH = 2.05;

      // 屋顶天窗反梁围护框
      const curbFrame = new THREE.Group();
      const cH = 0.55;
      const curbParts = [
        [(a.x1 + a.x2) * 0.5, roofY + 0.48 + cH * 0.5, a.z1 - 0.2, aw + 0.8, cH, 0.4],
        [(a.x1 + a.x2) * 0.5, roofY + 0.48 + cH * 0.5, a.z2 + 0.2, aw + 0.8, cH, 0.4],
        [a.x1 - 0.2, roofY + 0.48 + cH * 0.5, (a.z1 + a.z2) * 0.5, 0.4, cH, ad + 0.4],
        [a.x2 + 0.2, roofY + 0.48 + cH * 0.5, (a.z1 + a.z2) * 0.5, 0.4, cH, ad + 0.4],
      ];
      for (const [px, py, pz, pw, ph, pd] of curbParts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), materials.darkCharcoalMetal);
        m.position.set(px, py, pz);
        m.castShadow = true;
        curbFrame.add(m);
      }
      roofGroup.add(curbFrame);

      // 锯齿斜屋面与朝北漫射采光玻璃面（置于第 5 层悬浮采光顶 Group，爆炸时完整浮升！）
      const sawBaseY = roofY + 1.0;
      for (let b = 0; b < bays; b++) {
        const bz1 = a.z1 + b * bayD;
        const bz2 = bz1 + bayD;
        const bcz = (bz1 + bz2) * 0.5;

        // 朝北陡峭采光玻璃面
        const glassSlopeLen = Math.hypot(bayD * 0.24, ridgeH);
        const glassSlopeAngle = Math.atan2(ridgeH, bayD * 0.24);
        const sGlass = new THREE.Mesh(
          new THREE.BoxGeometry(aw + 0.2, 0.08, glassSlopeLen),
          materials.skylightGlass
        );
        sGlass.position.set((a.x1 + a.x2) * 0.5, sawBaseY + ridgeH * 0.5, bz1 + bayD * 0.12);
        sGlass.rotation.x = -glassSlopeAngle;
        canopyGroup.add(sGlass);

        // 朝南缓坡铝合金背板（金属质感）
        const backLen = Math.hypot(bayD * 0.76, ridgeH);
        const backAngle = Math.atan2(ridgeH, bayD * 0.76);
        const sBack = new THREE.Mesh(
          new THREE.BoxGeometry(aw + 0.35, 0.14, backLen),
          materials.roofParapet
        );
        sBack.position.set((a.x1 + a.x2) * 0.5, sawBaseY + ridgeH * 0.5, bz1 + bayD * 0.62);
        sBack.rotation.x = backAngle;
        sBack.castShadow = true;
        sBack.receiveShadow = true;
        canopyGroup.add(sBack);

        // 两端锯齿三角封板
        const triShape = new THREE.Shape();
        triShape.moveTo(0, 0);
        triShape.lineTo(bayD, 0);
        triShape.lineTo(bayD * 0.24, ridgeH);
        triShape.closePath();
        const triGeo = new THREE.ExtrudeGeometry(triShape, { depth: 0.16, bevelEnabled: false });
        triGeo.rotateY(-Math.PI / 2);
        for (const sideX of [a.x1, a.x2 + 0.16]) {
          const cap = new THREE.Mesh(triGeo, materials.darkCharcoalMetal);
          cap.position.set(sideX, sawBaseY, bz1);
          canopyGroup.add(cap);
        }
      }
    }

    // 3. 收集分布式单晶硅光伏阵列（带铝合金倾角支架）
    if (w.pvZones) {
      for (const zone of w.pvZones) {
        const zw = zone.x2 - zone.x1;
        const zd = zone.z2 - zone.z1;
        const rows = zone.rows || 3;
        const cols = Math.max(2, Math.floor(zw / 3.3));
        const panelW = (zw - (cols - 1) * 0.35) / cols;
        const panelD = Math.min(2.05, (zd / rows) * 0.68);
        const stepZ = zd / rows;

        for (let r = 0; r < rows; r++) {
          const pz = zone.z1 + (r + 0.5) * stepZ;
          for (let c = 0; c < cols; c++) {
            const px = zone.x1 + c * (panelW + 0.35) + panelW * 0.5;
            pvPanelTransforms.push({
              pos: [px, roofY + 0.96, pz],
              scale: [panelW, 0.08, panelD],
            });
            // 前后铝合金倾角支架立腿
            pvLegTransforms.push({
              pos: [px - panelW * 0.34, roofY + 0.72, pz - panelD * 0.34],
              scale: [0.08, 0.62, 0.08],
            });
            pvLegTransforms.push({
              pos: [px + panelW * 0.34, roofY + 0.72, pz - panelD * 0.34],
              scale: [0.08, 0.62, 0.08],
            });
            pvLegTransforms.push({
              pos: [px - panelW * 0.34, roofY + 0.58, pz + panelD * 0.34],
              scale: [0.08, 0.3, 0.08],
            });
            pvLegTransforms.push({
              pos: [px + panelW * 0.34, roofY + 0.58, pz + panelD * 0.34],
              scale: [0.08, 0.3, 0.08],
            });
          }
        }
      }
    }

    // 4. 金属检修步道（沿屋面主要纵轴铺设镀锌格栅走道）
    const walkW = 1.15;
    const isZLong = wd >= ww;
    const walkway = new THREE.Mesh(
      new THREE.BoxGeometry(isZLong ? walkW : ww - 3.6, 0.09, isZLong ? wd - 3.6 : walkW),
      materials.walkwayMetal
    );
    walkway.position.set(
      isZLong ? w.x1 + 1.65 : cx,
      roofY + 0.56,
      isZLong ? cz : w.z1 + 1.65
    );
    walkway.receiveShadow = true;
    roofGroup.add(walkway);
  }

  // 批量 InstancedMesh 光伏板与铝合金倾角支架
  const dummy = new THREE.Object3D();
  if (pvPanelTransforms.length > 0) {
    const pvInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      materials.solarPanel,
      pvPanelTransforms.length
    );
    pvInst.castShadow = true;
    pvInst.receiveShadow = true;
    pvPanelTransforms.forEach((p, idx) => {
      dummy.position.set(...p.pos);
      dummy.rotation.set(0.28, 0, 0); // 16° 朝南倾角
      dummy.scale.set(...p.scale);
      dummy.updateMatrix();
      pvInst.setMatrixAt(idx, dummy.matrix);
    });
    pvInst.instanceMatrix.needsUpdate = true;
    roofGroup.add(pvInst);
  }

  if (pvLegTransforms.length > 0) {
    const legInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      materials.aluminumFrame,
      pvLegTransforms.length
    );
    pvLegTransforms.forEach((l, idx) => {
      dummy.position.set(...l.pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...l.scale);
      dummy.updateMatrix();
      legInst.setMatrixAt(idx, dummy.matrix);
    });
    legInst.instanceMatrix.needsUpdate = true;
    roofGroup.add(legInst);
  }

  // 5. 布置 7 组屋顶模块化工业风冷却风罩（含旋转叶轮动画注册）
  for (const cfg of ROOF_COOLING_UNITS) {
    const { unit, impellers } = buildIndustrialCoolingUnit(materials);
    unit.position.set(cfg.x, roofY + 0.48, cfg.z);
    unit.rotation.y = cfg.rotY;
    unit.scale.setScalar(1.28);
    roofGroup.add(unit);
    animatedImpellers.push(...impellers);
  }

  // 6. 第 5 层独立「悬浮采光顶」：中央 32m 大入口门廊 + 东侧门洞的钢构玻璃顶棚与悬挑木格栅顶棚
  // 严格对照实拍图 KKAA_EiichiKano_07 / 08 / 11
  const slatUnit = new THREE.BoxGeometry(1, 1, 1);
  const slatMatrices = [];
  const beamMatrices = [];
  const downlightPositions = [];

  for (const portal of PORTAL_CANOPIES) {
    const pw = portal.x2 - portal.x1 + portal.overhangX * 2;
    const pd = portal.z2 - portal.z1 + portal.overhangZ * 2;
    const cx = (portal.x1 + portal.x2) * 0.5;
    const cz = (portal.z1 + portal.z2) * 0.5;
    const canopyY = roofY + 0.35;

    // 收集门廊木格栅底面 3000K 暖琥珀嵌入式筒灯点阵（夜景下从悬挑顶棚温柔洒亮地面广场）
    const dlCols = portal.slatAxis === 'z' ? 5 : 4;
    const dlRows = portal.slatAxis === 'z' ? 4 : 4;
    for (let ix = 0; ix < dlCols; ix++) {
      const dx = cx - pw * 0.38 + (ix / Math.max(1, dlCols - 1)) * (pw * 0.76);
      for (let iz = 0; iz < dlRows; iz++) {
        const dz = cz - pd * 0.36 + (iz / Math.max(1, dlRows - 1)) * (pd * 0.72);
        downlightPositions.push([dx, canopyY - 0.21, dz]);
      }
    }

    // 顶层通透磨砂夹胶玻璃采光顶板
    const glassTop = new THREE.Mesh(
      new THREE.BoxGeometry(pw, 0.14, pd),
      materials.portalCanopyGlass
    );
    glassTop.position.set(cx, canopyY + 0.52, cz);
    glassTop.castShadow = false;
    glassTop.receiveShadow = true;
    canopyGroup.add(glassTop);

    // 纵横深色钢结构主次梁格栅（托举悬浮采光玻璃）
    const nx = Math.max(4, Math.round(pw / 3.2));
    const nz = Math.max(4, Math.round(pd / 3.2));
    for (let i = 0; i <= nx; i++) {
      const bx = cx - pw * 0.5 + (i / nx) * pw;
      beamMatrices.push({
        pos: [bx, canopyY + 0.28, cz],
        scale: [0.16, 0.34, pd],
      });
    }
    for (let j = 0; j <= nz; j++) {
      const bz = cz - pd * 0.5 + (j / nz) * pd;
      beamMatrices.push({
        pos: [cx, canopyY + 0.28, bz],
        scale: [pw, 0.28, 0.16],
      });
    }

    // 标志性悬挑错落宽木格栅顶棚（KKAA_EiichiKano_07 / 08 中标志性交错悬吊木板条）
    if (portal.slatAxis === 'z') {
      const stripCount = 19;
      for (let i = 0; i < stripCount; i++) {
        const sx = cx - pw * 0.48 + (i / (stripCount - 1)) * (pw * 0.96);
        // 交错分段与轻微长短韵律，还原实拍中穿透阳光的格栅虚实感
        const segLen = pd * (0.38 + ((i * 7) % 3) * 0.11);
        const shift = ((i % 2 === 0 ? 1 : -1) * pd) * 0.18;
        slatMatrices.push({
          pos: [sx, canopyY - 0.16, cz + shift * 0.55],
          scale: [0.82, 0.08, segLen],
        });
        slatMatrices.push({
          pos: [sx, canopyY - 0.16, cz - shift * 1.15],
          scale: [0.76, 0.08, pd * 0.34],
        });
      }
    } else {
      const stripCount = 14;
      for (let i = 0; i < stripCount; i++) {
        const sz = cz - pd * 0.46 + (i / (stripCount - 1)) * (pd * 0.92);
        const shift = (i % 2 === 0 ? 1 : -1) * pw * 0.14;
        slatMatrices.push({
          pos: [cx + shift * 0.5, canopyY - 0.16, sz],
          scale: [pw * 0.52, 0.08, 0.78],
        });
        slatMatrices.push({
          pos: [cx - shift * 1.1, canopyY - 0.16, sz],
          scale: [pw * 0.34, 0.08, 0.72],
        });
      }
    }
  }

  if (beamMatrices.length > 0) {
    const beamInst = new THREE.InstancedMesh(slatUnit, materials.darkCharcoalMetal, beamMatrices.length);
    beamInst.castShadow = true;
    beamMatrices.forEach((b, i) => {
      dummy.position.set(...b.pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...b.scale);
      dummy.updateMatrix();
      beamInst.setMatrixAt(i, dummy.matrix);
    });
    beamInst.instanceMatrix.needsUpdate = true;
    canopyGroup.add(beamInst);
  }

  if (slatMatrices.length > 0) {
    const slatInst = new THREE.InstancedMesh(slatUnit, materials.warmWoodSoffit, slatMatrices.length);
    slatInst.castShadow = true;
    slatInst.receiveShadow = true;
    slatMatrices.forEach((s, i) => {
      dummy.position.set(...s.pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...s.scale);
      dummy.updateMatrix();
      slatInst.setMatrixAt(i, dummy.matrix);
    });
    slatInst.instanceMatrix.needsUpdate = true;
    canopyGroup.add(slatInst);
  }

  if (downlightPositions.length > 0 && materials.warmAmberLightMat) {
    const dlGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.08, 10);
    const dlInst = new THREE.InstancedMesh(dlGeo, materials.warmAmberLightMat, downlightPositions.length);
    dlInst.name = 'PortalCanopyDownlights';
    downlightPositions.forEach(([x, y, z], i) => {
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      dlInst.setMatrixAt(i, dummy.matrix);
    });
    dlInst.instanceMatrix.needsUpdate = true;
    canopyGroup.add(dlInst);
  }

  return {
    roofGroup,
    canopyGroup,
    update(dt) {
      // 屋顶 9 叶曲面弯叶冷却叶轮持续平稳旋转
      for (let i = 0; i < animatedImpellers.length; i++) {
        animatedImpellers[i].rotation.y += dt * (2.6 + (i % 3) * 0.35);
      }
    },
  };
}
