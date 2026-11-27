import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BUILDING_WINGS,
  ELEVATIONS,
  PORTAL_CANOPIES,
  ROOF_COOLING_UNITS,
} from '../config/campusConfig.js';
import {
  classifySegmentEndpoints,
  computeExposedFacadeSegments,
  computeNonOverlappingExtensions,
} from './FacadeSystem.js';

/**
 * 屋顶系统（第 4 层 Group：roof）与 悬浮采光顶系统（第 5 层 Group：floatingCanopy）
 *
 * 精工工业美学升级 + 全部屋顶连接缺陷（A1-A5）根治：
 * - A1: 翼段核心屋面板零外扩无缝拼合，仅在真实外露建筑边界（自动排除相邻翼与门廊交界）设置无重叠挑檐与倒角女儿墙
 * - A2: 光伏阵列精准规避全部 7 组冷却机组与检修步道包络框，检修步道严丝合缝坐落于屋面顶面（roofY + 0.48）
 * - A3: 冷却机组重构为参考图 RTX 级精密工业硬件：圆角倒角拉丝钛灰风罩 + 实体静压腔箱体 + 高密深石墨 CNC 散热鳍片
 *       + 铜质换热管束 + 双联车削喇叭口与 9 叶曲面弯叶旋转叶轮 + 微距冰青/琥珀运行状态灯点
 * - A4: 光伏板倾角支架按精确三角平面方程计算前后立腿高度，底部平贴屋面、顶部严密嵌入组件铝框，配套独立拉丝铝边框托盘
 * - A5: 门廊主钢梁直接对齐全部通高立柱中心线，顶层升级为参考图风格悬浮冰青磨砂亚克力采光顶板与钛银收边
 */

function createRoundedRectShape(width, depth, radius) {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const r = Math.min(radius, hw * 0.45, hd * 0.45);
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hd);
  s.lineTo(hw - r, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + r);
  s.lineTo(hw, hd - r);
  s.quadraticCurveTo(hw, hd, hw - r, hd);
  s.lineTo(-hw + r, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - r);
  s.lineTo(-hw, -hd + r);
  s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  s.closePath();
  return s;
}

/**
 * 创建 7 组屋顶 RTX 级模块化工业风冷却风罩的共享几何体库（一次生成、全园复用，显著降低显存与构建耗时）
 */
function createCoolingUnitSharedGeos() {
  // 1. 倒角圆角主底座机盘（5.8 x 3.6）
  const baseShape = createRoundedRectShape(5.8, 3.6, 0.42);
  const baseChassisGeo = new THREE.ExtrudeGeometry(baseShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 8,
  });
  baseChassisGeo.rotateX(-Math.PI / 2);
  baseChassisGeo.translate(0, 0.06, 0); // 底面 y = 0.00，顶面 y = 0.36

  // 2. 实体静压腔箱体（彻底修复 A3：无悬空，从底座顶面 0.36 严密托举双风罩至 1.40）
  const plenumGeo = new THREE.BoxGeometry(5.28, 1.06, 1.92);

  // 3. RTX 风格顶部双孔镂空倒角外护罩（圆角外框 + 双圆形风筒切口）
  const shroudTopShape = createRoundedRectShape(5.68, 3.44, 0.38);
  for (const fx of [-1.28, 1.28]) {
    const hole = new THREE.Path();
    hole.absarc(fx, 0, 1.02, 0, Math.PI * 2, true);
    shroudTopShape.holes.push(hole);
  }
  const shroudDeckGeo = new THREE.ExtrudeGeometry(shroudTopShape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 14,
  });
  shroudDeckGeo.rotateX(-Math.PI / 2);

  // 4. 两侧端盖倒角防护罩（呼应参考图 RTX 5090 两端包覆式拉丝外壳）
  const endCapGeo = new THREE.BoxGeometry(0.46, 1.06, 3.24);
  const crossBridgeGeo = new THREE.BoxGeometry(0.56, 0.14, 3.28);

  // 5. 高密度 CNC 散热鳍片单元
  const finGeo = new THREE.BoxGeometry(0.055, 1.02, 0.72);

  // 6. 铜质换热管 + U 型弯头 + 集液总管
  const pipeGeo = new THREE.CylinderGeometry(0.068, 0.068, 5.08, 10);
  pipeGeo.rotateZ(Math.PI / 2);
  const elbowGeo = new THREE.TorusGeometry(0.20, 0.068, 8, 12, Math.PI);
  const headerPipeGeo = new THREE.CylinderGeometry(0.105, 0.105, 2.55, 12);
  headerPipeGeo.rotateX(Math.PI / 2);

  // 7. LatheGeometry 精密车削喇叭口风罩（24 边高顺滑圆环）
  const shroudProfile = [
    new THREE.Vector2(1.04, 0.0),
    new THREE.Vector2(1.04, 0.10),
    new THREE.Vector2(0.96, 0.22),
    new THREE.Vector2(0.90, 0.44),
    new THREE.Vector2(0.94, 0.68),
    new THREE.Vector2(1.06, 0.86),
    new THREE.Vector2(1.14, 0.92),
    new THREE.Vector2(1.08, 0.96),
    new THREE.Vector2(0.96, 0.82),
    new THREE.Vector2(0.84, 0.52),
    new THREE.Vector2(0.85, 0.18),
    new THREE.Vector2(0.96, 0.0),
  ];
  const cowlGeo = new THREE.LatheGeometry(shroudProfile, 24);

  // 8. ExtrudeGeometry 曲面弯叶 9 叶旋转叶轮（合批单几何体）
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.17, -0.055);
  bladeShape.bezierCurveTo(0.38, -0.15, 0.64, -0.09, 0.82, 0.045);
  bladeShape.quadraticCurveTo(0.84, 0.15, 0.76, 0.20);
  bladeShape.bezierCurveTo(0.56, 0.145, 0.35, 0.085, 0.17, 0.065);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.042,
    bevelEnabled: false,
    curveSegments: 5,
  });
  bladeGeo.rotateX(Math.PI / 2);

  const mergedBladeParts = [];
  const rotMat = new THREE.Matrix4();
  const pitchMat = new THREE.Matrix4().makeRotationX(0.44);
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

  const hubGeo = new THREE.CylinderGeometry(0.19, 0.22, 0.24, 14);
  const hubCapGeo = new THREE.CylinderGeometry(0.13, 0.17, 0.06, 14);
  const fanWellGeo = new THREE.CylinderGeometry(0.92, 0.92, 0.34, 20);
  const guardRingGeo = new THREE.TorusGeometry(0.95, 0.026, 6, 24);
  guardRingGeo.rotateX(Math.PI / 2);
  const guardStrutGeo = new THREE.BoxGeometry(1.94, 0.036, 0.038);
  const ledStripBackGeo = new THREE.BoxGeometry(0.08, 0.20, 0.92);
  const ledDotGeo = new THREE.BoxGeometry(0.07, 0.09, 0.12);

  return {
    baseChassisGeo,
    plenumGeo,
    shroudDeckGeo,
    endCapGeo,
    crossBridgeGeo,
    finGeo,
    pipeGeo,
    elbowGeo,
    headerPipeGeo,
    cowlGeo,
    combinedBladesGeo,
    hubGeo,
    hubCapGeo,
    fanWellGeo,
    guardRingGeo,
    guardStrutGeo,
    ledStripBackGeo,
    ledDotGeo,
  };
}

/**
 * 构造单组 RTX 风格精工工业冷却风罩
 */
function buildIndustrialCoolingUnit(materials, geos) {
  const unit = new THREE.Group();
  unit.name = 'IndustrialCoolingUnit';

  const titaniumMat = materials.brushedTitanium || materials.fanShroud;
  const darkFinMat = materials.heatsinkDarkFin || materials.darkCharcoalMetal;
  const cyanLedMat = materials.microCyanLed || materials.serverLedMat;
  const amberLedMat = materials.microAmberLed || materials.warmAmberLightMat;

  // 1. 圆角倒角设备底座机盘（严密平贴屋面 y=0..0.36）
  const basePlate = new THREE.Mesh(geos.baseChassisGeo, materials.fanShroud);
  basePlate.castShadow = true;
  basePlate.receiveShadow = true;
  unit.add(basePlate);

  // 2. 实体深石墨静压腔箱体（无缝连接底座 0.36 与双风罩 1.40，根治 A3 悬空）
  const plenum = new THREE.Mesh(geos.plenumGeo, materials.industrialGunmetal);
  plenum.position.set(0, 0.88, 0);
  plenum.castShadow = true;
  plenum.receiveShadow = true;
  unit.add(plenum);

  // 3. RTX 风格顶部拉丝钛银双孔倒角外护罩 + 两端端盖 + 中央 X 形桥接筋
  const shroudDeck = new THREE.Mesh(geos.shroudDeckGeo, titaniumMat);
  shroudDeck.position.set(0, 1.38, 0);
  shroudDeck.castShadow = true;
  shroudDeck.receiveShadow = true;
  unit.add(shroudDeck);

  for (const ex of [-2.62, 2.62]) {
    const cap = new THREE.Mesh(geos.endCapGeo, materials.fanShroud);
    cap.position.set(ex, 0.88, 0);
    cap.castShadow = true;
    cap.receiveShadow = true;
    unit.add(cap);
  }

  const centerBridge = new THREE.Mesh(geos.crossBridgeGeo, materials.fanShroud);
  centerBridge.position.set(0, 1.66, 0);
  centerBridge.castShadow = true;
  unit.add(centerBridge);

  // 4. 两侧高密度深石墨 CNC 散热鳍片阵列（呼应参考图侧置高对比散热鳍片窗）
  const finCountPerSide = 20;
  const finInst = new THREE.InstancedMesh(geos.finGeo, darkFinMat, finCountPerSide * 2);
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < finCountPerSide; i++) {
      const fx = -2.26 + (i / (finCountPerSide - 1)) * 4.52;
      dummy.position.set(fx, 0.88, side * 1.28);
      dummy.rotation.set(side * 0.10, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      finInst.setMatrixAt(idx++, dummy.matrix);
    }
  }
  finInst.instanceMatrix.needsUpdate = true;
  finInst.castShadow = false;
  finInst.receiveShadow = true;
  unit.add(finInst);

  // 5. 贯穿鳍片的拉丝紫铜热管与集液总管
  for (const side of [-1, 1]) {
    for (const py of [0.60, 0.92, 1.24]) {
      const pipe = new THREE.Mesh(geos.pipeGeo, materials.copperPipe);
      pipe.position.set(0, py, side * 1.24);
      pipe.castShadow = false;
      unit.add(pipe);
    }
    for (const endX of [-2.44, 2.44]) {
      const elbow = new THREE.Mesh(geos.elbowGeo, materials.copperPipe);
      elbow.position.set(endX, 0.76, side * 1.24);
      elbow.rotation.y = endX < 0 ? Math.PI / 2 : -Math.PI / 2;
      elbow.rotation.z = Math.PI / 2;
      unit.add(elbow);
    }
  }
  const headerPipe = new THREE.Mesh(geos.headerPipeGeo, materials.copperPipe);
  headerPipe.position.set(-2.52, 1.50, 0);
  unit.add(headerPipe);

  // 6. 端面微距工业状态指示面板（冰青 + 暖琥珀微光点，呼应参考图精致微缩状态灯）
  const telemetryBezel = new THREE.Mesh(geos.ledStripBackGeo, materials.darkCharcoalMetal);
  telemetryBezel.position.set(2.86, 1.12, 0);
  unit.add(telemetryBezel);

  const ledCyan1 = new THREE.Mesh(geos.ledDotGeo, cyanLedMat);
  ledCyan1.position.set(2.885, 1.12, -0.22);
  unit.add(ledCyan1);

  const ledCyan2 = new THREE.Mesh(geos.ledDotGeo, cyanLedMat);
  ledCyan2.position.set(2.885, 1.12, 0.0);
  unit.add(ledCyan2);

  const ledAmber = new THREE.Mesh(geos.ledDotGeo, amberLedMat);
  ledAmber.position.set(2.885, 1.12, 0.24);
  unit.add(ledAmber);

  // 7. 双联 LatheGeometry 车削喇叭口风罩 + 深色风腔 + ExtrudeGeometry 9 叶旋转叶轮
  const impellers = [];
  for (const fx of [-1.28, 1.28]) {
    const fanPod = new THREE.Group();
    fanPod.position.set(fx, 1.32, 0);

    // 深石墨风腔底井（嵌入静压箱体顶面，反衬曲面叶片立体纵深）
    const fanWell = new THREE.Mesh(geos.fanWellGeo, materials.darkCharcoalMetal);
    fanWell.position.y = 0.02;
    fanPod.add(fanWell);

    // 车削流线喇叭口风罩（拉丝钛银）
    const shroud = new THREE.Mesh(geos.cowlGeo, titaniumMat);
    shroud.castShadow = true;
    shroud.receiveShadow = true;
    fanPod.add(shroud);

    // 顶部防护网环与十字支架
    const guard = new THREE.Mesh(geos.guardRingGeo, materials.darkCharcoalMetal);
    guard.position.y = 0.90;
    fanPod.add(guard);

    for (let s = 0; s < 2; s++) {
      const strut = new THREE.Mesh(geos.guardStrutGeo, materials.darkCharcoalMetal);
      strut.position.y = 0.90;
      strut.rotation.y = (s * Math.PI) / 2;
      fanPod.add(strut);
    }

    // 9 叶曲面弯叶旋转叶轮（深石墨叶片 + 紫铜轴毂 + 钛银端帽，标记 noMerge 保持平滑独立旋转）
    const impeller = new THREE.Group();
    impeller.userData.noMerge = true;
    impeller.position.y = 0.48;
    const hub = new THREE.Mesh(geos.hubGeo, materials.copperPipe);
    const hubCap = new THREE.Mesh(geos.hubCapGeo, titaniumMat);
    hubCap.position.y = 0.14;
    const bladesMesh = new THREE.Mesh(geos.combinedBladesGeo, materials.impellerMetal);
    bladesMesh.castShadow = false;
    impeller.add(hub, hubCap, bladesMesh);

    fanPod.add(impeller);
    impellers.push(impeller);
    unit.add(fanPod);
  }

  return { unit, impellers };
}

function rectsOverlap(ax1, az1, ax2, az2, bx1, bz1, bx2, bz2) {
  return ax1 < bx2 && ax2 > bx1 && az1 < bz2 && az2 > bz1;
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
  const roofSlabT = 0.48;
  const roofTopY = roofY + roofSlabT;
  const animatedImpellers = [];

  const unitScale = 1.26;
  // 预计算全部 7 组冷却机组的屋面安全净空包络（用于 A2 光伏与步道避让）
  const coolingNoGoBoxes = ROOF_COOLING_UNITS.map((cfg) => {
    const rotated = Math.abs(Math.sin(cfg.rotY)) > 0.5;
    const halfX = (rotated ? 3.6 : 5.8) * 0.5 * unitScale + 0.72;
    const halfZ = (rotated ? 5.8 : 3.6) * 0.5 * unitScale + 0.72;
    return {
      x1: cfg.x - halfX,
      z1: cfg.z - halfZ,
      x2: cfg.x + halfX,
      z2: cfg.z + halfZ,
    };
  });

  // 预计算全部检修步道位置（供 A2 光伏避让，且底部严丝合缝贴合 roofTopY）
  const walkwayRects = [];
  const walkwayRailList = [];

  for (const w of BUILDING_WINGS) {
    const ww = w.x2 - w.x1;
    const wd = w.z2 - w.z1;
    const cx = (w.x1 + w.x2) * 0.5;
    const cz = (w.z1 + w.z2) * 0.5;
    const walkW = 1.12;
    const isZLong = wd >= ww;

    // 针对 W1_W2_BRIDGE 改为东西向北沿步道，自然衔接 W2 步道且完全错开光伏排
    const forceXWalk = w.id === 'W1_W2_BRIDGE';
    const runAlongZ = isZLong && !forceXWalk;

    const wx = runAlongZ ? w.x1 + 1.55 : cx;
    const wz = runAlongZ ? cz : w.z1 + 1.55;
    const wLenX = runAlongZ ? walkW : ww - 3.2;
    const wLenZ = runAlongZ ? wd - 3.2 : walkW;

    walkwayRects.push({
      x1: wx - wLenX * 0.5 - 0.28,
      z1: wz - wLenZ * 0.5 - 0.28,
      x2: wx + wLenX * 0.5 + 0.28,
      z2: wz + wLenZ * 0.5 + 0.28,
    });

    const walkH = 0.08;
    const walkway = new THREE.Mesh(
      new THREE.BoxGeometry(wLenX, walkH, wLenZ),
      materials.walkwayMetal
    );
    // A2 修复：底部严格贴合 roofTopY (roofY + 0.48)，零 0.035m 悬浮！
    walkway.position.set(wx, roofTopY + walkH * 0.5, wz);
    walkway.receiveShadow = true;
    roofGroup.add(walkway);

    // 步道两侧纤细深石墨防滑压条
    for (const side of [-1, 1]) {
      walkwayRailList.push({
        pos: [
          runAlongZ ? wx + side * (walkW * 0.5 - 0.04) : wx,
          roofTopY + walkH + 0.02,
          runAlongZ ? wz : wz + side * (walkW * 0.5 - 0.04),
        ],
        scale: [runAlongZ ? 0.07 : wLenX, 0.04, runAlongZ ? wLenZ : 0.07],
      });
    }
  }

  // 1. A1 根治：各翼严格按净轮廓生成核心屋面板（ov = 0，相邻翼拼缝零重叠、零 Z-Fighting！）
  const pvPanelTransforms = [];
  const pvFrameTransforms = [];
  const pvLegTransforms = [];
  const pvFootTransforms = [];

  for (const w of BUILDING_WINGS) {
    const shape = new THREE.Shape();
    shape.moveTo(w.x1, -w.z1);
    shape.lineTo(w.x2, -w.z1);
    shape.lineTo(w.x2, -w.z2);
    shape.lineTo(w.x1, -w.z2);
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
      depth: roofSlabT,
      bevelEnabled: false,
    });
    slabGeo.rotateX(-Math.PI / 2);

    const roofMesh = new THREE.Mesh(slabGeo, materials.roofMembrane);
    roofMesh.position.y = roofY;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    roofGroup.add(roofMesh);

    // 2. 锯齿状采光天窗（屋面反梁围护框归 roofGroup，冰青磨砂采光玻璃与金属背板归 canopyGroup）
    if (w.atrium && w.skylightType === 'sawtooth') {
      const a = w.atrium;
      const aw = a.x2 - a.x1;
      const ad = a.z2 - a.z1;
      const bays = Math.max(3, Math.round(ad / 5.4));
      const bayD = ad / bays;
      const ridgeH = 2.05;
      const acx = (a.x1 + a.x2) * 0.5;

      // 屋顶天窗反梁围护框（坐落于 roofTopY，带顶部钛银泛水压边 + 内侧暖光槽）
      const cH = 0.54;
      const curbParts = [
        [acx, roofTopY + cH * 0.5, a.z1 - 0.22, aw + 0.88, cH, 0.44],
        [acx, roofTopY + cH * 0.5, a.z2 + 0.22, aw + 0.88, cH, 0.44],
        [a.x1 - 0.22, roofTopY + cH * 0.5, (a.z1 + a.z2) * 0.5, 0.44, cH, ad],
        [a.x2 + 0.22, roofTopY + cH * 0.5, (a.z1 + a.z2) * 0.5, 0.44, cH, ad],
      ];
      for (const [px, py, pz, pw, ph, pd] of curbParts) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), materials.darkCharcoalMetal);
        m.position.set(px, py, pz);
        m.castShadow = true;
        m.receiveShadow = true;
        roofGroup.add(m);
      }

      // 锯齿斜屋面、朝北冰青磨砂采光玻璃与悬浮亚克力采光檐口（置于第 5 层 canopyGroup）
      const sawBaseY = roofTopY + cH;
      const canopyFrameMat = materials.darkCharcoalMetal;
      const titaniumBackMat = materials.brushedTitanium || materials.roofParapet;

      for (let b = 0; b < bays; b++) {
        const bz1 = a.z1 + b * bayD;

        // 朝北陡峭冰青磨砂采光玻璃面
        const glassSlopeLen = Math.hypot(bayD * 0.24, ridgeH);
        const glassSlopeAngle = Math.atan2(ridgeH, bayD * 0.24);
        const sGlass = new THREE.Mesh(
          new THREE.BoxGeometry(aw + 0.12, 0.08, glassSlopeLen),
          materials.skylightGlass
        );
        sGlass.position.set(acx, sawBaseY + ridgeH * 0.5, bz1 + bayD * 0.12);
        sGlass.rotation.x = -glassSlopeAngle;
        canopyGroup.add(sGlass);

        // 采光玻璃细分深石墨竖梃（强化微缩建筑精度）
        const mullions = 3;
        for (let m = 1; m < mullions; m++) {
          const mx = a.x1 + (m / mullions) * aw;
          const sMul = new THREE.Mesh(
            new THREE.BoxGeometry(0.10, 0.12, glassSlopeLen),
            canopyFrameMat
          );
          sMul.position.set(mx, sawBaseY + ridgeH * 0.5, bz1 + bayD * 0.12);
          sMul.rotation.x = -glassSlopeAngle;
          canopyGroup.add(sMul);
        }

        // 朝南缓坡拉丝钛银金属背板 + 屋脊挑檐收口
        const backLen = Math.hypot(bayD * 0.76, ridgeH);
        const backAngle = Math.atan2(ridgeH, bayD * 0.76);
        const sBack = new THREE.Mesh(
          new THREE.BoxGeometry(aw + 0.36, 0.14, backLen),
          titaniumBackMat
        );
        sBack.position.set(acx, sawBaseY + ridgeH * 0.5, bz1 + bayD * 0.62);
        sBack.rotation.x = backAngle;
        sBack.castShadow = true;
        sBack.receiveShadow = true;
        canopyGroup.add(sBack);

        // 屋脊悬浮冰青亚克力遮阳挑眉（精致纤薄，呼应参考图悬浮透明顶片）
        const ridgeCap = new THREE.Mesh(
          new THREE.BoxGeometry(aw + 0.44, 0.06, 0.62),
          materials.portalCanopyGlass
        );
        ridgeCap.position.set(acx, sawBaseY + ridgeH + 0.10, bz1 + bayD * 0.16);
        canopyGroup.add(ridgeCap);

        // 两端锯齿三角封板
        const triShape = new THREE.Shape();
        triShape.moveTo(0, 0);
        triShape.lineTo(bayD, 0);
        triShape.lineTo(bayD * 0.24, ridgeH);
        triShape.closePath();
        const triGeo = new THREE.ExtrudeGeometry(triShape, { depth: 0.16, bevelEnabled: false });
        triGeo.rotateY(-Math.PI / 2);
        for (const sideX of [a.x1, a.x2 + 0.16]) {
          const cap = new THREE.Mesh(triGeo, canopyFrameMat);
          cap.position.set(sideX, sawBaseY, bz1);
          canopyGroup.add(cap);
        }
      }
    }

    // 3. 分布式单晶硅光伏阵列（修复 A2 冷却机组/步道碰撞 + 修复 A4 精确倾角立腿落地）
    if (w.pvZones) {
      const tilt = 0.28; // 16° 朝南倾角
      const tanTilt = Math.tan(tilt);
      const cosTilt = Math.cos(tilt);
      const panelT = 0.075;
      const panelCenterY = roofTopY + 0.50; // 中心抬离屋面 0.50m

      for (const zone of w.pvZones) {
        const zw = zone.x2 - zone.x1;
        const zd = zone.z2 - zone.z1;
        const rows = zone.rows || 3;
        const cols = Math.max(2, Math.floor(zw / 3.3));
        const panelW = (zw - (cols - 1) * 0.35) / cols;
        const panelD = Math.min(2.02, (zd / rows) * 0.68);
        const stepZ = zd / rows;

        for (let r = 0; r < rows; r++) {
          const pz = zone.z1 + (r + 0.5) * stepZ;
          for (let c = 0; c < cols; c++) {
            const px = zone.x1 + c * (panelW + 0.35) + panelW * 0.5;
            const bx1 = px - panelW * 0.5;
            const bx2 = px + panelW * 0.5;
            const bz1 = pz - panelD * 0.5;
            const bz2 = pz + panelD * 0.5;

            // A2 修复：跳过与任何冷却机组、检修步道或挑空中庭重叠的光伏单元格
            let blocked = false;
            for (const ng of coolingNoGoBoxes) {
              if (rectsOverlap(bx1, bz1, bx2, bz2, ng.x1, ng.z1, ng.x2, ng.z2)) {
                blocked = true;
                break;
              }
            }
            if (!blocked) {
              for (const wr of walkwayRects) {
                if (rectsOverlap(bx1, bz1, bx2, bz2, wr.x1, wr.z1, wr.x2, wr.z2)) {
                  blocked = true;
                  break;
                }
              }
            }
            if (!blocked && w.atrium) {
              const a = w.atrium;
              if (rectsOverlap(bx1, bz1, bx2, bz2, a.x1 - 0.6, a.z1 - 0.6, a.x2 + 0.6, a.z2 + 0.6)) {
                blocked = true;
              }
            }
            if (blocked) continue;

            // 光伏深靛晶格主面板
            pvPanelTransforms.push({
              pos: [px, panelCenterY, pz],
              scale: [panelW, panelT, panelD],
            });
            // 倒角铝合金背框托盘（略宽出 0.08m，营造精致工业边框高光）
            pvFrameTransforms.push({
              pos: [px, panelCenterY - 0.028 * cosTilt, pz - 0.028 * Math.sin(tilt)],
              scale: [panelW + 0.08, 0.055, panelD + 0.08],
            });

            // A4 修复：按精确斜面底面方程 yUnder(dz) = panelCenterY - dz*tan(tilt) - (panelT/2)/cos(tilt) 计算四腿
            const zOff = panelD * 0.34;
            const xOff = panelW * 0.34;
            for (const dz of [-zOff, zOff]) {
              const yUnder = panelCenterY - dz * tanTilt - (panelT * 0.5) / cosTilt;
              const yTop = yUnder + 0.02; // 严密嵌入背框 2cm
              const yBot = roofTopY; // 精确落地于屋面顶面
              const legH = Math.max(0.14, yTop - yBot);
              const legY = (yTop + yBot) * 0.5;
              for (const dx of [-xOff, xOff]) {
                pvLegTransforms.push({
                  pos: [px + dx, legY, pz + dz],
                  scale: [0.075, legH, 0.075],
                });
                pvFootTransforms.push({
                  pos: [px + dx, roofTopY + 0.02, pz + dz],
                  scale: [0.18, 0.04, 0.18],
                });
              }
            }
          }
        }
      }
    }
  }

  // 1b. A1 核心修复：仅在真实外露屋面周界生成无重叠大挑檐 + 暖木吊顶 + 精工倒角女儿墙
  // 将 PORTAL_CANOPIES 作为外部遮挡体传入，彻底杜绝屋面挑檐与女儿墙伸入中央/东侧门廊采光顶！
  const exposedRoofEdges = computeExposedFacadeSegments(BUILDING_WINGS, PORTAL_CANOPIES);
  const ov = 1.22; // 精致建筑薄挑檐
  const parapetH = 0.52;
  const parapetT = 0.34;

  const overhangSlabList = [];
  const overhangSoffitList = [];
  const parapetBodyList = [];
  const parapetInnerList = [];
  const parapetCapList = [];

  // 精确带状收边延伸计算：确保任意外挑距离与宽度的女儿墙/压顶/内衬在阳角与阴角均严格齐平闭合、零缺口、零共面重叠
  const computeRimSpan = (seg, endTypes, outerDist, bandW) => {
    const isX = seg.axis === 'x';
    const innerDist = outerDist - bandW;
    const extFor = (type) => {
      if (type === 'convex') return isX ? outerDist : innerDist;
      if (type === 'concave') return isX ? -innerDist : -outerDist;
      return 0;
    };
    const eStart = extFor(endTypes.start);
    const eEnd = extFor(endTypes.end);
    const len = seg.length + eStart + eEnd;
    if (len <= 0.12) return null;
    const shift = (eEnd - eStart) * 0.5;
    const cx = (seg.x1 + seg.x2) * 0.5;
    const cz = (seg.z1 + seg.z2) * 0.5;
    return {
      len,
      x: cx + (isX ? shift : 0),
      z: cz + (isX ? 0 : shift),
    };
  };

  for (const seg of exposedRoofEdges) {
    const cx = (seg.x1 + seg.x2) * 0.5;
    const cz = (seg.z1 + seg.z2) * 0.5;
    const faceRotY = Math.atan2(seg.nx, seg.nz);
    const isXAxis = seg.axis === 'x';
    const axisYBias = isXAxis ? 0.004 : -0.004;
    const endTypes = classifySegmentEndpoints(seg, BUILDING_WINGS, PORTAL_CANOPIES);

    const { extStart, extEnd } = computeNonOverlappingExtensions(seg, endTypes, ov);
    const len = seg.length + extStart + extEnd;
    if (len <= 0.15) continue;
    const shift = (extEnd - extStart) * 0.5;
    const sx = cx + (isXAxis ? shift : 0);
    const sz = cz + (isXAxis ? 0 : shift);

    // 外挑屋面板条（瓷土微暖灰外檐，与核心屋面板严密齐平衔接、零共面重叠）
    overhangSlabList.push({
      pos: [sx + seg.nx * (ov * 0.5), roofY + roofSlabT * 0.5 + axisYBias, sz + seg.nz * (ov * 0.5)],
      rotY: faceRotY,
      scale: [len, roofSlabT, ov],
    });

    // 屋顶挑檐底面暖雪松木吊顶
    overhangSoffitList.push({
      pos: [sx + seg.nx * (ov * 0.5), roofY - 0.04 + axisYBias, sz + seg.nz * (ov * 0.5)],
      rotY: faceRotY,
      scale: [len, 0.08, ov],
    });

    // 外露周界女儿墙（阳角与阴角严丝合缝闭合、零转角缺口、零内墙穿插）
    const pOffset = ov - parapetT * 0.5;
    const pSpan = computeRimSpan(seg, endTypes, ov, parapetT);
    if (pSpan) {
      parapetBodyList.push({
        pos: [pSpan.x + seg.nx * pOffset, roofTopY + parapetH * 0.5 + axisYBias, pSpan.z + seg.nz * pOffset],
        rotY: faceRotY,
        scale: [pSpan.len, parapetH, parapetT],
      });
    }

    // 女儿墙内侧深暖灰暗影衬边（精确收口于内壁面，凸显托盘凹槽层次）
    const innerT = 0.06;
    const innerOuter = ov - parapetT;
    const iSpan = computeRimSpan(seg, endTypes, innerOuter, innerT);
    if (iSpan) {
      parapetInnerList.push({
        pos: [
          iSpan.x + seg.nx * (innerOuter - innerT * 0.5),
          roofTopY + parapetH * 0.44 + axisYBias,
          iSpan.z + seg.nz * (innerOuter - innerT * 0.5),
        ],
        rotY: faceRotY,
        scale: [iSpan.len, parapetH * 0.88, innerT],
      });
    }

    // 倒角拉丝香槟钛银女儿墙压顶盖板（阳角/阴角全闭合无缺口）
    const capW = parapetT + 0.10;
    const capOuter = ov + 0.05;
    const cSpan = computeRimSpan(seg, endTypes, capOuter, capW);
    if (cSpan) {
      parapetCapList.push({
        pos: [cSpan.x + seg.nx * pOffset, roofTopY + parapetH + 0.05 + axisYBias, cSpan.z + seg.nz * pOffset],
        rotY: faceRotY,
        scale: [cSpan.len, 0.10, capW],
      });
    }
  }

  // 门廊交界线屋面低矮收水泛水边（仅在翼段内侧 0.12m 退让收口，绝不侵入任何门廊！）
  const portalEdgeFlashings = [
    { pos: [9.88, roofTopY + 0.12, -71], scale: [0.24, 0.24, 22.0] },
    { pos: [42.12, roofTopY + 0.12, -71], scale: [0.24, 0.24, 22.0] },
    { pos: [74.0, roofTopY + 0.12, 11.88], scale: [24.0, 0.24, 0.24] },
    { pos: [74.0, roofTopY + 0.12, 34.12], scale: [24.0, 0.24, 0.24] },
  ];
  for (const fl of portalEdgeFlashings) {
    parapetCapList.push({ pos: fl.pos, rotY: 0, scale: fl.scale });
  }

  // 批量 InstancedMesh 构建外檐、女儿墙、步道压条与光伏阵列
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const addInst = (items, mat, name, castShadow = true, receiveShadow = true) => {
    if (items.length === 0) return;
    const inst = new THREE.InstancedMesh(unitBox, mat, items.length);
    inst.name = name;
    inst.castShadow = castShadow;
    inst.receiveShadow = receiveShadow;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(...it.pos);
      dummy.rotation.set(0, it.rotY || 0, 0);
      dummy.scale.set(...it.scale);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    roofGroup.add(inst);
  };

  addInst(overhangSlabList, materials.slabEdgeClay || materials.roofMembrane, 'RoofOverhangSlabs', true, true);
  addInst(overhangSoffitList, materials.warmWoodSoffit, 'RoofOverhangSoffits', false, true);
  addInst(parapetBodyList, materials.roofParapet, 'RoofParapets', true, true);
  addInst(parapetInnerList, materials.shadowReveal || materials.darkCharcoalMetal, 'RoofParapetInners', false, true);
  addInst(parapetCapList, materials.roofParapetCap || materials.aluminumFrame, 'RoofParapetCaps', true, true);
  addInst(walkwayRailList, materials.darkCharcoalMetal, 'RoofWalkwayRails', false, true);

  if (pvPanelTransforms.length > 0) {
    const pvInst = new THREE.InstancedMesh(unitBox, materials.solarPanel, pvPanelTransforms.length);
    pvInst.name = 'SolarPanelCells';
    pvInst.castShadow = true;
    pvInst.receiveShadow = true;
    pvPanelTransforms.forEach((p, idx) => {
      dummy.position.set(...p.pos);
      dummy.rotation.set(0.28, 0, 0);
      dummy.scale.set(...p.scale);
      dummy.updateMatrix();
      pvInst.setMatrixAt(idx, dummy.matrix);
    });
    pvInst.instanceMatrix.needsUpdate = true;
    roofGroup.add(pvInst);

    const frameInst = new THREE.InstancedMesh(unitBox, materials.aluminumFrame, pvFrameTransforms.length);
    frameInst.name = 'SolarPanelFrames';
    frameInst.castShadow = false;
    frameInst.receiveShadow = true;
    pvFrameTransforms.forEach((f, idx) => {
      dummy.position.set(...f.pos);
      dummy.rotation.set(0.28, 0, 0);
      dummy.scale.set(...f.scale);
      dummy.updateMatrix();
      frameInst.setMatrixAt(idx, dummy.matrix);
    });
    frameInst.instanceMatrix.needsUpdate = true;
    roofGroup.add(frameInst);
  }

  if (pvLegTransforms.length > 0) {
    const legInst = new THREE.InstancedMesh(unitBox, materials.aluminumFrame, pvLegTransforms.length);
    legInst.name = 'SolarPanelLegs';
    pvLegTransforms.forEach((l, idx) => {
      dummy.position.set(...l.pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...l.scale);
      dummy.updateMatrix();
      legInst.setMatrixAt(idx, dummy.matrix);
    });
    legInst.instanceMatrix.needsUpdate = true;
    roofGroup.add(legInst);

    const footInst = new THREE.InstancedMesh(unitBox, materials.darkCharcoalMetal, pvFootTransforms.length);
    footInst.name = 'SolarPanelFeet';
    pvFootTransforms.forEach((f, idx) => {
      dummy.position.set(...f.pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...f.scale);
      dummy.updateMatrix();
      footInst.setMatrixAt(idx, dummy.matrix);
    });
    footInst.instanceMatrix.needsUpdate = true;
    roofGroup.add(footInst);
  }

  // 5. 布置 7 组 RTX 风格精工工业风冷却风罩（底部严密坐落于 roofTopY，含旋转叶轮动画注册）
  const coolingGeos = createCoolingUnitSharedGeos();
  for (const cfg of ROOF_COOLING_UNITS) {
    const { unit, impellers } = buildIndustrialCoolingUnit(materials, coolingGeos);
    unit.position.set(cfg.x, roofTopY, cfg.z);
    unit.rotation.y = cfg.rotY;
    unit.scale.setScalar(unitScale);
    roofGroup.add(unit);
    animatedImpellers.push(...impellers);
  }

  // 6. 第 5 层独立「悬浮采光顶」：中央 32m 大入口门廊 + 东侧门洞
  // A5 修复：主钢梁精准经过每一根门廊立柱轴线（立柱顶 14.975 严密嵌入梁底 14.955）
  const slatMatrices = [];
  const beamMatrices = [];
  const strutMatrices = [];
  const downlightPositions = [];
  const trimMatrices = [];

  for (const portal of PORTAL_CANOPIES) {
    const pw = portal.x2 - portal.x1 + portal.overhangX * 2;
    const pd = portal.z2 - portal.z1 + portal.overhangZ * 2;
    const cx = (portal.x1 + portal.x2) * 0.5;
    const cz = (portal.z1 + portal.z2) * 0.5;
    const canopyY = roofY + 0.35; // 14.845 -> 梁中心 15.125，梁底 14.955

    // 收集门廊木格栅底面 3000K 暖琥珀嵌入式筒灯点阵
    const dlCols = portal.slatAxis === 'z' ? 5 : 4;
    const dlRows = 4;
    for (let ix = 0; ix < dlCols; ix++) {
      const dx = cx - pw * 0.38 + (ix / Math.max(1, dlCols - 1)) * (pw * 0.76);
      for (let iz = 0; iz < dlRows; iz++) {
        const dz = cz - pd * 0.36 + (iz / Math.max(1, dlRows - 1)) * (pd * 0.72);
        downlightPositions.push([dx, canopyY - 0.21, dz]);
      }
    }

    // 顶层参考图级「悬浮冰青磨砂亚克力采光顶板」（略微悬浮于钢梁上方，配套纤细支座与拉丝钛银包边）
    const glassY = canopyY + 0.62;
    const glassTop = new THREE.Mesh(
      new THREE.BoxGeometry(pw, 0.13, pd),
      materials.portalCanopyGlass
    );
    glassTop.position.set(cx, glassY, cz);
    glassTop.castShadow = false;
    glassTop.receiveShadow = true;
    canopyGroup.add(glassTop);

    // 悬浮亚克力顶板四周纤细拉丝钛银收边框（捕捉顶部柔和棚拍高光）
    trimMatrices.push({ pos: [cx, glassY, cz - pd * 0.5], scale: [pw + 0.14, 0.15, 0.09] });
    trimMatrices.push({ pos: [cx, glassY, cz + pd * 0.5], scale: [pw + 0.14, 0.15, 0.09] });
    trimMatrices.push({ pos: [cx - pw * 0.5, glassY, cz], scale: [0.09, 0.15, pd] });
    trimMatrices.push({ pos: [cx + pw * 0.5, glassY, cz], scale: [0.09, 0.15, pd] });

    // A5 修复：提取全部立柱唯一 X/Z 坐标，确保主箱型钢梁精准穿过每一根立柱正中心！
    const colXs = [...new Set(portal.columns.map(([x]) => Number(x.toFixed(2))))].sort((a, b) => a - b);
    const colZs = [...new Set(portal.columns.map(([, z]) => Number(z.toFixed(2))))].sort((a, b) => a - b);

    // 构造主梁 + 周边梁 + 加密次梁坐标序列
    const buildGridLines = (minV, maxV, anchors, targetStep) => {
      const pts = [minV, ...anchors, maxV].sort((a, b) => a - b);
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        if (i === 0 || pts[i] - pts[i - 1] > 0.4) out.push({ v: pts[i], primary: anchors.includes(pts[i]) || i === 0 || i === pts.length - 1 });
        if (i < pts.length - 1) {
          const span = pts[i + 1] - pts[i];
          const sub = Math.max(1, Math.round(span / targetStep));
          for (let s = 1; s < sub; s++) {
            out.push({ v: pts[i] + (s / sub) * span, primary: false });
          }
        }
      }
      return out;
    };

    const gridXs = buildGridLines(cx - pw * 0.5, cx + pw * 0.5, colXs, 3.6);
    const gridZs = buildGridLines(cz - pd * 0.5, cz + pd * 0.5, colZs, 3.6);

    for (const gx of gridXs) {
      beamMatrices.push({
        pos: [gx.v, canopyY + 0.28, cz],
        scale: [gx.primary ? 0.24 : 0.13, gx.primary ? 0.34 : 0.24, pd],
      });
    }
    for (const gz of gridZs) {
      beamMatrices.push({
        pos: [cx, canopyY + 0.28, gz.v],
        scale: [pw, gz.primary ? 0.32 : 0.22, gz.primary ? 0.24 : 0.13],
      });
    }

    // 钢梁顶至悬浮冰青亚克力板的纤细点式抓件支杆
    for (const gx of gridXs) {
      if (!gx.primary) continue;
      for (const gz of gridZs) {
        if (!gz.primary) continue;
        strutMatrices.push({
          pos: [gx.v, canopyY + 0.50, gz.v],
          scale: [0.09, 0.16, 0.09],
        });
      }
    }

    // 标志性 KKAA 悬挑错落暖雪松木格栅顶棚（带吊杆衔接主钢梁）
    if (portal.slatAxis === 'z') {
      const stripCount = 19;
      for (let i = 0; i < stripCount; i++) {
        const sx = cx - pw * 0.48 + (i / (stripCount - 1)) * (pw * 0.96);
        const segLen = pd * (0.38 + ((i * 7) % 3) * 0.11);
        const shift = (i % 2 === 0 ? 1 : -1) * pd * 0.18;
        slatMatrices.push({
          pos: [sx, canopyY - 0.16, cz + shift * 0.55],
          scale: [0.80, 0.085, segLen],
        });
        slatMatrices.push({
          pos: [sx, canopyY - 0.16, cz - shift * 1.15],
          scale: [0.74, 0.085, pd * 0.34],
        });
      }
    } else {
      const stripCount = 14;
      for (let i = 0; i < stripCount; i++) {
        const sz = cz - pd * 0.46 + (i / (stripCount - 1)) * (pd * 0.92);
        const shift = (i % 2 === 0 ? 1 : -1) * pw * 0.14;
        slatMatrices.push({
          pos: [cx + shift * 0.5, canopyY - 0.16, sz],
          scale: [pw * 0.52, 0.085, 0.76],
        });
        slatMatrices.push({
          pos: [cx - shift * 1.1, canopyY - 0.16, sz],
          scale: [pw * 0.34, 0.085, 0.70],
        });
      }
    }
  }

  const addCanopyInst = (items, mat, name, castShadow = true, receiveShadow = true) => {
    if (items.length === 0) return;
    const inst = new THREE.InstancedMesh(unitBox, mat, items.length);
    inst.name = name;
    inst.castShadow = castShadow;
    inst.receiveShadow = receiveShadow;
    items.forEach((b, i) => {
      dummy.position.set(...b.pos);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(...b.scale);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    canopyGroup.add(inst);
  };

  addCanopyInst(beamMatrices, materials.darkCharcoalMetal, 'PortalCanopyBeams', true, true);
  addCanopyInst(strutMatrices, materials.aluminumFrame, 'PortalGlassStandoffs', false, true);
  addCanopyInst(trimMatrices, materials.brushedTitanium || materials.aluminumFrame, 'PortalGlassEdgeTrim', false, true);
  addCanopyInst(slatMatrices, materials.warmWoodSoffit, 'PortalWoodSlats', true, true);

  if (downlightPositions.length > 0 && materials.warmAmberLightMat) {
    const dlGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 10);
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
