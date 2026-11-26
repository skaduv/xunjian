import * as THREE from 'three';
import {
  BUILDING_WINGS,
  ELEVATIONS,
  getFloorExplodeOffset,
  NVR_DEVICES,
  SAFETY_ZONES,
  SECURITY_CAMERAS,
} from '../config/campusConfig.js';

/**
 * 园区 3D 零后处理交互引擎（InteractionManager）
 *
 * 严格遵循低 GPU 预算与零合批破坏架构：
 * 1. Raycasting 拾取（< 5px pointerdown->pointerup 点击判定，绝不与 OrbitControls 拖拽冲突；
 *    pointermove 节流至 30Hz 且拖拽时暂停；按 camera > nvr > visible safetyZone > wing 优先级判定）
 * 2. 基于 BUILDING_WINGS / SECURITY_CAMERAS / NVR_DEVICES / SAFETY_ZONES 生成离线不可见代理拾取体
 *    （不加入渲染 scene，0 Draw Call、0 渲染遍历开销、完整保留 ArchitectureBuilder 静态合批）
 * 3. 零后处理 3D 视觉反馈：
 *    - 复用单位 EdgesGeometry 冰青线框盒 + 地面投影发光框（悬浮/选中建筑翼段，仅 +1~2 Draw Call）
 *    - 复用摄像头/NVR 悬浮细环与选中冰青/告警双层脉冲底环
 *    - 单路摄像头视锥 fovVisibleOverride 联动
 *    - NVR -> 下属摄像头 3D 二次贝塞尔拓扑光路（在线冰青流光 / 离线猩红脉冲，支持爆炸高度零 GC 同步）
 * 4. 完整 dispose() 回收所有监听、几何体与材质，适配 Vite HMR
 */

const CLICK_THRESHOLD_PX = 5;
const HOVER_THROTTLE_MS = 1000 / 30; // 30Hz hover raycast cap
const ARC_SEGMENTS = 28;
const ARC_RADIAL = 4;
const ARC_TUBE_RADIUS = 0.22;

// 零 GC 模块级复用向量，用于贝塞尔弧线与射线运算
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
const _upX = new THREE.Vector3(1, 0, 0);
const _normal = new THREE.Vector3();
const _binormal = new THREE.Vector3();
const _tmpColor = new THREE.Color();

function createReusableTubeGeometry(tubularSegments = ARC_SEGMENTS, radialSegments = ARC_RADIAL) {
  const vertexCount = (tubularSegments + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const indices = [];
  const stride = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

function updateTubeFromCurve(geo, curve, tubularSegments = ARC_SEGMENTS, radialSegments = ARC_RADIAL, radius = ARC_TUBE_RADIUS) {
  const posAttr = geo.attributes.position;
  const arr = posAttr.array;
  const stride = radialSegments + 1;

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    curve.getPoint(u, _pt);
    curve.getTangent(u, _tan).normalize();

    const refUp = Math.abs(_tan.y) > 0.94 ? _upX : _upY;
    _normal.crossVectors(_tan, refUp).normalize();
    _binormal.crossVectors(_tan, _normal).normalize();

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta) * radius;
      const sin = Math.sin(theta) * radius;
      const idx = (i * stride + j) * 3;
      arr[idx] = _pt.x + _normal.x * cos + _binormal.x * sin;
      arr[idx + 1] = _pt.y + _normal.y * cos + _binormal.y * sin;
      arr[idx + 2] = _pt.z + _normal.z * cos + _binormal.z * sin;
    }
  }
  posAttr.needsUpdate = true;
  geo.computeBoundingSphere();
}

function updateLineFromCurve(geo, curve, segments = ARC_SEGMENTS) {
  const posAttr = geo.attributes.position;
  const arr = posAttr.array;
  for (let i = 0; i <= segments; i++) {
    curve.getPoint(i / segments, _pt);
    const idx = i * 3;
    arr[idx] = _pt.x;
    arr[idx + 1] = _pt.y;
    arr[idx + 2] = _pt.z;
  }
  posAttr.needsUpdate = true;
  geo.computeBoundingSphere();
}

function computeZoneBounds(zone) {
  const pts = zone.polygon;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    w: Math.max(1.5, maxX - minX),
    d: Math.max(1.5, maxZ - minZ),
  };
}

function getFloorBaseY(floorNumber) {
  if (floorNumber === 1) return ELEVATIONS.FLOOR_1_Y;
  if (floorNumber === 2) return ELEVATIONS.FLOOR_2_Y;
  return ELEVATIONS.FLOOR_3_Y;
}

function getFloorGroup(architecture, floorKey) {
  const g = architecture?.groups;
  if (!g) return null;
  if (floorKey === '1F') return g.floor1;
  if (floorKey === '2F') return g.floor2;
  if (floorKey === '3F') return g.floor3;
  if (floorKey === 'roof') return g.roof;
  if (floorKey === 'floatingCanopy') return g.floatingCanopy;
  return null;
}

function isSameEntity(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

export class InteractionManager {
  constructor({
    studio,
    architecture,
    cameraLayer,
    safetyZonesLayer,
    onHover = null,
    onClick = null,
    onCanvasClick = null,
    onStateChange = null,
  }) {
    this.studio = studio;
    this.architecture = architecture;
    this.cameraLayer = cameraLayer;
    this.safetyZonesLayer = safetyZonesLayer;

    this._onHover = onHover;
    this._onClick = onClick;
    this._onCanvasClick = onCanvasClick;
    this._onStateChange = onStateChange;

    this.domElement = studio.renderer.domElement;
    this.enabled = true;
    this.disposed = false;

    this.explodeFactor = 0;
    this.duskFactor = studio.duskFactor || 0;
    this.nightFactor = studio.nightFactor || 0;

    this.hoveredEntity = null;
    this.selectedEntity = null;
    this._selectedFloorKey = null;
    this._hoveredFloorKey = null;

    // 显式手动单路视锥覆盖 vs 选中/悬浮临时视锥覆盖（避免互相打架）
    this._manualFovOverride = null;
    this._selectionFovOverride = null;
    this._hoverFovOverride = null;
    this._activeFovOverride = null;

    // NVR 拓扑显示状态: false | true | 'NVR-01' | 'NVR-02' | 'NVR-03'
    this._nvrTopologyTarget = false;

    // 零 GC Raycaster 与状态变量
    this._raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._hits = [];
    this._pickBuffer = [];

    this._isPointerDown = false;
    this._isDragging = false;
    this._downX = 0;
    this._downY = 0;
    this._downButton = -1;
    this._lastHoverMs = 0;
    this._cursorState = '';

    // 追踪所有需要 dispose() 清理的自建资源
    this._ownedGeometries = [];
    this._ownedMaterials = [];

    // 1. 离屏代理拾取体（不挂载到 studio.scene，0 Draw Call & 0 渲染遍历）
    this._pickingRoot = new THREE.Group();
    this._pickingRoot.name = 'InteractionPickingProxies';
    this._proxyMat = this._trackMat(new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this._cameraProxies = [];
    this._nvrProxies = [];
    this._zoneProxies = [];
    this._wingProxies = [];
    this._buildPickingProxies();

    // 2. 场景内零后处理 3D 视觉反馈图层（仅在激活时显示）
    this.feedbackGroup = new THREE.Group();
    this.feedbackGroup.name = 'InteractionFeedbackLayer';
    this._buildFeedbackVisuals();
    this._buildNvrTopologyArcs();
    this.studio.scene.add(this.feedbackGroup);

    // 3. 绑定指针与 OrbitControls 事件
    this._bindEvents();
    this.setLightingFactor(this.duskFactor, this.nightFactor);
  }

  _trackGeo(geo) {
    this._ownedGeometries.push(geo);
    return geo;
  }

  _trackMat(mat) {
    this._ownedMaterials.push(mat);
    return mat;
  }

  _buildPickingProxies() {
    // A. 12 路摄像头代理球体（半径 3.1m，确保 898m 俯视等轴测下轻松命中）
    const camSphereGeo = this._trackGeo(new THREE.SphereGeometry(3.1, 8, 6));
    for (const cam of SECURITY_CAMERAS) {
      const mesh = new THREE.Mesh(camSphereGeo, this._proxyMat);
      mesh.position.set(cam.position[0], cam.position[1], cam.position[2]);
      mesh.userData = {
        entityType: 'camera',
        entityId: cam.id,
        floorKey: cam.floor,
        isIndoor: Boolean(cam.isIndoor),
        baseY: cam.position[1],
        config: cam,
      };
      this._pickingRoot.add(mesh);
      this._cameraProxies.push(mesh);
    }

    // B. 3 台大华 NVR 核心机房节点代理盒
    const nvrBoxGeo = this._trackGeo(new THREE.BoxGeometry(2.3, 3.4, 2.2));
    for (const nvr of NVR_DEVICES) {
      const mesh = new THREE.Mesh(nvrBoxGeo, this._proxyMat);
      mesh.position.set(nvr.nodePosition[0], nvr.nodePosition[1] + 0.9, nvr.nodePosition[2]);
      mesh.userData = {
        entityType: 'nvr',
        entityId: nvr.id,
        floorKey: nvr.floor || '1F',
        isIndoor: true,
        baseY: nvr.nodePosition[1] + 0.9,
        config: nvr,
      };
      this._pickingRoot.add(mesh);
      this._nvrProxies.push(mesh);
    }

    // C. 11 个四类安全防区多边形代理体（仅在 safetyZones 图层及其分类开启时参与拾取）
    for (const zone of SAFETY_ZONES) {
      const pts = zone.polygon;
      const shape = new THREE.Shape();
      shape.moveTo(pts[0][0], -pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i][0], -pts[i][1]);
      }
      shape.closePath();

      const h = zone.type === 'restricted' ? Math.max(zone.height || 3.1, 3.8) : Math.max(zone.height || 0.6, 0.85);
      const geo = this._trackGeo(
        new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
      );
      geo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(geo, this._proxyMat);
      mesh.position.y = zone.baseY;
      mesh.userData = {
        entityType: 'zone',
        entityId: zone.id,
        zoneType: zone.type,
        floorKey: zone.floor,
        isIndoor: Boolean(zone.isIndoor),
        baseY: zone.baseY,
        bounds: computeZoneBounds(zone),
        config: zone,
      };
      this._pickingRoot.add(mesh);
      this._zoneProxies.push(mesh);
    }

    // D. BUILDING_WINGS 建筑翼段按层代理拾取盒（零合批破坏 + 爆炸透视下层间空隙可穿透点选室内设备）
    const unitBoxGeo = this._trackGeo(new THREE.BoxGeometry(1, 1, 1));
    for (const wing of BUILDING_WINGS) {
      const w = wing.x2 - wing.x1;
      const d = wing.z2 - wing.z1;
      const cx = (wing.x1 + wing.x2) * 0.5;
      const cz = (wing.z1 + wing.z2) * 0.5;

      for (const floorNum of wing.floors) {
        const floorKey = `${floorNum}F`;
        const h = ELEVATIONS.FLOOR_HEIGHT;
        const baseCenterY = getFloorBaseY(floorNum) + h * 0.5;

        const mesh = new THREE.Mesh(unitBoxGeo, this._proxyMat);
        mesh.scale.set(w, h, d);
        mesh.position.set(cx, baseCenterY, cz);
        mesh.userData = {
          entityType: 'wing',
          entityId: wing.id,
          groupId: wing.groupId,
          floorKey,
          floorNum,
          baseCenterY,
          wing,
        };
        this._pickingRoot.add(mesh);
        this._wingProxies.push(mesh);
      }
    }

    this._pickingRoot.updateMatrixWorld(true);
  }

  _buildFeedbackVisuals() {
    // 1. 复用单位 Box 的冰青 EdgesGeometry 高亮线框（选中 + 悬浮各一个，仅激活时 visible = true）
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitEdges = this._trackGeo(new THREE.EdgesGeometry(unitBox));
    unitBox.dispose();

    this._wingSelectEdgeMat = this._trackMat(
      new THREE.LineBasicMaterial({
        color: '#0284c7',
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
    );
    this._wingSelectBox = new THREE.LineSegments(unitEdges, this._wingSelectEdgeMat);
    this._wingSelectBox.visible = false;
    this._wingSelectBox.renderOrder = 14;
    this.feedbackGroup.add(this._wingSelectBox);

    // 建筑翼段选中时的极轻地面发光轮廓垫（增强白模材质对比度，仅 +1 Draw Call）
    const unitPadGeo = this._trackGeo(new THREE.PlaneGeometry(1, 1));
    unitPadGeo.rotateX(-Math.PI / 2);
    this._wingSelectPadMat = this._trackMat(
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._wingSelectPad = new THREE.Mesh(unitPadGeo, this._wingSelectPadMat);
    this._wingSelectPad.visible = false;
    this._wingSelectPad.renderOrder = 12;
    this.feedbackGroup.add(this._wingSelectPad);

    this._wingHoverEdgeMat = this._trackMat(
      new THREE.LineBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      })
    );
    this._wingHoverBox = new THREE.LineSegments(unitEdges, this._wingHoverEdgeMat);
    this._wingHoverBox.visible = false;
    this._wingHoverBox.renderOrder = 13;
    this.feedbackGroup.add(this._wingHoverBox);

    // 2. 摄像头 / NVR 悬浮细线底环 + 选中实心/扩散双光环（全局仅复用 1 套，低 Draw Call）
    const hoverRingGeo = this._trackGeo(new THREE.RingGeometry(1.55, 2.05, 32));
    hoverRingGeo.rotateX(-Math.PI / 2);
    this._entityHoverRingMat = this._trackMat(
      new THREE.MeshBasicMaterial({
        color: '#0284c7',
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._entityHoverRing = new THREE.Mesh(hoverRingGeo, this._entityHoverRingMat);
    this._entityHoverRing.visible = false;
    this._entityHoverRing.renderOrder = 15;
    this.feedbackGroup.add(this._entityHoverRing);

    this._entitySelectGroup = new THREE.Group();
    this._entitySelectGroup.visible = false;

    const selectCoreGeo = this._trackGeo(new THREE.RingGeometry(1.4, 2.25, 36));
    selectCoreGeo.rotateX(-Math.PI / 2);
    this._entitySelectCoreMat = this._trackMat(
      new THREE.MeshBasicMaterial({
        color: '#0284c7',
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._entitySelectCore = new THREE.Mesh(selectCoreGeo, this._entitySelectCoreMat);
    this._entitySelectCore.renderOrder = 16;
    this._entitySelectGroup.add(this._entitySelectCore);

    const selectPulseGeo = this._trackGeo(new THREE.RingGeometry(2.15, 2.75, 36));
    selectPulseGeo.rotateX(-Math.PI / 2);
    this._entitySelectPulseMat = this._trackMat(
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this._entitySelectPulse = new THREE.Mesh(selectPulseGeo, this._entitySelectPulseMat);
    this._entitySelectPulse.renderOrder = 15;
    this._entitySelectGroup.add(this._entitySelectPulse);

    // 高杆/室内摄像头至地坪的极细垂线定位杆（仅在选中离地摄像头时按高度缩放）
    const stemGeo = this._trackGeo(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1, 0),
    ]));
    this._entitySelectStemMat = this._trackMat(
      new THREE.LineBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      })
    );
    this._entitySelectStem = new THREE.Line(stemGeo, this._entitySelectStemMat);
    this._entitySelectStem.renderOrder = 15;
    this._entitySelectGroup.add(this._entitySelectStem);

    this.feedbackGroup.add(this._entitySelectGroup);
  }

  _buildNvrTopologyArcs() {
    this._topologyGroup = new THREE.Group();
    this._topologyGroup.name = 'NvrTopologyArcs';
    this._topologyGroup.visible = false;
    this.feedbackGroup.add(this._topologyGroup);

    this._nvrTopologyGroups = new Map();
    const beadGeo = this._trackGeo(new THREE.SphereGeometry(0.62, 10, 8));
    const endRingGeo = this._trackGeo(new THREE.RingGeometry(0.95, 1.45, 24));
    endRingGeo.rotateX(-Math.PI / 2);

    for (const nvr of NVR_DEVICES) {
      const grp = new THREE.Group();
      grp.name = `NvrTopology_${nvr.id}`;
      grp.visible = false;

      const lineMat = this._trackMat(
        new THREE.LineBasicMaterial({
          color: '#0284c7',
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
        })
      );
      const tubeMat = this._trackMat(
        new THREE.MeshBasicMaterial({
          color: '#38bdf8',
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const beadMat = this._trackMat(
        new THREE.MeshBasicMaterial({
          color: '#e0f2fe',
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
        })
      );
      const ringMat = this._trackMat(
        new THREE.MeshBasicMaterial({
          color: '#38bdf8',
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );

      const arcs = [];
      const children = SECURITY_CAMERAS.filter((c) => c.nvrId === nvr.id);

      children.forEach((cam, idx) => {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(...nvr.nodePosition),
          new THREE.Vector3(),
          new THREE.Vector3(...cam.position)
        );

        const lineGeo = this._trackGeo(new THREE.BufferGeometry());
        lineGeo.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 3), 3)
        );
        const line = new THREE.Line(lineGeo, lineMat);
        line.renderOrder = 18;
        grp.add(line);

        const tubeGeo = this._trackGeo(createReusableTubeGeometry(ARC_SEGMENTS, ARC_RADIAL));
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.renderOrder = 17;
        grp.add(tube);

        const bead = new THREE.Mesh(beadGeo, beadMat);
        bead.renderOrder = 19;
        grp.add(bead);

        const endRing = new THREE.Mesh(endRingGeo, ringMat);
        endRing.renderOrder = 17;
        grp.add(endRing);

        arcs.push({
          cameraId: cam.id,
          camConfig: cam,
          curve,
          lineGeo,
          tubeGeo,
          bead,
          endRing,
          phase: idx * 0.25,
        });
      });

      this._topologyGroup.add(grp);
      this._nvrTopologyGroups.set(nvr.id, {
        nvrId: nvr.id,
        nvrConfig: nvr,
        group: grp,
        lineMat,
        tubeMat,
        beadMat,
        ringMat,
        arcs,
        isOffline: false,
      });
    }

    this._updateAllTopologyCurves();
    this.refreshNvrTopologyStatus();
  }

  _updateAllTopologyCurves() {
    for (const bundle of this._nvrTopologyGroups.values()) {
      const nvrPos = this.cameraLayer?.getCameraWorldPosition?.(bundle.nvrId);
      if (nvrPos) {
        _p0.copy(nvrPos);
      } else {
        const np = bundle.nvrConfig.nodePosition;
        _p0.set(np[0], np[1] + getFloorExplodeOffset(bundle.nvrConfig.floor, this.explodeFactor), np[2]);
      }
      _p0.y += 1.65;

      for (const arc of bundle.arcs) {
        const camPos = this.cameraLayer?.getCameraWorldPosition?.(arc.cameraId);
        if (camPos) {
          _p2.copy(camPos);
        } else {
          const cp = arc.camConfig.position;
          const dy = arc.camConfig.isIndoor
            ? getFloorExplodeOffset(arc.camConfig.floor, this.explodeFactor)
            : 0;
          _p2.set(cp[0], cp[1] + dy, cp[2]);
        }

        const horizDist = Math.hypot(_p2.x - _p0.x, _p2.z - _p0.z);
        const archLift = Math.min(52, 18 + horizDist * 0.16);
        _p1.set(
          (_p0.x + _p2.x) * 0.5,
          Math.max(_p0.y, _p2.y) + archLift,
          (_p0.z + _p2.z) * 0.5
        );

        arc.curve.v0.copy(_p0);
        arc.curve.v1.copy(_p1);
        arc.curve.v2.copy(_p2);

        updateLineFromCurve(arc.lineGeo, arc.curve, ARC_SEGMENTS);
        updateTubeFromCurve(arc.tubeGeo, arc.curve, ARC_SEGMENTS, ARC_RADIAL, ARC_TUBE_RADIUS);
        arc.endRing.position.set(_p2.x, _p2.y + 0.12, _p2.z);
      }
    }
  }

  _isNvrOffline(nvrId) {
    if (typeof this.cameraLayer?.isNvrOffline === 'function') {
      return this.cameraLayer.isNvrOffline(nvrId);
    }
    const snap = this.cameraLayer?.getCatalogSnapshot?.();
    const found = snap?.nvrs?.find((n) => n.id === nvrId);
    return found ? found.status === 'offline' : false;
  }

  refreshNvrTopologyStatus() {
    const darkFactor = Math.max(this.duskFactor, this.nightFactor);
    for (const bundle of this._nvrTopologyGroups.values()) {
      const offline = this._isNvrOffline(bundle.nvrId);
      bundle.isOffline = offline;

      if (offline) {
        bundle.lineMat.color.set(darkFactor > 0.35 ? '#f43f5e' : '#dc2626');
        bundle.tubeMat.color.set('#ef4444');
        bundle.beadMat.color.set('#fecaca');
        bundle.ringMat.color.set('#ef4444');
      } else {
        bundle.lineMat.color.set(darkFactor > 0.35 ? '#38bdf8' : '#0284c7');
        bundle.tubeMat.color.set(darkFactor > 0.35 ? '#38bdf8' : '#0ea5e9');
        bundle.beadMat.color.set(darkFactor > 0.35 ? '#e0f2fe' : '#0284c7');
        bundle.ringMat.color.set(darkFactor > 0.35 ? '#38bdf8' : '#0ea5e9');
      }
      bundle.tubeMat.opacity = offline
        ? THREE.MathUtils.lerp(0.32, 0.44, darkFactor)
        : THREE.MathUtils.lerp(0.24, 0.34, darkFactor);
    }
  }

  setNvrTopologyVisible(target) {
    let normalized = false;
    if (target === true || target === 'all') {
      normalized = true;
    } else if (typeof target === 'string' && this._nvrTopologyGroups.has(target)) {
      normalized = target;
    } else {
      normalized = false;
    }

    this._nvrTopologyTarget = normalized;
    this._topologyGroup.visible = normalized !== false;

    for (const [nvrId, bundle] of this._nvrTopologyGroups.entries()) {
      bundle.group.visible = normalized === true || normalized === nvrId;
    }

    if (this._topologyGroup.visible) {
      this._updateAllTopologyCurves();
      this.refreshNvrTopologyStatus();
    }

    this.studio.wake(900);
    this._emitStateChange('nvrTopology', { target: normalized });
    return normalized;
  }

  getNvrTopologyTarget() {
    return this._nvrTopologyTarget;
  }

  setCameraFovOverride(cameraId) {
    this._manualFovOverride = cameraId || null;
    this._reconcileFovOverride();
    this.studio.wake(500);
    return this._activeFovOverride;
  }

  _reconcileFovOverride() {
    const next = this._manualFovOverride || this._selectionFovOverride || this._hoverFovOverride || null;
    if (next === this._activeFovOverride) return;
    this._activeFovOverride = next;
    if (typeof this.cameraLayer?.setCameraFovOverride === 'function') {
      this.cameraLayer.setCameraFovOverride(next);
    }
  }

  setLightingFactor(duskFactor = 0, nightFactor = 0) {
    this.duskFactor = duskFactor;
    this.nightFactor = nightFactor;
    const dark = Math.max(duskFactor, nightFactor);

    // 日间白模采用清晰深冰青 (#0284c7)，暮光/星夜提升高明度冰青 (#38bdf8)
    _tmpColor.set('#0284c7').lerp(_tmpColor.clone().set('#38bdf8'), dark);
    this._wingSelectEdgeMat.color.copy(_tmpColor);
    this._wingHoverEdgeMat.color.set(dark > 0.35 ? '#7dd3fc' : '#0ea5e9');
    this._wingSelectPadMat.color.set(dark > 0.35 ? '#38bdf8' : '#0284c7');
    this._wingSelectPadMat.opacity = THREE.MathUtils.lerp(0.11, 0.18, dark);

    this._entityHoverRingMat.color.set(dark > 0.35 ? '#38bdf8' : '#0284c7');
    this._entitySelectStemMat.color.set(dark > 0.35 ? '#38bdf8' : '#0284c7');

    this._syncSelectedRingColor();
    this.refreshNvrTopologyStatus();
  }

  syncExplosion(explodeFactor) {
    this.explodeFactor = explodeFactor;

    for (const mesh of this._cameraProxies) {
      const u = mesh.userData;
      const dy = u.isIndoor ? getFloorExplodeOffset(u.floorKey, explodeFactor) : 0;
      mesh.position.y = u.baseY + dy;
    }

    for (const mesh of this._nvrProxies) {
      const u = mesh.userData;
      const dy = getFloorExplodeOffset(u.floorKey, explodeFactor);
      mesh.position.y = u.baseY + dy;
    }

    for (const mesh of this._zoneProxies) {
      const u = mesh.userData;
      const dy = u.isIndoor ? getFloorExplodeOffset(u.floorKey, explodeFactor) : 0;
      mesh.position.y = u.baseY + dy;
    }

    for (const mesh of this._wingProxies) {
      const u = mesh.userData;
      const dy = getFloorExplodeOffset(u.floorKey, explodeFactor);
      mesh.position.y = u.baseCenterY + dy;
    }

    this._pickingRoot.updateMatrixWorld(true);

    // 同步当前激活的 3D 高亮盒、底环与 NVR 弧线
    this._syncFeedbackTransforms();
    if (this._topologyGroup.visible) {
      this._updateAllTopologyCurves();
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this._setHoveredInternal(null, null, false);
    }
  }

  getSelectedEntity() {
    return this.selectedEntity ? { ...this.selectedEntity } : null;
  }

  getHoveredEntity() {
    return this.hoveredEntity ? { ...this.hoveredEntity } : null;
  }

  setHoveredEntity(ref) {
    const normalized = ref && ref.type && ref.id ? { type: ref.type, id: ref.id } : null;
    this._setHoveredInternal(normalized, null, false);
  }

  setSelectedEntity(ref, options = {}) {
    const normalized = ref && ref.type && ref.id ? { type: ref.type, id: ref.id } : null;
    this.selectedEntity = normalized;
    this._selectedFloorKey = options.floorKey || null;

    // 同步 CameraLayer 自身选中高亮辅助
    if (typeof this.cameraLayer?.setSelectedCamera === 'function') {
      this.cameraLayer.setSelectedCamera(normalized?.type === 'camera' ? normalized.id : null);
    }

    // 同步单路视锥覆盖
    if (normalized?.type === 'camera') {
      const showFov = options.showFov !== undefined ? Boolean(options.showFov) : true;
      this._selectionFovOverride = showFov ? normalized.id : null;
    } else {
      this._selectionFovOverride = null;
      if (!normalized && options.clearFovOverride !== false) {
        this._manualFovOverride = null;
      }
    }
    this._reconcileFovOverride();

    // 同步 NVR 拓扑弧线（选中 NVR 默认展开该 NVR 拓扑；取消选中若由选中触发则收起）
    if (normalized?.type === 'nvr') {
      if (options.showNvrLinks !== false) {
        this.setNvrTopologyVisible(normalized.id);
      }
    } else if (options.showNvrLinks === false) {
      this.setNvrTopologyVisible(false);
    }

    this._syncFeedbackTransforms();
    this._syncSelectedRingColor();
    this.studio.wake(900);
    this._emitStateChange('selection', { entity: this.getSelectedEntity() });
    return this.getSelectedEntity();
  }

  _setHoveredInternal(ref, floorKey, emitCallback) {
    const changed = !isSameEntity(this.hoveredEntity, ref) || this._hoveredFloorKey !== floorKey;
    if (!changed) return;

    this.hoveredEntity = ref;
    this._hoveredFloorKey = floorKey;

    if (typeof this.cameraLayer?.setHoveredCamera === 'function') {
      this.cameraLayer.setHoveredCamera(ref?.type === 'camera' ? ref.id : null);
    }

    // Hover 摄像头时柔和预览该路视锥（不覆盖用户锁定/选中的视锥）
    this._hoverFovOverride = ref?.type === 'camera' ? ref.id : null;
    this._reconcileFovOverride();

    this._syncHoverCursor(Boolean(ref));
    this._syncFeedbackTransforms();
    this.studio.wake(450);

    if (emitCallback && typeof this._onHover === 'function') {
      this._onHover(ref ? { ...ref, floorKey: floorKey || undefined } : null);
    }
  }

  _syncHoverCursor(isHovering) {
    const next = isHovering ? 'pointer' : '';
    if (next !== this._cursorState) {
      this._cursorState = next;
      this.domElement.style.cursor = next;
    }
  }

  _syncSelectedRingColor() {
    if (!this.selectedEntity) return;
    const dark = Math.max(this.duskFactor, this.nightFactor);
    let primary = dark > 0.35 ? '#38bdf8' : '#0284c7';
    let pulse = '#38bdf8';

    if (this.selectedEntity.type === 'camera') {
      const entry = this.cameraLayer?.getCameraEntry?.(this.selectedEntity.id);
      if (entry?.state === 'alarm_critical') {
        primary = '#ef4444';
        pulse = '#f43f5e';
      } else if (entry?.state === 'alarm_order') {
        primary = '#f59e0b';
        pulse = '#fbbf24';
      } else if (entry?.state === 'offline') {
        primary = '#64748b';
        pulse = '#94a3b8';
      }
    } else if (this.selectedEntity.type === 'nvr') {
      if (this._isNvrOffline(this.selectedEntity.id)) {
        primary = '#ef4444';
        pulse = '#f43f5e';
      }
    }

    this._entitySelectCoreMat.color.set(primary);
    this._entitySelectPulseMat.color.set(pulse);
    this._entitySelectStemMat.color.set(primary);
  }

  _computeBoxForRef(ref, floorKey) {
    if (!ref) return null;

    if (ref.type === 'wing') {
      const wing = BUILDING_WINGS.find((w) => w.id === ref.id);
      if (!wing) return null;
      return this._computeWingBox(wing, floorKey);
    }

    if (ref.type === 'group') {
      const wings = BUILDING_WINGS.filter((w) => w.groupId === ref.id);
      if (wings.length === 0) return null;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const w of wings) {
        const b = this._computeWingBox(w, null);
        minX = Math.min(minX, b.cx - b.sx * 0.5);
        maxX = Math.max(maxX, b.cx + b.sx * 0.5);
        minZ = Math.min(minZ, b.cz - b.sz * 0.5);
        maxZ = Math.max(maxZ, b.cz + b.sz * 0.5);
        minY = Math.min(minY, b.cy - b.sy * 0.5);
        maxY = Math.max(maxY, b.cy + b.sy * 0.5);
      }
      return {
        cx: (minX + maxX) * 0.5,
        cy: (minY + maxY) * 0.5,
        cz: (minZ + maxZ) * 0.5,
        sx: maxX - minX,
        sy: maxY - minY,
        sz: maxZ - minZ,
        groundY: minY,
      };
    }

    if (ref.type === 'zone') {
      const proxy = this._zoneProxies.find((m) => m.userData.entityId === ref.id);
      if (!proxy) return null;
      const u = proxy.userData;
      const h = u.zoneType === 'restricted' ? Math.max(u.config.height || 3.1, 3.8) : Math.max(u.config.height || 0.6, 0.85);
      return {
        cx: u.bounds.cx,
        cy: proxy.position.y + h * 0.5,
        cz: u.bounds.cz,
        sx: u.bounds.w + 0.6,
        sy: h + 0.2,
        sz: u.bounds.d + 0.6,
        groundY: proxy.position.y + 0.08,
      };
    }

    return null;
  }

  _computeWingBox(wing, floorKey) {
    const pad = 0.55;
    const cx = (wing.x1 + wing.x2) * 0.5;
    const cz = (wing.z1 + wing.z2) * 0.5;
    const sx = wing.x2 - wing.x1 + pad * 2;
    const sz = wing.z2 - wing.z1 + pad * 2;

    // 若处于爆炸态且有明确命中楼层，则精准框选该层；否则包裹该翼段全高
    if (this.explodeFactor > 0.05 && floorKey) {
      const fNum = Number(floorKey.replace('F', ''));
      if (wing.floors.includes(fNum)) {
        const dy = getFloorExplodeOffset(floorKey, this.explodeFactor);
        const yMin = getFloorBaseY(fNum) + dy;
        const yMax = yMin + ELEVATIONS.FLOOR_HEIGHT;
        return { cx, cy: (yMin + yMax) * 0.5, cz, sx, sy: yMax - yMin + 0.25, sz, groundY: yMin + 0.08 };
      }
    }

    const minF = Math.min(...wing.floors);
    const maxF = Math.max(...wing.floors);
    const minOff = getFloorExplodeOffset(`${minF}F`, this.explodeFactor);
    const maxOff = getFloorExplodeOffset(`${maxF}F`, this.explodeFactor);
    const yMin = getFloorBaseY(minF) + minOff;
    const yMax = getFloorBaseY(maxF) + ELEVATIONS.FLOOR_HEIGHT + maxOff;
    return {
      cx,
      cy: (yMin + yMax) * 0.5,
      cz,
      sx,
      sy: yMax - yMin + 0.35,
      sz,
      groundY: yMin + 0.08,
    };
  }

  _getPointEntityAnchor(ref) {
    if (!ref || (ref.type !== 'camera' && ref.type !== 'nvr')) return null;

    const worldPos = this.cameraLayer?.getCameraWorldPosition?.(ref.id);
    if (ref.type === 'camera') {
      const cam = SECURITY_CAMERAS.find((c) => c.id === ref.id);
      if (!cam) return null;
      const pos = worldPos || new THREE.Vector3(...cam.position);
      let floorBaseY = ELEVATIONS.ROAD_TOP + 0.14;
      if (cam.isIndoor) {
        const fNum = cam.floor === '2F' ? 2 : cam.floor === '3F' ? 3 : 1;
        floorBaseY = getFloorBaseY(fNum) + ELEVATIONS.SLAB_THICKNESS + 0.08 + getFloorExplodeOffset(cam.floor, this.explodeFactor);
      }
      return { x: pos.x, y: pos.y, z: pos.z, groundY: floorBaseY };
    }

    const nvr = NVR_DEVICES.find((n) => n.id === ref.id);
    if (!nvr) return null;
    const pos = worldPos || new THREE.Vector3(...nvr.nodePosition);
    const floorBaseY = ELEVATIONS.FLOOR_1_Y + ELEVATIONS.SLAB_THICKNESS + 0.08 + getFloorExplodeOffset(nvr.floor || '1F', this.explodeFactor);
    return { x: pos.x, y: pos.y + 1.5, z: pos.z, groundY: floorBaseY };
  }

  _syncFeedbackTransforms() {
    // 1. 选中态建筑翼段 / 分组 / 防区高亮盒
    const selBox = this._computeBoxForRef(this.selectedEntity, this._selectedFloorKey);
    if (selBox) {
      this._wingSelectBox.position.set(selBox.cx, selBox.cy, selBox.cz);
      this._wingSelectBox.scale.set(selBox.sx, selBox.sy, selBox.sz);
      this._wingSelectBox.visible = true;

      this._wingSelectPad.position.set(selBox.cx, selBox.groundY, selBox.cz);
      this._wingSelectPad.scale.set(selBox.sx, selBox.sz, 1);
      this._wingSelectPad.visible = this.selectedEntity?.type !== 'zone';
    } else {
      this._wingSelectBox.visible = false;
      this._wingSelectPad.visible = false;
    }

    // 2. 悬浮态建筑翼段 / 防区线框盒（避免与选中态重叠重复显示）
    const hoverBox =
      this.hoveredEntity && !isSameEntity(this.hoveredEntity, this.selectedEntity)
        ? this._computeBoxForRef(this.hoveredEntity, this._hoveredFloorKey)
        : null;
    if (hoverBox) {
      this._wingHoverBox.position.set(hoverBox.cx, hoverBox.cy, hoverBox.cz);
      this._wingHoverBox.scale.set(hoverBox.sx, hoverBox.sy, hoverBox.sz);
      this._wingHoverBox.visible = true;
    } else {
      this._wingHoverBox.visible = false;
    }

    // 3. 选中态摄像头 / NVR 地面光环 + 垂线定位杆
    const selPoint = this._getPointEntityAnchor(this.selectedEntity);
    if (selPoint) {
      this._entitySelectGroup.position.set(selPoint.x, selPoint.groundY, selPoint.z);
      const stemH = Math.max(0.2, selPoint.y - selPoint.groundY);
      this._entitySelectStem.scale.set(1, stemH, 1);
      this._entitySelectGroup.visible = true;
    } else {
      this._entitySelectGroup.visible = false;
    }

    // 4. 悬浮态摄像头 / NVR 细线地面环
    const hoverPoint =
      this.hoveredEntity && !isSameEntity(this.hoveredEntity, this.selectedEntity)
        ? this._getPointEntityAnchor(this.hoveredEntity)
        : null;
    if (hoverPoint) {
      this._entityHoverRing.position.set(hoverPoint.x, hoverPoint.groundY + 0.04, hoverPoint.z);
      this._entityHoverRing.visible = true;
    } else {
      this._entityHoverRing.visible = false;
    }
  }

  _bindEvents() {
    this._onPointerDown = (e) => {
      if (!this.enabled || this.disposed) return;
      this._isPointerDown = true;
      this._isDragging = false;
      this._downX = e.clientX;
      this._downY = e.clientY;
      this._downButton = e.button;
    };

    this._onPointerMove = (e) => {
      if (!this.enabled || this.disposed || document.hidden) return;

      if (this._isPointerDown) {
        const dist = Math.hypot(e.clientX - this._downX, e.clientY - this._downY);
        if (dist >= CLICK_THRESHOLD_PX) {
          this._isDragging = true;
          this._syncHoverCursor(false);
        }
        // 拖拽旋转/平移相机期间完全暂停射线拾取，守护低 GPU 负载
        return;
      }

      const now = performance.now();
      if (now - this._lastHoverMs < HOVER_THROTTLE_MS) return;
      this._lastHoverMs = now;

      const hit = this._pickAtClientPos(e.clientX, e.clientY);
      if (hit) {
        this._setHoveredInternal(
          { type: hit.entityType, id: hit.entityId },
          hit.floorKey || null,
          true
        );
      } else {
        this._setHoveredInternal(null, null, true);
      }
    };

    this._onPointerUp = (e) => {
      if (!this.enabled || this.disposed) return;
      const wasDown = this._isPointerDown;
      const wasPrimary = this._downButton === 0 || e.pointerType === 'touch';
      const dist = Math.hypot(e.clientX - this._downX, e.clientY - this._downY);

      this._isPointerDown = false;
      this._isDragging = false;
      this._downButton = -1;

      if (!wasDown || !wasPrimary || dist >= CLICK_THRESHOLD_PX) {
        return;
      }

      const hit = this._pickAtClientPos(e.clientX, e.clientY);
      if (hit) {
        const ref = { type: hit.entityType, id: hit.entityId };
        this.setSelectedEntity(ref, { floorKey: hit.floorKey || null });
        if (typeof this._onClick === 'function') {
          this._onClick({
            ...ref,
            floorKey: hit.floorKey || undefined,
            groupId: hit.groupId || undefined,
            worldPoint: [
              Number(hit.point.x.toFixed(2)),
              Number(hit.point.y.toFixed(2)),
              Number(hit.point.z.toFixed(2)),
            ],
            screenPoint: { x: e.clientX, y: e.clientY },
          });
        }
      } else {
        if (this.selectedEntity) {
          this.setSelectedEntity(null);
        }
        if (typeof this._onCanvasClick === 'function') {
          this._onCanvasClick({ screenPoint: { x: e.clientX, y: e.clientY } });
        }
      }
    };

    this._onPointerCancel = () => {
      this._isPointerDown = false;
      this._isDragging = false;
      this._downButton = -1;
    };

    this._onPointerLeave = () => {
      this._isPointerDown = false;
      this._isDragging = false;
      this._setHoveredInternal(null, null, true);
    };

    this.domElement.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    this.domElement.addEventListener('pointermove', this._onPointerMove, { passive: true });
    this.domElement.addEventListener('pointerup', this._onPointerUp, { passive: true });
    this.domElement.addEventListener('pointercancel', this._onPointerCancel, { passive: true });
    this.domElement.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
  }

  _pickAtClientPos(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    this._pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointerNdc, this.studio.camera);

    const camerasVisible = this.cameraLayer?.camerasGroup?.visible !== false;

    const isFloorPickable = (floorKey) => {
      if (typeof this.architecture?.isFloorInteractive === 'function') {
        if (!this.architecture.isFloorInteractive(floorKey)) return false;
      }
      const fg = getFloorGroup(this.architecture, floorKey);
      return fg ? fg.visible : true;
    };

    // 优先级 1：12 路摄像头（确保室内摄像头不被外层建筑翼段代理盒遮蔽）
    if (camerasVisible) {
      const hit = this._intersectList(this._cameraProxies, (mesh) => {
        const u = mesh.userData;
        if (!u.isIndoor) return true;
        return isFloorPickable(u.floorKey);
      });
      if (hit) return hit;

      // 优先级 2：3 台大华 NVR 核心机房节点
      const nvrHit = this._intersectList(this._nvrProxies, (mesh) => {
        return isFloorPickable(mesh.userData.floorKey);
      });
      if (nvrHit) return nvrHit;
    }

    // 优先级 3：当前可见的安全防区（11 个四类多边形）
    if (this.safetyZonesLayer?.group?.visible) {
      const filter = this.safetyZonesLayer.getFilter?.() || {};
      const zoneHit = this._intersectList(this._zoneProxies, (mesh) => {
        const u = mesh.userData;
        if (filter[u.zoneType] === false) return false;
        if (u.isIndoor && !isFloorPickable(u.floorKey)) return false;
        return true;
      });
      if (zoneHit) return zoneHit;
    }

    // 优先级 4：BUILDING_WINGS 建筑翼段代理盒
    if (this.architecture?.root?.visible !== false) {
      const wingHit = this._intersectList(this._wingProxies, (mesh) => {
        return isFloorPickable(mesh.userData.floorKey);
      });
      if (wingHit) return wingHit;
    }

    return null;
  }

  _intersectList(proxies, filterFn) {
    const targets = this._pickBuffer;
    targets.length = 0;
    for (let i = 0; i < proxies.length; i++) {
      const mesh = proxies[i];
      if (!filterFn || filterFn(mesh)) {
        targets.push(mesh);
      }
    }
    if (targets.length === 0) return null;

    this._hits.length = 0;
    this._raycaster.intersectObjects(targets, false, this._hits);
    if (this._hits.length === 0) return null;

    const first = this._hits[0];
    const u = first.object.userData;
    return {
      entityType: u.entityType,
      entityId: u.entityId,
      floorKey: u.floorKey,
      groupId: u.groupId || u.config?.groupId,
      point: first.point,
      distance: first.distance,
    };
  }

  hasActiveAnimations() {
    if (this._topologyGroup.visible) return true;
    if (this._entitySelectGroup.visible) return true;
    return false;
  }

  update(time) {
    if (this.disposed) return;

    // 1. 选中摄像头/NVR 地面呼吸脉冲环
    if (this._entitySelectGroup.visible) {
      const cycle = (time * 0.72) % 1;
      const scale = 1.0 + cycle * 1.45;
      this._entitySelectPulse.scale.set(scale, scale, 1);
      this._entitySelectPulseMat.opacity = (1 - cycle) * 0.68;
    }

    // 2. NVR -> 摄像头 3D 二次贝塞尔弧线拓扑光路流光与故障脉冲
    if (this._topologyGroup.visible) {
      for (const bundle of this._nvrTopologyGroups.values()) {
        if (!bundle.group.visible) continue;

        if (bundle.isOffline) {
          // 离线故障态：高辨识猩红呼吸脉冲 + 快速警戒微粒
          const pulse = 0.45 + 0.55 * Math.abs(Math.sin(time * 4.2));
          bundle.lineMat.opacity = 0.52 + pulse * 0.44;
          bundle.tubeMat.opacity = 0.16 + pulse * 0.34;
          bundle.ringMat.opacity = 0.35 + pulse * 0.55;

          for (const arc of bundle.arcs) {
            const t = (time * 0.75 + arc.phase) % 1;
            arc.curve.getPoint(t, arc.bead.position);
            const s = 0.9 + pulse * 0.55;
            arc.bead.scale.setScalar(s);
          }
        } else {
          // 正常在线态：克制冰青数据流光微粒从 NVR 汇聚节点流向各路摄像头
          const dark = Math.max(this.duskFactor, this.nightFactor);
          bundle.lineMat.opacity = THREE.MathUtils.lerp(0.76, 0.92, dark);
          bundle.tubeMat.opacity = THREE.MathUtils.lerp(0.22, 0.32, dark);
          bundle.ringMat.opacity = THREE.MathUtils.lerp(0.58, 0.78, dark);

          for (const arc of bundle.arcs) {
            const t = (time * 0.42 + arc.phase) % 1;
            arc.curve.getPoint(t, arc.bead.position);
            arc.bead.scale.setScalar(0.85);
          }
        }
      }
    }
  }

  _emitStateChange(kind, payload) {
    if (typeof this._onStateChange === 'function') {
      this._onStateChange(kind, payload);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.domElement.removeEventListener('pointerup', this._onPointerUp);
    this.domElement.removeEventListener('pointercancel', this._onPointerCancel);
    this.domElement.removeEventListener('pointerleave', this._onPointerLeave);
    this._syncHoverCursor(false);

    if (this.feedbackGroup.parent) {
      this.feedbackGroup.parent.remove(this.feedbackGroup);
    }

    for (const geo of this._ownedGeometries) {
      geo.dispose();
    }
    for (const mat of this._ownedMaterials) {
      mat.dispose();
    }
    this._ownedGeometries.length = 0;
    this._ownedMaterials.length = 0;
    this._nvrTopologyGroups.clear();
  }
}
