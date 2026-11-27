import * as THREE from 'three';
import { ELEVATIONS, PORTAL_CANOPIES } from '../config/campusConfig.js';

/**
 * KKAA 外立面幕墙与“弦理论”正弦波浪扭转木纹铝百叶系统（精工低饱和陶土白模 + 深度光影层叠升级）
 * - 精准外轮廓区间求差 + 凸/凹/共线转角分类：彻底根治 102 处层间挑檐与线条共面 Z-Fighting
 * - 冰青磨砂清透 Low-E 玻璃幕墙（严丝合缝坐落于楼板顶面至压顶底面，零穿插、零缝隙）
 * - 温润瓷土倒角层间压顶带 + 深灰内退阴影缝 + 深石墨实体竖梃/横梁
 * - KKAA 原木暖雪松吊顶与水平挑翼 + 正弦谐波扭转竖向百叶（1F 悬挑百叶增设底部连系拉杆）
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

function pointInsideAnyBox(x, z, boxes, eps = 0.05) {
  for (const b of boxes) {
    if (x > b.x1 + eps && x < b.x2 - eps && z > b.z1 + eps && z < b.z2 - eps) {
      return true;
    }
  }
  return false;
}

/**
 * 判断外露边界线段两端点（start / end）与相邻体块的几何拓扑关系：
 * - 'concave'   : 外侧延伸方向存在相邻体块（内凹 L 转角）
 * - 'collinear' : 内侧沿线延伸存在共线相邻翼段（直连拼缝）
 * - 'portal'    : 外侧或沿线延伸贴近门廊采光顶边界
 * - 'convex'    : 真实外凸建筑阳角
 */
export function classifySegmentEndpoints(seg, solidBoxes, portalBoxes = []) {
  const probe = 0.35;
  const dx = seg.axis === 'x' ? 1 : 0;
  const dz = seg.axis === 'z' ? 1 : 0;

  const classify = (px, pz, dirSign) => {
    const outX = px + dx * dirSign * probe + seg.nx * probe;
    const outZ = pz + dz * dirSign * probe + seg.nz * probe;
    if (pointInsideAnyBox(outX, outZ, solidBoxes)) return 'concave';

    const inX = px + dx * dirSign * probe - seg.nx * probe;
    const inZ = pz + dz * dirSign * probe - seg.nz * probe;
    if (pointInsideAnyBox(inX, inZ, solidBoxes)) return 'collinear';

    if (portalBoxes.length > 0) {
      if (pointInsideAnyBox(outX, outZ, portalBoxes) || pointInsideAnyBox(inX, inZ, portalBoxes)) {
        return 'portal';
      }
    }
    return 'convex';
  };

  return {
    start: classify(seg.x1, seg.z1, -1),
    end: classify(seg.x2, seg.z2, 1),
  };
}

/**
 * 根据转角拓扑计算非重叠挑檐延伸量（N/S 边阳角包角 +proj、E/W 边阳角齐平 0 且阴角退让 -proj）
 * 彻底消除建筑转角处水平挑檐、压顶与装饰线条的共面 Z-Fighting
 */
export function computeNonOverlappingExtensions(seg, endTypes, proj) {
  const isXAxis = seg.axis === 'x';
  const extFor = (type) => {
    if (type === 'convex') return isXAxis ? proj : 0;
    if (type === 'concave') return isXAxis ? 0 : -proj;
    return 0; // collinear / portal -> 齐平对接
  };
  return {
    extStart: extFor(endTypes.start),
    extEnd: extFor(endTypes.end),
  };
}

/**
 * 提取指定楼层全部外露建筑边界线段
 * 返回数组元素：{ x1, z1, x2, z2, nx, nz, length, wingId, side, axis, isPortalEntrance, touchesPortal }
 */
export function computeExposedFacadeSegments(wingsOnFloor, extraOccluders = []) {
  const segments = [];
  const eps = 0.08;
  const occluders = extraOccluders.length > 0 ? [...wingsOnFloor, ...extraOccluders] : wingsOnFloor;

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
      for (const other of occluders) {
        if (other.id === w.id) continue;
        if (edge.axis === 'x') {
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
            ? {
                x1: s,
                z1: edge.fixed,
                x2: e,
                z2: edge.fixed,
                nx: edge.nx,
                nz: edge.nz,
                length: e - s,
                wingId: w.id,
                side: edge.side,
                axis: edge.axis,
              }
            : {
                x1: edge.fixed,
                z1: s,
                x2: edge.fixed,
                z2: e,
                nx: edge.nx,
                nz: edge.nz,
                length: e - s,
                wingId: w.id,
                side: edge.side,
                axis: edge.axis,
              };
        // 识别朝向中央大入口门廊与东侧门洞的临门廊玻璃面
        seg.isPortalEntrance =
          (w.id === 'W5_N' && edge.side === 'E') || (w.id === 'E1' && edge.side === 'W');
        seg.touchesPortal =
          seg.isPortalEntrance ||
          (w.id === 'E2' && edge.side === 'S') ||
          (w.id === 'E3' && edge.side === 'N' && s < 86.2 && e > 61.8);
        segments.push(seg);
      }
    }
  }

  return segments;
}

/**
 * 为单个楼层 Group 构建全套外立面：
 * - 精确贴合楼板顶面至压顶底面的冰青 Low-E 玻璃幕墙（杜绝沉入楼板与层间裂隙）
 * - 温润瓷土倒角层间腰线/檐口 + 深石墨内退阴影缝 + 首层基座暗影收边条
 * - 零转角 Z-Fighting 的暖雪松悬挑吊顶与双层水平木纹挑翼
 * - InstancedMesh 深石墨竖梃/横梁 + 正弦波浪扭转木百叶
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

  // A11 精确垂直标高约束：
  // - 楼板顶面：floorY + slabT (0.34)
  // - 层间压顶与檐口总高 0.46m：底面 floorY + floorH - 0.46，顶面严格齐平 floorY + floorH（零缝隙！）
  // - 玻璃幕墙严格夹于 [floorY + slabT, floorY + floorH - 0.46]，高度 4.00m（零沉入楼板！）
  const spandrelH = 0.46;
  const spandrelBottomY = floorY + floorH - spandrelH;
  const spandrelCenterY = floorY + floorH - spandrelH * 0.5;
  const glassBotY = floorY + slabT;
  const glassTopY = spandrelBottomY;
  const glassH = glassTopY - glassBotY;
  const glassCenterY = (glassBotY + glassTopY) * 0.5;

  const segments = computeExposedFacadeSegments(wingsOnFloor);

  // 收集批量 InstancedMesh 变换
  const mullionList = [];
  const transomList = [];
  const louverList = [];
  const louverRailList = [];
  const finList = [];
  const soffitList = [];
  const corniceBandList = [];
  const corniceLipList = [];
  const shadowRevealList = [];

  let runningArc = floorIndex * 19.3;

  for (const seg of segments) {
    const cx = (seg.x1 + seg.x2) * 0.5;
    const cz = (seg.z1 + seg.z2) * 0.5;
    const faceRotY = Math.atan2(seg.nx, seg.nz);
    const isXAxis = seg.axis === 'x';
    // 微量跨轴 Y 错层（±0.004m），与精准转角裁剪双保险彻底杜绝共面 Z-Fighting
    const axisYBias = isXAxis ? 0.004 : -0.004;
    const endTypes = classifySegmentEndpoints(seg, wingsOnFloor, PORTAL_CANOPIES);

    const buildBandSpan = (outerDist, bandW) => {
      const innerDist = Math.max(0, outerDist - bandW);
      const extFor = (type) => {
        if (type === 'convex') return isXAxis ? outerDist : innerDist;
        if (type === 'concave') return isXAxis ? -innerDist : -outerDist;
        return 0;
      };
      const extStart = extFor(endTypes.start);
      const extEnd = extFor(endTypes.end);
      const len = seg.length + extStart + extEnd;
      if (len <= 0.12) return null;
      const shift = (extEnd - extStart) * 0.5;
      return {
        len,
        x: cx + (isXAxis ? shift : 0),
        z: cz + (isXAxis ? 0 : shift),
      };
    };

    const buildSpan = (proj) => buildBandSpan(proj, proj);

    // 1. 冰青磨砂高透 Low-E 玻璃幕墙（内退 -0.12m，给深石墨竖梃与扭转木百叶留出雕塑进深）
    const glassGeo = new THREE.PlaneGeometry(seg.length, glassH);
    const glassMesh = new THREE.Mesh(glassGeo, materials.lowEGlass);
    glassMesh.position.set(cx + seg.nx * -0.12, glassCenterY, cz + seg.nz * -0.12);
    glassMesh.rotation.y = faceRotY;
    group.add(glassMesh);

    // 1b. 夜景专属室内分间发光透景层（内退 -0.54m 位于玻璃幕墙后方，日间隐藏零开销）
    const isOpenEscalatorFace = floorIndex <= 2 && seg.isPortalEntrance;
    if (!isOpenEscalatorFace && materials.nightWindowGlow && seg.length > 0.6) {
      const glowW = Math.max(0.4, seg.length - 0.16);
      const glowH = glassH * 0.94;
      const glowGeo = new THREE.PlaneGeometry(glowW, glowH);
      const uv = glowGeo.attributes.uv;
      const tileU = Math.max(0.45, glowW / 24.0);
      const phaseU = ((floorIndex * 0.31 + runningArc * 0.043) % 1 + 1) % 1;
      for (let k = 0; k < uv.count; k++) {
        uv.setX(k, uv.getX(k) * tileU + phaseU);
      }
      uv.needsUpdate = true;

      const glowMesh = new THREE.Mesh(glowGeo, materials.nightWindowGlow);
      glowMesh.position.set(cx + seg.nx * -0.54, glassCenterY, cz + seg.nz * -0.54);
      glowMesh.rotation.y = faceRotY;
      group.add(glowMesh);
    }

    // 2. 层间深石墨背衬压顶 + 温润瓷土倒角檐口带 + 内退阴影槽（精工微缩工业层次）
    const spandrelSpan = buildSpan(0.14);
    if (spandrelSpan) {
      // 深石墨结构压顶内芯（严格填充 [spandrelBottomY, floorY + floorH]，零裂隙）
      shadowRevealList.push({
        pos: [
          spandrelSpan.x + seg.nx * 0.02,
          spandrelCenterY + axisYBias * 0.5,
          spandrelSpan.z + seg.nz * 0.02,
        ],
        rotY: faceRotY,
        scale: [spandrelSpan.len, spandrelH, 0.24],
      });
    }

    // 温润瓷土阶梯倒角楼层边带（位于压顶上部，下留 0.11m 深色阴影凹槽，凸显层叠体块感）
    const corniceSpan = buildSpan(0.22);
    if (corniceSpan) {
      corniceBandList.push({
        pos: [
          corniceSpan.x + seg.nx * 0.11,
          floorY + floorH - 0.19 + axisYBias,
          corniceSpan.z + seg.nz * 0.11,
        ],
        rotY: faceRotY,
        scale: [corniceSpan.len, 0.28, 0.22],
      });
      // 上沿收口微倒角挑边（捕捉棚拍顶部柔光高光，阳角/阴角全闭合）
      const lipSpan = buildBandSpan(0.23, 0.14);
      if (lipSpan) {
        corniceLipList.push({
          pos: [
            lipSpan.x + seg.nx * 0.16,
            floorY + floorH - 0.035 + axisYBias,
            lipSpan.z + seg.nz * 0.16,
          ],
          rotY: faceRotY,
          scale: [lipSpan.len, 0.065, 0.14],
        });
      }
    }

    // 1F 建筑底部深色阴影收边踢脚线（让建筑立面稳重锚固在首层地坪上）
    if (floorIndex === 1) {
      const baseSpan = buildSpan(0.12);
      if (baseSpan) {
        shadowRevealList.push({
          pos: [
            baseSpan.x + seg.nx * 0.05,
            floorY + slabT * 0.5 + axisYBias * 0.5,
            baseSpan.z + seg.nz * 0.05,
          ],
          rotY: faceRotY,
          scale: [baseSpan.len, slabT, 0.16],
        });
      }
    }

    // 3. KKAA 暖雪松水平层间悬挑吊顶与双层薄翼挑檐（非重叠转角裁剪，零 Z-Fighting）
    // 紧邻门廊的 3F 立面适度收窄挑檐，避免与门廊悬浮采光顶干涉
    const eaveDepth = seg.touchesPortal
      ? floorIndex === 3
        ? 0.55
        : 0.65
      : floorIndex === 3
        ? 1.38
        : 0.92;

    const soffitSpan = buildSpan(eaveDepth);
    if (soffitSpan) {
      soffitList.push({
        pos: [
          soffitSpan.x + seg.nx * (eaveDepth * 0.5 + 0.04),
          spandrelBottomY + 0.08 + axisYBias,
          soffitSpan.z + seg.nz * (eaveDepth * 0.5 + 0.04),
        ],
        rotY: faceRotY,
        scale: [soffitSpan.len, 0.09, eaveDepth],
      });
    }

    // 标志性 KKAA 阶梯式水平木纹铝板装饰挑翼（2 条细长层间水平挑翼，阳角/阴角严密收口）
    for (const [dy, ratio] of [
      [0.14, 0.96],
      [0.36, 0.72],
    ]) {
      const proj = eaveDepth * ratio;
      const finDepth = proj * 0.68;
      const finCenter = proj * 0.5 + 0.08;
      const finSpan = buildBandSpan(finCenter + finDepth * 0.5, finDepth);
      if (finSpan) {
        finList.push({
          pos: [
            finSpan.x + seg.nx * finCenter,
            spandrelBottomY + dy + axisYBias,
            finSpan.z + seg.nz * finCenter,
          ],
          rotY: faceRotY,
          scale: [finSpan.len, 0.068, finDepth],
        });
      }
    }

    // 4. 实体深石墨竖梃（间距 2.4m）与上下中 4 道精细横梁
    const mullionStep = 2.4;
    const mCount = Math.max(2, Math.round(seg.length / mullionStep));

    for (let i = 0; i <= mCount; i++) {
      const t = i / mCount;
      const px = THREE.MathUtils.lerp(seg.x1, seg.x2, t);
      const pz = THREE.MathUtils.lerp(seg.z1, seg.z2, t);
      mullionList.push({
        pos: [px + seg.nx * 0.02, glassCenterY, pz + seg.nz * 0.02],
        rotY: faceRotY,
        scale: [0.11, glassH, 0.24],
      });
    }

    // 上下收口框与中腰深石墨横梁（Transoms）
    const transomYs = [
      glassBotY + 0.045,
      glassBotY + glassH * 0.34,
      glassBotY + glassH * 0.74,
      glassTopY - 0.045,
    ];
    for (const ty of transomYs) {
      transomList.push({
        pos: [cx + seg.nx * 0.01, ty + axisYBias * 0.4, cz + seg.nz * 0.01],
        rotY: faceRotY,
        scale: [seg.length + 0.02, 0.09, 0.21],
      });
    }

    // 5. 高密度正弦波浪扭转暖雪松木纹铝百叶（致敬“弦理论”）
    const skipBottomOpening = floorIndex === 1 && seg.isPortalEntrance;
    if (!skipBottomOpening) {
      const louverPitch = floorIndex === 1 ? 1.85 : 1.25;
      const lCount = Math.floor(seg.length / louverPitch);
      const louverOutset = 0.42;
      const louverH = floorIndex === 1 ? glassH * 0.66 : glassH;
      const louverY = floorIndex === 1 ? glassTopY - louverH * 0.5 : glassCenterY;

      let placedAny = false;
      for (let i = 1; i < lCount; i++) {
        const t = i / lCount;
        // 1F 长立面中央留出疏散入口通透门洞
        if (floorIndex === 1 && seg.length > 14 && Math.abs(t - 0.5) < 0.14) continue;

        const px = THREE.MathUtils.lerp(seg.x1, seg.x2, t);
        const pz = THREE.MathUtils.lerp(seg.z1, seg.z2, t);
        const arc = runningArc + t * seg.length;

        const waveAngle =
          Math.sin(arc * 0.145 + floorIndex * 1.15) * 0.68 +
          Math.sin(arc * 0.055 - floorIndex * 0.7) * 0.22;

        louverList.push({
          pos: [px + seg.nx * louverOutset, louverY, pz + seg.nz * louverOutset],
          rotY: faceRotY + waveAngle,
          scale: [0.072, louverH, 0.35],
        });
        placedAny = true;
      }

      // 1F 上挂式百叶底端增加纤细深石墨水平拉结收口杆，确保悬挑百叶有真实结构锚固不悬空
      if (floorIndex === 1 && placedAny && lCount > 2) {
        if (seg.length > 14) {
          // 避开中央门洞左右分段拉结
          const leftLen = seg.length * 0.34;
          const rightLen = seg.length * 0.34;
          for (const sideSign of [-1, 1]) {
            const offset = sideSign * seg.length * 0.31;
            louverRailList.push({
              pos: [
                cx + (isXAxis ? offset : 0) + seg.nx * louverOutset,
                glassTopY - louverH + 0.03,
                cz + (isXAxis ? 0 : offset) + seg.nz * louverOutset,
              ],
              rotY: faceRotY,
              scale: [sideSign < 0 ? leftLen : rightLen, 0.06, 0.12],
            });
          }
        } else {
          louverRailList.push({
            pos: [
              cx + seg.nx * louverOutset,
              glassTopY - louverH + 0.03,
              cz + seg.nz * louverOutset,
            ],
            rotY: faceRotY,
            scale: [Math.max(0.4, seg.length - 0.5), 0.06, 0.12],
          });
        }
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
  const corniceMat = materials.slabEdgeClay || materials.interiorWall;
  const lipMat = materials.roofParapetCap || materials.aluminumFrame;
  const revealMat = materials.darkCharcoalMetal;

  buildInstanced(shadowRevealList, unitBox, revealMat, `SpandrelCore_${floorIndex}F`, true, true);
  buildInstanced(corniceBandList, unitBox, corniceMat, `CorniceBand_${floorIndex}F`, true, true);
  buildInstanced(corniceLipList, unitBox, lipMat, `CorniceLip_${floorIndex}F`, false, true);
  buildInstanced(mullionList, unitBox, materials.darkCharcoalMetal, `Mullions_${floorIndex}F`, false, true);
  buildInstanced(transomList, unitBox, materials.darkCharcoalMetal, `Transoms_${floorIndex}F`, false, true);
  buildInstanced(louverRailList, unitBox, materials.darkCharcoalMetal, `LouverTieRails_${floorIndex}F`, false, true);
  buildInstanced(soffitList, unitBox, materials.warmWoodSoffit, `EaveSoffit_${floorIndex}F`, true, true);
  buildInstanced(finList, unitBox, materials.woodLouver, `HorizontalFins_${floorIndex}F`, false, true);
  buildInstanced(louverList, unitBox, materials.woodLouver, `TwistedStringLouvers_${floorIndex}F`, false, true);

  return group;
}
