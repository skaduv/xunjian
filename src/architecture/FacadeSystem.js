import * as THREE from 'three';
import { ELEVATIONS } from '../config/campusConfig.js';

/**
 * KKAA 外立面幕墙与“弦理论”正弦波浪扭转木纹铝百叶系统
 * - 精准外轮廓区间求差：只在建筑真实外露边界生成幕墙，杜绝连廊衔接处产生内部穿插墙面
 * - 深色高透 Low-E 玻璃幕墙（反射暗室软箱高光，同时清晰透见室内实验室、扶梯与球场）
 * - InstancedMesh 实体深灰竖梃与中横梁
 * - 暖木色挑檐吊顶 + 标志性水平木纹铝板层间挑檐
 * - InstancedMesh 高密度正弦波浪扭转木纹铝板竖向百叶（致敬“弦理论”）
 */

function subtractIntervals(baseStart, baseEnd, cuts) {
  let intervals = [[baseStart, baseEnd]];
  for (const [cs, ce] of cuts) {
    const next = [];
    for (const [s, e] of intervals) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
      } else {
        if (cs > s + 0.05) next.push([s, cs]);
        if (ce < e - 0.05) next.push([ce, e]);
      }
    }
    intervals = next;
  }
  return intervals.filter(([s, e]) => e - s > 0.25);
}

/**
 * 提取指定楼层全部外露建筑边界线段
 * 返回数组元素：{ x1, z1, x2, z2, nx, nz, length, wingId, isEscalatorFace }
 */
export function computeExposedFacadeSegments(wingsOnFloor) {
  const segments = [];
  const eps = 0.08;

  for (const w of wingsOnFloor) {
    // 4 条边：北 (z = z1, normal -Z), 南 (z = z2, normal +Z), 西 (x = x1, normal -X), 东 (x = x2, normal +X)
    const edges = [
      { axis: 'x', fixed: w.z1, start: w.x1, end: w.x2, nx: 0, nz: -1, side: 'N' },
      { axis: 'x', fixed: w.z2, start: w.x1, end: w.x2, nx: 0, nz: 1, side: 'S' },
      { axis: 'z', fixed: w.x1, start: w.z1, end: w.z2, nx: -1, nz: 0, side: 'W' },
      { axis: 'z', fixed: w.x2, start: w.z1, end: w.z2, nx: 1, nz: 0, side: 'E' },
    ];

    for (const edge of edges) {
      const cuts = [];
      for (const other of wingsOnFloor) {
        if (other.id === w.id) continue;
        if (edge.axis === 'x') {
          // 另一体块紧贴该水平边（对面边或完全内部重合）
          const touchesNorth = edge.side === 'N' && Math.abs(other.z2 - edge.fixed) < eps;
          const touchesSouth = edge.side === 'S' && Math.abs(other.z1 - edge.fixed) < eps;
          const overlapsInterior = other.z1 < edge.fixed - eps && other.z2 > edge.fixed + eps;
          if (touchesNorth || touchesSouth || overlapsInterior) {
            const os = Math.max(edge.start, other.x1);
            const oe = Math.min(edge.end, other.x2);
            if (oe > os + eps) cuts.push([os, oe]);
          }
        } else {
          const touchesWest = edge.side === 'W' && Math.abs(other.x2 - edge.fixed) < eps;
          const touchesEast = edge.side === 'E' && Math.abs(other.x1 - edge.fixed) < eps;
          const overlapsInterior = other.x1 < edge.fixed - eps && other.x2 > edge.fixed + eps;
          if (touchesWest || touchesEast || overlapsInterior) {
            const os = Math.max(edge.start, other.z1);
            const oe = Math.min(edge.end, other.z2);
            if (oe > os + eps) cuts.push([os, oe]);
          }
        }
      }

      const exposed = subtractIntervals(edge.start, edge.end, cuts);
      for (const [s, e] of exposed) {
        const seg =
          edge.axis === 'x'
            ? { x1: s, z1: edge.fixed, x2: e, z2: edge.fixed, nx: edge.nx, nz: edge.nz, length: e - s, wingId: w.id }
            : { x1: edge.fixed, z1: s, x2: edge.fixed, z2: e, nx: edge.nx, nz: edge.nz, length: e - s, wingId: w.id };
        // 识别朝向中央大入口门廊的主入口大玻璃面（适当降低百叶遮挡，便于清晰透见内部波浪扶梯大厅）
        seg.isPortalEntrance =
          (w.id === 'W5_N' && edge.side === 'E') || (w.id === 'E1' && edge.side === 'W');
        segments.push(seg);
      }
    }
  }

  return segments;
}

/**
 * 为单个楼层 Group 构建全套外立面（幕墙玻璃 + InstancedMesh 竖梃/横梁 + 挑檐吊顶 + 正弦扭转木纹铝百叶）
 */
export function buildFloorFacade({
  floorIndex, // 1, 2, 3
  floorY,
  wingsOnFloor,
  materials,
}) {
  const group = new THREE.Group();
  group.name = `Facade_${floorIndex}F`;

  const floorH = ELEVATIONS.FLOOR_HEIGHT;
  const slabT = ELEVATIONS.SLAB_THICKNESS;
  const glassH = floorH - slabT - 0.16;
  const glassCenterY = floorY + slabT * 0.5 + glassH * 0.5 + 0.08;

  const segments = computeExposedFacadeSegments(wingsOnFloor);

  // 收集批量 InstancedMesh 变换
  const mullionList = [];
  const transomList = [];
  const louverList = [];
  const finList = [];
  const soffitList = [];

  let runningArc = floorIndex * 19.3;

  for (const seg of segments) {
    const cx = (seg.x1 + seg.x2) * 0.5;
    const cz = (seg.z1 + seg.z2) * 0.5;
    const dx = seg.x2 - seg.x1;
    const dz = seg.z2 - seg.z1;
    const angleY = Math.atan2(-dz, dx); // 让局部 +X 沿线段方向，局部 +Z 朝法线方向或反向

    // 1. 深色高透 Low-E 玻璃幕墙整片（内退 0.12m，给竖梃与扭转百叶留出真实建筑进深层次）
    const glassGeo = new THREE.PlaneGeometry(seg.length, glassH);
    const glassMesh = new THREE.Mesh(glassGeo, materials.lowEGlass);
    const glassInset = -0.12;
    glassMesh.position.set(cx + seg.nx * glassInset, glassCenterY, cz + seg.nz * glassInset);
    // 精确朝向外法线
    glassMesh.rotation.y = Math.atan2(seg.nx, seg.nz);
    group.add(glassMesh);

    // 1b. 夜景专属室内分间发光透景层（内退 -0.58m 位于玻璃幕墙后方，日间 visible=false 零开销，
    // 夜间与内部实验室吸顶灯叠合，将深灰竖梃与正弦扭转木百叶剪影锐利勾勒于温暖金光之上！）
    const isOpenEscalatorFace = floorIndex <= 2 && seg.isPortalEntrance;
    if (!isOpenEscalatorFace && materials.nightWindowGlow && seg.length > 0.6) {
      const glowW = Math.max(0.4, seg.length - 0.16);
      const glowH = glassH * 0.92;
      const glowGeo = new THREE.PlaneGeometry(glowW, glowH);
      const uv = glowGeo.attributes.uv;
      const tileU = Math.max(0.45, glowW / 24.0);
      const phaseU = ((floorIndex * 0.31 + runningArc * 0.043) % 1 + 1) % 1;
      for (let k = 0; k < uv.count; k++) {
        uv.setX(k, uv.getX(k) * tileU + phaseU);
      }
      uv.needsUpdate = true;

      const glowMesh = new THREE.Mesh(glowGeo, materials.nightWindowGlow);
      glowMesh.position.set(cx + seg.nx * -0.58, glassCenterY, cz + seg.nz * -0.58);
      glowMesh.rotation.y = Math.atan2(seg.nx, seg.nz);
      group.add(glowMesh);
    }

    // 2. 层间深灰铝合金压顶带（Spandrel）与 KKAA 暖木色水平挑檐吊顶
    const spandrelY = floorY + floorH - 0.24;
    const spandrelGeo = new THREE.BoxGeometry(seg.length + 0.22, 0.44, 0.36);
    const spandrelMesh = new THREE.Mesh(spandrelGeo, materials.darkCharcoalMetal);
    spandrelMesh.position.set(cx + seg.nx * 0.04, spandrelY, cz + seg.nz * 0.04);
    spandrelMesh.rotation.y = Math.atan2(seg.nx, seg.nz);
    spandrelMesh.castShadow = true;
    spandrelMesh.receiveShadow = true;
    group.add(spandrelMesh);

    // 暖木色水平层间悬挑吊顶与薄翼挑檐（呼应实拍图 KKAA_EiichiKano_09 的叠层悬挑层次）
    const eaveDepth = floorIndex === 3 ? 1.55 : 0.92;
    soffitList.push({
      pos: [cx + seg.nx * (eaveDepth * 0.5 + 0.05), spandrelY - 0.14, cz + seg.nz * (eaveDepth * 0.5 + 0.05)],
      rotY: Math.atan2(seg.nx, seg.nz),
      scale: [seg.length + eaveDepth * 0.75, 0.09, eaveDepth],
    });

    // 标志性 KKAA 阶梯式水平木纹铝板装饰线条（2 条细长层间水平挑翼，强化建筑水平延展感）
    for (const dy of [-0.04, 0.24]) {
      const proj = dy > 0 ? eaveDepth * 0.68 : eaveDepth * 0.95;
      finList.push({
        pos: [cx + seg.nx * (proj * 0.5 + 0.1), spandrelY + dy, cz + seg.nz * (proj * 0.5 + 0.1)],
        rotY: Math.atan2(seg.nx, seg.nz),
        scale: [seg.length + proj * 0.55, 0.065, proj * 0.65],
      });
    }

    // 3. 实体深灰竖梃（间距 2.4m）与中横梁
    const mullionStep = 2.4;
    const mCount = Math.max(2, Math.round(seg.length / mullionStep));
    const faceRotY = Math.atan2(seg.nx, seg.nz);

    for (let i = 0; i <= mCount; i++) {
      const t = i / mCount;
      const px = THREE.MathUtils.lerp(seg.x1, seg.x2, t);
      const pz = THREE.MathUtils.lerp(seg.z1, seg.z2, t);
      mullionList.push({
        pos: [px + seg.nx * 0.02, glassCenterY, pz + seg.nz * 0.02],
        rotY: faceRotY,
        scale: [0.11, glassH + 0.08, 0.24],
      });
    }

    // 上下收口与中腰深灰横梁（Transoms）
    const transomYs = [floorY + slabT + 0.05, floorY + floorH * 0.34, floorY + floorH * 0.76];
    for (const ty of transomYs) {
      transomList.push({
        pos: [cx + seg.nx * 0.01, ty, cz + seg.nz * 0.01],
        rotY: faceRotY,
        scale: [seg.length + 0.04, 0.095, 0.21],
      });
    }

    // 4. 高密度扭转木纹铝板竖向百叶（角度随弧长呈正弦波浪变化，致敬“弦理论”）
    // 1F 主入口门廊通透区保留净高门洞视野，其余外立面高密度排布正弦扭转竖向百叶
    const skipBottomOpening = floorIndex === 1 && seg.isPortalEntrance;
    if (!skipBottomOpening) {
      const louverPitch = floorIndex === 1 ? 1.85 : 1.25;
      const lCount = Math.floor(seg.length / louverPitch);
      const louverOutset = 0.42;
      const louverH = floorIndex === 1 ? glassH * 0.68 : glassH + 0.06;
      const louverY = floorIndex === 1 ? floorY + floorH - 0.44 - louverH * 0.5 : glassCenterY;

      for (let i = 1; i < lCount; i++) {
        const t = i / lCount;
        // 1F 入口中央留出疏散门通透视野
        if (floorIndex === 1 && seg.length > 14 && Math.abs(t - 0.5) < 0.14) continue;

        const px = THREE.MathUtils.lerp(seg.x1, seg.x2, t);
        const pz = THREE.MathUtils.lerp(seg.z1, seg.z2, t);
        const arc = runningArc + t * seg.length;

        // “弦理论”正弦谐波扭转角（主波 + 谐波，跨楼层相位错动，呈现流动光影韵律）
        const waveAngle =
          Math.sin(arc * 0.145 + floorIndex * 1.15) * 0.68 +
          Math.sin(arc * 0.055 - floorIndex * 0.7) * 0.22;

        louverList.push({
          pos: [px + seg.nx * louverOutset, louverY, pz + seg.nz * louverOutset],
          rotY: faceRotY + waveAngle,
          scale: [0.065, louverH, 0.34],
        });
      }
    }

    runningArc += seg.length;
  }

  // 生成各构件 InstancedMesh
  const dummy = new THREE.Object3D();
  const buildInstanced = (items, geo, mat, name, castShadow = true, receiveShadow = true) => {
    if (items.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.name = name;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dummy.position.set(...it.pos);
      dummy.rotation.set(0, it.rotY, 0);
      dummy.scale.set(...it.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  // 细小竖梃、横梁与密集百叶关闭单件阴影投射（主体楼板/挑檐/屋顶仍投射完整软阴影），大幅减轻阴影渲染开销
  buildInstanced(mullionList, unitBox, materials.darkCharcoalMetal, `Mullions_${floorIndex}F`, false, true);
  buildInstanced(transomList, unitBox, materials.darkCharcoalMetal, `Transoms_${floorIndex}F`, false, true);
  buildInstanced(soffitList, unitBox, materials.warmWoodSoffit, `EaveSoffit_${floorIndex}F`, true, true);
  buildInstanced(finList, unitBox, materials.woodLouver, `HorizontalFins_${floorIndex}F`, false, true);
  buildInstanced(louverList, unitBox, materials.woodLouver, `TwistedStringLouvers_${floorIndex}F`, false, true);

  return group;
}
