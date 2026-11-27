import * as THREE from 'three';
import {
  BUILDING_WINGS,
  LAKE_SHORELINE,
  PLINTH_CONFIG,
  PORTAL_CANOPIES,
} from '../config/campusConfig.js';
import { sampleGroundElevation } from './TerrainAndStructures.js';

/**
 * Tactile Studio-Botanical Vegetation System (Full InstancedMesh, ~12 Draw Calls)
 *
 * Visual Direction (aligned with @art-lighting Master Palette #9):
 * - Rich matte-satin miniature botanical foliage (Deep Cypress, Olive-Sage, Sunlit Moss,
 *   Soft Lichen Highlight, and curated 12-15% Muted Autumn Amber / Golden Ginkgo focal trees)
 * - Sculpted multi-cushion broadleaf cloud canopies with baked vertical AO shading,
 *   tapered warm walnut-cedar trunks with root flare & angled lower branch forks
 * - Sculpted soft-beveled 5-tier diorama conifers (LatheGeometry + gentle 7-lobe bough relief)
 * - Chamfered warm-stone tree-pit collars + dark mulch soil beds on flat-lawn avenues/plazas,
 *   plus subtle sculpted soil mounds on park lawns
 * - Plush multi-cushion ornamental shrub clusters, chamfered trimmed boxwood hedges,
 *   delicate inland-shoreline reed tufts, and slope-aware soft radial Contact AO discs
 *
 * Spatial & Joint Integrity (fixes 100% of @joint-auditor Section 5 defects V1-V4 & Contracts):
 * - Exact spline-distance rejection against ALL 8 roads & walkways (including updated WalkwayMain)
 * - Exact sync with relocated SW Spiral Hill (-126, 133, r=21.5, summitR=7.0),
 *   relocated Hyperbolic Pavilion (-78, 154, r=12.5+), East Pavilion (146, -24), & extended East Pier
 * - Lake interior + 2.6m coping-cap buffer for trees (1.8m shrubs; 1.35-2.45m inland bank for reeds)
 * - Deep hillside trunk root embedding (0.42m on slopes), flat-only stone pits (y < 0.05),
 *   and terrain-normal-aligned / slope-attenuated Contact AO discs (zero clipping/floating)
 */

// ---------------------------------------------------------------------------
// Deterministic pseudo-random helper
// ---------------------------------------------------------------------------
function seeded(i, salt = 1) {
  const n = Math.sin(i * 91.345 + salt * 47.123) * 43758.5453123;
  return n - Math.floor(n);
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

  const isInsideAnyRoad = (x, z, extraMargin) => {
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (distToPolyline(x, z, r.pts) < r.halfW + r.curbW + extraMargin) {
        return true;
      }
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

  return { roads, isBlockedForTree, isBlockedForShrub, isBlockedForReed };
}

// ---------------------------------------------------------------------------
// Terrain Normal & Slope Sampling (for V4: slope-safe grounding & AO discs)
// ---------------------------------------------------------------------------
function sampleTerrainInfo(x, z) {
  const y = sampleGroundElevation(x, z);
  const eps = 0.85;
  const hL = sampleGroundElevation(x - eps, z);
  const hR = sampleGroundElevation(x + eps, z);
  const hD = sampleGroundElevation(x, z - eps);
  const hU = sampleGroundElevation(x, z + eps);
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

    // Baked vertical AO shading (linear space: soft shaded belly -> luminous sunlit crown)
    const t = THREE.MathUtils.clamp((vy + 1.0) * 0.5, 0, 1);
    const ao = 0.66 + 0.34 * (t * t * (3 - 2 * t));
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao;
    colors[i * 3 + 2] = ao;
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
      const lobe = 1.0 + 0.115 * Math.cos(theta * 7.0) * skirtWeight + 0.03 * Math.sin(theta * 3.0);
      const droop = -0.055 * Math.cos(theta * 7.0) * skirtWeight * r;
      pos.setXYZ(i, x * lobe, y + droop, z * lobe);
    }

    const t = THREE.MathUtils.clamp((y + 0.08) / 1.08, 0, 1);
    const ao = 0.62 + 0.38 * (t * t * (3 - 2 * t));
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao;
    colors[i * 3 + 2] = ao;
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

  // Add subtle top-to-bottom vertical AO vertex color
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp(y / 0.98, 0, 1);
    const ao = 0.72 + 0.28 * t;
    colors[i * 3] = ao;
    colors[i * 3 + 1] = ao;
    colors[i * 3 + 2] = ao;
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

  // Palette triplets [lowerShade, midBody, sunlitCrown] aligned strictly with @art-lighting #9
  const SPECIES_PALETTES = {
    camphor: [
      new THREE.Color('#3A5A46'), // Deep Cypress Green underside
      new THREE.Color('#537352'), // Canopy Olive-Sage body
      new THREE.Color('#6E8D5E'), // Sunlit Satin Moss crown
    ],
    moss: [
      new THREE.Color('#47674C'), // Rich deep moss-sage underside
      new THREE.Color('#6E8D5E'), // Sunlit Satin Moss body
      new THREE.Color('#87A06E'), // Soft Lichen Highlight crown
    ],
    amber: [
      new THREE.Color('#9E6A36'), // Warm shaded ochre-cedar underside
      new THREE.Color('#BD8448'), // Muted Autumn Amber body
      new THREE.Color('#C9985A'), // Warm Golden Ginkgo sunlit crown
    ],
  };

  const canopyMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.0,
  });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunkInst.name = 'BroadleafTrunks';
  const branchInst = new THREE.InstancedMesh(branchGeo, branchMat, trees.length * 3);
  branchInst.name = 'BroadleafBranches';
  const canopyInst = new THREE.InstancedMesh(cushionGeo, canopyMat, trees.length * cushionOffsets.length);
  canopyInst.name = 'BroadleafCanopies';

  // Stone tree-pit collars ONLY on flat ground (V4: y < 0.05 && slope < 0.05)
  const pitTrees = trees.filter((t) => t.hasPit && t.y < 0.05 && t.slope < 0.05);
  const lawnMoundTrees = trees.filter((t) => !(t.hasPit && t.y < 0.05 && t.slope < 0.05) && t.slope <= 0.16);

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
    // V4: embed trunks 0.42m on sloped hillsides so downhill roots NEVER expose
    const rootEmbed = isSloped ? 0.42 : 0.18;
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
      colorObj.offsetHSL(treeHueShift, puffJitter * 0.35, treeLitShift + puffJitter);
      canopyInst.setColorAt(cIdx, colorObj);
      cIdx++;
    }

    // 4. Tree-pit collar (flat avenues/plazas) OR organic soil mound ring (park lawns)
    const usePit = tr.hasPit && tr.y < 0.05 && tr.slope < 0.05;
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
    } else if (tr.slope <= 0.16 && mulchInst) {
      quat.setFromUnitVectors(UP_VEC, tr.normal);
      dummy.position.set(tr.x, tr.y - 0.03, tr.z);
      dummy.quaternion.copy(quat);
      dummy.scale.set(0.88 * s, 0.72, 0.88 * s);
      dummy.updateMatrix();
      mulchInst.setMatrixAt(mulchIdx++, dummy.matrix);
    }

    // 5. Ground Contact AO disc registration (slope-aware per V4)
    if (tr.slope <= 0.22) {
      const slopeShrink = tr.slope > 0.12 ? THREE.MathUtils.lerp(1.0, 0.55, (tr.slope - 0.12) / 0.10) : 1.0;
      aoEntries.push({
        x: tr.x,
        y: tr.y,
        z: tr.z,
        normal: tr.normal,
        slope: tr.slope,
        radius: 3.15 * s * slopeShrink,
      });
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
    roughness: 0.80,
    metalness: 0.0,
  });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunkInst.name = 'ConiferTrunks';
  const tierInst = new THREE.InstancedMesh(tierGeo, foliageMat, trees.length * tiers);
  tierInst.name = 'ConiferTiers';

  // Deep velvety cypress -> olive-pine sunlit apex gradient (@art-lighting #9)
  const cBase = new THREE.Color('#304E3C');
  const cMid = new THREE.Color('#3A5A46');
  const cTop = new THREE.Color('#5A7B56');
  const col = new THREE.Color();
  const dummy = new THREE.Object3D();

  let wIdx = 0;
  for (let i = 0; i < trees.length; i++) {
    const tr = trees[i];
    const s = tr.scale;
    const isSloped = tr.slope > 0.08;
    // V4: embed conifer roots 0.42m on steep Longpan Mountain slopes
    const rootEmbed = isSloped ? 0.42 : 0.20;
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
      col.offsetHSL(treeHue, 0, treeLit + (seeded(i, t + 11) - 0.5) * 0.025);
      tierInst.setColorAt(wIdx, col);
      wIdx++;
    }

    // Contact AO disc only on gentle terrain (slope <= 0.20); steep mountain flanks rely on real shadows
    if (tr.slope <= 0.20) {
      const slopeShrink = tr.slope > 0.12 ? THREE.MathUtils.lerp(1.0, 0.55, (tr.slope - 0.12) / 0.08) : 1.0;
      aoEntries.push({
        x: tr.x,
        y: tr.y,
        z: tr.z,
        normal: tr.normal,
        slope: tr.slope,
        radius: 2.85 * s * slopeShrink,
      });
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
    roughness: 0.82,
    metalness: 0.0,
  });

  // 3 merged plush blobs per ornamental shrub cluster
  const blobOffsets = [
    { x: 0.0, y: 0.44, z: 0.0, sx: 1.08, sy: 0.82, sz: 1.02 },
    { x: 0.72, y: 0.34, z: 0.28, sx: 0.78, sy: 0.64, sz: 0.76 },
    { x: -0.64, y: 0.32, z: -0.24, sx: 0.74, sy: 0.60, sz: 0.72 },
  ];

  const palette = [
    new THREE.Color('#3A5A46'),
    new THREE.Color('#537352'),
    new THREE.Color('#6E8D5E'),
    new THREE.Color('#87A06E'),
    new THREE.Color('#B9844A'), // occasional warm amber accent shrub
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
      col.offsetHSL((seeded(i, b + 5) - 0.5) * 0.02, 0, (b === 0 ? 0.02 : -0.02) + (seeded(i, b + 17) - 0.5) * 0.03);
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
    roughness: 0.82,
    metalness: 0.0,
  });

  const inst = new THREE.InstancedMesh(geo, mat, hedges.length);
  inst.name = 'TrimmedHedgeBlocks';
  const dummy = new THREE.Object3D();
  const baseCol = new THREE.Color('#46674B');
  const col = new THREE.Color();

  for (let i = 0; i < hedges.length; i++) {
    const h = hedges[i];
    dummy.position.set(h.x, h.y - 0.05, h.z);
    dummy.rotation.set(0, h.rotY, 0);
    dummy.scale.set(h.w, h.h, h.len);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);

    col.copy(baseCol).offsetHSL((seeded(i, 31) - 0.5) * 0.015, 0, (seeded(i, 37) - 0.5) * 0.025);
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
    roughness: 0.78,
    metalness: 0.0,
  });

  const plumeGeo = new THREE.SphereGeometry(0.068, 6, 5);
  plumeGeo.scale(0.85, 2.5, 0.85);
  const plumeMat = new THREE.MeshStandardMaterial({
    color: '#CEB88E',
    roughness: 0.82,
    metalness: 0.0,
  });

  const bladeInst = new THREE.InstancedMesh(bladeGeo, bladeMat, blades.length);
  bladeInst.name = 'ShorelineReedBlades';
  const plumeInst = new THREE.InstancedMesh(plumeGeo, plumeMat, plumes.length);
  plumeInst.name = 'ShorelineReedPlumes';

  const dummy = new THREE.Object3D();
  const euler = new THREE.Euler();
  const tipOffset = new THREE.Vector3();
  const reedDark = new THREE.Color('#47684A');
  const reedLight = new THREE.Color('#6E8D5E');
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

  const aoMat = new THREE.MeshBasicMaterial({
    map: aoTex,
    color: '#2C2824',
    transparent: true,
    opacity: 0.27,
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

  const { roads, isBlockedForTree, isBlockedForShrub, isBlockedForReed } = buildSpatialClearanceContext();

  // Shared materials strictly matching @art-lighting Master Palette #9
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#6B5340', roughness: 0.86, metalness: 0.0 });
  const branchMat = new THREE.MeshStandardMaterial({ color: '#7C624C', roughness: 0.86, metalness: 0.0 });
  const coniferTrunkMat = new THREE.MeshStandardMaterial({ color: '#5A4535', roughness: 0.88, metalness: 0.0 });
  const stonePitMat = new THREE.MeshStandardMaterial({ color: '#B5AEA3', roughness: 0.66, metalness: 0.03 });
  const mulchMat = new THREE.MeshStandardMaterial({ color: '#4A423A', roughness: 0.94, metalness: 0.0 });

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

  // -------------------------------------------------------------------------
  // 1. Formal Street Boulevards & Ceremonial Welcome Allée (Chamfered Stone Pits)
  // -------------------------------------------------------------------------

  // 1a. North Welcome Ceremonial Allée (6 warm Golden Ginkgo focal specimens framing Twin Mirror Pools)
  // V1 fix: z=-110 shifted north to z=-117 (9.1m clear of FireRing)
  for (const side of [-1, 1]) {
    const zs = [-136.0, -126.5, -117.0];
    for (let i = 0; i < zs.length; i++) {
      tryAddBroadleaf({
        x: 26 + side * 27.5,
        z: zs[i],
        scale: 1.14,
        rot: side * 0.9 + i * 1.3,
        species: 'amber',
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
    const species = isNearWelcome && i % 2 === 0 ? 'amber' : i % 3 === 0 ? 'moss' : 'camphor';
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
  // 2. Curated Lakeside & Park Focal Specimen Trees (Warm Amber/Ginkgo + Plush Camphors)
  // -------------------------------------------------------------------------
  const curatedSpecimens = [
    // Lakeside South & Southeast promenade amber focal accents
    { x: -34, z: 162, species: 'amber', scale: 1.18 },
    { x: 18, z: 173, species: 'amber', scale: 1.22 },
    { x: 76, z: 162, species: 'amber', scale: 1.16 },
    { x: 128, z: 128, species: 'amber', scale: 1.20 },
    // East pavilion & canal approach focal accents
    { x: 132, z: -118, species: 'amber', scale: 1.15 },
    { x: 146, z: -54, species: 'amber', scale: 1.18 },
    { x: 162, z: 22, species: 'amber', scale: 1.12 },
    // SW Arch Bridge & Hyperbolic Pavilion framing accents
    { x: -162, z: 136, species: 'amber', scale: 1.14 },
    { x: -96, z: 148, species: 'amber', scale: 1.12 },
    // Northwest park entrance accent
    { x: -82, z: -118, species: 'amber', scale: 1.14 },
    { x: -166, z: -102, species: 'amber', scale: 1.10 },
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
  //    Balanced botanical mix: ~54% Deep Olive-Sage Camphor, ~34% Sunlit Moss, ~12% Autumn Amber
  // -------------------------------------------------------------------------
  const organicZones = [
    // Northwest park lawn (between Pingling, FireRing, and W3/W4/W5)
    { xMin: -186, xMax: -14, zMin: -136, zMax: -62, attempts: 72, target: 32, amberRatio: 0.08, spacing: 6.4 },
    // West flank lawn (between Zhongguancun Ave, WalkwayNW, and W1/West Parking)
    { xMin: -196, xMax: -152, zMin: -62, zMax: 92, attempts: 48, target: 16, amberRatio: 0.06, spacing: 6.8 },
    // Northeast park & east canal shore (between NE Parking, East Canal, and Longpan toe)
    { xMin: 108, xMax: 168, zMin: -158, zMax: -36, attempts: 64, target: 24, amberRatio: 0.12, spacing: 6.4 },
    // Southwest park & SW Hill framing belt (between Yongping, Bridge, SW Hill, and Hyperbolic Pavilion)
    { xMin: -194, xMax: -54, zMin: 104, zMax: 170, attempts: 66, target: 22, amberRatio: 0.10, spacing: 6.4 },
    // South & Southeast lakeside park promenade
    { xMin: -54, xMax: 168, zMin: 84, zMax: 174, attempts: 84, target: 32, amberRatio: 0.10, spacing: 6.6 },
    // Longpan lower western foothill transition broadleaves (softening pine mountain base)
    { xMin: 166, xMax: 184, zMin: -146, zMax: 146, attempts: 40, target: 14, amberRatio: 0.18, spacing: 7.4 },
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
      const species = rRoll < zone.amberRatio ? 'amber' : rRoll < zone.amberRatio + 0.36 ? 'moss' : 'camphor';
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

  // 5d. Companion ornamental shrubs tucked naturally near park broadleaf groves
  for (let i = 0; i < broadleafTrees.length; i += 2) {
    const tr = broadleafTrees[i];
    if (tr.hasPit || tr.slope > 0.14) continue;
    const a = seeded(i, 113) * Math.PI * 2;
    const dist = 2.4 + seeded(i, 127) * 1.6;
    const sx = tr.x + Math.cos(a) * dist;
    const sz = tr.z + Math.sin(a) * dist;
    tryAddShrub(
      sx,
      sz,
      0.86 + seeded(i, 131) * 0.38,
      seeded(i, 137) * 6.28,
      tr.species === 'amber' ? 4 : i % 4
    );
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
