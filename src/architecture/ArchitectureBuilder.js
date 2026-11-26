import * as THREE from 'three';
import {
  BUILDING_WINGS,
  ELEVATIONS,
  EXPLODE_OFFSETS,
  PORTAL_CANOPIES,
} from '../config/campusConfig.js';
import {
  createBasketballCourtTexture,
  createFeatheredLightPoolTexture,
  createInteriorFloorTexture,
  createNightWindowGlowTexture,
  createSolarPanelTexture,
  createTeakDeckTexture,
  createWoodLouverTexture,
} from '../core/ProceduralTextures.js';
import { buildFloorFacade } from './FacadeSystem.js';
import { buildE3VaultedLobby, buildMainEscalatorHall } from './EscalatorAtrium.js';
import { buildRoofAndCanopies } from './RoofDetails.js';
import { batchStaticMeshes } from '../core/MeshBatcher.js';

/**
 * 长三角物理研究中心主体建筑总装（严格分为 5 个独立 Group 支持平滑垂直爆炸透视）：
 * - groups.floor1       (1F)
 * - groups.floor2       (2F)
 * - groups.floor3       (3F)
 * - groups.roof         (屋顶)
 * - groups.floatingCanopy (悬浮采光顶)
 */

function createArchitectureMaterials(maxAnisotropy) {
  const woodTex = createWoodLouverTexture(maxAnisotropy);
  const teakTex = createTeakDeckTexture(maxAnisotropy);
  const solarTex = createSolarPanelTexture(maxAnisotropy);
  const courtTex = createBasketballCourtTexture(maxAnisotropy);
  const interiorFloorTex = createInteriorFloorTexture(maxAnisotropy);
  const nightWindowTex = createNightWindowGlowTexture(maxAnisotropy);
  const portalPoolTex = createFeatheredLightPoolTexture('255, 224, 162', '255, 162, 62', maxAnisotropy);

  const interiorLightMat = new THREE.MeshStandardMaterial({
    color: '#fffbf2',
    emissive: new THREE.Color('#ffdfa8'),
    emissiveIntensity: 0.22,
    roughness: 0.36,
  });

  // 4000K 物理实验室顶棚格栅灯盘
  const labCeilingLightMat = new THREE.MeshStandardMaterial({
    color: '#fffdf7',
    emissive: new THREE.Color('#ffebc2'),
    emissiveIntensity: 0.16,
    roughness: 0.32,
  });

  // 3000K 建筑暖琥珀重点照明（门廊筒灯、波浪扶梯暗槽、展柜顶光、亲水台灯带、报告厅舞台灯）
  const warmAmberLightMat = new THREE.MeshStandardMaterial({
    color: '#ffe6b8',
    emissive: new THREE.Color('#ffae42'),
    emissiveIntensity: 0.12,
    roughness: 0.24,
  });

  // 报告厅发光屏幕
  const auditoriumScreenMat = new THREE.MeshStandardMaterial({
    color: '#eef6ff',
    emissive: new THREE.Color('#9cd4ff'),
    emissiveIntensity: 0.2,
    roughness: 0.25,
  });

  // 机房 NVR 机柜微距状态光条
  const serverLedMat = new THREE.MeshStandardMaterial({
    color: '#7ef7ff',
    emissive: new THREE.Color('#22d3ee'),
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  // 夜景幕墙后置分间暖光景深层（日间隐藏 0 负载，夜间透出丰富分间暖白/暖金建筑层次）
  const nightWindowGlow = new THREE.MeshStandardMaterial({
    map: nightWindowTex,
    emissiveMap: nightWindowTex,
    color: '#ffe2b0',
    emissive: new THREE.Color('#ffc168'),
    emissiveIntensity: 0.0,
    roughness: 0.55,
    metalness: 0.0,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    side: THREE.DoubleSide,
    visible: false,
  });

  // 门廊与底层架空处地面羽化暖金光晕池
  const portalFloorPoolMat = new THREE.MeshBasicMaterial({
    map: portalPoolTex,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    visible: false,
  });

  const fireCorridorMat = new THREE.MeshStandardMaterial({
    color: '#e2e9e6',
    roughness: 0.55,
    metalness: 0.03,
  });

  const fireStripMat = new THREE.MeshStandardMaterial({
    color: '#4ad6a8',
    emissive: new THREE.Color('#10b981'),
    emissiveIntensity: 0.75,
    roughness: 0.25,
  });

  return {
    // 轻量化高透冰青玻璃幕墙（偏白模清透冰青调，参考图亚克力质感 + IOPLY 白模玻璃）
    lowEGlass: new THREE.MeshStandardMaterial({
      color: '#9ec2cf',
      roughness: 0.09,
      metalness: 0.16,
      transparent: true,
      opacity: 0.34,
      envMapIntensity: 1.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    glassBalustrade: new THREE.MeshStandardMaterial({
      color: '#c4e4f0',
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    portalCanopyGlass: new THREE.MeshStandardMaterial({
      color: '#cde9f2',
      emissive: new THREE.Color('#ffbc64'),
      emissiveIntensity: 0.0,
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.5,
      envMapIntensity: 1.35,
    }),
    skylightGlass: new THREE.MeshStandardMaterial({
      color: '#c2e3ef',
      emissive: new THREE.Color('#ffc470'),
      emissiveIntensity: 0.0,
      roughness: 0.1,
      metalness: 0.12,
      transparent: true,
      opacity: 0.52,
      envMapIntensity: 1.35,
    }),
    // 雅致建筑锡灰金属竖梃与框架（偏白模克制深灰，杜绝生硬死黑）
    darkCharcoalMetal: new THREE.MeshStandardMaterial({
      color: '#636d78',
      roughness: 0.42,
      metalness: 0.52,
    }),
    aluminumFrame: new THREE.MeshStandardMaterial({
      color: '#cfd6e0',
      roughness: 0.32,
      metalness: 0.68,
    }),
    aluminumFin: new THREE.MeshStandardMaterial({
      color: '#dce2ea',
      roughness: 0.28,
      metalness: 0.72,
    }),
    // 香槟浅橡木纹铝百叶与暖木吊顶（呼应 KKAA 原木调，同时保持白模雅致高级感）
    woodLouver: new THREE.MeshStandardMaterial({
      map: woodTex,
      color: '#dfd0bc',
      emissive: new THREE.Color('#704318'),
      emissiveIntensity: 0.0,
      roughness: 0.46,
      metalness: 0.14,
    }),
    warmWoodSoffit: new THREE.MeshStandardMaterial({
      map: woodTex,
      color: '#d9c9b2',
      emissive: new THREE.Color('#a45f20'),
      emissiveIntensity: 0.0,
      roughness: 0.52,
      metalness: 0.08,
    }),
    curvedWoodRib: new THREE.MeshStandardMaterial({
      map: woodTex,
      color: '#deceb6',
      emissive: new THREE.Color('#b86b24'),
      emissiveIntensity: 0.0,
      roughness: 0.46,
      metalness: 0.06,
    }),
    teakDeck: new THREE.MeshStandardMaterial({
      map: teakTex,
      emissive: new THREE.Color('#70441a'),
      emissiveIntensity: 0.0,
      roughness: 0.58,
      metalness: 0.03,
    }),
    // 陶瓷白建筑主体楼板与墙体
    slabConcrete: new THREE.MeshStandardMaterial({
      map: interiorFloorTex,
      color: '#f2f4f7',
      emissive: new THREE.Color('#6b4d29'),
      emissiveIntensity: 0.0,
      roughness: 0.55,
      metalness: 0.03,
    }),
    interiorWall: new THREE.MeshStandardMaterial({
      color: '#f6f7fa',
      emissive: new THREE.Color('#7d5b32'),
      emissiveIntensity: 0.0,
      roughness: 0.62,
      metalness: 0.02,
    }),
    labPartitionGlass: new THREE.MeshStandardMaterial({
      color: '#b8dce8',
      roughness: 0.12,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    labBench: new THREE.MeshStandardMaterial({
      color: '#dce1e8',
      roughness: 0.45,
      metalness: 0.15,
    }),
    labEquip: new THREE.MeshStandardMaterial({
      color: '#eef1f6',
      roughness: 0.36,
      metalness: 0.2,
    }),
    whiteColumn: new THREE.MeshStandardMaterial({
      color: '#f7f8fb',
      roughness: 0.36,
      metalness: 0.05,
    }),
    escalatorMetal: new THREE.MeshStandardMaterial({
      color: '#8f99a6',
      roughness: 0.36,
      metalness: 0.6,
    }),
    escalatorStep: new THREE.MeshStandardMaterial({
      color: '#5f6975',
      roughness: 0.6,
      metalness: 0.35,
    }),
    // 偏白模精工哑光灰白屋面与女儿墙（呼应 IOPLY_Campus_WhiteModel 与参考图白色工业顶盖）
    roofMembrane: new THREE.MeshStandardMaterial({
      color: '#e5e9ef',
      roughness: 0.72,
      metalness: 0.05,
    }),
    roofParapet: new THREE.MeshStandardMaterial({
      color: '#cdd4de',
      roughness: 0.44,
      metalness: 0.22,
    }),
    walkwayMetal: new THREE.MeshStandardMaterial({
      color: '#d4dbe4',
      roughness: 0.46,
      metalness: 0.42,
    }),
    solarPanel: new THREE.MeshStandardMaterial({
      map: solarTex,
      roughness: 0.28,
      metalness: 0.35,
      envMapIntensity: 1.15,
    }),
    // 复刻参考图 RTX-5090 级陶瓷白精密工业冷却风罩（哑光白风罩 + 银色高密鳍片 + 香槟铜热管 + 瓷白 9 叶叶轮）
    industrialGunmetal: new THREE.MeshStandardMaterial({
      color: '#e2e6ed',
      roughness: 0.38,
      metalness: 0.22,
    }),
    fanShroud: new THREE.MeshStandardMaterial({
      color: '#f2f4f8',
      roughness: 0.3,
      metalness: 0.14,
    }),
    impellerMetal: new THREE.MeshStandardMaterial({
      color: '#f9fafc',
      roughness: 0.25,
      metalness: 0.2,
    }),
    copperPipe: new THREE.MeshStandardMaterial({
      color: '#d6a57c',
      roughness: 0.26,
      metalness: 0.82,
    }),
    basketballCourt: new THREE.MeshStandardMaterial({
      map: courtTex,
      emissiveMap: courtTex,
      emissive: new THREE.Color('#fff2d4'),
      emissiveIntensity: 0.0,
      roughness: 0.4,
      metalness: 0.04,
    }),
    auditoriumWood: new THREE.MeshStandardMaterial({
      color: '#d6c4ac',
      emissive: new THREE.Color('#8e5622'),
      emissiveIntensity: 0.0,
      roughness: 0.55,
      metalness: 0.04,
    }),
    auditoriumSeat: new THREE.MeshStandardMaterial({
      color: '#738ca6',
      roughness: 0.65,
      metalness: 0.06,
    }),
    serverRack: new THREE.MeshStandardMaterial({
      color: '#4e5968',
      roughness: 0.42,
      metalness: 0.48,
    }),
    interiorLightMat,
    labCeilingLightMat,
    warmAmberLightMat,
    auditoriumScreenMat,
    serverLedMat,
    nightWindowGlow,
    portalFloorPoolMat,
    fireCorridorMat,
    fireStripMat,
  };
}

/**
 * 构建单个楼层翼段的楼板（精确抠除挑空中庭与 E3 双层通高孔洞）、
 * 双侧实验室 + 宽中央通廊 + 清晰消防疏散通道 + 室内立柱 + 灯光天花
 */
function buildWingInteriorFloor({ wing, floorIndex, floorY, materials, columnInstances }) {
  const grp = new THREE.Group();
  const ww = wing.x2 - wing.x1;
  const wd = wing.z2 - wing.z1;
  const cx = (wing.x1 + wing.x2) * 0.5;
  const cz = (wing.z1 + wing.z2) * 0.5;
  const slabT = ELEVATIONS.SLAB_THICKNESS;
  const innerH = ELEVATIONS.FLOOR_HEIGHT - slabT - 0.1;

  // 1. 建筑楼板（使用 Shape + holes 实现真实镂空挑空中庭）
  const slabShape = new THREE.Shape();
  slabShape.moveTo(wing.x1, -wing.z1);
  slabShape.lineTo(wing.x2, -wing.z1);
  slabShape.lineTo(wing.x2, -wing.z2);
  slabShape.lineTo(wing.x1, -wing.z2);
  slabShape.closePath();

  // 2F / 3F 在中庭区域镂空
  if (wing.atrium && floorIndex >= 2) {
    const a = wing.atrium;
    const hole = new THREE.Path();
    hole.moveTo(a.x1, -a.z1);
    hole.lineTo(a.x2, -a.z1);
    hole.lineTo(a.x2, -a.z2);
    hole.lineTo(a.x1, -a.z2);
    hole.closePath();
    slabShape.holes.push(hole);
  }

  // 主入口扶梯大厅 2F 局部挑空（给曲面木格栅与扶梯通高空间）
  if (wing.escalatorHall && floorIndex === 2) {
    const e = wing.escalatorHall;
    const hole = new THREE.Path();
    hole.moveTo(e.x1 + 2.5, -(e.z1 + 2.0));
    hole.lineTo(e.x2 - 2.5, -(e.z1 + 2.0));
    hole.lineTo(e.x2 - 2.5, -(e.z2 - 2.0));
    hole.lineTo(e.x1 + 2.5, -(e.z2 - 2.0));
    hole.closePath();
    slabShape.holes.push(hole);
  }

  // E3 东南半岛体量 3F 在报告厅与篮球体育馆上方双层通高镂空
  if (wing.isPeninsulaHall && floorIndex === 3) {
    const holeAud = new THREE.Path();
    holeAud.moveTo(64.5, -43.5);
    holeAud.lineTo(83.5, -43.5);
    holeAud.lineTo(83.5, -70.0);
    holeAud.lineTo(64.5, -70.0);
    holeAud.closePath();
    slabShape.holes.push(holeAud);

    const holeGym = new THREE.Path();
    holeGym.moveTo(90.5, -43.5);
    holeGym.lineTo(108.0, -43.5);
    holeGym.lineTo(108.0, -70.0);
    holeGym.lineTo(90.5, -70.0);
    holeGym.closePath();
    slabShape.holes.push(holeGym);
  }

  const slabGeo = new THREE.ExtrudeGeometry(slabShape, {
    depth: slabT,
    bevelEnabled: false,
  });
  slabGeo.rotateX(-Math.PI / 2);
  const slabMesh = new THREE.Mesh(slabGeo, materials.slabConcrete);
  slabMesh.position.y = floorY;
  slabMesh.receiveShadow = true;
  slabMesh.castShadow = true;
  grp.add(slabMesh);

  // 2. 2F/3F 挑空中庭玻璃栏杆与暖木内檐
  if (wing.atrium && floorIndex >= 2) {
    const a = wing.atrium;
    const aw = a.x2 - a.x1;
    const ad = a.z2 - a.z1;
    const railH = 1.15;
    const ry = floorY + slabT + railH * 0.5;
    const rails = [
      [(a.x1 + a.x2) * 0.5, ry, a.z1, aw, railH, 0.08],
      [(a.x1 + a.x2) * 0.5, ry, a.z2, aw, railH, 0.08],
      [a.x1, ry, (a.z1 + a.z2) * 0.5, 0.08, railH, ad],
      [a.x2, ry, (a.z1 + a.z2) * 0.5, 0.08, railH, ad],
    ];
    for (const [rx, rry, rz, rw, rh, rd] of rails) {
      const rMesh = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rd), materials.glassBalustrade);
      rMesh.position.set(rx, rry, rz);
      grp.add(rMesh);

      // 中庭回廊板底 3000K 暖金暗藏灯槽（向上透亮锯齿采光天窗）
      const coveMesh = new THREE.Mesh(
        new THREE.BoxGeometry(rw > 0.2 ? rw : 0.14, 0.08, rd > 0.2 ? rd : 0.14),
        materials.warmAmberLightMat
      );
      coveMesh.position.set(rx, floorY - 0.04, rz);
      grp.add(coveMesh);
    }

    // 中庭对角飞梯（3F/2F 连接不同标高，体现对角挑空中庭）
    const stairLen = Math.min(aw, ad) * 0.62;
    const stairMesh = new THREE.Mesh(
      new THREE.BoxGeometry(stairLen, 0.25, 1.8),
      materials.warmWoodSoffit
    );
    stairMesh.position.set((a.x1 + a.x2) * 0.5, floorY - ELEVATIONS.FLOOR_HEIGHT * 0.45, (a.z1 + a.z2) * 0.5);
    stairMesh.rotation.y = Math.PI * 0.25;
    stairMesh.rotation.z = 0.38;
    grp.add(stairMesh);
  }

  // 3. 室内结构白柱网格（收集到楼层 InstancedMesh）
  const colStepX = 9.0;
  const colStepZ = 9.0;
  for (let x = wing.x1 + 3.6; x <= wing.x2 - 3.4; x += colStepX) {
    for (let z = wing.z1 + 3.6; z <= wing.z2 - 3.4; z += colStepZ) {
      // 避开中庭洞口、篮球场与报告厅内部
      if (wing.atrium && x > wing.atrium.x1 + 0.5 && x < wing.atrium.x2 - 0.5 && z > wing.atrium.z1 + 0.5 && z < wing.atrium.z2 - 0.5 && floorIndex >= 2) {
        continue;
      }
      if (wing.isPeninsulaHall && z > 42.5 && floorIndex >= 2) continue;
      if (wing.escalatorHall && x >= wing.escalatorHall.x1 && x <= wing.escalatorHall.x2) continue;
      columnInstances.push([x, floorY + slabT + innerH * 0.5, z]);
    }
  }

  // 4. 室内功能布局：双侧实验室 + 宽中央消防疏散通廊（非半岛特殊场馆）
  if (!wing.isPeninsulaHall) {
    const isZAxis = wing.corridorAxis === 'z';
    const labDepth = 4.6;
    const partH = innerH * 0.86;
    const partY = floorY + slabT + partH * 0.5;

    // 清晰可辨的中央消防疏散通道地坪与两侧安全绿导引光带
    const corridorW = isZAxis ? Math.max(5.5, ww - labDepth * 2 - 2.4) : Math.max(5.5, wd - labDepth * 2 - 2.4);
    const corridorL = (isZAxis ? wd : ww) - 4.0;
    const corrGeo = new THREE.BoxGeometry(isZAxis ? corridorW : corridorL, 0.04, isZAxis ? corridorL : corridorW);
    const corrMesh = new THREE.Mesh(corrGeo, materials.fireCorridorMat);
    corrMesh.position.set(cx, floorY + slabT + 0.025, cz);
    corrMesh.receiveShadow = true;
    grp.add(corrMesh);

    // 两侧消防疏散通道绿色导引线（爆炸透视时一目了然！）
    for (const side of [-1, 1]) {
      const stripGeo = new THREE.BoxGeometry(
        isZAxis ? 0.24 : corridorL - 1.2,
        0.045,
        isZAxis ? corridorL - 1.2 : 0.24
      );
      const strip = new THREE.Mesh(stripGeo, materials.fireStripMat);
      strip.position.set(
        isZAxis ? cx + side * (corridorW * 0.5 - 0.35) : cx,
        floorY + slabT + 0.032,
        isZAxis ? cz : cz + side * (corridorW * 0.5 - 0.35)
      );
      grp.add(strip);
    }

    // 两侧实验室透明隔断墙 + 物理实验台与仪器模块
    const spanLen = isZAxis ? wd - 6.0 : ww - 6.0;
    const bays = Math.max(2, Math.floor(spanLen / 7.5));
    const bayLen = spanLen / bays;

    for (const side of [-1, 1]) {
      // 沿通廊一侧的玻璃隔墙
      const wallOffset = (isZAxis ? ww * 0.5 : wd * 0.5) - labDepth;
      const gWall = new THREE.Mesh(
        new THREE.BoxGeometry(isZAxis ? 0.14 : spanLen, partH, isZAxis ? spanLen : 0.14),
        materials.labPartitionGlass
      );
      gWall.position.set(
        isZAxis ? cx + side * wallOffset : cx,
        partY,
        isZAxis ? cz : cz + side * wallOffset
      );
      grp.add(gWall);

      for (let b = 0; b < bays; b++) {
        const offsetAlong = -spanLen * 0.5 + (b + 0.5) * bayLen;
        const px = isZAxis ? cx + side * (wallOffset + labDepth * 0.5) : cx + offsetAlong;
        const pz = isZAxis ? cz + offsetAlong : cz + side * (wallOffset + labDepth * 0.5);

        // 避开主入口扶梯厅区域
        if (wing.escalatorHall && px >= wing.escalatorHall.x1 - 1 && px <= wing.escalatorHall.x2 + 1) {
          continue;
        }

        // 房间分隔实墙
        const div = new THREE.Mesh(
          new THREE.BoxGeometry(isZAxis ? labDepth - 0.4 : 0.16, partH, isZAxis ? 0.16 : labDepth - 0.4),
          materials.interiorWall
        );
        div.position.set(
          isZAxis ? px : cx - spanLen * 0.5 + b * bayLen,
          partY,
          isZAxis ? cz - spanLen * 0.5 + b * bayLen : pz
        );
        grp.add(div);

        // 物理实验台（深色台面 + 精密仪器机柜）
        const bench = new THREE.Mesh(
          new THREE.BoxGeometry(isZAxis ? 2.4 : 3.6, 0.92, isZAxis ? 3.6 : 2.4),
          materials.labBench
        );
        bench.position.set(px, floorY + slabT + 0.46, pz);
        bench.castShadow = true;
        bench.receiveShadow = true;
        grp.add(bench);

        const equip = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, 1.55, 1.1),
          materials.labEquip
        );
        equip.position.set(px + (isZAxis ? side * 0.8 : 1.1), floorY + slabT + 0.78, pz + (isZAxis ? 1.0 : side * 0.8));
        grp.add(equip);

        // 实验室 4000K 暖白嵌入式顶棚格栅灯盘（夜晚每间实验室均匀通明，避免空壳假光）
        const labCeilPanel = new THREE.Mesh(
          new THREE.BoxGeometry(isZAxis ? 2.1 : bayLen * 0.58, 0.06, isZAxis ? bayLen * 0.58 : 2.1),
          materials.labCeilingLightMat
        );
        labCeilPanel.position.set(px, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.26, pz);
        grp.add(labCeilPanel);
      }
    }

    // 室内柔和吸顶发光灯带（夜间与暮光模式下自然亮起温暖室内光）
    const lightStrip = new THREE.Mesh(
      new THREE.BoxGeometry(isZAxis ? 2.2 : corridorL * 0.84, 0.08, isZAxis ? corridorL * 0.84 : 2.2),
      materials.interiorLightMat
    );
    lightStrip.position.set(cx, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.28, cz);
    grp.add(lightStrip);
  }

  // 4b. 底层架空连桥 2F 板底暖琥珀嵌入式过廊灯条
  if (wing.isPorchBridge && floorIndex === 2) {
    const isZPorch = wd >= ww;
    const soffitLamp = new THREE.Mesh(
      new THREE.BoxGeometry(isZPorch ? 1.6 : ww - 3.0, 0.08, isZPorch ? wd - 3.0 : 1.6),
      materials.warmAmberLightMat
    );
    soffitLamp.position.set(cx, floorY - 0.05, cz);
    grp.add(soffitLamp);
  }

  // 5. 特殊室内空间细部
  // 5a. E1 东北角 1F 机房/NVR 核心间（机柜阵列 + 冰青运行指示光条）
  if (wing.id === 'E1' && floorIndex === 1) {
    for (let r = 0; r < 3; r++) {
      const rack = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 2.5, 1.15),
        materials.serverRack
      );
      rack.position.set(78.5 + r * 2.3, floorY + slabT + 1.25, -74.5);
      rack.castShadow = true;
      grp.add(rack);

      const rackLed = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.09, 0.06),
        materials.serverLedMat
      );
      rackLed.position.set(78.5 + r * 2.3, floorY + slabT + 2.15, -73.9);
      grp.add(rackLed);
    }
  }

  // 5b. W5_S 临湖多功能大台阶（1.5 Multifunctional Steps + 踏步暗藏暖光条）
  if (wing.hasMultifunctionSteps && floorIndex === 1) {
    const stepRows = 9;
    for (let s = 0; s < stepRows; s++) {
      const st = new THREE.Mesh(
        new THREE.BoxGeometry(11.0, 0.52, 1.05),
        materials.warmWoodSoffit
      );
      st.position.set(-22, floorY + slabT + s * 0.5 + 0.26, -37.2 - s * 0.92);
      st.castShadow = true;
      st.receiveShadow = true;
      grp.add(st);

      if (s % 2 === 1) {
        const stepGlow = new THREE.Mesh(
          new THREE.BoxGeometry(10.6, 0.06, 0.08),
          materials.warmAmberLightMat
        );
        stepGlow.position.set(-22, floorY + slabT + s * 0.5 + 0.48, -36.68 - s * 0.92);
        grp.add(stepGlow);
      }
    }
  }

  // 5c. W2 / W4 外侧临湖木平台（1F + 临湖暖琥珀扶手底灯带）
  if (wing.lakesideDeck && floorIndex === 1) {
    const d = wing.lakesideDeck;
    const dw = d.x2 - d.x1;
    const dd = d.z2 - d.z1;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(dw, 0.34, dd),
      materials.teakDeck
    );
    deck.position.set((d.x1 + d.x2) * 0.5, floorY + 0.05, (d.z1 + d.z2) * 0.5);
    deck.castShadow = true;
    deck.receiveShadow = true;
    grp.add(deck);

    // 平台下水下桩柱支撑
    const pileGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.2, 10);
    for (let px = d.x1 + 1.5; px <= d.x2 - 1.2; px += 4.5) {
      const pile = new THREE.Mesh(pileGeo, materials.darkCharcoalMetal);
      pile.position.set(px, floorY - 1.0, d.z2 - 0.8);
      grp.add(pile);
    }

    // 临湖玻璃护栏 + 暖金轮廓洗地灯槽
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(dw, 1.05, 0.08),
      materials.glassBalustrade
    );
    rail.position.set((d.x1 + d.x2) * 0.5, floorY + 0.72, d.z2 - 0.12);
    grp.add(rail);

    const deckEdgeGlow = new THREE.Mesh(
      new THREE.BoxGeometry(dw - 0.4, 0.08, 0.12),
      materials.warmAmberLightMat
    );
    deckEdgeGlow.position.set((d.x1 + d.x2) * 0.5, floorY + 0.24, d.z2 - 0.16);
    grp.add(deckEdgeGlow);
  }

  // 5d. E3 东南临湖半岛体量（1F 展厅 + 2F 带真实标线室内篮球体育馆 + 2F 阶梯报告厅）
  if (wing.isPeninsulaHall) {
    buildE3PeninsulaInteriors({ grp, floorIndex, floorY, slabT, innerH, materials });
  }

  return grp;
}

/**
 * 东三楼 E3 内部三大标志性公共空间（严格遵循 1F/2F/3F 图纸与 Section 2）
 */
function buildE3PeninsulaInteriors({ grp, floorIndex, floorY, slabT, innerH, materials }) {
  const base = floorY + slabT;

  if (floorIndex === 1) {
    // 1F 西侧：物理科技展厅（1.10 Exhibition）—— 雕塑感展台阵列与发光展柜
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const vx = 67.2 + col * 5.8;
        const vz = 48.0 + row * 7.6;
        const plinth = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 1.05, 1.4),
          materials.interiorWall
        );
        plinth.position.set(vx, base + 0.525, vz);
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        grp.add(plinth);

        // 展柜台面内置博物馆暖金展灯箱
        const vitrineGlow = new THREE.Mesh(
          new THREE.BoxGeometry(1.9, 0.1, 0.86),
          materials.warmAmberLightMat
        );
        vitrineGlow.position.set(vx, base + 1.08, vz);
        grp.add(vitrineGlow);

        const vitrine = new THREE.Mesh(
          new THREE.BoxGeometry(2.1, 0.9, 1.0),
          materials.glassBalustrade
        );
        vitrine.position.set(vx, base + 1.5, vz);
        grp.add(vitrine);
      }
    }
    // 1F 展厅与东侧门厅顶棚轨道灯带
    for (const tz of [48.5, 56.0, 63.5]) {
      const track = new THREE.Mesh(
        new THREE.BoxGeometry(17.5, 0.08, 0.55),
        materials.labCeilingLightMat
      );
      track.position.set(73.2, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.28, tz);
      grp.add(track);
    }
    for (const tz of [48.5, 60.5]) {
      const eastTrack = new THREE.Mesh(
        new THREE.BoxGeometry(15.5, 0.08, 0.75),
        materials.interiorLightMat
      );
      eastTrack.position.set(99.5, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.28, tz);
      grp.add(eastTrack);
    }
    // 中央核心筒电梯/更衣室墙体
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, innerH, 24.0),
      materials.interiorWall
    );
    core.position.set(87.0, base + innerH * 0.5, 56.5);
    grp.add(core);
  } else if (floorIndex === 2) {
    // 2F 北侧安全出口消防疏散通道（清晰可辨）
    const exitLane = new THREE.Mesh(
      new THREE.BoxGeometry(42, 0.045, 5.2),
      materials.fireCorridorMat
    );
    exitLane.position.set(86, base + 0.025, 38.5);
    grp.add(exitLane);
    const exitStrip = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.05, 0.28),
      materials.fireStripMat
    );
    exitStrip.position.set(86, base + 0.035, 38.5);
    grp.add(exitStrip);

    const northCorrLight = new THREE.Mesh(
      new THREE.BoxGeometry(38, 0.08, 1.4),
      materials.interiorLightMat
    );
    northCorrLight.position.set(86, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.28, 38.5);
    grp.add(northCorrLight);

    // 2F 西侧：阶梯报告厅（2.12 Auditorium）—— 弧形递升阶梯观众席 + 演讲舞台 + 幕布
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(17.5, 0.95, 5.2),
      materials.auditoriumWood
    );
    stage.position.set(73.8, base + 0.48, 66.2);
    stage.castShadow = true;
    stage.receiveShadow = true;
    grp.add(stage);

    // 舞台前沿暖金脚灯槽
    const footLight = new THREE.Mesh(
      new THREE.BoxGeometry(16.4, 0.09, 0.16),
      materials.warmAmberLightMat
    );
    footLight.position.set(73.8, base + 0.98, 63.65);
    grp.add(footLight);

    // 演讲屏幕背景墙（明亮冷暖学术汇报屏幕）
    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(12.8, 4.6, 0.25),
      materials.auditoriumScreenMat
    );
    screen.position.set(73.8, base + 3.4, 69.2);
    grp.add(screen);

    // 10 排逐级抬升阶梯与深蓝座椅排 + 踏步导引暖灯带
    const tierCount = 10;
    for (let t = 0; t < tierCount; t++) {
      const tz = 61.2 - t * 1.65;
      const th = 0.28 + t * 0.32;
      const tier = new THREE.Mesh(
        new THREE.BoxGeometry(17.2, th, 1.55),
        materials.auditoriumWood
      );
      tier.position.set(73.8, base + th * 0.5, tz);
      tier.receiveShadow = true;
      grp.add(tier);

      if (t % 2 === 0) {
        const tierGlow = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 0.06, 0.09),
          materials.warmAmberLightMat
        );
        tierGlow.position.set(73.8, base + th + 0.02, tz + 0.72);
        grp.add(tierGlow);
      }

      // 左右分段观众座椅排（留出中央疏散走道）
      for (const sx of [68.8, 78.8]) {
        const seatRow = new THREE.Mesh(
          new THREE.BoxGeometry(6.8, 0.72, 0.72),
          materials.auditoriumSeat
        );
        seatRow.position.set(sx, base + th + 0.36, tz);
        seatRow.castShadow = true;
        grp.add(seatRow);
      }
    }

    // 2F 东侧：带真实标线的室内篮球体育馆（2.11 Gymnasium）
    const courtGeo = new THREE.PlaneGeometry(25.8, 16.8);
    courtGeo.rotateX(-Math.PI / 2);
    courtGeo.rotateY(Math.PI / 2);
    const courtMesh = new THREE.Mesh(courtGeo, materials.basketballCourt);
    courtMesh.position.set(99.5, base + 0.04, 57.0);
    courtMesh.receiveShadow = true;
    grp.add(courtMesh);

    // 南北两端透明篮板与橙色篮筐
    const hoopMat = new THREE.MeshStandardMaterial({ color: '#ea580c', roughness: 0.4, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const hz = 57.0 + side * 10.6;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 0.28), materials.darkCharcoalMetal);
      pole.position.set(99.5, base + 1.8, hz + side * 1.1);
      grp.add(pole);

      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 1.3), materials.darkCharcoalMetal);
      arm.position.set(99.5, base + 3.25, hz + side * 0.5);
      grp.add(arm);

      const board = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.15, 0.08), materials.glassBalustrade);
      board.position.set(99.5, base + 3.35, hz);
      grp.add(board);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.035, 8, 18), hoopMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(99.5, base + 3.05, hz - side * 0.32);
      grp.add(rim);
    }

    // 东侧观赛看台台阶
    for (let b = 0; b < 3; b++) {
      const bleacher = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.45 + b * 0.42, 18.0),
        materials.warmWoodSoffit
      );
      bleacher.position.set(107.6 + b * 0.72, base + (0.45 + b * 0.42) * 0.5, 57.0);
      grp.add(bleacher);
    }
  } else if (floorIndex === 3) {
    // 3F 挑空上方：篮球馆高棚场馆灯排 + 报告厅暖金顶棚格栅灯
    for (const gx of [95.0, 104.0]) {
      const gymBar = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.1, 21.5),
        materials.labCeilingLightMat
      );
      gymBar.position.set(gx, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.35, 57.0);
      grp.add(gymBar);
    }
    for (const ax of [69.0, 78.6]) {
      const audBar = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.1, 20.0),
        materials.warmAmberLightMat
      );
      audBar.position.set(ax, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.35, 57.0);
      grp.add(audBar);
    }
  }
}

/**
 * 构建整座长三角物理研究中心 5 层可拆解建筑体系
 */
export function buildArchitecture(maxAnisotropy = 16) {
  const root = new THREE.Group();
  root.name = 'ArchitectureRoot';

  const materials = createArchitectureMaterials(maxAnisotropy);

  const floor1 = new THREE.Group();
  floor1.name = '1F';
  const floor2 = new THREE.Group();
  floor2.name = '2F';
  const floor3 = new THREE.Group();
  floor3.name = '3F';

  const floorGroups = { 1: floor1, 2: floor2, 3: floor3 };
  const floorYs = {
    1: ELEVATIONS.FLOOR_1_Y,
    2: ELEVATIONS.FLOOR_2_Y,
    3: ELEVATIONS.FLOOR_3_Y,
  };

  // 按楼层构建楼板、室内空间、立柱与外立面幕墙/扭转百叶
  for (const floorIndex of [1, 2, 3]) {
    const fg = floorGroups[floorIndex];
    const fy = floorYs[floorIndex];
    const wingsOnFloor = BUILDING_WINGS.filter((w) => w.floors.includes(floorIndex));
    const colPositions = [];

    for (const wing of wingsOnFloor) {
      fg.add(
        buildWingInteriorFloor({
          wing,
          floorIndex,
          floorY: fy,
          materials,
          columnInstances: colPositions,
        })
      );
    }

    // 批量 InstancedMesh 室内白色结构圆柱
    if (colPositions.length > 0) {
      const colH = ELEVATIONS.FLOOR_HEIGHT - ELEVATIONS.SLAB_THICKNESS;
      const colGeo = new THREE.CylinderGeometry(0.32, 0.32, colH, 14);
      const colInst = new THREE.InstancedMesh(colGeo, materials.whiteColumn, colPositions.length);
      colInst.castShadow = true;
      colInst.receiveShadow = true;
      const dummy = new THREE.Object3D();
      colPositions.forEach((p, idx) => {
        dummy.position.set(...p);
        dummy.updateMatrix();
        colInst.setMatrixAt(idx, dummy.matrix);
      });
      colInst.instanceMatrix.needsUpdate = true;
      fg.add(colInst);
    }

    // 外立面幕墙、实体竖梃横梁、暖木挑檐与“弦理论”正弦波浪扭转百叶
    fg.add(
      buildFloorFacade({
        floorIndex,
        floorY: fy,
        wingsOnFloor,
        materials,
      })
    );
  }

  // 1F 架空入口门洞支撑柱（W1-W2 与 W2-W3 底层架空处）
  const porchColGeo = new THREE.CylinderGeometry(0.32, 0.32, ELEVATIONS.FLOOR_HEIGHT, 14);
  for (const w of BUILDING_WINGS) {
    if (w.isPorchBridge && w.porchColumns) {
      for (const [px, pz] of w.porchColumns) {
        const col = new THREE.Mesh(porchColGeo, materials.darkCharcoalMetal);
        col.position.set(px, ELEVATIONS.FLOOR_1_Y + ELEVATIONS.FLOOR_HEIGHT * 0.5, pz);
        col.castShadow = true;
        col.receiveShadow = true;
        floor1.add(col);
      }
      // 底层架空连桥石材铺装地坪
      const pDeck = new THREE.Mesh(
        new THREE.BoxGeometry(w.x2 - w.x1, 0.12, w.z2 - w.z1),
        materials.slabConcrete
      );
      pDeck.position.set((w.x1 + w.x2) * 0.5, ELEVATIONS.FLOOR_1_Y, (w.z1 + w.z2) * 0.5);
      pDeck.receiveShadow = true;
      floor1.add(pDeck);
    }
  }

  // 中央大入口门廊（32m 宽）与东侧门洞：三层通高双排细长柱列 + 门廊地坪（归属 1F，直通屋檐）
  const fullPortalH = ELEVATIONS.ROOF_Y - ELEVATIONS.FLOOR_1_Y + 0.35;
  const slenderColGeo = new THREE.CylinderGeometry(0.34, 0.38, fullPortalH, 16);
  for (const portal of PORTAL_CANOPIES) {
    const pSlab = new THREE.Mesh(
      new THREE.BoxGeometry(portal.x2 - portal.x1 + 2.0, 0.16, portal.z2 - portal.z1 + 4.0),
      materials.slabConcrete
    );
    pSlab.position.set((portal.x1 + portal.x2) * 0.5, ELEVATIONS.FLOOR_1_Y, (portal.z1 + portal.z2) * 0.5);
    pSlab.receiveShadow = true;
    floor1.add(pSlab);

    for (const [cx, cz] of portal.columns) {
      const col = new THREE.Mesh(slenderColGeo, materials.darkCharcoalMetal);
      col.position.set(cx, ELEVATIONS.FLOOR_1_Y + fullPortalH * 0.5, cz);
      col.castShadow = true;
      col.receiveShadow = true;
      floor1.add(col);
    }
  }

  // 门廊与底层架空入口 1F 地面羽化暖金光晕池（InstancedMesh，零硬边圆盘，零 Z-Fighting）
  const portalPoolPlacements = [];
  for (const portal of PORTAL_CANOPIES) {
    const pw = portal.x2 - portal.x1;
    const pd = portal.z2 - portal.z1;
    const cx = (portal.x1 + portal.x2) * 0.5;
    const cz = (portal.z1 + portal.z2) * 0.5;
    const cols = portal.slatAxis === 'z' ? 3 : 2;
    const rows = 2;
    for (let ix = 0; ix < cols; ix++) {
      const px = cx - pw * 0.32 + (ix / Math.max(1, cols - 1)) * (pw * 0.64);
      for (let iz = 0; iz < rows; iz++) {
        const pz = cz - pd * 0.26 + (iz / Math.max(1, rows - 1)) * (pd * 0.52);
        portalPoolPlacements.push({
          x: px,
          y: ELEVATIONS.FLOOR_1_Y + 0.095,
          z: pz,
          sx: 15.5,
          sz: 15.5,
        });
      }
    }
  }
  for (const w of BUILDING_WINGS) {
    if (w.isPorchBridge) {
      portalPoolPlacements.push({
        x: (w.x1 + w.x2) * 0.5,
        y: ELEVATIONS.FLOOR_1_Y + 0.076,
        z: (w.z1 + w.z2) * 0.5,
        sx: Math.max(w.x2 - w.x1, w.z2 - w.z1) * 0.95,
        sz: Math.max(w.x2 - w.x1, w.z2 - w.z1) * 0.95,
      });
    }
  }
  if (portalPoolPlacements.length > 0) {
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    const poolInst = new THREE.InstancedMesh(poolGeo, materials.portalFloorPoolMat, portalPoolPlacements.length);
    poolInst.name = 'PortalPlazaLightPools';
    const dummy = new THREE.Object3D();
    portalPoolPlacements.forEach((p, idx) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(p.sx, 1, p.sz);
      dummy.updateMatrix();
      poolInst.setMatrixAt(idx, dummy.matrix);
    });
    poolInst.instanceMatrix.needsUpdate = true;
    floor1.add(poolInst);
  }

  // 主入口两侧对称 KKAA 曲面波浪木格栅扶梯大厅（W5 东端 & E1 西端）+ E3 拱券木肋入口厅
  const w5n = BUILDING_WINGS.find((w) => w.id === 'W5_N');
  const e1 = BUILDING_WINGS.find((w) => w.id === 'E1');
  if (w5n?.escalatorHall) {
    floor1.add(
      buildMainEscalatorHall({
        ...w5n.escalatorHall,
        floor1Y: ELEVATIONS.FLOOR_1_Y,
        materials,
      })
    );
  }
  if (e1?.escalatorHall) {
    floor1.add(
      buildMainEscalatorHall({
        ...e1.escalatorHall,
        floor1Y: ELEVATIONS.FLOOR_1_Y,
        materials,
      })
    );
  }
  floor1.add(
    buildE3VaultedLobby({
      x1: 63, z1: 34.5, x2: 109, z2: 42.5,
      floor1Y: ELEVATIONS.FLOOR_1_Y,
      materials,
    })
  );

  // 第 4 层屋顶 + 第 5 层悬浮采光顶
  const { roofGroup, canopyGroup, update: updateRoof } = buildRoofAndCanopies(materials);

  // 对 5 个独立层 Group 内各自执行静态几何自动合批（保持 5 层爆炸完全独立，同时削减 85%+ Draw Call！）
  batchStaticMeshes(floor1);
  batchStaticMeshes(floor2);
  batchStaticMeshes(floor3);
  batchStaticMeshes(roofGroup);
  batchStaticMeshes(canopyGroup);

  root.add(floor1, floor2, floor3, roofGroup, canopyGroup);

  // 五层顺序索引与单层聚焦/上层幽灵化支持（零合批破坏、仅复用 1 枚亚克力幽灵材质）
  const layerOrder = [
    { key: '1F', group: floor1 },
    { key: '2F', group: floor2 },
    { key: '3F', group: floor3 },
    { key: 'roof', group: roofGroup },
    { key: 'floatingCanopy', group: canopyGroup },
  ];
  const layerIdxMap = new Map(layerOrder.map((item, idx) => [item.key, idx]));

  const ghostShellMat = new THREE.MeshStandardMaterial({
    color: '#cbd5e1',
    emissive: new THREE.Color('#38bdf8'),
    emissiveIntensity: 0.06,
    roughness: 0.35,
    metalness: 0.08,
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const glowMatSet = new Set([
    materials.nightWindowGlow,
    materials.interiorLightMat,
    materials.labCeilingLightMat,
    materials.warmAmberLightMat,
    materials.portalFloorPoolMat,
    materials.fireStripMat,
    materials.auditoriumScreenMat,
    materials.serverLedMat,
  ]);

  const layerMeshRecords = new Map();
  for (const { key, group } of layerOrder) {
    const records = [];
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      const isGlow = Array.isArray(obj.material)
        ? obj.material.some((m) => glowMatSet.has(m))
        : glowMatSet.has(obj.material);
      records.push({
        mesh: obj,
        origMaterial: obj.material,
        origVisible: obj.visible,
        origCastShadow: obj.castShadow,
        origReceiveShadow: obj.receiveShadow,
        isGlow,
      });
    });
    layerMeshRecords.set(key, records);
  }

  let focusedFloor = 'all';
  let focusedGhostUpper = true;

  function applyLayerMode(key, mode) {
    const item = layerOrder[layerIdxMap.get(key)];
    const records = layerMeshRecords.get(key);
    if (!item || !records) return;

    if (mode === 'hidden') {
      item.group.visible = false;
      return;
    }

    item.group.visible = true;
    if (mode === 'solid') {
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        rec.mesh.material = rec.origMaterial;
        rec.mesh.visible = rec.origVisible;
        rec.mesh.castShadow = rec.origCastShadow;
        rec.mesh.receiveShadow = rec.origReceiveShadow;
      }
      return;
    }

    // 'ghost': 上层轻量化透明建筑轮廓壳，关闭阴影投射以让日光直射被聚焦楼层内部
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec.isGlow) {
        rec.mesh.visible = false;
      } else {
        rec.mesh.visible = rec.origVisible;
        rec.mesh.material = ghostShellMat;
        rec.mesh.castShadow = false;
        rec.mesh.receiveShadow = false;
      }
    }
  }

  function focusFloor(floor = 'all', options = {}) {
    const valid = layerIdxMap.has(floor) ? floor : 'all';
    const ghostUpper = options.ghostUpper !== undefined ? Boolean(options.ghostUpper) : true;
    focusedFloor = valid;
    focusedGhostUpper = ghostUpper;

    if (valid === 'all') {
      for (const { key } of layerOrder) {
        applyLayerMode(key, 'solid');
      }
      return focusedFloor;
    }

    const targetIdx = layerIdxMap.get(valid);
    for (let i = 0; i < layerOrder.length; i++) {
      const { key } = layerOrder[i];
      if (i <= targetIdx) {
        applyLayerMode(key, 'solid');
      } else if (ghostUpper && i === targetIdx + 1 && key !== 'roof' && key !== 'floatingCanopy') {
        // 仅紧邻上一楼层保留极轻亚克力幽灵壳，屋顶/顶棚隐藏以确保俯视室内无遮挡
        applyLayerMode(key, 'ghost');
      } else {
        applyLayerMode(key, 'hidden');
      }
    }
    return focusedFloor;
  }

  // 平滑垂直爆炸透视状态机
  let explodeFactor = 0;
  let targetExplode = 0;
  let currentDusk = 0;
  let currentNight = 0;

  const syncNightWindowGlow = () => {
    const glowActive = currentDusk > 0.005;
    materials.nightWindowGlow.visible = glowActive;
    // 爆炸透视展开时自动略微提高透光率，清晰展示每层明亮的室内实验室/篮球馆/报告厅！
    const explodeClearance = 1 - explodeFactor * 0.44;
    materials.nightWindowGlow.opacity = (currentDusk * 0.56 + currentNight * 0.14) * explodeClearance;
    materials.nightWindowGlow.emissiveIntensity = currentDusk * 1.95 + currentNight * 0.75;
  };

  return {
    root,
    groups: {
      floor1,
      floor2,
      floor3,
      roof: roofGroup,
      floatingCanopy: canopyGroup,
    },
    setExploded(enabled) {
      targetExplode = enabled ? 1 : 0;
    },
    setExplodeFactor(factor) {
      const clamped = Math.max(0, Math.min(1, Number(factor) || 0));
      targetExplode = clamped;
      return targetExplode;
    },
    getExplodeFactor() {
      return explodeFactor;
    },
    getTargetExplode() {
      return targetExplode;
    },
    isExploded() {
      return targetExplode > 0.5;
    },
    focusFloor,
    getFocusedFloor() {
      return focusedFloor;
    },
    isFloorInteractive(floorKey) {
      if (focusedFloor === 'all') return true;
      const targetIdx = layerIdxMap.get(focusedFloor);
      const checkIdx = layerIdxMap.get(floorKey);
      if (targetIdx === undefined || checkIdx === undefined) return true;
      return checkIdx <= targetIdx;
    },
    setDuskFactor(dusk, night = dusk) {
      currentDusk = dusk;
      currentNight = night;
      const glowActive = dusk > 0.005;

      // 暮光与深邃夜景模式：分层点亮全部大楼实验室、暖木挑檐、曲面波浪扶梯厅与 E3 半岛场馆
      materials.interiorLightMat.emissiveIntensity = 0.22 + dusk * 2.15 + night * 0.55;
      materials.labCeilingLightMat.emissiveIntensity = 0.16 + dusk * 2.25 + night * 0.55;
      materials.warmAmberLightMat.emissiveIntensity = 0.12 + dusk * 2.75 + night * 0.9;
      materials.auditoriumScreenMat.emissiveIntensity = 0.2 + dusk * 1.9 + night * 0.6;
      materials.serverLedMat.emissiveIntensity = 0.9 + dusk * 1.9 + night * 0.6;
      materials.fireStripMat.emissiveIntensity = 0.75 + dusk * 1.2 + night * 0.35;

      materials.warmWoodSoffit.emissiveIntensity = dusk * 0.34 + night * 0.18;
      materials.curvedWoodRib.emissiveIntensity = dusk * 0.46 + night * 0.26;
      materials.woodLouver.emissiveIntensity = dusk * 0.09 + night * 0.05;
      materials.teakDeck.emissiveIntensity = dusk * 0.18 + night * 0.1;
      materials.slabConcrete.emissiveIntensity = dusk * 0.28 + night * 0.14;
      materials.interiorWall.emissiveIntensity = dusk * 0.3 + night * 0.14;
      materials.basketballCourt.emissiveIntensity = dusk * 0.72 + night * 0.32;
      materials.auditoriumWood.emissiveIntensity = dusk * 0.32 + night * 0.18;

      materials.skylightGlass.emissiveIntensity = dusk * 0.68 + night * 0.34;
      materials.portalCanopyGlass.emissiveIntensity = dusk * 0.26 + night * 0.16;
      materials.lowEGlass.opacity = THREE.MathUtils.lerp(0.34, 0.23, dusk);

      materials.portalFloorPoolMat.visible = glowActive;
      materials.portalFloorPoolMat.opacity = dusk * 0.42 + night * 0.16;

      // 幽灵切剖外壳昼夜自适应微调
      const dark = Math.max(dusk, night);
      ghostShellMat.color.set(dark > 0.35 ? '#64748b' : '#cbd5e1');
      ghostShellMat.emissiveIntensity = THREE.MathUtils.lerp(0.06, 0.28, dark);
      ghostShellMat.opacity = THREE.MathUtils.lerp(0.075, 0.095, dark);

      syncNightWindowGlow();
    },
    update(dt) {
      updateRoof(dt);

      const diff = targetExplode - explodeFactor;
      if (Math.abs(diff) > 0.0004) {
        explodeFactor += diff * Math.min(1, dt * 5.2);
        if (Math.abs(targetExplode - explodeFactor) < 0.001) {
          explodeFactor = targetExplode;
        }
        floor1.position.y = EXPLODE_OFFSETS.floor1 * explodeFactor;
        floor2.position.y = EXPLODE_OFFSETS.floor2 * explodeFactor;
        floor3.position.y = EXPLODE_OFFSETS.floor3 * explodeFactor;
        roofGroup.position.y = EXPLODE_OFFSETS.roof * explodeFactor;
        canopyGroup.position.y = EXPLODE_OFFSETS.floatingCanopy * explodeFactor;
        syncNightWindowGlow();
      }
      return explodeFactor;
    },
    dispose() {
      ghostShellMat.dispose();
    },
  };
}
