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
 * - groups.floor1         (1F)
 * - groups.floor2         (2F)
 * - groups.floor3         (3F)
 * - groups.roof           (屋顶)
 * - groups.floatingCanopy (悬浮采光顶)
 *
 * 视觉体系严格对齐 @art-lighting 温润瓷土/哑光石材/深石墨/KKAA 暖雪松/冰青磨砂亚克力主色板，
 * 并彻底修复全部建筑结构连接缺陷（A5 / A6 / A7 / A8 / A9 / A10）。
 */

function createArchitectureMaterials(maxAnisotropy) {
  const woodTex = createWoodLouverTexture(maxAnisotropy);
  const teakTex = createTeakDeckTexture(maxAnisotropy);
  const solarTex = createSolarPanelTexture(maxAnisotropy);
  const courtTex = createBasketballCourtTexture(maxAnisotropy);
  const interiorFloorTex = createInteriorFloorTexture(maxAnisotropy);
  const nightWindowTex = createNightWindowGlowTexture(maxAnisotropy);
  const portalPoolTex = createFeatheredLightPoolTexture('255, 222, 162', '255, 162, 68', maxAnisotropy);

  // 室内温暖纵深主光带（日间保留克制柔暖内透层次，暮光/星夜逐级点亮）
  const interiorLightMat = new THREE.MeshStandardMaterial({
    color: '#fff4df',
    emissive: new THREE.Color('#ffca7a'),
    emissiveIntensity: 0.28,
    roughness: 0.36,
  });

  // 4000K 物理实验室顶棚格栅灯盘
  const labCeilingLightMat = new THREE.MeshStandardMaterial({
    color: '#fff7e8',
    emissive: new THREE.Color('#ffda9e'),
    emissiveIntensity: 0.24,
    roughness: 0.34,
  });

  // 3000K 建筑暖琥珀重点照明（门廊筒灯、波浪扶梯暗槽、展柜顶光、亲水台灯带、报告厅舞台灯）
  const warmAmberLightMat = new THREE.MeshStandardMaterial({
    color: '#ffe0ad',
    emissive: new THREE.Color('#ffae42'),
    emissiveIntensity: 0.22,
    roughness: 0.26,
  });

  // 报告厅发光屏幕
  const auditoriumScreenMat = new THREE.MeshStandardMaterial({
    color: '#dcebf7',
    emissive: new THREE.Color('#7ec4f2'),
    emissiveIntensity: 0.25,
    roughness: 0.25,
  });

  // 机房 NVR 机柜与屋顶工业硬件冰青微距状态灯
  const serverLedMat = new THREE.MeshStandardMaterial({
    color: '#38e8f8',
    emissive: new THREE.Color('#2ed6ee'),
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  const microCyanLed = new THREE.MeshStandardMaterial({
    color: '#38e8f8',
    emissive: new THREE.Color('#2ed6ee'),
    emissiveIntensity: 1.45,
    roughness: 0.18,
  });

  const microAmberLed = new THREE.MeshStandardMaterial({
    color: '#f5a623',
    emissive: new THREE.Color('#f5a623'),
    emissiveIntensity: 1.35,
    roughness: 0.18,
  });

  // 夜景幕墙后置分间暖光景深层（严格按 Master Palette：Day 0 / Dusk 0.70 / Night 1.35）
  const nightWindowGlow = new THREE.MeshStandardMaterial({
    map: nightWindowTex,
    emissiveMap: nightWindowTex,
    color: '#ffdfad',
    emissive: new THREE.Color('#ffca7a'),
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

  // 消防疏散通道地坪（低饱和浅灰绿石材，无惨白过曝）
  const fireCorridorMat = new THREE.MeshStandardMaterial({
    color: '#c2c8c1',
    roughness: 0.62,
    metalness: 0.02,
  });

  const fireStripMat = new THREE.MeshStandardMaterial({
    color: '#46c79c',
    emissive: new THREE.Color('#10b981'),
    emissiveIntensity: 0.75,
    roughness: 0.26,
  });

  return {
    // 冰青磨砂清透 Low-E 幕墙玻璃（#7ECAD6 | r 0.14 | m 0.10 | opacity 0.42 | env 1.25）
    lowEGlass: new THREE.MeshStandardMaterial({
      color: '#7ecad6',
      roughness: 0.14,
      metalness: 0.10,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    // 扶梯与中庭冰青磨砂玻璃护栏（#8CD4DF | r 0.16 | m 0.08 | opacity 0.46）
    glassBalustrade: new THREE.MeshStandardMaterial({
      color: '#8cd4df',
      roughness: 0.16,
      metalness: 0.08,
      transparent: true,
      opacity: 0.46,
      envMapIntensity: 1.25,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    // 门廊悬浮冰青磨砂亚克力顶板（呼应参考图悬浮透明青绿顶片）
    portalCanopyGlass: new THREE.MeshStandardMaterial({
      color: '#8cd4df',
      emissive: new THREE.Color('#2fbcd4'),
      emissiveIntensity: 0.08,
      roughness: 0.14,
      metalness: 0.10,
      transparent: true,
      opacity: 0.50,
      envMapIntensity: 1.30,
    }),
    // 锯齿采光天窗冰青磨砂玻璃
    skylightGlass: new THREE.MeshStandardMaterial({
      color: '#8cd4df',
      emissive: new THREE.Color('#2fbcd4'),
      emissiveIntensity: 0.06,
      roughness: 0.14,
      metalness: 0.10,
      transparent: true,
      opacity: 0.50,
      envMapIntensity: 1.30,
    }),
    // 阳极氧化深石墨竖梃、窗框与建筑结构钢（#2F353D | r 0.40 | m 0.58）
    darkCharcoalMetal: new THREE.MeshStandardMaterial({
      color: '#2f353d',
      roughness: 0.40,
      metalness: 0.58,
    }),
    // 拉丝铝合金边框与组件框架（#9BA2AA | r 0.32 | m 0.66）
    aluminumFrame: new THREE.MeshStandardMaterial({
      color: '#9ba2aa',
      roughness: 0.32,
      metalness: 0.66,
    }),
    // 屋顶 HVAC 拉丝钛银护罩与扶梯桁架（#9BA1A8 | r 0.30 | m 0.68）
    brushedTitanium: new THREE.MeshStandardMaterial({
      color: '#9ba1a8',
      roughness: 0.30,
      metalness: 0.68,
    }),
    aluminumFin: new THREE.MeshStandardMaterial({
      color: '#a7adb5',
      roughness: 0.28,
      metalness: 0.72,
    }),
    // 屋顶 CNC 高对比深石墨散热鳍片（#32373F | r 0.42 | m 0.52）
    heatsinkDarkFin: new THREE.MeshStandardMaterial({
      color: '#32373f',
      roughness: 0.42,
      metalness: 0.52,
    }),
    // KKAA 暖雪松/橡木百叶与挑檐吊顶（搭配升级后 #B6895E–#966A43 木纹贴图，不重复压黑）
    woodLouver: new THREE.MeshStandardMaterial({
      map: woodTex,
      color: '#f6ede2',
      emissive: new THREE.Color('#7a481a'),
      emissiveIntensity: 0.0,
      roughness: 0.56,
      metalness: 0.04,
    }),
    warmWoodSoffit: new THREE.MeshStandardMaterial({
      map: woodTex,
      color: '#ecdac4',
      emissive: new THREE.Color('#a45f20'),
      emissiveIntensity: 0.0,
      roughness: 0.56,
      metalness: 0.04,
    }),
    curvedWoodRib: new THREE.MeshStandardMaterial({
      map: woodTex,
      color: '#f5e8d8',
      emissive: new THREE.Color('#b86b24'),
      emissiveIntensity: 0.0,
      roughness: 0.50,
      metalness: 0.05,
    }),
    teakDeck: new THREE.MeshStandardMaterial({
      map: teakTex,
      color: '#ffffff',
      emissive: new THREE.Color('#70441a'),
      emissiveIntensity: 0.0,
      roughness: 0.60,
      metalness: 0.04,
    }),
    // 温润瓷土楼板边带与檐口（#D8D2C8 | r 0.44 | m 0.05）
    slabEdgeClay: new THREE.MeshStandardMaterial({
      color: '#d8d2c8',
      roughness: 0.44,
      metalness: 0.05,
    }),
    // 室内暖灰石材水磨石楼板（配合升级后 #CFC9BF 贴图）
    slabConcrete: new THREE.MeshStandardMaterial({
      map: interiorFloorTex,
      color: '#faf7f2',
      emissive: new THREE.Color('#75522b'),
      emissiveIntensity: 0.0,
      roughness: 0.62,
      metalness: 0.02,
    }),
    // 中浅暖石灰岩建筑实墙（#C6BFB4 | r 0.58 | m 0.04）
    interiorWall: new THREE.MeshStandardMaterial({
      color: '#c6bfb4',
      emissive: new THREE.Color('#7d5b32'),
      emissiveIntensity: 0.0,
      roughness: 0.58,
      metalness: 0.04,
    }),
    // 凹槽核心筒、女儿墙内侧与阴影退缝（#8C877F | r 0.62 | m 0.08）
    shadowReveal: new THREE.MeshStandardMaterial({
      color: '#8c877f',
      roughness: 0.62,
      metalness: 0.08,
    }),
    labPartitionGlass: new THREE.MeshStandardMaterial({
      color: '#8ccad6',
      roughness: 0.14,
      metalness: 0.08,
      transparent: true,
      opacity: 0.30,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    labBench: new THREE.MeshStandardMaterial({
      color: '#b8b2a8',
      roughness: 0.48,
      metalness: 0.14,
    }),
    labEquip: new THREE.MeshStandardMaterial({
      color: '#cec8be',
      roughness: 0.38,
      metalness: 0.22,
    }),
    // 哑光缎面温瓷建筑圆柱（告别惨白 #F7F8FB -> #D6D0C6 | r 0.42 | m 0.06）
    whiteColumn: new THREE.MeshStandardMaterial({
      color: '#d6d0c6',
      roughness: 0.42,
      metalness: 0.06,
    }),
    // 拉丝钛银扶梯桁架与暖石墨踏步
    escalatorMetal: new THREE.MeshStandardMaterial({
      color: '#9ba1a8',
      roughness: 0.30,
      metalness: 0.68,
    }),
    escalatorStep: new THREE.MeshStandardMaterial({
      color: '#494e56',
      roughness: 0.56,
      metalness: 0.38,
    }),
    // 屋面暖石灰岩哑光防水面层（#C4BDB2，彻底告别大白板过曝！）
    roofMembrane: new THREE.MeshStandardMaterial({
      color: '#c4bdb2',
      roughness: 0.64,
      metalness: 0.04,
    }),
    // 温润瓷土女儿墙外墙体（#D4CEC4 | r 0.46 | m 0.06）
    roofParapet: new THREE.MeshStandardMaterial({
      color: '#d4cec4',
      roughness: 0.46,
      metalness: 0.06,
    }),
    // 阳极香槟银女儿墙倒角压顶（#BEB7AD | r 0.34 | m 0.26）
    roofParapetCap: new THREE.MeshStandardMaterial({
      color: '#beb7ad',
      roughness: 0.34,
      metalness: 0.26,
    }),
    // 拉丝钛灰屋面检修步道
    walkwayMetal: new THREE.MeshStandardMaterial({
      color: '#9ea4ac',
      roughness: 0.42,
      metalness: 0.52,
    }),
    // 深光伏靛灰单晶硅阵列（配合升级后 #263447 贴图 | r 0.26 | m 0.35）
    solarPanel: new THREE.MeshStandardMaterial({
      map: solarTex,
      color: '#ffffff',
      roughness: 0.26,
      metalness: 0.35,
      envMapIntensity: 1.30,
    }),
    // 屋顶 RTX 级精密工业冷却硬件材质组
    industrialGunmetal: new THREE.MeshStandardMaterial({
      color: '#404650',
      roughness: 0.44,
      metalness: 0.52,
    }),
    fanShroud: new THREE.MeshStandardMaterial({
      color: '#d2ccc3',
      roughness: 0.36,
      metalness: 0.18,
    }),
    impellerMetal: new THREE.MeshStandardMaterial({
      color: '#32373f',
      roughness: 0.42,
      metalness: 0.50,
    }),
    copperPipe: new THREE.MeshStandardMaterial({
      color: '#b8734b',
      roughness: 0.32,
      metalness: 0.78,
    }),
    basketballCourt: new THREE.MeshStandardMaterial({
      map: courtTex,
      color: '#f2ece4',
      emissiveMap: courtTex,
      emissive: new THREE.Color('#ffdfa8'),
      emissiveIntensity: 0.0,
      roughness: 0.44,
      metalness: 0.04,
    }),
    auditoriumWood: new THREE.MeshStandardMaterial({
      color: '#ae8258',
      emissive: new THREE.Color('#8e5622'),
      emissiveIntensity: 0.0,
      roughness: 0.56,
      metalness: 0.04,
    }),
    auditoriumSeat: new THREE.MeshStandardMaterial({
      color: '#4a6075',
      roughness: 0.68,
      metalness: 0.05,
    }),
    serverRack: new THREE.MeshStandardMaterial({
      color: '#2f353d',
      roughness: 0.40,
      metalness: 0.58,
    }),
    interiorLightMat,
    labCeilingLightMat,
    warmAmberLightMat,
    auditoriumScreenMat,
    serverLedMat,
    microCyanLed,
    microAmberLed,
    nightWindowGlow,
    portalFloorPoolMat,
    fireCorridorMat,
    fireStripMat,
  };
}

/**
 * 区间裁剪工具（用于 A8：确保走廊地坪、绿导引带、玻璃隔墙与吸顶灯带绝不穿透中庭、扶梯厅与大台阶）
 */
function clipSpanIntervals(start, end, blockers) {
  let spans = [[start, end]];
  for (const [bs, be] of blockers) {
    const next = [];
    for (const [s, e] of spans) {
      if (be <= s || bs >= e) {
        next.push([s, e]);
      } else {
        if (bs > s + 0.6) next.push([s, bs]);
        if (be < e - 0.6) next.push([be, e]);
      }
    }
    spans = next;
  }
  return spans.filter(([s, e]) => e - s > 1.0);
}

/**
 * 构建中庭精准端对端斜跨飞梯（彻底修复 A7：两端严密搭接上下层楼板边缘，带玻璃栏板与钛银支座）
 */
function buildAtriumDiagonalStair({ atrium, floorIndex, floorY, slabT, materials }) {
  const grp = new THREE.Group();
  const ad = atrium.z2 - atrium.z1;
  const acz = (atrium.z1 + atrium.z2) * 0.5;
  const yBot = floorY - ELEVATIONS.FLOOR_HEIGHT + slabT;
  const yTop = floorY + slabT;

  // 2F 与 3F 飞梯正反交错布置，还原 KKAA 标志性雕塑中庭交叉动线
  const dir = floorIndex === 2 ? 1 : -1;
  const zHalfRun = Math.min(3.2, ad * 0.22);

  const pStart = new THREE.Vector3(dir > 0 ? atrium.x1 : atrium.x2, yBot, acz - dir * zHalfRun);
  const pEnd = new THREE.Vector3(dir > 0 ? atrium.x2 : atrium.x1, yTop, acz + dir * zHalfRun);

  const delta = pEnd.clone().sub(pStart);
  const horizLen = Math.hypot(delta.x, delta.z);
  const diagLen = delta.length();
  const yaw = Math.atan2(-delta.z, delta.x);
  const pitch = Math.atan2(delta.y, horizLen);
  const mid = pStart.clone().add(pEnd).multiplyScalar(0.5);

  const stairPivot = new THREE.Group();
  stairPivot.position.copy(mid);
  stairPivot.rotation.order = 'YXZ';
  stairPivot.rotation.y = yaw;

  const stairW = 1.85;
  // 暖木主梯板（两端微微咬合上下层楼板 0.16m，彻底零缝隙）
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(diagLen + 0.32, 0.26, stairW),
    materials.warmWoodSoffit
  );
  deck.rotation.z = pitch;
  deck.castShadow = true;
  deck.receiveShadow = true;
  stairPivot.add(deck);

  // 两侧深石墨钢槽形边梁 + 冰青磨砂玻璃栏板 + 深石墨扶手
  const fasciaGeo = new THREE.BoxGeometry(diagLen + 0.32, 0.30, 0.08);
  const railGeo = new THREE.BoxGeometry(diagLen, 1.05, 0.06);
  const handGeo = new THREE.BoxGeometry(diagLen + 0.12, 0.08, 0.11);
  for (const side of [-1, 1]) {
    const sz = side * (stairW * 0.5 + 0.01);
    const fascia = new THREE.Mesh(fasciaGeo, materials.darkCharcoalMetal);
    fascia.position.set(0, 0.02, sz);
    fascia.rotation.z = pitch;
    stairPivot.add(fascia);

    const rail = new THREE.Mesh(railGeo, materials.glassBalustrade);
    rail.position.set(0, 0.64, side * (stairW * 0.5 - 0.04));
    rail.rotation.z = pitch;
    stairPivot.add(rail);

    const hand = new THREE.Mesh(handGeo, materials.darkCharcoalMetal);
    hand.position.set(0, 1.18, side * (stairW * 0.5 - 0.04));
    hand.rotation.z = pitch;
    stairPivot.add(hand);
  }

  // 上下端拉丝钛银着陆连接支座板（将飞梯端头稳固锚固在楼板边沿）
  const bracketGeo = new THREE.BoxGeometry(0.68, 0.24, stairW + 0.24);
  const botBracket = new THREE.Mesh(bracketGeo, materials.brushedTitanium);
  botBracket.position.set(-horizLen * 0.5, -delta.y * 0.5 - 0.10, 0);
  stairPivot.add(botBracket);

  const topBracket = new THREE.Mesh(bracketGeo, materials.brushedTitanium);
  topBracket.position.set(horizLen * 0.5, delta.y * 0.5 - 0.10, 0);
  stairPivot.add(topBracket);

  grp.add(stairPivot);
  return {
    grp,
    arrivalSide: dir > 0 ? 'east' : 'west',
    arrivalZ: pEnd.z,
  };
}

/**
 * 构建单个楼层翼段的楼板（精确抠除挑空中庭、扶梯井与 E3 双层通高孔洞）、
 * 双侧实验室 + 宽中央通廊 + 清晰消防疏散通道 + 室内立柱 + 灯光天花
 */
function buildWingInteriorFloor({ wing, floorIndex, floorY, materials, columnInstances }) {
  const grp = new THREE.Group();
  const ww = wing.x2 - wing.x1;
  const wd = wing.z2 - wing.z1;
  const cx = (wing.x1 + wing.x2) * 0.5;
  const cz = (wing.z1 + wing.z2) * 0.5;
  const slabT = ELEVATIONS.SLAB_THICKNESS;
  const clearColH = ELEVATIONS.FLOOR_HEIGHT - slabT;
  const innerH = clearColH - 0.10;

  // 1. 建筑楼板（使用 Shape + holes 实现真实镂空挑空中庭与扶梯井）
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

  // 主入口扶梯大厅 2F 局部挑空（给曲面木格栅与双扶梯通高空间）
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

  // A6 修复：E3 东南半岛体量 2F 精准抠除北侧扶梯井洞口（x:[81.5, 91.5], z:[34.8, 37.8]）
  if (wing.isPeninsulaHall && floorIndex === 2) {
    const holeE3Esc = new THREE.Path();
    holeE3Esc.moveTo(81.5, -34.8);
    holeE3Esc.lineTo(91.5, -34.8);
    holeE3Esc.lineTo(91.5, -37.8);
    holeE3Esc.lineTo(81.5, -37.8);
    holeE3Esc.closePath();
    slabShape.holes.push(holeE3Esc);
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

  // 2. 2F/3F 挑空中庭冰青玻璃栏杆 + 暖金暗槽 + A7 端对端对角飞梯
  if (wing.atrium && floorIndex >= 2) {
    const a = wing.atrium;
    const aw = a.x2 - a.x1;
    const ad = a.z2 - a.z1;
    const railH = 1.12;
    const ry = floorY + slabT + railH * 0.5;

    // 构建精准端对端对角飞梯，并获取上口到达边以自动留出栏杆开口
    const stairRes = buildAtriumDiagonalStair({
      atrium: a,
      floorIndex,
      floorY,
      slabT,
      materials,
    });
    grp.add(stairRes.grp);

    const addBalustradeSeg = (rx, rz, rw, rd) => {
      const rMesh = new THREE.Mesh(new THREE.BoxGeometry(rw, railH, rd), materials.glassBalustrade);
      rMesh.position.set(rx, ry, rz);
      grp.add(rMesh);

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(rw > 0.2 ? rw : 0.11, 0.06, rd > 0.2 ? rd : 0.11),
        materials.darkCharcoalMetal
      );
      cap.position.set(rx, floorY + slabT + railH + 0.03, rz);
      grp.add(cap);

      const coveMesh = new THREE.Mesh(
        new THREE.BoxGeometry(rw > 0.2 ? rw : 0.14, 0.08, rd > 0.2 ? rd : 0.14),
        materials.warmAmberLightMat
      );
      coveMesh.position.set(rx, floorY - 0.04, rz);
      grp.add(coveMesh);
    };

    // 南北两侧完整玻璃护栏
    addBalustradeSeg((a.x1 + a.x2) * 0.5, a.z1, aw, 0.07);
    addBalustradeSeg((a.x1 + a.x2) * 0.5, a.z2, aw, 0.07);

    // 东西两侧玻璃护栏（飞梯上口着陆侧自动断开 2.4m 通行豁口）
    for (const sideName of ['west', 'east']) {
      const rx = sideName === 'west' ? a.x1 : a.x2;
      if (stairRes.arrivalSide === sideName) {
        const gapHalf = 1.2;
        const g1 = stairRes.arrivalZ - gapHalf;
        const g2 = stairRes.arrivalZ + gapHalf;
        if (g1 - a.z1 > 0.4) addBalustradeSeg(rx, (a.z1 + g1) * 0.5, 0.07, g1 - a.z1);
        if (a.z2 - g2 > 0.4) addBalustradeSeg(rx, (g2 + a.z2) * 0.5, 0.07, a.z2 - g2);
      } else {
        addBalustradeSeg(rx, (a.z1 + a.z2) * 0.5, 0.07, ad);
      }
    }
  }

  // 2b. 主入口扶梯厅 2F 挑空洞口三边冰青玻璃栏杆（扶梯上口边敞开迎接双扶梯）
  if (wing.escalatorHall && floorIndex === 2) {
    const e = wing.escalatorHall;
    const hx1 = e.x1 + 2.5;
    const hx2 = e.x2 - 2.5;
    const hz1 = e.z1 + 2.0;
    const hz2 = e.z2 - 2.0;
    const railH = 1.10;
    const ry = floorY + slabT + railH * 0.5;
    const edges = [
      [(hx1 + hx2) * 0.5, hz1, hx2 - hx1, 0.07],
      [(hx1 + hx2) * 0.5, hz2, hx2 - hx1, 0.07],
      // 朝向中央门廊一侧封闭护栏，背向门廊一侧（扶梯上口）畅通留白
      e.side === 'west'
        ? [hx2, (hz1 + hz2) * 0.5, 0.07, hz2 - hz1]
        : [hx1, (hz1 + hz2) * 0.5, 0.07, hz2 - hz1],
    ];
    for (const [rx, rz, rw, rd] of edges) {
      const rMesh = new THREE.Mesh(new THREE.BoxGeometry(rw, railH, rd), materials.glassBalustrade);
      rMesh.position.set(rx, ry, rz);
      grp.add(rMesh);

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(rw > 0.2 ? rw : 0.11, 0.06, rd > 0.2 ? rd : 0.11),
        materials.darkCharcoalMetal
      );
      cap.position.set(rx, floorY + slabT + railH + 0.03, rz);
      grp.add(cap);
    }
  }

  // 2c. E3 2F 扶梯井洞口三边冰青玻璃护栏（西口 x=81.5 敞开迎接扶梯着陆）
  if (wing.isPeninsulaHall && floorIndex === 2) {
    const railH = 1.08;
    const ry = floorY + slabT + railH * 0.5;
    const wellRails = [
      [86.5, 34.8, 10.0, 0.07],
      [86.5, 37.8, 10.0, 0.07],
      [91.5, 36.3, 0.07, 3.0],
    ];
    for (const [rx, rz, rw, rd] of wellRails) {
      const rMesh = new THREE.Mesh(new THREE.BoxGeometry(rw, railH, rd), materials.glassBalustrade);
      rMesh.position.set(rx, ry, rz);
      grp.add(rMesh);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(rw > 0.2 ? rw : 0.10, 0.06, rd > 0.2 ? rd : 0.10),
        materials.darkCharcoalMetal
      );
      cap.position.set(rx, floorY + slabT + railH + 0.03, rz);
      grp.add(cap);
    }
  }

  // 3. 室内结构温瓷圆柱网格（A9 修复：严格按 floorY + slabT + clearColH * 0.5 顶天立地零缝隙！）
  const colCenterY = floorY + slabT + clearColH * 0.5;
  const colStepX = 9.0;
  const colStepZ = 9.0;
  for (let x = wing.x1 + 3.6; x <= wing.x2 - 3.4; x += colStepX) {
    for (let z = wing.z1 + 3.6; z <= wing.z2 - 3.4; z += colStepZ) {
      if (
        wing.atrium &&
        x > wing.atrium.x1 + 0.5 &&
        x < wing.atrium.x2 - 0.5 &&
        z > wing.atrium.z1 + 0.5 &&
        z < wing.atrium.z2 - 0.5 &&
        floorIndex >= 2
      ) {
        continue;
      }
      if (wing.isPeninsulaHall && z > 42.5 && floorIndex >= 2) continue;
      // 避让 E3 2F 北侧扶梯井开洞（x:[81.5, 91.5], z:[34.8, 37.8]）
      if (wing.isPeninsulaHall && floorIndex === 2 && x > 80.6 && x < 92.4 && z < 38.6) continue;
      if (wing.escalatorHall && x >= wing.escalatorHall.x1 && x <= wing.escalatorHall.x2) continue;
      columnInstances.push([x, colCenterY, z]);
    }
  }

  // A9 修复：为 E3 2F 中央核心走廊带（x:[83.5, 90.5], z:[43.5, 70]）增设双排 6 根承重柱，稳固托举 3F 中央连桥！
  if (wing.isPeninsulaHall && floorIndex === 2) {
    for (const cxCol of [85.0, 89.0]) {
      for (const czCol of [48.0, 57.0, 66.0]) {
        columnInstances.push([cxCol, colCenterY, czCol]);
      }
    }
  }

  // 4. 室内功能布局：双侧实验室 + 宽中央消防疏散通廊（A8 修复：全面裁剪避让中庭、扶梯厅与大台阶）
  if (!wing.isPeninsulaHall) {
    const isZAxis = wing.corridorAxis === 'z';
    const labDepth = 4.6;
    const partH = innerH * 0.86;
    const partY = floorY + slabT + partH * 0.5;

    const axisMin = (isZAxis ? wing.z1 : wing.x1) + 2.0;
    const axisMax = (isZAxis ? wing.z2 : wing.x2) - 2.0;
    const corridorW = isZAxis
      ? Math.max(5.5, ww - labDepth * 2 - 2.4)
      : Math.max(5.5, wd - labDepth * 2 - 2.4);

    // 收集走廊中轴阻挡区间（中庭洞口 + 扶梯双层通高厅 + W5_S 多功能阶梯）
    const centerBlockers = [];
    const wallBlockers = [];
    if (wing.atrium && floorIndex >= 2) {
      centerBlockers.push([
        (isZAxis ? wing.atrium.z1 : wing.atrium.x1) - 0.5,
        (isZAxis ? wing.atrium.z2 : wing.atrium.x2) + 0.5,
      ]);
    }
    if (wing.escalatorHall && floorIndex <= 2) {
      const eb = [
        (isZAxis ? wing.escalatorHall.z1 : wing.escalatorHall.x1) - 0.5,
        (isZAxis ? wing.escalatorHall.z2 : wing.escalatorHall.x2) + 0.5,
      ];
      centerBlockers.push(eb);
      wallBlockers.push(eb);
    }
    if (wing.hasMultifunctionSteps && floorIndex === 1) {
      // W5_S 大台阶占据 z ∈ [-44.2, -34.0]
      centerBlockers.push([-44.5, -34.0]);
      wallBlockers.push([-44.5, -34.0]);
    }

    const corridorSpans = clipSpanIntervals(axisMin, axisMax, centerBlockers);
    for (const [s0, s1] of corridorSpans) {
      const segLen = s1 - s0;
      const segMid = (s0 + s1) * 0.5;
      const segX = isZAxis ? cx : segMid;
      const segZ = isZAxis ? segMid : cz;

      // 中央消防疏散通道地坪
      const corrGeo = new THREE.BoxGeometry(
        isZAxis ? corridorW : segLen,
        0.04,
        isZAxis ? segLen : corridorW
      );
      const corrMesh = new THREE.Mesh(corrGeo, materials.fireCorridorMat);
      corrMesh.position.set(segX, floorY + slabT + 0.025, segZ);
      corrMesh.receiveShadow = true;
      grp.add(corrMesh);

      // 两侧绿色消防导引光带
      const stripLen = Math.max(0.5, segLen - 0.8);
      for (const side of [-1, 1]) {
        const stripGeo = new THREE.BoxGeometry(
          isZAxis ? 0.24 : stripLen,
          0.045,
          isZAxis ? stripLen : 0.24
        );
        const strip = new THREE.Mesh(stripGeo, materials.fireStripMat);
        strip.position.set(
          isZAxis ? cx + side * (corridorW * 0.5 - 0.35) : segMid,
          floorY + slabT + 0.032,
          isZAxis ? segMid : cz + side * (corridorW * 0.5 - 0.35)
        );
        grp.add(strip);
      }

      // 走廊吸顶柔光灯带（同样严格避让中庭与扶梯挑空）
      if (segLen > 1.8) {
        const lightStrip = new THREE.Mesh(
          new THREE.BoxGeometry(isZAxis ? 2.1 : segLen * 0.84, 0.08, isZAxis ? segLen * 0.84 : 2.1),
          materials.interiorLightMat
        );
        lightStrip.position.set(segX, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.28, segZ);
        grp.add(lightStrip);
      }
    }

    // 两侧实验室透明隔断墙（严格裁剪避让扶梯厅与大台阶）+ 实验台与格栅顶灯
    const wallMin = (isZAxis ? wing.z1 : wing.x1) + 3.0;
    const wallMax = (isZAxis ? wing.z2 : wing.x2) - 3.0;
    const wallSpans = clipSpanIntervals(wallMin, wallMax, wallBlockers);

    const spanLen = wallMax - wallMin;
    const bays = Math.max(2, Math.floor(spanLen / 7.5));
    const bayLen = spanLen / bays;

    for (const side of [-1, 1]) {
      const wallOffset = (isZAxis ? ww * 0.5 : wd * 0.5) - labDepth;

      for (const [w0, w1] of wallSpans) {
        const wLen = w1 - w0;
        const wMid = (w0 + w1) * 0.5;
        const gWall = new THREE.Mesh(
          new THREE.BoxGeometry(isZAxis ? 0.14 : wLen, partH, isZAxis ? wLen : 0.14),
          materials.labPartitionGlass
        );
        gWall.position.set(
          isZAxis ? cx + side * wallOffset : wMid,
          partY,
          isZAxis ? wMid : cz + side * wallOffset
        );
        grp.add(gWall);
      }

      for (let b = 0; b < bays; b++) {
        const offsetAlong = -spanLen * 0.5 + (b + 0.5) * bayLen;
        const px = isZAxis ? cx + side * (wallOffset + labDepth * 0.5) : cx + offsetAlong;
        const pz = isZAxis ? cz + offsetAlong : cz + side * (wallOffset + labDepth * 0.5);

        // 避开主入口扶梯厅区域与 W5_S 1F 大台阶区
        if (wing.escalatorHall && px >= wing.escalatorHall.x1 - 1 && px <= wing.escalatorHall.x2 + 1) {
          continue;
        }
        if (wing.hasMultifunctionSteps && floorIndex === 1 && pz > -44.8) {
          continue;
        }

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
        equip.position.set(
          px + (isZAxis ? side * 0.8 : 1.1),
          floorY + slabT + 0.78,
          pz + (isZAxis ? 1.0 : side * 0.8)
        );
        grp.add(equip);

        const labCeilPanel = new THREE.Mesh(
          new THREE.BoxGeometry(isZAxis ? 2.1 : bayLen * 0.58, 0.06, isZAxis ? bayLen * 0.58 : 2.1),
          materials.labCeilingLightMat
        );
        labCeilPanel.position.set(px, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.26, pz);
        grp.add(labCeilPanel);
      }
    }
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
  // 5a. E1 东北角 1F 机房/NVR 核心间（深石墨机柜阵列 + 冰青运行指示光条）
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

  // 5b. A8 修复：W5_S 临湖多功能大台阶（10 级实体阶梯，单级高 0.48m，总抬升 4.80m -> 顶面 5.235
  // 严密着陆于实心 2F 楼板边沿 z=-43.8，不再倾泻入 2F 挑空中庭开洞 z∈[-56,-44]！）
  if (wing.hasMultifunctionSteps && floorIndex === 1) {
    const stepRows = 10;
    const stepH = ELEVATIONS.FLOOR_HEIGHT / stepRows; // 0.48m 精准等分
    const stepPitch = 0.85;
    const firstStepZ = -35.7;
    const base = floorY + slabT;
    for (let s = 0; s < stepRows; s++) {
      const totalH = (s + 1) * stepH;
      const sz = firstStepZ - s * stepPitch; // s=9 -> -43.35，北沿 -43.80 严密衔实心 2F 楼板 z=-44.0
      const st = new THREE.Mesh(
        new THREE.BoxGeometry(11.0, totalH, 0.90),
        materials.warmWoodSoffit
      );
      st.position.set(-22, base + totalH * 0.5, sz);
      st.castShadow = true;
      st.receiveShadow = true;
      grp.add(st);

      if (s % 2 === 1) {
        const stepGlow = new THREE.Mesh(
          new THREE.BoxGeometry(10.6, 0.055, 0.07),
          materials.warmAmberLightMat
        );
        stepGlow.position.set(-22, base + totalH - 0.04, sz + 0.46);
        grp.add(stepGlow);
      }
    }
  }

  // 5c. A10 修复：W2 / W5_S 外侧临湖木平台（水下桩柱延伸至 y=-2.50 锚固入湖底 -2.20，零悬浮！）
  if (wing.lakesideDeck && floorIndex === 1) {
    const d = wing.lakesideDeck;
    const dw = d.x2 - d.x1;
    const dd = d.z2 - d.z1;
    const deckTopY = floorY + 0.22; // 0.315 严格匹配 TerrainAndStructures 人物站立标高 0.315
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(dw, 0.34, dd),
      materials.teakDeck
    );
    deck.position.set((d.x1 + d.x2) * 0.5, deckTopY - 0.17, (d.z1 + d.z2) * 0.5);
    deck.castShadow = true;
    deck.receiveShadow = true;
    grp.add(deck);

    // 平台下水下深石墨桩柱双排支撑（[-2.50, +0.20]，稳固锚入湖底 0.30m）
    const pileGeo = new THREE.CylinderGeometry(0.22, 0.24, 2.70, 12);
    for (let px = d.x1 + 1.5; px <= d.x2 - 1.2; px += 4.5) {
      for (const pz of [d.z2 - 0.8, d.z1 + 1.2]) {
        const pile = new THREE.Mesh(pileGeo, materials.darkCharcoalMetal);
        pile.position.set(px, -1.15, pz);
        grp.add(pile);
      }
    }

    // 临湖冰青磨砂玻璃护栏 + 深石墨扶手立柱 + 暖金洗地灯槽
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(dw, 1.05, 0.07),
      materials.glassBalustrade
    );
    rail.position.set((d.x1 + d.x2) * 0.5, deckTopY + 0.525, d.z2 - 0.12);
    grp.add(rail);

    const railCap = new THREE.Mesh(
      new THREE.BoxGeometry(dw, 0.07, 0.11),
      materials.darkCharcoalMetal
    );
    railCap.position.set((d.x1 + d.x2) * 0.5, deckTopY + 1.07, d.z2 - 0.12);
    grp.add(railCap);

    const deckEdgeGlow = new THREE.Mesh(
      new THREE.BoxGeometry(dw - 0.4, 0.07, 0.11),
      materials.warmAmberLightMat
    );
    deckEdgeGlow.position.set((d.x1 + d.x2) * 0.5, deckTopY + 0.035, d.z2 - 0.16);
    grp.add(deckEdgeGlow);
  }

  // 5d. E3 东南临湖半岛体量（1F 展厅 + 2F 室内篮球馆/阶梯报告厅 + 3F 场馆灯光）
  if (wing.isPeninsulaHall) {
    buildE3PeninsulaInteriors({ grp, floorIndex, floorY, slabT, innerH, materials });
  }

  return grp;
}

/**
 * 东三楼 E3 内部三大标志性公共空间（严格遵循 1F/2F/3F 图纸与 A6 扶梯井避让布局）
 */
function buildE3PeninsulaInteriors({ grp, floorIndex, floorY, slabT, innerH, materials }) {
  const base = floorY + slabT;

  if (floorIndex === 1) {
    // 1F 西侧：物理科技展厅（1.10 Exhibition）—— 雕塑感展台阵列与冰青玻璃发光展柜
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const vx = 67.2 + col * 5.8;
        const vz = 48.0 + row * 7.6;
        const plinth = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 1.05, 1.4),
          materials.slabEdgeClay
        );
        plinth.position.set(vx, base + 0.525, vz);
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        grp.add(plinth);

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
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(6.8, innerH, 24.0),
      materials.interiorWall
    );
    core.position.set(87.0, base + innerH * 0.5, 56.5);
    grp.add(core);
  } else if (floorIndex === 2) {
    // A6 修复：2F 北侧安全出口消防疏散通道顺畅南移至 z=40.5（宽 4.2m -> [38.4, 42.6]），完整避让北侧扶梯井 [34.8, 37.8]！
    const exitLane = new THREE.Mesh(
      new THREE.BoxGeometry(42, 0.045, 4.2),
      materials.fireCorridorMat
    );
    exitLane.position.set(86, base + 0.025, 40.5);
    grp.add(exitLane);
    const exitStrip = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.05, 0.26),
      materials.fireStripMat
    );
    exitStrip.position.set(86, base + 0.035, 40.5);
    grp.add(exitStrip);

    const northCorrLight = new THREE.Mesh(
      new THREE.BoxGeometry(38, 0.08, 1.3),
      materials.interiorLightMat
    );
    northCorrLight.position.set(86, floorY + ELEVATIONS.FLOOR_HEIGHT - 0.28, 40.5);
    grp.add(northCorrLight);

    // 2F 西侧：阶梯报告厅（2.12 Auditorium）
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(17.5, 0.95, 5.2),
      materials.auditoriumWood
    );
    stage.position.set(73.8, base + 0.48, 66.2);
    stage.castShadow = true;
    stage.receiveShadow = true;
    grp.add(stage);

    const footLight = new THREE.Mesh(
      new THREE.BoxGeometry(16.4, 0.09, 0.16),
      materials.warmAmberLightMat
    );
    footLight.position.set(73.8, base + 0.98, 63.65);
    grp.add(footLight);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(12.8, 4.6, 0.25),
      materials.auditoriumScreenMat
    );
    screen.position.set(73.8, base + 3.4, 69.2);
    grp.add(screen);

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

    const hoopMat = new THREE.MeshStandardMaterial({ color: '#d95b26', roughness: 0.4, metalness: 0.6 });
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

    for (let b = 0; b < 3; b++) {
      const bleacher = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.45 + b * 0.42, 18.0),
        materials.warmWoodSoffit
      );
      bleacher.position.set(107.6 + b * 0.72, base + (0.45 + b * 0.42) * 0.5, 57.0);
      grp.add(bleacher);
    }
  } else if (floorIndex === 3) {
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

    // 批量 InstancedMesh 室内温瓷结构圆柱（高度严密等于 FLOOR_HEIGHT - SLAB_THICKNESS）
    if (colPositions.length > 0) {
      const colH = ELEVATIONS.FLOOR_HEIGHT - ELEVATIONS.SLAB_THICKNESS;
      const colGeo = new THREE.CylinderGeometry(0.32, 0.32, colH, 14);
      const colInst = new THREE.InstancedMesh(colGeo, materials.whiteColumn, colPositions.length);
      colInst.castShadow = true;
      colInst.receiveShadow = true;
      const dummy = new THREE.Object3D();
      colPositions.forEach((p, idx) => {
        dummy.position.set(...p);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        colInst.setMatrixAt(idx, dummy.matrix);
      });
      colInst.instanceMatrix.needsUpdate = true;
      fg.add(colInst);
    }

    // 外立面幕墙、实体竖梃横梁、温润瓷土檐口、暖雪松挑檐与“弦理论”正弦波浪扭转百叶
    fg.add(
      buildFloorFacade({
        floorIndex,
        floorY: fy,
        wingsOnFloor,
        materials,
      })
    );
  }

  // 1F 架空入口门洞支撑柱（W1-W2 与 W2-W3 底层架空处，柱高 4.80m 严密托举 2F 板底 + 柱脚收边环）
  const porchColGeo = new THREE.CylinderGeometry(0.32, 0.34, ELEVATIONS.FLOOR_HEIGHT, 14);
  const porchCollarGeo = new THREE.CylinderGeometry(0.46, 0.50, 0.20, 14);
  for (const w of BUILDING_WINGS) {
    if (w.isPorchBridge && w.porchColumns) {
      for (const [px, pz] of w.porchColumns) {
        const col = new THREE.Mesh(porchColGeo, materials.darkCharcoalMetal);
        col.position.set(px, ELEVATIONS.FLOOR_1_Y + ELEVATIONS.FLOOR_HEIGHT * 0.5, pz);
        col.castShadow = true;
        col.receiveShadow = true;
        floor1.add(col);

        const collar = new THREE.Mesh(porchCollarGeo, materials.brushedTitanium);
        collar.position.set(px, ELEVATIONS.FLOOR_1_Y + 0.14, pz);
        floor1.add(collar);
      }
      // 底层架空连桥温润石材铺装地坪（顶面 0.155，对齐场地人物标高）
      const pDeck = new THREE.Mesh(
        new THREE.BoxGeometry(w.x2 - w.x1, 0.12, w.z2 - w.z1),
        materials.slabEdgeClay
      );
      pDeck.position.set((w.x1 + w.x2) * 0.5, ELEVATIONS.FLOOR_1_Y, (w.z1 + w.z2) * 0.5);
      pDeck.receiveShadow = true;
      floor1.add(pDeck);
    }
  }

  // A5 修复：中央大入口门廊（32m 宽）与东侧门洞（22m 跨）
  // - 立柱顶标高提升至 ROOF_Y + 0.48 = 14.975（严密咬合悬浮采光顶主钢梁底面 14.955，零 0.11m 缝隙！）
  // - 门廊地坪 pSlab 裁剪至精准净跨（GrandPortal: 32.0×24.0, EastPortal: 24.0×22.0），零侵入两侧翼段！
  const fullPortalH = ELEVATIONS.ROOF_Y + 0.48 - ELEVATIONS.FLOOR_1_Y; // 14.88m
  const slenderColGeo = new THREE.CylinderGeometry(0.34, 0.38, fullPortalH, 16);
  const portalBaseCollarGeo = new THREE.CylinderGeometry(0.50, 0.56, 0.28, 16);
  const portalCapPlateGeo = new THREE.BoxGeometry(0.86, 0.14, 0.86);

  for (const portal of PORTAL_CANOPIES) {
    const pSlabW = portal.x2 - portal.x1; // GrandPortal: 32.0, EastPortal: 24.0
    const pSlabD =
      portal.slatAxis === 'z'
        ? portal.z2 - portal.z1 + 2.0 // GrandPortal: 24.0（南北端温和收边，不侵湖泊）
        : portal.z2 - portal.z1; // EastPortal: 22.0（严格齐平 E2/E3 外墙）

    const pSlab = new THREE.Mesh(
      new THREE.BoxGeometry(pSlabW, 0.16, pSlabD),
      materials.slabEdgeClay
    );
    pSlab.position.set(
      (portal.x1 + portal.x2) * 0.5,
      ELEVATIONS.FLOOR_1_Y, // 顶面 0.175，对齐门廊人物标高
      (portal.z1 + portal.z2) * 0.5
    );
    pSlab.receiveShadow = true;
    floor1.add(pSlab);

    for (const [cx, cz] of portal.columns) {
      const col = new THREE.Mesh(slenderColGeo, materials.darkCharcoalMetal);
      col.position.set(cx, ELEVATIONS.FLOOR_1_Y + fullPortalH * 0.5, cz);
      col.castShadow = true;
      col.receiveShadow = true;
      floor1.add(col);

      // 柱脚倒角底座与柱顶钛银承托托盘
      const baseCollar = new THREE.Mesh(portalBaseCollarGeo, materials.shadowReveal);
      baseCollar.position.set(cx, ELEVATIONS.FLOOR_1_Y + 0.21, cz);
      floor1.add(baseCollar);

      const capPlate = new THREE.Mesh(portalCapPlateGeo, materials.brushedTitanium);
      capPlate.position.set(cx, ELEVATIONS.ROOF_Y + 0.42, cz);
      floor1.add(capPlate);
    }
  }

  // 门廊与底层架空入口 1F 地面羽化暖金光晕池
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
      x1: 63,
      z1: 34.5,
      x2: 109,
      z2: 42.5,
      floor1Y: ELEVATIONS.FLOOR_1_Y,
      materials,
    })
  );

  // 第 4 层屋顶 + 第 5 层悬浮采光顶
  const { roofGroup, canopyGroup, update: updateRoof } = buildRoofAndCanopies(materials);

  // 对 5 个独立层 Group 内各自执行静态几何自动合批（保持 5 层爆炸完全独立，同时大幅削减 Draw Call）
  batchStaticMeshes(floor1);
  batchStaticMeshes(floor2);
  batchStaticMeshes(floor3);
  batchStaticMeshes(roofGroup);
  batchStaticMeshes(canopyGroup);

  root.add(floor1, floor2, floor3, roofGroup, canopyGroup);

  // 平滑垂直爆炸透视状态机
  let explodeFactor = 0;
  let targetExplode = 0;
  let currentDusk = 0;
  let currentNight = 0;

  const dayAquaEmissive = new THREE.Color('#2fbcd4');
  const nightWarmEmissive = new THREE.Color('#ffbc64');
  const tmpEmissive = new THREE.Color();

  const syncNightWindowGlow = () => {
    const glowActive = currentDusk > 0.005;
    materials.nightWindowGlow.visible = glowActive;
    const explodeClearance = 1 - explodeFactor * 0.44;
    // 严格遵循 @art-lighting Master Palette：Day 0 / Dusk 0.70 / Night 1.35
    materials.nightWindowGlow.opacity = (currentDusk * 0.56 + currentNight * 0.16) * explodeClearance;
    materials.nightWindowGlow.emissiveIntensity = currentDusk * 0.70 + currentNight * 0.65;
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
    getExplodeFactor() {
      return explodeFactor;
    },
    isExploded() {
      return targetExplode > 0.5;
    },
    setDuskFactor(dusk, night = dusk) {
      currentDusk = dusk;
      currentNight = night;
      const glowActive = dusk > 0.005;

      // 暮光与深邃夜景模式：分层点亮全部大楼实验室、暖木挑檐、曲面波浪扶梯厅与 E3 半岛场馆
      materials.interiorLightMat.emissiveIntensity = 0.28 + dusk * 1.65 + night * 0.55;
      materials.labCeilingLightMat.emissiveIntensity = 0.24 + dusk * 1.75 + night * 0.55;
      materials.warmAmberLightMat.emissiveIntensity = 0.22 + dusk * 2.15 + night * 0.75;
      materials.auditoriumScreenMat.emissiveIntensity = 0.25 + dusk * 1.65 + night * 0.55;
      materials.serverLedMat.emissiveIntensity = 1.4 + dusk * 1.3 + night * 0.5;
      materials.microCyanLed.emissiveIntensity = 1.45 + dusk * 1.2 + night * 0.5;
      materials.microAmberLed.emissiveIntensity = 1.35 + dusk * 1.2 + night * 0.5;
      materials.fireStripMat.emissiveIntensity = 0.75 + dusk * 1.0 + night * 0.35;

      materials.warmWoodSoffit.emissiveIntensity = dusk * 0.30 + night * 0.16;
      materials.curvedWoodRib.emissiveIntensity = dusk * 0.40 + night * 0.22;
      materials.woodLouver.emissiveIntensity = dusk * 0.08 + night * 0.05;
      materials.teakDeck.emissiveIntensity = dusk * 0.16 + night * 0.09;
      materials.slabConcrete.emissiveIntensity = dusk * 0.24 + night * 0.12;
      materials.interiorWall.emissiveIntensity = dusk * 0.26 + night * 0.12;
      materials.basketballCourt.emissiveIntensity = dusk * 0.65 + night * 0.28;
      materials.auditoriumWood.emissiveIntensity = dusk * 0.28 + night * 0.15;

      // 悬浮天窗与门廊玻璃：日间呈现冰青微透亚克力光泽，暮光/星夜柔和透射暖琥珀室内上照光
      tmpEmissive.copy(dayAquaEmissive).lerp(nightWarmEmissive, dusk);
      materials.skylightGlass.emissive.copy(tmpEmissive);
      materials.skylightGlass.emissiveIntensity = THREE.MathUtils.lerp(0.06, 0.58, dusk) + night * 0.28;

      materials.portalCanopyGlass.emissive.copy(tmpEmissive);
      materials.portalCanopyGlass.emissiveIntensity = THREE.MathUtils.lerp(0.08, 0.28, dusk) + night * 0.14;

      materials.lowEGlass.opacity = THREE.MathUtils.lerp(0.42, 0.26, dusk);

      materials.portalFloorPoolMat.visible = glowActive;
      materials.portalFloorPoolMat.opacity = dusk * 0.42 + night * 0.16;

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
  };
}
