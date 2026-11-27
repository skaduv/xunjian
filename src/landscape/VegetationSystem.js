import * as THREE from 'three';
import {
  BUILDING_WINGS,
  LAKE_SHORELINE,
  PLINTH_CONFIG,
  PORTAL_CANOPIES,
} from '../config/campusConfig.js';
import { sampleGroundElevation } from './TerrainAndStructures.js';
import * as HardwarePlinthModule from '../plinth/HardwarePlinth.js';

/**
 * Lush Healthy Botanical Vegetation & Boundless Outer Woodland System (Full InstancedMesh, ~12 Draw Calls)
 *
 * Visual Direction (aligned with @env-clouds Boundless Cloud-Fade & Healthy-Emerald Spec #38):
 * - Rich, vibrant, alive chlorophyll emerald foliage across campus & boundless outer woodland:
 *   deep pine/woodland shadow greens (#16381e–#224f2a), healthy broadleaf mid-canopy (#2b642e–#3d7f38),
 *   sunlit healthy crowns (#589e40–#76b64b), and fresh sunlit spring-lime specimen trees (#59a13e–#79b94c)
 * - Sculpted multi-cushion broadleaf cloud canopies & 5-tier diorama conifers with deep sunlit-to-forest-shadow
 *   baked vertical AO shading so every crown reads plush and three-dimensional under aerial sunlight
 * - Deepened chlorophyll-tinted flat-lawn Contact AO shadow discs (#102012) grounding sunlit canopies
 * - Seamless 360° outer woodland belt (clustered groves, hedgerow tree bands, & Longpan foothills forest)
 *   reusing the EXACT same InstancedMesh buffers across d_out ∈ [0..235m] (tapering into drifting clouds)
 *   with zero visible campus perimeter cutoff and strict clearance from all 3 extended municipal roads
 *
 * Spatial & Joint Integrity (100% V1-V4 = 0 violations):
 * - Exact spline-distance rejection against ALL 8 campus roads/walkways AND all 3 extended outer arterial roads
 * - Exact sync with SW Spiral Hill (-126, 133, r=21.5), Hyperbolic Pavilion (-78, 154), East Pavilion (146, -24),
 *   East Pier, SW Bridge, Lake coping buffer, parking lots, buildings, portals, & camera poles
 * - Unified inner + outer terrain elevation sampling (`sampleTotalElevation`) with deep hillside trunk embedding
 */

// ---------------------------------------------------------------------------
// Deterministic pseudo-random & math helpers
// ---------------------------------------------------------------------------
function seeded(i, salt = 1) {
  const n = Math.sin(i * 91.345 + salt * 47.123) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Signed distance outside the rounded-rect campus footprint (486 × 368, r = 26).
 * Matches @env-clouds Spec #38 Section 5 exactly for all exterior points (d_out > 0).
 */
function signedDistOutsideCampus(x, z) {
  const hw = PLINTH_CONFIG.width * 0.5; // 243
  const hd = PLINTH_CONFIG.depth * 0.5; // 184
  const r = PLINTH_CONFIG.cornerRadius; // 26
  const qx = Math.abs(x) - (hw - r); // |x| - 217
  const qz = Math.abs(z) - (hd - r); // |z| - 158
  const outDist = Math.hypot(Math.max(0, qx), Math.max(0, qz));
  const inDist = Math.min(Math.max(qx, qz), 0);
  return outDist + inDist - r;
}

// ---------------------------------------------------------------------------
// Exact Road, Walkway & Site Clearance Infrastructure
// ---------------------------------------------------------------------------
function clampToPlinthBorder(x, z) {
  const hw = PLINTH_CONFIG.width * 0.5 - 0.6;
  const hd = PLINTH_CONFIG.depth * 0.5 - 0.6;
  return [Math.max(-hw, Math.min(hw, x)), Math.max(-hd, Math.min(hd, z))];
}

function sampleRoadSplinePoints(controlPoints, segments = 96) {
  const vecs = controlPoints.map(([x, z]) => {
    const [cx, cz] = clampToPlinthBorder(x, z);
    return new THREE.Vector3(cx, 0, cz);
  });
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.32);
  const pts = curve.getSpacedPoints(segments);
  return { curve, pts };
}

function distToSegmentSq2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-8) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  let t = ((px - ax) * abx + (pz - az) * abz) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

function distToPolyline(px, pz, pts) {
  let minSq = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dSq = distToSegmentSq2D(px, pz, a.x, a.z, b.x, b.z);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

function distToPolygonEdge(px, pz, poly) {
  let minSq = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const dSq = distToSegmentSq2D(px, pz, a[0], a[1], b[0], b[1]);
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

function pointInPolygon(px, pz, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isOutsideRoundedRect(x, z, halfW, halfD, cornerR) {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax > halfW || az > halfD) return true;
  const cx = halfW - cornerR;
  const cz = halfD - cornerR;
  if (ax > cx && az > cz) {
    return Math.hypot(ax - cx, az - cz) > cornerR;
  }
  return false;
}

// All 8 campus roads & walkways synced with RoadAndParking.js + Cross-Worker Contract (#11)
const ROAD_SPECS = [
  {
    name: 'ZhongguancunAve',
    halfW: 17.5 * 0.5,
    curbW: 0.42,
    segments: 80,
    controlPoints: [
      [-208, -184],
      [-211, -92],
      [-216, 15],
      [-221, 110],
      [-224, 184],
    ],
  },
  {
    name: 'PinglingWestRd',
    halfW: 15.5 * 0.5,
    curbW: 0.42,
    segments: 80,
    controlPoints: [
      [-243, -100],
      [-211, -106],
      [-130, -124],
      [-25, -144],
      [65, -162],
      [164, -184],
    ],
  },
  {
    name: 'YongpingAve',
    halfW: 15.0 * 0.5,
    curbW: 0.42,
    segments: 64,
    controlPoints: [
      [-243, 114],
      [-221, 122],
      [-186, 138],
      [-138, 164],
      [-94, 184],
    ],
  },
  {
    name: 'NorthWelcomeAve',
    halfW: 16.8 * 0.5,
    curbW: 0.42,
    segments: 32,
    controlPoints: [
      [26, -153],
      [26, -124],
      [26, -82],
    ],
  },
  {
    name: 'FireRing',
    halfW: 6.8 * 0.5,
    curbW: 0.42,
    segments: 120,
    controlPoints: [
      [-210, -66],
      [-174, -84],
      [-130, -98],
      [-58, -106],
      [26, -108],
      [96, -104],
      [98, -64],
      [97, -12],
      [96, 24],
    ],
  },
  {
    name: 'WestBranch',
    halfW: 6.2 * 0.5,
    curbW: 0.42,
    segments: 64,
    controlPoints: [
      [-214, 22],
      [-168, 22],
      [-146, 18],
      [-146, -34],
      [-144, -93],
    ],
  },
  {
    name: 'WalkwayNW',
    halfW: 3.6 * 0.5,
    curbW: 0.22,
    segments: 56,
    controlPoints: [
      [-177, -81.5],
      [-184, -18],
      [-184, 52],
      [-181, 78],
      [-179, 95],
    ],
  },
  {
    name: 'WalkwayMain',
    halfW: 3.6 * 0.5,
    curbW: 0.22,
    segments: 160,
    controlPoints: [
      [-161, 122],
      [-144, 110],
      [-114, 106],
      [-84, 126],
      [-64, 146],
      [-22, 165],
      [28, 168],
      [88, 152],
      [136, 114],
      [168, 74],
      [172, 34],
      [156, 2],
      [160.5, -24],
      [154, -76],
      [136, -132],
      [98, -142],
      [72, -160],
    ],
  },
];

// Extended outer municipal arterial corridors (synced with @env-clouds #38 Section 4 & @road-horizon)
// Includes straight tangent horizon guards past road fade-out endpoints so zero outer trees block vanishing road vistas.
const EXTENDED_ARTERIAL_SPECS = [
  {
    name: 'ZhongguancunAveExt',
    halfW: 17.5 * 0.5,
    curbW: 0.42,
    segments: 160,
    controlPoints: [
      [-201, -404],
      [-205, -294],
      [-208, -184],
      [-211, -92],
      [-216, 15],
      [-221, 110],
      [-224, 184],
      [-228, 294],
      [-233, 404],
    ],
    guardStart: [-191, -674],
    guardEnd: [-246, 674],
  },
  {
    name: 'PinglingWestRdExt',
    halfW: 15.5 * 0.5,
    curbW: 0.42,
    segments: 160,
    controlPoints: [
      [-459, -59],
      [-351, -80],
      [-243, -100],
      [-211, -106],
      [-130, -124],
      [-25, -144],
      [65, -162],
      [164, -184],
      [272, -208],
      [379, -232],
    ],
    guardStart: [-722, -7],
    guardEnd: [662, -295],
  },
  {
    name: 'YongpingAveExt',
    halfW: 15.0 * 0.5,
    curbW: 0.42,
    segments: 144,
    controlPoints: [
      [-450, 39],
      [-346, 76],
      [-243, 114],
      [-221, 122],
      [-186, 138],
      [-138, 164],
      [-94, 184],
      [6, 230],
      [106, 275],
    ],
    guardStart: [-705, -52],
    guardEnd: [388, 402],
  },
];

function sampleUnclampedRoadSplinePoints(controlPoints, segments = 140) {
  const vecs = controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.32);
  const pts = curve.getSpacedPoints(segments);
  return { curve, pts };
}

// Precomputed extended arterial polylines (shared by clearance & outer terrain fallback)
const EXTENDED_ARTERIAL_CURVES = EXTENDED_ARTERIAL_SPECS.map((spec) => {
  const { curve, pts } = sampleUnclampedRoadSplinePoints(spec.controlPoints, spec.segments);
  const clearancePts = [
    new THREE.Vector3(spec.guardStart[0], 0, spec.guardStart[1]),
    ...pts,
    new THREE.Vector3(spec.guardEnd[0], 0, spec.guardEnd[1]),
  ];
  return { ...spec, curve, pts, clearancePts };
});

/**
 * Fallback outer terrain elevation formula synced 1:1 with @env-clouds Spec #38 Section 5.
 * Automatically defers to live `HardwarePlinth.sampleOuterTerrainHeight(x, z)` once merged.
 */
function fallbackOuterTerrainHeight(x, z) {
  const dOut = signedDistOutsideCampus(x, z);
  if (dOut <= 22) return 0;

  let minRoadDist = Infinity;
  for (let i = 0; i < EXTENDED_ARTERIAL_CURVES.length; i++) {
    const d = distToPolyline(x, z, EXTENDED_ARTERIAL_CURVES[i].pts);
    if (d < minRoadDist) minRoadDist = d;
  }
  const mRoad = smoothstep(26, 56, minRoadDist);
  if (mRoad <= 1e-4) return 0;

  const mEdge = smoothstep(22, 75, dOut) * smoothstep(520, 320, dOut);
  if (mEdge <= 1e-4) return 0;

  const roll = Math.max(
    0,
    (Math.sin(x * 0.0095 + z * 0.0062) * 0.5 +
      Math.cos(x * 0.0068 - z * 0.0105) * 0.35 +
      Math.sin((x - z) * 0.014) * 0.15 +
      0.55) *
      5.2
  );

  let east = 0;
  if (x > 250) {
    east =
      smoothstep(250, 340, x) *
      smoothstep(520, 380, x) *
      (12.0 * Math.exp(-Math.pow((z + 55) / 145, 2)) + 10.5 * Math.exp(-Math.pow((z - 85) / 130, 2)));
  }

  return Math.max(0, (roll + east) * mEdge * mRoad);
}

function sampleOuterTerrainElevation(x, z) {
  const externalFn = HardwarePlinthModule['sampleOuterTerrainHeight'];
  if (typeof externalFn === 'function') {
    return externalFn(x, z);
  }
  return fallbackOuterTerrainHeight(x, z);
}

function sampleTotalElevation(x, z) {
  const innerY = sampleGroundElevation(x, z);
  const outerY = sampleOuterTerrainElevation(x, z);
  return Math.max(innerY, outerY);
}

// Cross-Worker Contract constants (#11)
const SW_HILL = { cx: -126, cz: 133, outerR: 21.5, summitR: 7.0 };
const HYPERBOLIC_PAVILION = { cx: -78, cz: 154, exclusionR: 13.5 };
const EAST_PAVILION = { cx: 146, cz: -24, exclusionR: 15.5 };
const EAST_PIER = { ax: 99.0, az: 24.2, bx: 155.2, bz: 2.0 };
const SW_BRIDGE = { ax: -181.0, az: 92.0, bx: -159.0, bz: 125.0 };

const ROAD_JUNCTIONS = [
  { x: -211, z: -106, r: 10.5 },
  { x: -221, z: 122, r: 10.2 },
  { x: 26, z: -153, r: 9.8 },
];

const OUTDOOR_CAMERA_POLES = [
  { x: 13.5, z: -104.0 },
  { x: -150.2, z: -36.0 },
  { x: 103.5, z: -46.0 },
];

// Precomputed SW Hill spiral path polyline (synced with TerrainAndStructures L2)
function buildSWHillSpiralPoints() {
  const pts = [];
  const steps = 84;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = -Math.PI * 0.72 + t * Math.PI * 2 * 1.42;
    const rad = THREE.MathUtils.lerp(21.2, 7.1, t);
    pts.push(new THREE.Vector3(SW_HILL.cx + Math.cos(angle) * rad, 0, SW_HILL.cz + Math.sin(angle) * rad));
  }
  return pts;
}

function buildSpatialClearanceContext() {
  const roads = ROAD_SPECS.map((spec) => {
    const { curve, pts } = sampleRoadSplinePoints(spec.controlPoints, spec.segments);
    return { ...spec, curve, pts };
  });
  const swSpiralPts = buildSWHillSpiralPoints();

  const isInsideAnyExtendedRoad = (x, z, extraMargin) => {
    for (let i = 0; i < EXTENDED_ARTERIAL_CURVES.length; i++) {
      const r = EXTENDED_ARTERIAL_CURVES[i];
      if (distToPolyline(x, z, r.clearancePts) < r.halfW + extraMargin) {
        return true;
      }
    }
    return false;
  };

  const isInsideAnyRoad = (x, z, extraMargin) => {
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (distToPolyline(x, z, r.pts) < r.halfW + r.curbW + extraMargin) {
        return true;
      }
    }
    if (isInsideAnyExtendedRoad(x, z, 0.42 + extraMargin)) {
      return true;
    }
    for (let i = 0; i < ROAD_JUNCTIONS.length; i++) {
      const j = ROAD_JUNCTIONS[i];
      if (Math.hypot(x - j.x, z - j.z) < j.r + extraMargin) return true;
    }
    return false;
  };

  const isBlockedCommon = (x, z, { bldgPad, plazaPad, lakePad, extraRoadMargin, allowSWHillSlope }) => {
    // 1. Buildings + Portals + Lakeside Decks + Waterfront Steps
    for (let i = 0; i < BUILDING_WINGS.length; i++) {
      const w = BUILDING_WINGS[i];
      if (x >= w.x1 - bldgPad && x <= w.x2 + bldgPad && z >= w.z1 - bldgPad && z <= w.z2 + bldgPad) {
        return true;
      }
      if (w.lakesideDeck) {
        const d = w.lakesideDeck;
        if (x >= d.x1 - 3.5 && x <= d.x2 + 3.5 && z >= d.z1 - 3.5 && z <= d.z2 + 3.5) {
          return true;
        }
      }
    }
    for (let i = 0; i < PORTAL_CANOPIES.length; i++) {
      const p = PORTAL_CANOPIES[i];
      const ox = p.overhangX || 0;
      const oz = p.overhangZ || 0;
      if (
        x >= p.x1 - ox - bldgPad * 0.8 &&
        x <= p.x2 + ox + bldgPad * 0.8 &&
        z >= p.z1 - oz - bldgPad * 0.8 &&
        z <= p.z2 + oz + bldgPad * 0.8
      ) {
        return true;
      }
    }
    // Waterfront teak steps
    if (x >= -111 && x <= -85 && z >= 48.5 && z <= 55.5) return true;
    if (x >= 10 && x <= 42 && z >= -61.5 && z <= -54.5) return true;

    // 2. North Welcome Plaza, Twin Mirror Pools & Mirror Pool Hedges
    if (x >= 8 - plazaPad && x <= 44 + plazaPad && z >= -107 - plazaPad && z <= -81 + plazaPad) return true;
    if (x >= 2 - plazaPad * 0.55 && x <= 50 + plazaPad * 0.55 && z >= -139 && z <= -109) return true;

    // 3. Parking Lots, Carports, Aprons, East Loading Bay & 1BF Underground Garage Ramp
    if (x >= -146.5 - plazaPad * 0.4 && x <= -101.5 + plazaPad * 0.4 && z >= -34 - plazaPad * 0.4 && z <= 14 + plazaPad * 0.4) {
      return true;
    }
    if (x >= 73 - plazaPad * 0.4 && x <= 106.5 + plazaPad * 0.4 && z >= -129.5 - plazaPad * 0.4 && z <= -102.5 + plazaPad * 0.4) {
      return true;
    }
    if (x >= 48.1 - plazaPad * 0.3 && x <= 76.5 + plazaPad * 0.4 && z >= -104.5 && z <= -85.5) return true;
    if (x >= 86.5 && x <= 102.5 && z >= -18 && z <= 10) return true;

    // 4. All 8 Road & Walkway Splines + Junction Pads
    if (isInsideAnyRoad(x, z, extraRoadMargin)) return true;

    // 5. Lake interior + Granite Revetment Coping Buffer (V3)
    if (pointInPolygon(x, z, LAKE_SHORELINE)) return true;
    if (lakePad > 0 && distToPolygonEdge(x, z, LAKE_SHORELINE) < lakePad) return true;

    // 6. SW Arch Bridge & approaches
    if (Math.hypot(x + 170, z - 108) < 17.5) return true;
    if (Math.sqrt(distToSegmentSq2D(x, z, SW_BRIDGE.ax, SW_BRIDGE.az, SW_BRIDGE.bx, SW_BRIDGE.bz)) < 6.8) return true;

    // 7. Relocated SW Spiral Hill Park (-126, 133, outerR=21.5, summitR=7.0) (V2)
    const dSWHill = Math.hypot(x - SW_HILL.cx, z - SW_HILL.cz);
    if (!allowSWHillSlope) {
      if (dSWHill < SW_HILL.outerR + 1.3) return true;
    } else {
      if (dSWHill < SW_HILL.summitR + 2.5) return true;
      if (distToPolyline(x, z, swSpiralPts) < 2.8) return true;
    }

    // 8. Relocated Hyperbolic Membrane Pavilion (-78, 154) & NE stone link (V3)
    if (Math.hypot(x - HYPERBOLIC_PAVILION.cx, z - HYPERBOLIC_PAVILION.cz) < HYPERBOLIC_PAVILION.exclusionR) {
      return true;
    }
    if (Math.sqrt(distToSegmentSq2D(x, z, -78, 154, -64, 145)) < 4.5) return true;

    // 9. East Hexagonal Pavilion (146, -24) & Extended East Pier (99.4,24.0 -> 154.4,2.4)
    if (Math.hypot(x - EAST_PAVILION.cx, z - EAST_PAVILION.cz) < EAST_PAVILION.exclusionR) return true;
    if (Math.sqrt(distToSegmentSq2D(x, z, EAST_PIER.ax, EAST_PIER.az, EAST_PIER.bx, EAST_PIER.bz)) < 5.0) {
      return true;
    }

    // 10. Outdoor security camera poles
    for (let i = 0; i < OUTDOOR_CAMERA_POLES.length; i++) {
      const c = OUTDOOR_CAMERA_POLES[i];
      if (Math.hypot(x - c.x, z - c.z) < 3.4) return true;
    }

    return false;
  };

  const isBlockedForTree = (x, z, { hasPit = false } = {}) => {
    // Keep canopy cleanly inside the ceramic plinth rounded border
    if (
      isOutsideRoundedRect(
        x,
        z,
        PLINTH_CONFIG.width * 0.5 - 9.0,
        PLINTH_CONFIG.depth * 0.5 - 9.0,
        PLINTH_CONFIG.cornerRadius
      )
    ) {
      return true;
    }
    return isBlockedCommon(x, z, {
      bldgPad: 5.4,
      plazaPad: 3.2,
      lakePad: 2.6,
      extraRoadMargin: hasPit ? 2.25 : 1.9,
      allowSWHillSlope: false,
    });
  };

  const isBlockedForShrub = (x, z) => {
    if (
      isOutsideRoundedRect(
        x,
        z,
        PLINTH_CONFIG.width * 0.5 - 5.2,
        PLINTH_CONFIG.depth * 0.5 - 5.2,
        PLINTH_CONFIG.cornerRadius
      )
    ) {
      return true;
    }
    return isBlockedCommon(x, z, {
      bldgPad: 2.8,
      plazaPad: 1.6,
      lakePad: 1.85,
      extraRoadMargin: 1.2,
      allowSWHillSlope: false,
    });
  };

  const isBlockedForReed = (x, z) => {
    if (
      isOutsideRoundedRect(
        x,
        z,
        PLINTH_CONFIG.width * 0.5 - 4.0,
        PLINTH_CONFIG.depth * 0.5 - 4.0,
        PLINTH_CONFIG.cornerRadius
      )
    ) {
      return true;
    }
    if (pointInPolygon(x, z, LAKE_SHORELINE)) return true;
    const dLake = distToPolygonEdge(x, z, LAKE_SHORELINE);
    // Sit neatly on the inland grass bank outside the 0.78m granite coping cap
    if (dLake < 1.35 || dLake > 2.65) return true;

    return isBlockedCommon(x, z, {
      bldgPad: 4.0,
      plazaPad: 2.5,
      lakePad: 0, // handled explicitly above
      extraRoadMargin: 1.0,
      allowSWHillSlope: false,
    });
  };

  const isBlockedForOuterTree = (x, z, { allowBorderBridge = false } = {}) => {
    const dOut = signedDistOutsideCampus(x, z);
    if (dOut > 296) return true;
    if (!allowBorderBridge && dOut < 4.0) return true;

    // Generous clearance (>= halfW + 6.5m) against all 3 extended municipal arterial corridors + horizon guards
    if (isInsideAnyExtendedRoad(x, z, 6.5)) return true;

    // Near or inside the campus border: enforce 100% of ALL inner campus exclusions as well
    if (dOut < 34) {
      if (
        isBlockedCommon(x, z, {
          bldgPad: 6.2,
          plazaPad: 3.6,
          lakePad: 3.2,
          extraRoadMargin: 2.8,
          allowSWHillSlope: false,
        })
      ) {
        return true;
      }
    }
    return false;
  };

  return {
    roads,
    extendedRoads: EXTENDED_ARTERIAL_CURVES,
    isBlockedForTree,
    isBlockedForOuterTree,
    isBlockedForShrub,
    isBlockedForReed,
  };
}

// ---------------------------------------------------------------------------
// Terrain Normal & Slope Sampling (unified inner campus + outer boundless terrain)
// ---------------------------------------------------------------------------
function sampleTerrainInfo(x, z) {
  const y = sampleTotalElevation(x, z);
  const eps = 0.85;
  const hL = sampleTotalElevation(x - eps, z);
  const hR = sampleTotalElevation(x + eps, z);
  const hD = sampleTotalElevation(x, z - eps);
  const hU = sampleTotalElevation(x, z + eps);
  const dx = (hR - hL) / (2 * eps);
  const dz = (hU - hD) / (2 * eps);
  const slope = Math.hypot(dx, dz);
  const normal = new THREE.Vector3(-dx, 1, -dz).normalize();
  return { y, slope, normal };
}

// ---------------------------------------------------------------------------
// Procedural Soft Radial Contact AO Disc Texture (inline, zero external deps)
// ---------------------------------------------------------------------------
function createContactAOTexture() {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.94)');
  grad.addColorStop(0.32, 'rgba(255, 255, 255, 0.70)');
  grad.addColorStop(0.62, 'rgba(255, 255, 255, 0.30)');
  grad.addColorStop(0.84, 'rgba(255, 255, 255, 0.07)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Sculpted Tactile Miniature Geometries
// ---------------------------------------------------------------------------

/**
 * Plush soft-cushion foliage blob (smooth subdivided icosahedron with gentle oblate
 * clay-cloud shaping + baked vertical AO vertex shading from darker underside to sunlit crown)
 */
function createSoftCushionGeometry(detail = 2) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);

    // Gentle low-frequency organic pillow undulation
    const ripple =
      1.0 +
      0.068 * Math.sin(vx * 2.7 + vz * 2.3) * Math.cos(vy * 2.1) +
      0.042 * Math.cos(vx * 4.1 - vz * 3.6);

    // Slightly flatter underside for grounded designer-diorama cloud feel
    const yScale = vy < 0 ? 0.72 : 0.84;
    pos.setXYZ(i, vx * ripple, vy * ripple * yScale, vz * ripple);

    // Baked vertical & crown-shoulder AO shading (deep velvety forest shadow underside -> natural sunlit crown)
    const t = THREE.MathUtils.clamp((vy + 1.0) * 0.5, 0, 1);
    const s = t * t * (3 - 2 * t);
    const outerLift = Math.min(1.0, Math.hypot(vx, vz)) * 0.032 * s;
    colors[i * 3] = 0.42 + 0.54 * s + outerLift * 0.85;
    colors[i * 3 + 1] = 0.50 + 0.48 * s + outerLift;
    colors[i * 3 + 2] = 0.45 + 0.45 * s + outerLift * 0.55;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Tapered warm-wood trunk with subtle flared root base (origin at bottom y=0 -> top y=1)
 */
function createFlaredTrunkGeometry(topR = 0.14, botR = 0.28, radialSegs = 10) {
  const geo = new THREE.CylinderGeometry(topR, botR, 1.0, radialSegs, 5);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y < 0.28) {
      const flare = 1.0 + Math.pow(1.0 - y / 0.28, 2.0) * 0.34;
      pos.setXYZ(i, x * flare, y, z * flare);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sculpted soft-beveled diorama conifer tier (rounded dome shoulder + softly scalloped 7-lobe
 * skirt + baked vertical AO shading — machined architectural-model elegance, zero harsh cones)
 */
function createConiferTierGeometry() {
  const profile = [
    new THREE.Vector2(0.01, -0.05),
    new THREE.Vector2(0.92, 0.02),
    new THREE.Vector2(1.0, 0.19),
    new THREE.Vector2(0.85, 0.45),
    new THREE.Vector2(0.56, 0.73),
    new THREE.Vector2(0.26, 0.94),
    new THREE.Vector2(0.01, 1.0),
  ];
  const geo = new THREE.LatheGeometry(profile, 21);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r > 0.05) {
      const theta = Math.atan2(z, x);
      // Soft 7-lobe organic pine-bough scallops strongest near the lower rim, smooth at crown
      const skirtWeight = Math.max(0, 1.0 - Math.max(0, y) * 1.15);
      const lobe = 1.0 + 0.125 * Math.cos(theta * 7.0) * skirtWeight + 0.035 * Math.sin(theta * 3.0);
      const droop = -0.058 * Math.cos(theta * 7.0) * skirtWeight * r;
      pos.setXYZ(i, x * lobe, y + droop, z * lobe);
    }

    const t = THREE.MathUtils.clamp((y + 0.08) / 1.08, 0, 1);
    const s = t * t * (3 - 2 * t);
    colors[i * 3] = 0.40 + 0.56 * s;
    colors[i * 3 + 1] = 0.49 + 0.49 * s;
    colors[i * 3 + 2] = 0.44 + 0.46 * s;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Crisp chamfered rounded-square stone tree-pit collar ring (outer 2.28m, inner opening 1.62m)
 */
function createStonePitCollarGeometry() {
  const outerHalf = 1.14;
  const outerR = 0.28;
  const innerHalf = 0.80;
  const innerR = 0.18;

  const makeRoundedSquare = (h, r, ccw = false) => {
    const p = ccw ? new THREE.Path() : new THREE.Shape();
    if (!ccw) {
      p.moveTo(-h + r, -h);
      p.lineTo(h - r, -h);
      p.quadraticCurveTo(h, -h, h, -h + r);
      p.lineTo(h, h - r);
      p.quadraticCurveTo(h, h, h - r, h);
      p.lineTo(-h + r, h);
      p.quadraticCurveTo(-h, h, -h, h - r);
      p.lineTo(-h, -h + r);
      p.quadraticCurveTo(-h, -h, -h + r, -h);
    } else {
      p.moveTo(-h + r, -h);
      p.quadraticCurveTo(-h, -h, -h, -h + r);
      p.lineTo(-h, h - r);
      p.quadraticCurveTo(-h, h, -h + r, h);
      p.lineTo(h - r, h);
      p.quadraticCurveTo(h, h, h, h - r);
      p.lineTo(h, -h + r);
      p.quadraticCurveTo(h, -h, h - r, -h);
      p.lineTo(-h + r, -h);
    }
    return p;
  };

  const shape = makeRoundedSquare(outerHalf, outerR, false);
  shape.holes.push(makeRoundedSquare(innerHalf, innerR, true));

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.045,
    bevelSegments: 1,
    curveSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);
  // Bottom sits at y = -0.045 (embeds cleanly into y=0 lawn), top at y = +0.185
  geo.computeVertexNormals();
  return geo;
}

/**
 * Chamfered architectural trimmed boxwood hedge unit block (unit 1x1x1 centered in XZ, base at y=-0.04)
 */
function createChamferedHedgeGeometry() {
  const hw = 0.47;
  const hd = 0.47;
  const r = 0.06;
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

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.84,
    bevelEnabled: true,
    bevelThickness: 0.10,
    bevelSize: 0.03,
    bevelSegments: 1,
    curveSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.05, 0);

  // Deep emerald shaded base -> sunlit fresh boxwood top AO vertex color
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / 0.98, 0, 1);
    const s = t * t * (3 - 2 * t);
    colors[i * 3] = 0.52 + 0.45 * s;
    colors[i * 3 + 1] = 0.62 + 0.37 * s;
    colors[i * 3 + 2] = 0.55 + 0.36 * s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function finalizeInstancedMesh(inst, { castShadow = false, receiveShadow = false } = {}) {
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.castShadow = castShadow;
  inst.receiveShadow = receiveShadow;
  inst.frustumCulled = false;
  if (typeof inst.computeBoundingSphere === 'function') {
    inst.computeBoundingSphere();
  }
  return inst;
}

// ---------------------------------------------------------------------------
// Instanced Species Builders
// ---------------------------------------------------------------------------
const UP_VEC = new THREE.Vector3(0, 1, 0);

function buildBroadleafCanopySystem({ trees, trunkMat, branchMat, stonePitMat, mulchMat, aoEntries }) {
  const grp = new THREE.Group();
  grp.name = 'BroadleafTrees';
  if (trees.length === 0) return grp;

  const cushionGeo = createSoftCushionGeometry(2);
  const trunkGeo = createFlaredTrunkGeometry(0.14, 0.30, 10);
  const branchGeo = new THREE.CylinderGeometry(0.06, 0.13, 1.0, 7);
  branchGeo.translate(0, 0.5, 0);

  // 5 organically merged soft cloud cushions per broadleaf tree (asymmetric designer silhouette)
  const cushionOffsets = [
    { x: -1.16, y: 0.12, z: -0.68, sx: 1.66, sy: 1.24, sz: 1.56, tier: 0 },
    { x: 1.22, y: 0.18, z: -0.52, sx: 1.62, sy: 1.20, sz: 1.58, tier: 0 },
    { x: 0.04, y: 0.22, z: 1.26, sx: 1.68, sy: 1.22, sz: 1.54, tier: 0 },
    { x: -0.28, y: 1.18, z: -0.14, sx: 1.88, sy: 1.38, sz: 1.82, tier: 1 },
    { x: 0.42, y: 1.94, z: 0.22, sx: 1.38, sy: 1.08, sz: 1.34, tier: 2 },
  ];

  // Natural deep photographic aerial chlorophyll palettes [lowerShade, midBody, sunlitCrown] (synced to #36662d lawn & QA #44)
  const SPRING_LIME_PALETTE = [
    new THREE.Color('#275726'), // Deep rich olive-emerald underside
    new THREE.Color('#447931'), // Warm sunlit natural olive-emerald body
    new THREE.Color('#5C943E'), // Crisp healthy sunlit crown (zero cartoon neon)
  ];
  const SPECIES_PALETTES = {
    deepWood: [
      new THREE.Color('#122D18'), // Deep dense woodland shadow green underside
      new THREE.Color('#1B4120'), // Rich mature dark forest emerald body
      new THREE.Color('#2B5C29'), // Natural sunlit woodland upper crown
    ],
    camphor: [
      new THREE.Color('#16361C'), // Deep forest-emerald underside
      new THREE.Color('#235225'), // Rich healthy broadleaf mid-canopy
      new THREE.Color('#376E2F'), // Natural sunlit canopy highlight
    ],
    moss: [
      new THREE.Color('#1C4221'), // Lush shadowed park emerald underside
      new THREE.Color('#2E662C'), // Vibrant healthy meadow-leaf body
      new THREE.Color('#497E33'), // Warm sunlit chlorophyll crown
    ],
    springLime: SPRING_LIME_PALETTE,
    amber: SPRING_LIME_PALETTE,
  };

  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
  });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunkInst.name = 'BroadleafTrunks';
  const branchInst = new THREE.InstancedMesh(branchGeo, branchMat, trees.length * 3);
  branchInst.name = 'BroadleafBranches';
  const canopyInst = new THREE.InstancedMesh(cushionGeo, canopyMat, trees.length * cushionOffsets.length);
  canopyInst.name = 'BroadleafCanopies';

  // Stone tree-pit collars & lawn mulch mounds ONLY on inner campus trees (never outer countryside woodland)
  const pitTrees = trees.filter((t) => !t.isOuter && t.hasPit && t.y < 0.05 && t.slope < 0.05);
  const lawnMoundTrees = trees.filter(
    (t) => !t.isOuter && !(t.hasPit && t.y < 0.05 && t.slope < 0.05) && t.slope <= 0.16
  );

  const pitCollarInst =
    pitTrees.length > 0
      ? new THREE.InstancedMesh(createStonePitCollarGeometry(), stonePitMat, pitTrees.length)
      : null;
  if (pitCollarInst) pitCollarInst.name = 'StoneTreePitCollars';

  const mulchGeo = new THREE.CylinderGeometry(0.68, 0.84, 0.14, 12);
  mulchGeo.translate(0, 0.02, 0);
  const totalMulch = pitTrees.length + lawnMoundTrees.length;
  const mulchInst = totalMulch > 0 ? new THREE.InstancedMesh(mulchGeo, mulchMat, totalMulch) : null;
  if (mulchInst) mulchInst.name = 'TreePitMulchBeds';

  const dummy = new THREE.Object3D();
  const quat = new THREE.Quaternion();
  const colorObj = new THREE.Color();

  let bIdx = 0;
  let cIdx = 0;
  let pitIdx = 0;
  let mulchIdx = 0;

  for (let i = 0; i < trees.length; i++) {
    const tr = trees[i];
    const s = tr.scale;
    const isSloped = tr.slope > 0.08;
    // V4: embed trunks deeply on slopes & outer rolling hills so downhill roots NEVER expose
    const rootEmbed = isSloped ? (tr.isOuter ? 0.58 : 0.42) : tr.isOuter ? 0.24 : 0.18;
    const visibleTrunkH = 3.05 * s;
    const totalTrunkH = visibleTrunkH + rootEmbed;
    const baseY = tr.y - rootEmbed;
    const rot = tr.rot;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    // 1. Flared tapered trunk
    dummy.position.set(tr.x, baseY, tr.z);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.set(s, totalTrunkH, s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    // 2. Three angled lower branch forks aimed directly into the 3 outer cloud cushions
    const forkBaseY = tr.y + visibleTrunkH * 0.72;
    const branchAngles = [-2.61, -0.40, 1.54];
    for (let b = 0; b < 3; b++) {
      const ba = rot + branchAngles[b];
      const bLen = 1.92 * s;
      const tilt = 0.56;
      dummy.position.set(tr.x, forkBaseY, tr.z);
      dummy.rotation.set(0, -ba, -tilt);
      dummy.scale.set(s, bLen, s);
      dummy.updateMatrix();
      branchInst.setMatrixAt(bIdx++, dummy.matrix);
    }

    // 3. Five sculpted cloud cushions with subtle hue/lightness botanical variation
    const crownBaseY = tr.y + visibleTrunkH + 0.78 * s;
    const palette = SPECIES_PALETTES[tr.species] || SPECIES_PALETTES.camphor;
    const treeHueShift = (seeded(i, 71) - 0.5) * 0.022;
    const treeLitShift = (seeded(i, 73) - 0.5) * 0.045;

    for (let k = 0; k < cushionOffsets.length; k++) {
      const po = cushionOffsets[k];
      const lx = po.x * s;
      const lz = po.z * s;
      const wx = tr.x + lx * cosR - lz * sinR;
      const wz = tr.z + lx * sinR + lz * cosR;
      const wy = crownBaseY + po.y * s;

      dummy.position.set(wx, wy, wz);
      dummy.rotation.set(
        (seeded(i * 5 + k, 11) - 0.5) * 0.24,
        rot + k * 1.15,
        (seeded(i * 5 + k, 13) - 0.5) * 0.24
      );
      dummy.scale.set(po.sx * s, po.sy * s, po.sz * s);
      dummy.updateMatrix();
      canopyInst.setMatrixAt(cIdx, dummy.matrix);

      colorObj.copy(palette[po.tier]);
      const puffJitter = (seeded(i * 7 + k, 19) - 0.5) * 0.032;
      colorObj.offsetHSL(treeHueShift, puffJitter * 0.35, 0);
      // Multiplicative linear brightness variation prevents dark emerald undersides from clipping to black
      colorObj.multiplyScalar(1.0 + (treeLitShift + puffJitter) * 4.2);
      canopyInst.setColorAt(cIdx, colorObj);
      cIdx++;
    }

    // 4. Tree-pit collar (flat avenues/plazas) OR organic soil mound ring (inner park lawns only)
    const usePit = !tr.isOuter && tr.hasPit && tr.y < 0.05 && tr.slope < 0.05;
    if (usePit && pitCollarInst) {
      dummy.position.set(tr.x, tr.y, tr.z);
      dummy.rotation.set(0, tr.pitRotY ?? 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pitCollarInst.setMatrixAt(pitIdx++, dummy.matrix);

      if (mulchInst) {
        dummy.position.set(tr.x, tr.y, tr.z);
        dummy.rotation.set(0, tr.pitRotY ?? 0, 0);
        dummy.scale.set(1.12, 0.9, 1.12);
        dummy.updateMatrix();
        mulchInst.setMatrixAt(mulchIdx++, dummy.matrix);
      }
    } else if (!tr.isOuter && tr.slope <= 0.16 && mulchInst) {
      quat.setFromUnitVectors(UP_VEC, tr.normal);
      dummy.position.set(tr.x, tr.y - 0.03, tr.z);
      dummy.quaternion.copy(quat);
      dummy.scale.set(0.88 * s, 0.72, 0.88 * s);
      dummy.updateMatrix();
      mulchInst.setMatrixAt(mulchIdx++, dummy.matrix);
    }

    // 5. Ground Contact AO disc registration (slope-aware per V4; fade out before outer cloud sea)
    const allowAO = tr.isOuter ? tr.slope <= 0.14 && (tr.dOut ?? 0) <= 178 : tr.slope <= 0.22;
    if (allowAO) {
      const slopeShrink = tr.slope > 0.12 ? THREE.MathUtils.lerp(1.0, 0.55, (tr.slope - 0.12) / 0.10) : 1.0;
      const outerFade = tr.isOuter ? smoothstep(178, 125, tr.dOut ?? 0) : 1.0;
      const aoRadius = 3.25 * s * slopeShrink * outerFade;
      if (aoRadius > 0.45) {
        aoEntries.push({
          x: tr.x,
          y: tr.y,
          z: tr.z,
          normal: tr.normal,
          slope: tr.slope,
          radius: aoRadius,
        });
      }
    }
  }

  grp.add(
    finalizeInstancedMesh(trunkInst, { castShadow: true, receiveShadow: true }),
    finalizeInstancedMesh(branchInst, { castShadow: true, receiveShadow: false }),
    finalizeInstancedMesh(canopyInst, { castShadow: true, receiveShadow: true })
  );
  if (pitCollarInst) grp.add(finalizeInstancedMesh(pitCollarInst, { castShadow: true, receiveShadow: true }));
  if (mulchInst) grp.add(finalizeInstancedMesh(mulchInst, { castShadow: false, receiveShadow: true }));
  return grp;
}

function buildSculptedConifers({ trees, trunkMat, aoEntries }) {
  const grp = new THREE.Group();
  grp.name = 'SculptedConifers';
  if (trees.length === 0) return grp;

  const tiers = 5;
  const trunkGeo = createFlaredTrunkGeometry(0.10, 0.28, 8);
  const tierGeo = createConiferTierGeometry();

  const foliageMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.87,
    metalness: 0.0,
  });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunkInst.name = 'ConiferTrunks';
  const tierInst = new THREE.InstancedMesh(tierGeo, foliageMat, trees.length * tiers);
  tierInst.name = 'ConiferTiers';

  // Deep velvety woodland pine shadow -> rich evergreen body -> natural sunlit pine apex (QA #44)
  const cBase = new THREE.Color('#132F19');
  const cMid = new THREE.Color('#1D4422');
  const cTop = new THREE.Color('#32672D');
  const col = new THREE.Color();
  const dummy = new THREE.Object3D();

  let wIdx = 0;
  for (let i = 0; i < trees.length; i++) {
    const tr = trees[i];
    const s = tr.scale;
    const isSloped = tr.slope > 0.08;
    // V4: embed conifer roots deeply on mountain & outer foothill slopes
    const rootEmbed = isSloped ? (tr.isOuter ? 0.62 : 0.42) : tr.isOuter ? 0.26 : 0.20;
    const treeH = 9.4 * s;
    const baseY = tr.y - rootEmbed;

    dummy.position.set(tr.x, baseY, tr.z);
    dummy.rotation.set(0, tr.rot, 0);
    dummy.scale.set(s, treeH * 0.88 + rootEmbed, s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    const treeHue = (seeded(i, 83) - 0.5) * 0.025;
    const treeLit = (seeded(i, 89) - 0.5) * 0.048;

    for (let t = 0; t < tiers; t++) {
      const frac = t / (tiers - 1);
      const tierY = tr.y + (1.85 + frac * 5.85) * s;
      const tierR = (2.68 - frac * 1.82) * s;
      const tierH = (2.35 - frac * 0.38) * s;

      dummy.position.set(tr.x, tierY, tr.z);
      dummy.rotation.set(0, tr.rot + t * 0.58, 0);
      dummy.scale.set(tierR, tierH, tierR);
      dummy.updateMatrix();
      tierInst.setMatrixAt(wIdx, dummy.matrix);

      if (frac < 0.5) {
        col.lerpColors(cBase, cMid, frac * 2.0);
      } else {
        col.lerpColors(cMid, cTop, (frac - 0.5) * 2.0);
      }
      col.offsetHSL(treeHue, 0, 0);
      // Multiplicative linear brightness variation keeps deep pine base shadows rich (never black-clipped)
      col.multiplyScalar(1.0 + (treeLit + (seeded(i, t + 11) - 0.5) * 0.025) * 4.2);
      tierInst.setColorAt(wIdx, col);
      wIdx++;
    }

    // Contact AO disc only on gentle terrain (steep mountain flanks rely on real shadows; fade before outer cloud sea)
    const allowConiferAO = tr.isOuter ? tr.slope <= 0.14 && (tr.dOut ?? 0) <= 178 : tr.slope <= 0.20;
    if (allowConiferAO) {
      const slopeShrink = tr.slope > 0.12 ? THREE.MathUtils.lerp(1.0, 0.55, (tr.slope - 0.12) / 0.08) : 1.0;
      const outerFade = tr.isOuter ? smoothstep(178, 125, tr.dOut ?? 0) : 1.0;
      const aoRadius = 2.95 * s * slopeShrink * outerFade;
      if (aoRadius > 0.45) {
        aoEntries.push({
          x: tr.x,
          y: tr.y,
          z: tr.z,
          normal: tr.normal,
          slope: tr.slope,
          radius: aoRadius,
        });
      }
    }
  }

  grp.add(
    finalizeInstancedMesh(trunkInst, { castShadow: true, receiveShadow: true }),
    finalizeInstancedMesh(tierInst, { castShadow: true, receiveShadow: true })
  );
  return grp;
}

function buildOrnamentalShrubs({ clusters, aoEntries }) {
  const grp = new THREE.Group();
  grp.name = 'OrnamentalShrubClusters';
  if (clusters.length === 0) return grp;

  const shrubGeo = createSoftCushionGeometry(1);
  const shrubMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
  });

  // 3 merged plush blobs per ornamental shrub cluster
  const blobOffsets = [
    { x: 0.0, y: 0.44, z: 0.0, sx: 1.08, sy: 0.82, sz: 1.02 },
    { x: 0.72, y: 0.34, z: 0.28, sx: 0.78, sy: 0.64, sz: 0.76 },
    { x: -0.64, y: 0.32, z: -0.24, sx: 0.74, sy: 0.60, sz: 0.72 },
  ];

  const palette = [
    new THREE.Color('#15351B'), // Deep shaded forest shrub
    new THREE.Color('#1E4A23'), // Rich healthy boxwood-holly
    new THREE.Color('#2B612A'), // Natural mid chlorophyll emerald
    new THREE.Color('#3D7630'), // Sunlit park shrub foliage
    new THREE.Color('#528A38'), // Warm sunlit olive-emerald accent
  ];

  const inst = new THREE.InstancedMesh(shrubGeo, shrubMat, clusters.length * blobOffsets.length);
  inst.name = 'OrnamentalShrubBlobs';
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  let idx = 0;
  for (let i = 0; i < clusters.length; i++) {
    const cl = clusters[i];
    const s = cl.scale;
    const cosR = Math.cos(cl.rot);
    const sinR = Math.sin(cl.rot);
    const embed = cl.slope > 0.08 ? 0.16 : 0.08;

    for (let b = 0; b < blobOffsets.length; b++) {
      const bo = blobOffsets[b];
      const lx = bo.x * s;
      const lz = bo.z * s;
      const wx = cl.x + lx * cosR - lz * sinR;
      const wz = cl.z + lx * sinR + lz * cosR;
      const localY = sampleGroundElevation(wx, wz);

      dummy.position.set(wx, localY + bo.y * s - embed, wz);
      dummy.rotation.set(0, cl.rot + b * 1.4, 0);
      dummy.scale.set(bo.sx * s, bo.sy * s, bo.sz * s);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);

      const baseCol = palette[cl.toneIdx ?? (i + b) % 4];
      col.copy(baseCol);
      col.offsetHSL((seeded(i, b + 5) - 0.5) * 0.02, 0, 0);
      col.multiplyScalar(1.0 + (b === 0 ? 0.08 : -0.06) + (seeded(i, b + 17) - 0.5) * 0.14);
      inst.setColorAt(idx, col);
      idx++;
    }

    if (cl.slope <= 0.16) {
      aoEntries.push({
        x: cl.x,
        y: cl.y,
        z: cl.z,
        normal: cl.normal,
        slope: cl.slope,
        radius: 1.65 * s,
      });
    }
  }

  grp.add(finalizeInstancedMesh(inst, { castShadow: true, receiveShadow: true }));
  return grp;
}

function buildTrimmedHedges(hedges) {
  const grp = new THREE.Group();
  grp.name = 'TrimmedBoxwoodHedges';
  if (hedges.length === 0) return grp;

  const geo = createChamferedHedgeGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
  });

  const inst = new THREE.InstancedMesh(geo, mat, hedges.length);
  inst.name = 'TrimmedHedgeBlocks';
  const dummy = new THREE.Object3D();
  // Synced with @green-terrain QA #44 boxwood palette (#1a4220 base AO -> #2d622a crown)
  const baseCol = new THREE.Color('#2D622A');
  const col = new THREE.Color();

  for (let i = 0; i < hedges.length; i++) {
    const h = hedges[i];
    dummy.position.set(h.x, h.y - 0.05, h.z);
    dummy.rotation.set(0, h.rotY, 0);
    dummy.scale.set(h.w, h.h, h.len);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);

    col.copy(baseCol).offsetHSL((seeded(i, 31) - 0.5) * 0.015, 0, 0);
    col.multiplyScalar(1.0 + (seeded(i, 37) - 0.5) * 0.12);
    inst.setColorAt(i, col);
  }

  grp.add(finalizeInstancedMesh(inst, { castShadow: true, receiveShadow: true }));
  return grp;
}

function buildShorelineReeds(tufts) {
  const grp = new THREE.Group();
  grp.name = 'ShorelineReedTufts';
  if (tufts.length === 0) return grp;

  const blades = [];
  const plumes = [];

  for (let i = 0; i < tufts.length; i++) {
    const tf = tufts[i];
    const bladeCount = tf.count || 12;
    for (let b = 0; b < bladeCount; b++) {
      const a = (b / bladeCount) * Math.PI * 2 + seeded(i * 19 + b, 3) * 0.55;
      const r = seeded(i * 19 + b, 7) * 0.55;
      const bx = tf.x + Math.cos(a) * r;
      const bz = tf.z + Math.sin(a) * r;
      const by = sampleGroundElevation(bx, bz);
      const h = 1.05 + seeded(i * 19 + b, 11) * 0.85;
      const tilt = 0.08 + seeded(i * 19 + b, 13) * 0.16;
      const yaw = a;
      blades.push({ x: bx, y: by, z: bz, h, tilt, yaw, idx: i * 19 + b });
      if (b % 3 === 0) {
        plumes.push({ x: bx, y: by, z: bz, h, tilt, yaw });
      }
    }
  }

  const bladeGeo = new THREE.CylinderGeometry(0.018, 0.044, 1.0, 5);
  bladeGeo.translate(0, 0.5, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.84,
    metalness: 0.0,
  });

  const plumeGeo = new THREE.SphereGeometry(0.068, 6, 5);
  plumeGeo.scale(0.85, 2.5, 0.85);
  const plumeMat = new THREE.MeshStandardMaterial({
    color: '#B9BCA0',
    roughness: 0.86,
    metalness: 0.0,
  });

  const bladeInst = new THREE.InstancedMesh(bladeGeo, bladeMat, blades.length);
  bladeInst.name = 'ShorelineReedBlades';
  const plumeInst = new THREE.InstancedMesh(plumeGeo, plumeMat, plumes.length);
  plumeInst.name = 'ShorelineReedPlumes';

  const dummy = new THREE.Object3D();
  const euler = new THREE.Euler();
  const tipOffset = new THREE.Vector3();
  // Rich natural marsh-emerald reeds synced to deeper aerial chlorophyll palette
  const reedDark = new THREE.Color('#235224');
  const reedLight = new THREE.Color('#568B3C');
  const col = new THREE.Color();

  for (let i = 0; i < blades.length; i++) {
    const bl = blades[i];
    dummy.position.set(bl.x, bl.y - 0.06, bl.z);
    dummy.rotation.set(0, -bl.yaw, -bl.tilt);
    dummy.scale.set(1, bl.h, 1);
    dummy.updateMatrix();
    bladeInst.setMatrixAt(i, dummy.matrix);

    col.lerpColors(reedDark, reedLight, seeded(bl.idx, 23));
    bladeInst.setColorAt(i, col);
  }

  for (let i = 0; i < plumes.length; i++) {
    const pl = plumes[i];
    euler.set(0, -pl.yaw, -pl.tilt);
    tipOffset.set(0, pl.h + 0.06, 0).applyEuler(euler);
    dummy.position.set(pl.x + tipOffset.x, pl.y - 0.06 + tipOffset.y, pl.z + tipOffset.z);
    dummy.rotation.copy(euler);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    plumeInst.setMatrixAt(i, dummy.matrix);
  }

  grp.add(
    finalizeInstancedMesh(bladeInst, { castShadow: false, receiveShadow: true }),
    finalizeInstancedMesh(plumeInst, { castShadow: false, receiveShadow: false })
  );
  return grp;
}

function buildContactAODiscs(aoEntries) {
  if (aoEntries.length === 0) return null;

  const aoTex = createContactAOTexture();
  const aoGeo = new THREE.PlaneGeometry(2, 2);
  aoGeo.rotateX(-Math.PI / 2);

  // Deepened lush forest-shadow Contact AO discs matching crisp aerial sunlight (QA #44)
  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    color: '#0E1C10',
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const aoInst = new THREE.InstancedMesh(aoGeo, aoMat, aoEntries.length);
  aoInst.name = 'VegetationContactAO';
  aoInst.renderOrder = -2;

  const dummy = new THREE.Object3D();
  const quat = new THREE.Quaternion();

  for (let i = 0; i < aoEntries.length; i++) {
    const e = aoEntries[i];
    quat.setFromUnitVectors(UP_VEC, e.normal);
    // Lift gently along terrain normal (+0.022m on flat ground, +0.042m on mild slope) to prevent Z-fighting
    const lift = e.slope > 0.08 ? 0.042 : 0.022;
    dummy.position.set(
      e.x + e.normal.x * lift,
      e.y + e.normal.y * lift,
      e.z + e.normal.z * lift
    );
    dummy.quaternion.copy(quat);
    dummy.scale.set(e.radius, 1, e.radius);
    dummy.updateMatrix();
    aoInst.setMatrixAt(i, dummy.matrix);
  }

  return finalizeInstancedMesh(aoInst, { castShadow: false, receiveShadow: false });
}

// ---------------------------------------------------------------------------
// Main Export: buildVegetationSystem()
// ---------------------------------------------------------------------------
export function buildVegetationSystem() {
  const root = new THREE.Group();
  root.name = 'VegetationSystem';

  const {
    roads,
    extendedRoads,
    isBlockedForTree,
    isBlockedForOuterTree,
    isBlockedForShrub,
    isBlockedForReed,
  } = buildSpatialClearanceContext();

  // Shared materials harmonized with deepened matte-velvet aerial chlorophyll palette (QA #44)
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4F3B2B', roughness: 0.90, metalness: 0.0 });
  const branchMat = new THREE.MeshStandardMaterial({ color: '#5C4534', roughness: 0.90, metalness: 0.0 });
  const coniferTrunkMat = new THREE.MeshStandardMaterial({ color: '#423023', roughness: 0.91, metalness: 0.0 });
  const stonePitMat = new THREE.MeshStandardMaterial({ color: '#B4AFA4', roughness: 0.72, metalness: 0.02 });
  const mulchMat = new THREE.MeshStandardMaterial({ color: '#2D2720', roughness: 0.95, metalness: 0.0 });

  const broadleafTrees = [];
  const conifers = [];
  const placedTreePositions = [];
  const shrubClusters = [];
  const trimmedHedges = [];
  const shorelineReedTufts = [];
  const aoEntries = [];

  const canPlaceTreeWithSpacing = (x, z, minDist) => {
    const minSq = minDist * minDist;
    for (let i = 0; i < placedTreePositions.length; i++) {
      const p = placedTreePositions[i];
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < minSq) return false;
    }
    return true;
  };

  const tryAddBroadleaf = ({ x, z, scale, rot, species, hasPit = false, pitRotY = 0, minSpacing = 5.6 }) => {
    if (isBlockedForTree(x, z, { hasPit })) return false;
    if (!canPlaceTreeWithSpacing(x, z, minSpacing)) return false;
    const { y, slope, normal } = sampleTerrainInfo(x, z);
    // V4: stone pit collars strictly on flat terrain
    const finalPit = hasPit && y < 0.05 && slope < 0.05;
    broadleafTrees.push({ x, z, y, slope, normal, scale, rot, species, hasPit: finalPit, pitRotY });
    placedTreePositions.push({ x, z });
    return true;
  };

  const tryAddConifer = ({ x, z, scale, rot, minSpacing = 5.8 }) => {
    if (isBlockedForTree(x, z, { hasPit: false })) return false;
    if (!canPlaceTreeWithSpacing(x, z, minSpacing)) return false;
    const { y, slope, normal } = sampleTerrainInfo(x, z);
    conifers.push({ x, z, y, slope, normal, scale, rot });
    placedTreePositions.push({ x, z });
    return true;
  };

  const tryAddOuterBroadleaf = ({ x, z, scale, rot, species, minSpacing = 7.2, allowBorderBridge = false }) => {
    if (isBlockedForOuterTree(x, z, { allowBorderBridge })) return false;
    if (!canPlaceTreeWithSpacing(x, z, minSpacing)) return false;
    const dOut = signedDistOutsideCampus(x, z);
    const { y, slope, normal } = sampleTerrainInfo(x, z);
    broadleafTrees.push({
      x,
      z,
      y,
      slope,
      normal,
      scale,
      rot,
      species,
      hasPit: false,
      pitRotY: 0,
      isOuter: true,
      dOut,
    });
    placedTreePositions.push({ x, z });
    return true;
  };

  const tryAddOuterConifer = ({ x, z, scale, rot, minSpacing = 7.0, allowBorderBridge = false }) => {
    if (isBlockedForOuterTree(x, z, { allowBorderBridge })) return false;
    if (!canPlaceTreeWithSpacing(x, z, minSpacing)) return false;
    const dOut = signedDistOutsideCampus(x, z);
    const { y, slope, normal } = sampleTerrainInfo(x, z);
    conifers.push({ x, z, y, slope, normal, scale, rot, isOuter: true, dOut });
    placedTreePositions.push({ x, z });
    return true;
  };

  // -------------------------------------------------------------------------
  // 1. Formal Street Boulevards & Ceremonial Welcome Allée (Chamfered Stone Pits)
  // -------------------------------------------------------------------------

  // 1a. North Welcome Ceremonial Allée (6 vibrant sunlit Spring-Lime focal specimens framing Twin Mirror Pools)
  // V1 fix: z=-110 shifted north to z=-117 (9.1m clear of FireRing)
  for (const side of [-1, 1]) {
    const zs = [-136.0, -126.5, -117.0];
    for (let i = 0; i < zs.length; i++) {
      tryAddBroadleaf({
        x: 26 + side * 27.5,
        z: zs[i],
        scale: 1.14,
        rot: side * 0.9 + i * 1.3,
        species: 'springLime',
        hasPit: true,
        pitRotY: 0,
        minSpacing: 5.0,
      });
    }
  }

  // 1b. Zhongguancun Avenue East Boulevard (offset cleanly east of curb & streetlights)
  const zgcRoad = roads[0];
  const zgcLen = zgcRoad.curve.getLength();
  const zgcCount = 17;
  for (let i = 0; i < zgcCount; i++) {
    const u = 0.05 + (i / (zgcCount - 1)) * 0.90;
    const pt = zgcRoad.curve.getPointAt(u);
    const tan = zgcRoad.curve.getTangentAt(u).normalize();
    // Curve runs N -> S (+Z), so east side is (+tan.z, -tan.x) -> wait: (-tan.z, tan.x) points West, (+tan.z, -tan.x) points East
    const eastX = tan.z;
    const eastZ = -tan.x;
    const offset = zgcRoad.halfW + zgcRoad.curbW + 3.4;
    const x = pt.x + eastX * offset;
    const z = pt.z + eastZ * offset;
    const pitRotY = Math.atan2(tan.x, tan.z);
    tryAddBroadleaf({
      x,
      z,
      scale: 1.04 + seeded(i, 3) * 0.16,
      rot: seeded(i, 5) * Math.PI * 2,
      species: i % 3 === 1 ? 'moss' : 'camphor',
      hasPit: true,
      pitRotY,
      minSpacing: 7.5,
    });
  }

  // 1c. Pingling West Road South Boulevard (offset cleanly south of curb & streetlights)
  const pinglingRoad = roads[1];
  const pingCount = 17;
  for (let i = 0; i < pingCount; i++) {
    const u = 0.10 + (i / (pingCount - 1)) * 0.78;
    const pt = pinglingRoad.curve.getPointAt(u);
    const tan = pinglingRoad.curve.getTangentAt(u).normalize();
    // Curve runs W -> E (+X, -Z), so south side is (-tan.z, +tan.x)
    const southX = -tan.z;
    const southZ = tan.x;
    const offset = pinglingRoad.halfW + pinglingRoad.curbW + 3.3;
    const x = pt.x + southX * offset;
    const z = pt.z + southZ * offset;
    const pitRotY = Math.atan2(tan.x, tan.z);
    const isNearWelcome = Math.abs(x - 26) < 48;
    const species = isNearWelcome && i % 2 === 0 ? 'springLime' : i % 3 === 0 ? 'moss' : 'camphor';
    tryAddBroadleaf({
      x,
      z,
      scale: 1.02 + seeded(i, 13) * 0.18,
      rot: seeded(i, 17) * Math.PI * 2,
      species,
      hasPit: true,
      pitRotY,
      minSpacing: 7.5,
    });
  }

  // 1d. Yongping Avenue North Boulevard (curated street trees framing SW approach)
  const yongpingRoad = roads[2];
  for (let i = 0; i < 7; i++) {
    const u = 0.22 + (i / 6) * 0.68;
    const pt = yongpingRoad.curve.getPointAt(u);
    const tan = yongpingRoad.curve.getTangentAt(u).normalize();
    // Curve runs NW -> SE (+X, +Z), so north side is (+tan.z, -tan.x)
    const northX = tan.z;
    const northZ = -tan.x;
    const offset = yongpingRoad.halfW + yongpingRoad.curbW + 3.4;
    const x = pt.x + northX * offset;
    const z = pt.z + northZ * offset;
    const pitRotY = Math.atan2(tan.x, tan.z);
    tryAddBroadleaf({
      x,
      z,
      scale: 1.02 + seeded(i, 21) * 0.16,
      rot: seeded(i, 23) * Math.PI * 2,
      species: i % 2 === 0 ? 'camphor' : 'moss',
      hasPit: true,
      pitRotY,
      minSpacing: 7.5,
    });
  }

  // -------------------------------------------------------------------------
  // 2. Curated Lakeside & Park Focal Specimen Trees (Sunlit Spring-Lime & Emerald Accents)
  // -------------------------------------------------------------------------
  const curatedSpecimens = [
    // Lakeside South & Southeast promenade sunlit spring-lime focal accents
    { x: -34, z: 162, species: 'springLime', scale: 1.18 },
    { x: 18, z: 173, species: 'springLime', scale: 1.22 },
    { x: 76, z: 162, species: 'springLime', scale: 1.16 },
    { x: 128, z: 128, species: 'springLime', scale: 1.20 },
    // East pavilion & canal approach focal accents
    { x: 132, z: -118, species: 'springLime', scale: 1.15 },
    { x: 146, z: -54, species: 'springLime', scale: 1.18 },
    { x: 162, z: 22, species: 'springLime', scale: 1.12 },
    // SW Arch Bridge & Hyperbolic Pavilion framing accents
    { x: -162, z: 136, species: 'springLime', scale: 1.14 },
    { x: -96, z: 148, species: 'springLime', scale: 1.12 },
    // Northwest park entrance accent
    { x: -82, z: -118, species: 'springLime', scale: 1.14 },
    { x: -166, z: -102, species: 'springLime', scale: 1.10 },
  ];
  for (let i = 0; i < curatedSpecimens.length; i++) {
    const sp = curatedSpecimens[i];
    tryAddBroadleaf({
      x: sp.x,
      z: sp.z,
      scale: sp.scale,
      rot: seeded(i, 41) * Math.PI * 2,
      species: sp.species,
      hasPit: false,
      minSpacing: 6.2,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Organic Campus Park & Lakeside Broadleaf Groves
  //    Lush healthy emerald mix: deep woodland + rich camphor + vibrant moss + sunlit spring-lime highlights
  // -------------------------------------------------------------------------
  const organicZones = [
    // Northwest park lawn (between Pingling, FireRing, and W3/W4/W5)
    { xMin: -186, xMax: -14, zMin: -136, zMax: -62, attempts: 72, target: 32, limeRatio: 0.14, spacing: 6.4 },
    // West flank lawn (between Zhongguancun Ave, WalkwayNW, and W1/West Parking)
    { xMin: -196, xMax: -152, zMin: -62, zMax: 92, attempts: 48, target: 16, limeRatio: 0.12, spacing: 6.8 },
    // Northeast park & east canal shore (between NE Parking, East Canal, and Longpan toe)
    { xMin: 108, xMax: 168, zMin: -158, zMax: -36, attempts: 64, target: 24, limeRatio: 0.15, spacing: 6.4 },
    // Southwest park & SW Hill framing belt (between Yongping, Bridge, SW Hill, and Hyperbolic Pavilion)
    { xMin: -194, xMax: -54, zMin: 104, zMax: 170, attempts: 66, target: 22, limeRatio: 0.14, spacing: 6.4 },
    // South & Southeast lakeside park promenade
    { xMin: -54, xMax: 168, zMin: 84, zMax: 174, attempts: 84, target: 32, limeRatio: 0.14, spacing: 6.6 },
    // Longpan lower western foothill transition broadleaves (softening pine mountain base)
    { xMin: 166, xMax: 184, zMin: -146, zMax: 146, attempts: 40, target: 14, limeRatio: 0.18, spacing: 7.4 },
  ];

  let seedCounter = 200;
  for (let zIdx = 0; zIdx < organicZones.length; zIdx++) {
    const zone = organicZones[zIdx];
    let added = 0;
    for (let a = 0; a < zone.attempts && added < zone.target; a++) {
      seedCounter++;
      const x = zone.xMin + seeded(seedCounter, 7) * (zone.xMax - zone.xMin);
      const z = zone.zMin + seeded(seedCounter, 13) * (zone.zMax - zone.zMin);
      const rRoll = seeded(seedCounter, 29);
      const species =
        rRoll < zone.limeRatio
          ? 'springLime'
          : rRoll < zone.limeRatio + 0.34
            ? 'moss'
            : rRoll < zone.limeRatio + 0.72
              ? 'camphor'
              : 'deepWood';
      const ok = tryAddBroadleaf({
        x,
        z,
        scale: 0.94 + seeded(seedCounter, 19) * 0.36,
        rot: seeded(seedCounter, 23) * Math.PI * 2,
        species,
        hasPit: false,
        minSpacing: zone.spacing,
      });
      if (ok) added++;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Sculpted Layered Conifers (Longpan Mountain Forest + SW Park & Waterfront Accents)
  // -------------------------------------------------------------------------

  // 4a. Longpan Mountain sculpted evergreen forest (stratified placement across N, Central, S peaks)
  let mountainAdded = 0;
  for (let k = 0; k < 165 && mountainAdded < 74; k++) {
    seedCounter++;
    const x = 169 + seeded(seedCounter, 31) * 65;
    const z = -158 + seeded(seedCounter, 41) * 316;
    const ok = tryAddConifer({
      x,
      z,
      scale: 0.96 + seeded(seedCounter, 47) * 0.50,
      rot: seeded(seedCounter, 53) * Math.PI * 2,
      minSpacing: 6.4,
    });
    if (ok) mountainAdded++;
  }

  // 4b. SW Park perimeter conifers framing the relocated SW Spiral Hill (-126, 133, r=21.5)
  const swRingAngles = [-2.55, -2.05, -1.52, -0.75, -0.22, 0.35, 0.95, 1.55, 2.15, 2.75];
  for (let i = 0; i < swRingAngles.length; i++) {
    const a = swRingAngles[i];
    const r = 24.0 + seeded(i, 61) * 6.5;
    const x = SW_HILL.cx + Math.cos(a) * r;
    const z = SW_HILL.cz + Math.sin(a) * r;
    tryAddConifer({
      x,
      z,
      scale: 0.92 + seeded(i, 67) * 0.36,
      rot: seeded(i, 71) * Math.PI * 2,
      minSpacing: 5.8,
    });
  }

  // 4c. Waterfront & North-East park backdrop accent conifers
  const accentConiferCoords = [
    [152, -138], [160, -118], [162, -96], [165, -48], [164, 52], [154, 108],
    [118, 144], [62, 166], [-48, 164], [-182, 124], [-192, -124], [-138, -142],
  ];
  for (let i = 0; i < accentConiferCoords.length; i++) {
    const [cx, cz] = accentConiferCoords[i];
    tryAddConifer({
      x: cx,
      z: cz,
      scale: 0.96 + seeded(i, 79) * 0.34,
      rot: seeded(i, 83) * Math.PI * 2,
      minSpacing: 5.8,
    });
  }

  // -------------------------------------------------------------------------
  // 5. Plush Ornamental Shrub Clusters (framing entries, plazas, pavilions, hill toe & groves)
  // -------------------------------------------------------------------------
  const tryAddShrub = (x, z, scale, rot, toneIdx) => {
    if (isBlockedForShrub(x, z)) return false;
    for (let i = 0; i < shrubClusters.length; i++) {
      if (Math.hypot(x - shrubClusters[i].x, z - shrubClusters[i].z) < 2.8) return false;
    }
    const { y, slope, normal } = sampleTerrainInfo(x, z);
    if (slope > 0.24) return false;
    shrubClusters.push({ x, z, y, slope, normal, scale, rot, toneIdx });
    return true;
  };

  // 5a. Framing North Welcome Plaza & Mirror Pool outer garden borders
  const welcomeShrubPoints = [
    [-3.5, -100], [-3.5, -92], [-3.5, -85],
    [55.5, -100], [55.5, -92], [55.5, -85],
    [-4.5, -132], [-4.5, -122],
    [56.5, -132], [56.5, -122],
  ];
  for (let i = 0; i < welcomeShrubPoints.length; i++) {
    const [sx, sz] = welcomeShrubPoints[i];
    tryAddShrub(sx, sz, 1.05 + seeded(i, 91) * 0.28, seeded(i, 97) * 6.28, i % 4);
  }

  // 5b. Framing SW Spiral Hill outer base ring (r = 22.8..25.0m, crisp diorama skirt)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.18;
    const r = 23.0 + seeded(i, 101) * 2.2;
    const sx = SW_HILL.cx + Math.cos(a) * r;
    const sz = SW_HILL.cz + Math.sin(a) * r;
    tryAddShrub(sx, sz, 0.92 + seeded(i, 103) * 0.36, a, i % 5 === 0 ? 4 : i % 4);
  }

  // 5c. Framing Hyperbolic Pavilion (-78, 154) & East Pavilion (146, -24) garden pockets
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    tryAddShrub(
      HYPERBOLIC_PAVILION.cx + Math.cos(a) * 14.5,
      HYPERBOLIC_PAVILION.cz + Math.sin(a) * 14.5,
      0.95 + seeded(i, 107) * 0.3,
      a,
      i % 4
    );
    tryAddShrub(
      EAST_PAVILION.cx + Math.cos(a) * 16.5,
      EAST_PAVILION.cz + Math.sin(a) * 16.5,
      1.0 + seeded(i, 109) * 0.32,
      a,
      i % 4 === 3 ? 4 : i % 3
    );
  }

  // 5d. Companion ornamental shrubs tucked naturally near inner campus park broadleaf groves
  for (let i = 0; i < broadleafTrees.length; i += 2) {
    const tr = broadleafTrees[i];
    if (tr.isOuter || tr.hasPit || tr.slope > 0.14) continue;
    const a = seeded(i, 113) * Math.PI * 2;
    const dist = 2.4 + seeded(i, 127) * 1.6;
    const sx = tr.x + Math.cos(a) * dist;
    const sz = tr.z + Math.sin(a) * dist;
    tryAddShrub(
      sx,
      sz,
      0.86 + seeded(i, 131) * 0.38,
      seeded(i, 137) * 6.28,
      tr.species === 'springLime' ? 4 : i % 4
    );
  }

  // -------------------------------------------------------------------------
  // 5e. Dense Interlocking Outer Woodland Belt & Continuous Cloud-Horizon Forest Curtain
  //     Reuses the EXACT same 12 InstancedMesh buffers (0 extra draw calls!)
  //     Spans perimeter bridging + dense multi-tree forest clusters + 2-row hedgerow bands
  //     + continuous 360° outer forest curtain receding INTO the clouds (d_out ∈ [12m, 294m])
  //     while keeping >= halfW + 6.5m clear of all 3 extended municipal arterial roads!
  // -------------------------------------------------------------------------
  let outerSeed = 9000;
  const pickOuterBroadleafSpecies = (seedVal, brightBias = 0.0) => {
    const r = seeded(seedVal, 173);
    if (r < 0.05 + brightBias) return 'springLime';
    if (r < 0.24 + brightBias) return 'moss';
    if (r < 0.56) return 'camphor';
    return 'deepWood';
  };

  // Clamp outer tree height softly on high East foothills & deep outer cloud edge so crowns
  // nestle gracefully underneath the upper volumetric cloud veil without sharp spikes.
  const clampOuterScale = (x, z, rawScale, dOut) => {
    const h = sampleTotalElevation(x, z);
    const hillDamp = h > 7.5 ? THREE.MathUtils.lerp(1.0, 0.80, smoothstep(7.5, 16.5, h)) : 1.0;
    const mistDamp = dOut > 230 ? THREE.MathUtils.lerp(1.0, 0.84, smoothstep(230, 294, dOut)) : 1.0;
    return rawScale * hillDamp * mistDamp;
  };

  // Approximate inner municipal road centerlines (strictly for selecting outer-side border-bridging pockets)
  const pinglingApproxZ = (x) => -100 + -84 * ((x + 243) / 407);
  const zgcApproxX = (z) => -208 + -16 * ((z + 184) / 368);
  const yongpingApproxZ = (x) => 114 + 70 * ((x + 243) / 149);

  // Sub-layer 1: Dense Border-Bridging Woodlands (eliminates any visible seam along the former ±243×±184 rim)
  const borderBridgeBands = [
    // 0a. North of Pingling West Road (bridging z ∈ [-198, -112] seamlessly into northern woodland)
    {
      xMin: -242,
      xMax: 158,
      zMin: -198,
      zMax: -112,
      attempts: 210,
      target: 64,
      coniferRatio: 0.30,
      spacing: 5.5,
      guard: (x, z) => z < pinglingApproxZ(x) - 16.0,
    },
    // 0b. West of Zhongguancun Avenue (bridging x ∈ [-268, -225] seamlessly into western woodland)
    {
      xMin: -268,
      xMax: -225,
      zMin: -190,
      zMax: 190,
      attempts: 130,
      target: 36,
      coniferRatio: 0.28,
      spacing: 5.6,
      guard: (x, z) => x < zgcApproxX(z) - 16.0,
    },
    // 0c. Southwest of Yongping Avenue (bridging SW corner seamlessly into SW woodland)
    {
      xMin: -248,
      xMax: -90,
      zMin: 122,
      zMax: 206,
      attempts: 115,
      target: 28,
      coniferRatio: 0.26,
      spacing: 5.5,
      guard: (x, z) => z > yongpingApproxZ(x) + 16.0,
    },
    // 0d. East Longpan Seamless Transition (fusing Longpan Mountain into East Longpan Foothills)
    {
      xMin: 228,
      xMax: 274,
      zMin: -188,
      zMax: 188,
      attempts: 165,
      target: 48,
      coniferRatio: 0.64,
      spacing: 5.4,
      guard: () => true,
    },
    // 0e. South & Southeast Lakeside Outer Skirt (strictly outside WalkwayMain & south park edge)
    {
      xMin: -94,
      xMax: 248,
      zMin: 175,
      zMax: 208,
      attempts: 135,
      target: 34,
      coniferRatio: 0.30,
      spacing: 5.8,
      guard: (x, z) => signedDistOutsideCampus(x, z) >= -8.0,
    },
  ];

  for (let bIdx = 0; bIdx < borderBridgeBands.length; bIdx++) {
    const band = borderBridgeBands[bIdx];
    let added = 0;
    for (let a = 0; a < band.attempts && added < band.target; a++) {
      outerSeed++;
      const x = band.xMin + seeded(outerSeed, 11) * (band.xMax - band.xMin);
      const z = band.zMin + seeded(outerSeed, 17) * (band.zMax - band.zMin);
      if (!band.guard(x, z)) continue;
      // Organic clumping wave so border trees form rich interlocking copses rather than uniform stripes
      const clump =
        Math.sin(x * 0.032 + z * 0.024) * 0.5 + Math.cos(x * 0.019 - z * 0.036) * 0.5;
      if (clump < -0.42 && seeded(outerSeed, 23) > 0.32) continue;

      const dOut = signedDistOutsideCampus(x, z);
      const scale = clampOuterScale(x, z, 1.12 + seeded(outerSeed, 29) * 0.48, dOut);
      const rot = seeded(outerSeed, 31) * Math.PI * 2;
      const isConifer = seeded(outerSeed, 37) < band.coniferRatio;
      const ok = isConifer
        ? tryAddOuterConifer({ x, z, scale, rot, minSpacing: band.spacing, allowBorderBridge: true })
        : tryAddOuterBroadleaf({
            x,
            z,
            scale,
            rot,
            species: pickOuterBroadleafSpecies(outerSeed, 0.01),
            minSpacing: band.spacing,
            allowBorderBridge: true,
          });
      if (ok) added++;
    }
  }

  // Sub-layer 2: 28 Dense Interlocking Countryside Woodland Groves (d_out ∈ [12m, 225m])
  // Tighter intra-grove spacing (4.8–5.4m) + mature canopies (1.18–1.74) overlap crowns into
  // plush continuous forest masses framing lush emerald countryside clearings (matching reference!)
  const outerWoodlandGroves = [
    // East & Northeast Longpan Foothill Pine-Mixed Forest Ridges
    { cx: 298, cz: -145, rx: 56, rz: 46, rot: 0.2, target: 26, coniferRatio: 0.60, sMin: 1.18, sMax: 1.66 },
    { cx: 374, cz: -120, rx: 64, rz: 54, rot: -0.3, target: 24, coniferRatio: 0.64, sMin: 1.20, sMax: 1.70 },
    { cx: 318, cz: -32, rx: 60, rz: 56, rot: 0.15, target: 28, coniferRatio: 0.60, sMin: 1.18, sMax: 1.68 },
    { cx: 412, cz: -22, rx: 64, rz: 58, rot: 0.4, target: 22, coniferRatio: 0.66, sMin: 1.18, sMax: 1.66 },
    { cx: 304, cz: 78, rx: 58, rz: 54, rot: -0.25, target: 28, coniferRatio: 0.58, sMin: 1.18, sMax: 1.68 },
    { cx: 400, cz: 94, rx: 62, rz: 56, rot: 0.3, target: 22, coniferRatio: 0.64, sMin: 1.18, sMax: 1.64 },
    { cx: 292, cz: 198, rx: 58, rz: 50, rot: 0.45, target: 24, coniferRatio: 0.48, sMin: 1.18, sMax: 1.66 },
    { cx: 372, cz: 218, rx: 58, rz: 52, rot: -0.2, target: 20, coniferRatio: 0.54, sMin: 1.16, sMax: 1.60 },
    // North & Northwest Countryside Groves
    { cx: 195, cz: -248, rx: 62, rz: 46, rot: -0.18, target: 24, coniferRatio: 0.44, sMin: 1.18, sMax: 1.66 },
    { cx: 302, cz: -282, rx: 62, rz: 52, rot: 0.25, target: 20, coniferRatio: 0.52, sMin: 1.16, sMax: 1.62 },
    { cx: 68, cz: -258, rx: 68, rz: 48, rot: -0.15, target: 26, coniferRatio: 0.34, sMin: 1.18, sMax: 1.68 },
    { cx: 128, cz: -358, rx: 72, rz: 50, rot: 0.2, target: 20, coniferRatio: 0.38, sMin: 1.16, sMax: 1.62 },
    { cx: -68, cz: -272, rx: 72, rz: 52, rot: 0.12, target: 28, coniferRatio: 0.32, sMin: 1.20, sMax: 1.68 },
    { cx: -112, cz: -366, rx: 66, rz: 48, rot: -0.22, target: 18, coniferRatio: 0.36, sMin: 1.16, sMax: 1.60 },
    { cx: -310, cz: -260, rx: 64, rz: 56, rot: 0.35, target: 24, coniferRatio: 0.36, sMin: 1.18, sMax: 1.66 },
    // West & Southwest Countryside Groves
    { cx: -318, cz: -150, rx: 58, rz: 50, rot: -0.2, target: 24, coniferRatio: 0.30, sMin: 1.18, sMax: 1.66 },
    { cx: -412, cz: -146, rx: 58, rz: 52, rot: 0.15, target: 20, coniferRatio: 0.34, sMin: 1.16, sMax: 1.62 },
    { cx: -316, cz: -20, rx: 60, rz: 56, rot: 0.22, target: 26, coniferRatio: 0.28, sMin: 1.20, sMax: 1.68 },
    { cx: -416, cz: -4, rx: 60, rz: 54, rot: -0.28, target: 20, coniferRatio: 0.32, sMin: 1.16, sMax: 1.62 },
    { cx: -312, cz: 150, rx: 60, rz: 52, rot: -0.35, target: 24, coniferRatio: 0.28, sMin: 1.18, sMax: 1.66 },
    { cx: -406, cz: 186, rx: 60, rz: 52, rot: 0.25, target: 20, coniferRatio: 0.30, sMin: 1.16, sMax: 1.60 },
    { cx: -308, cz: 274, rx: 62, rz: 52, rot: 0.4, target: 22, coniferRatio: 0.32, sMin: 1.16, sMax: 1.62 },
    // South & Southeast Countryside Groves (prominent foreground forest belts framing emerald meadows)
    { cx: -148, cz: 258, rx: 62, rz: 48, rot: -0.18, target: 24, coniferRatio: 0.26, sMin: 1.18, sMax: 1.68 },
    { cx: -146, cz: 358, rx: 64, rz: 48, rot: 0.2, target: 18, coniferRatio: 0.30, sMin: 1.16, sMax: 1.60 },
    { cx: -10, cz: 280, rx: 68, rz: 50, rot: 0.14, target: 26, coniferRatio: 0.26, sMin: 1.20, sMax: 1.68 },
    { cx: 26, cz: 374, rx: 66, rz: 48, rot: -0.15, target: 18, coniferRatio: 0.30, sMin: 1.16, sMax: 1.60 },
    { cx: 150, cz: 248, rx: 60, rz: 48, rot: -0.3, target: 24, coniferRatio: 0.34, sMin: 1.18, sMax: 1.66 },
    { cx: 196, cz: 352, rx: 62, rz: 50, rot: 0.22, target: 20, coniferRatio: 0.36, sMin: 1.16, sMax: 1.60 },
  ];

  for (let gIdx = 0; gIdx < outerWoodlandGroves.length; gIdx++) {
    const g = outerWoodlandGroves[gIdx];
    const cosG = Math.cos(g.rot);
    const sinG = Math.sin(g.rot);
    let added = 0;
    const maxAttempts = g.target * 4;

    for (let a = 0; a < maxAttempts && added < g.target; a++) {
      outerSeed++;
      // Center-weighted distribution creates dense interlocking forest cores with natural feathered edges
      const radial = Math.pow(seeded(outerSeed, 41), 0.74);
      const theta = seeded(outerSeed, 43) * Math.PI * 2;
      const lx = Math.cos(theta) * g.rx * radial;
      const lz = Math.sin(theta) * g.rz * radial;
      const x = g.cx + lx * cosG - lz * sinG;
      const z = g.cz + lx * sinG + lz * cosG;

      const dOut = signedDistOutsideCampus(x, z);
      if (dOut < 10.0 || dOut > 292.0) continue;

      const scale = clampOuterScale(x, z, g.sMin + seeded(outerSeed, 53) * (g.sMax - g.sMin), dOut);
      const rot = seeded(outerSeed, 59) * Math.PI * 2;
      const isConifer = seeded(outerSeed, 61) < g.coniferRatio;
      const spacing = 4.9 + (radial > 0.78 ? 0.8 : 0.0);

      const ok = isConifer
        ? tryAddOuterConifer({ x, z, scale, rot, minSpacing: spacing })
        : tryAddOuterBroadleaf({
            x,
            z,
            scale,
            rot,
            species: pickOuterBroadleafSpecies(outerSeed, radial > 0.75 ? 0.03 : -0.02),
            minSpacing: spacing,
          });
      if (ok) added++;
    }
  }

  // Sub-layer 3: Continuous 360° Cloud-Horizon Forest Curtain (d_out ∈ [155m, 294m])
  // Eliminates any bare grass ring before the cloud sea: dense undulating forest bands recede
  // directly INTO the drifting perimeter clouds, softening gently only past d_out > 250m.
  const hwCurtain = PLINTH_CONFIG.width * 0.5; // 243
  const hdCurtain = PLINTH_CONFIG.depth * 0.5; // 184
  const curtainBandSamples = 1800;
  let curtainAdded = 0;
  const curtainTarget = 420;

  for (let c = 0; c < curtainBandSamples && curtainAdded < curtainTarget; c++) {
    outerSeed++;
    // Golden-angle quasi-random azimuth ensures 100% uniform 360° coverage across N/NE/E/SE/S/SW/W/NW
    const angle = ((c * 2.399963229728653) % (Math.PI * 2)) + (seeded(outerSeed, 111) - 0.5) * 0.08;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    // Project point onto campus superellipse rim then march outward by dBand ∈ [152m, 294m]
    const rimDist = 1.0 / Math.hypot(cosA / hwCurtain, sinA / hdCurtain);
    const waveEdge = 18.0 * Math.sin(angle * 7.0 + 0.6) + 12.0 * Math.cos(angle * 11.0 - 0.4);
    const dBand = 152.0 + waveEdge + Math.pow(seeded(outerSeed, 113), 0.88) * 142.0;
    const rTotal = rimDist + dBand;
    const x = cosA * rTotal;
    const z = sinA * rTotal;

    const dOut = signedDistOutsideCampus(x, z);
    if (dOut < 145.0 || dOut > 294.0) continue;

    // Natural undulating forest mass modulation (keeps lush clustered continuity while avoiding artificial uniform grid)
    const canopyWave =
      Math.sin(x * 0.017 + z * 0.013) * 0.45 +
      Math.cos(x * 0.012 - z * 0.021) * 0.35 +
      Math.sin((x + z) * 0.029) * 0.20;
    if (canopyWave < -0.48 && seeded(outerSeed, 117) > 0.25) continue;

    // Taper smoothly only past d_out > 248m underneath the densest cloud sea
    if (dOut > 248.0) {
      const keepProb = THREE.MathUtils.lerp(1.0, 0.28, smoothstep(248, 294, dOut));
      if (seeded(outerSeed, 119) > keepProb) continue;
    }

    const isEastSide = x > 210;
    const coniferRatio = isEastSide ? 0.58 : 0.36;
    const scale = clampOuterScale(x, z, 1.24 + seeded(outerSeed, 123) * 0.56, dOut);
    const rot = seeded(outerSeed, 127) * Math.PI * 2;
    const spacing = dOut > 255 ? 6.4 : 5.2;

    const ok =
      seeded(outerSeed, 131) < coniferRatio
        ? tryAddOuterConifer({ x, z, scale, rot, minSpacing: spacing })
        : tryAddOuterBroadleaf({
            x,
            z,
            scale,
            rot,
            species: pickOuterBroadleafSpecies(outerSeed, -0.02),
            minSpacing: spacing,
          });
    if (ok) curtainAdded++;
  }

  // Sub-layer 4: Continuous 2-Row Countryside Hedgerow Treeline Bands & Arterial Woodland Fringes
  // Overlapping twin-row treelines inspired directly by the lush field hedgerows in the reference image
  const countrysideHedgerows = [
    // South & SE field hedgerows
    { x1: -124, z1: 214, x2: 32, z2: 246, steps: 14 },
    { x1: 38, z1: 212, x2: 224, z2: 312, steps: 15 },
    { x1: 184, z1: 212, x2: 358, z2: 278, steps: 13 },
    { x1: -215, z1: 298, x2: -42, z2: 336, steps: 12 },
    // West & SW field hedgerows
    { x1: -282, z1: 42, x2: -462, z2: 128, steps: 14 },
    { x1: -274, z1: -88, x2: -468, z2: -54, steps: 13 },
    { x1: -286, z1: 202, x2: -178, z2: 378, steps: 13 },
    // North & NE field hedgerows
    { x1: -176, z1: -218, x2: -18, z2: -348, steps: 14 },
    { x1: 42, z1: -212, x2: 226, z2: -342, steps: 14 },
    { x1: -328, z1: -194, x2: -454, z2: -282, steps: 11 },
  ];

  for (let hIdx = 0; hIdx < countrysideHedgerows.length; hIdx++) {
    const hr = countrysideHedgerows[hIdx];
    const dx = hr.x2 - hr.x1;
    const dz = hr.z2 - hr.z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;

    for (let s = 0; s < hr.steps; s++) {
      // Staggered twin-row hedgerow trees create lush continuous ribbons instead of isolated dots
      for (let row = 0; row < 2; row++) {
        outerSeed++;
        const t = (s + row * 0.48 + seeded(outerSeed, 67) * 0.36) / hr.steps;
        if (t > 1.0) continue;
        const lateral = (row === 0 ? -3.4 : 3.4) + (seeded(outerSeed, 71) - 0.5) * 4.6;
        const x = hr.x1 + dx * t + nx * lateral;
        const z = hr.z1 + dz * t + nz * lateral;
        const dOut = signedDistOutsideCampus(x, z);
        if (dOut < 12.0 || dOut > 268.0) continue;

        const scale = clampOuterScale(x, z, 1.08 + seeded(outerSeed, 73) * 0.44, dOut);
        const rot = seeded(outerSeed, 79) * Math.PI * 2;
        const isConifer = seeded(outerSeed, 83) < 0.24;
        if (isConifer) {
          tryAddOuterConifer({ x, z, scale, rot, minSpacing: 4.8 });
        } else {
          tryAddOuterBroadleaf({
            x,
            z,
            scale,
            rot,
            species: pickOuterBroadleafSpecies(outerSeed, 0.03),
            minSpacing: 4.8,
          });
        }
      }
    }
  }

  // Clustered roadside woodland fringes set safely back (halfW + 10.2..15.2m) along outer arterial extensions
  for (let rIdx = 0; rIdx < extendedRoads.length; rIdx++) {
    const er = extendedRoads[rIdx];
    const samples = 34;
    for (let i = 0; i < samples; i++) {
      outerSeed++;
      const u = 0.03 + (i / (samples - 1)) * 0.94;
      const pt = er.curve.getPointAt(u);
      const dOutCenter = signedDistOutsideCampus(pt.x, pt.z);
      if (dOutCenter < 12.0 || dOutCenter > 224.0) continue;
      if (seeded(outerSeed, 89) < 0.28) continue;

      const tan = er.curve.getTangentAt(u).normalize();
      const side = seeded(outerSeed, 97) < 0.5 ? 1 : -1;
      const perpX = -tan.z * side;
      const perpZ = tan.x * side;
      const offset = er.halfW + 10.4 + seeded(outerSeed, 101) * 5.2;
      const x = pt.x + perpX * offset;
      const z = pt.z + perpZ * offset;
      const dOut = signedDistOutsideCampus(x, z);
      const scale = clampOuterScale(x, z, 1.10 + seeded(outerSeed, 103) * 0.42, dOut);
      const rot = seeded(outerSeed, 107) * Math.PI * 2;
      tryAddOuterBroadleaf({
        x,
        z,
        scale,
        rot,
        species: pickOuterBroadleafSpecies(outerSeed, 0.02),
        minSpacing: 5.4,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Crisp Chamfered Trimmed Boxwood Hedges (parking & plaza perimeter screening)
  // -------------------------------------------------------------------------
  const hedgeCandidates = [
    // West Parking Lot perimeter hedges (set cleanly outside curbs & streetlights)
    { x: -120.0, z: -35.8, w: 1.2, h: 0.85, len: 26.0, rotY: Math.PI / 2 },
    { x: -120.0, z: 15.8, w: 1.2, h: 0.85, len: 26.0, rotY: Math.PI / 2 },
    { x: -98.8, z: -20.5, w: 1.15, h: 0.82, len: 14.0, rotY: 0 },
    { x: -98.8, z: 4.0, w: 1.15, h: 0.82, len: 14.0, rotY: 0 },
    // NE Parking Lot north & west screening hedges
    { x: 89.5, z: -130.6, w: 1.2, h: 0.85, len: 24.0, rotY: Math.PI / 2 },
    { x: 71.0, z: -118.0, w: 1.15, h: 0.82, len: 12.0, rotY: 0 },
    // North Welcome Plaza symmetrical lawn border hedges (clear of plazaBox [8..44] & 1BF ramp x>=49.25)
    { x: 5.4, z: -92.0, w: 1.2, h: 0.78, len: 12.0, rotY: 0 },
    { x: 46.6, z: -92.0, w: 1.2, h: 0.78, len: 12.0, rotY: 0 },
    // W1 & W3 western architectural garden hedges
    { x: -168.5, z: 54.0, w: 1.2, h: 0.80, len: 16.0, rotY: 0 },
    { x: -168.5, z: 76.0, w: 1.2, h: 0.80, len: 14.0, rotY: 0 },
    // E2 eastern lawn framing hedges (west of FireRing, outside E2 facade)
    { x: 89.5, z: -42.0, w: 1.1, h: 0.76, len: 14.0, rotY: 0 },
    { x: 89.5, z: -24.0, w: 1.1, h: 0.76, len: 12.0, rotY: 0 },
  ];

  for (let i = 0; i < hedgeCandidates.length; i++) {
    const hc = hedgeCandidates[i];
    const dx = Math.sin(hc.rotY) * (hc.len * 0.48);
    const dz = Math.cos(hc.rotY) * (hc.len * 0.48);
    // Validate center AND both endpoints against all spatial exclusions & flat ground
    const checkPts = [
      [hc.x, hc.z],
      [hc.x - dx, hc.z - dz],
      [hc.x + dx, hc.z + dz],
    ];
    let valid = true;
    for (let c = 0; c < checkPts.length; c++) {
      const [px, pz] = checkPts[c];
      const info = sampleTerrainInfo(px, pz);
      if (info.y > 0.06 || info.slope > 0.06 || isBlockedForShrub(px, pz)) {
        valid = false;
        break;
      }
    }
    if (valid) {
      trimmedHedges.push({ ...hc, y: sampleGroundElevation(hc.x, hc.z) });
    }
  }

  // -------------------------------------------------------------------------
  // 7. Delicate Inland-Shoreline Waterfront Reed Tufts (Natural Organic Park Coves Only)
  //    Indices 12..84 of LAKE_SHORELINE correspond to natural park coves (South/SW/SE/East)
  // -------------------------------------------------------------------------
  const nShore = LAKE_SHORELINE.length;
  for (let idx = 10; idx < Math.min(88, nShore - 1); idx += 4) {
    const prev = LAKE_SHORELINE[(idx - 1 + nShore) % nShore];
    const curr = LAKE_SHORELINE[idx];
    const next = LAKE_SHORELINE[(idx + 1) % nShore];
    const tx = next[0] - prev[0];
    const tz = next[1] - prev[1];
    const tLen = Math.hypot(tx, tz) || 1;
    // In XZ (+X east, +Z south), natural shore runs W->E along south & S->N along east -> landward normal is (-tz, +tx)
    const nx = -tz / tLen;
    const nz = tx / tLen;

    const bankOffset = 1.68 + seeded(idx, 149) * 0.52;
    const rx = curr[0] + nx * bankOffset;
    const rz = curr[1] + nz * bankOffset;
    if (isBlockedForReed(rx, rz)) continue;
    const info = sampleTerrainInfo(rx, rz);
    if (info.y > 0.15 || info.slope > 0.14) continue;

    shorelineReedTufts.push({
      x: rx,
      z: rz,
      count: 10 + Math.floor(seeded(idx, 151) * 6),
    });
  }

  // -------------------------------------------------------------------------
  // 8. Assemble All Instanced Subsystems into Root Group
  // -------------------------------------------------------------------------
  root.add(
    buildBroadleafCanopySystem({
      trees: broadleafTrees,
      trunkMat,
      branchMat,
      stonePitMat,
      mulchMat,
      aoEntries,
    })
  );

  root.add(
    buildSculptedConifers({
      trees: conifers,
      trunkMat: coniferTrunkMat,
      aoEntries,
    })
  );

  root.add(
    buildOrnamentalShrubs({
      clusters: shrubClusters,
      aoEntries,
    })
  );

  root.add(buildTrimmedHedges(trimmedHedges));
  root.add(buildShorelineReeds(shorelineReedTufts));

  const aoMesh = buildContactAODiscs(aoEntries);
  if (aoMesh) root.add(aoMesh);

  return root;
}
