/**
 * 3D-to-2D 零抖动空间锚点系统（SpatialAnchors）
 * - 严禁独立 60Hz rAF 轮询：完全由 CampusTwin.subscribeAnchors 渲染后同帧推送驱动
 * - 三级信息密度：
 *   1) 默认态：告警点位脉冲强调 + 当前分组/选中点位醒目 + 其余在线摄像头微缩静默圆点（绝不杂乱遮挡）
 *   2) Hover 态：单行轻量悬浮胶囊（CAM-01 · W1 危化实验室）
 *   3) 选中态：精密 45° SVG 折线引线 + 水平托线信息卡
 * - 遮挡幽灵化：室内被遮挡点位呈现降透明 + 虚线描边
 * - 视口外边缘吸附（Edge Clamping）：严重告警或离线 NVR 移出安全视口时贴边显示方向箭头芯片
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

function shortCameraTitle(name) {
  if (!name) return '';
  return name.length > 12 ? `${name.slice(0, 12)}…` : name;
}

export class SpatialAnchors {
  constructor({ root, api, onSelect, onHover }) {
    this.root = root;
    this.api = api;
    this.onSelect = onSelect;
    this.onHover = onHover;

    this.entities = new Map(); // id -> { id, type, name, floor, isIndoor, groupId, nvrId, state }
    this.pinNodes = new Map(); // id -> { el, core, pill, pillId, pillName }
    this.edgeNodes = new Map(); // id -> { el, arrowEl, labelEl }
    this.lastPositions = {};

    this.selectedRef = null;
    this.hoveredRef = null;
    this.activeGroupId = null;
    this.focusedFloor = 'all';
    this.camerasLayerVisible = true;
    this.insets = { top: 68, right: 320, bottom: 68, left: 296 };
    this.meta = { explodeFactor: 0, duskFactor: 0 };

    this._unsubAnchors = null;
    this._onResize = () => this.refreshFromApi();

    this._mountDOM();
  }

  _mountDOM() {
    this.layerEl = document.createElement('div');
    this.layerEl.className = 'wb-anchors-layer';

    this.svgEl = createSvgEl('svg', { class: 'wb-leader-svg' });
    this.leaderLineEl = createSvgEl('polyline', { class: 'wb-leader-line' });
    this.leaderDotEl = createSvgEl('circle', { class: 'wb-leader-dot', r: '3.5' });
    this.leaderLineEl.style.display = 'none';
    this.leaderDotEl.style.display = 'none';
    this.svgEl.appendChild(this.leaderLineEl);
    this.svgEl.appendChild(this.leaderDotEl);

    this.leaderCardEl = document.createElement('div');
    this.leaderCardEl.className = 'wb-leader-card wb-chrome';
    this.leaderCardEl.innerHTML = `
      <div class="wb-leader-card__top">
        <span class="wb-leader-card__id wb-num"></span>
        <span class="wb-leader-card__floor wb-num"></span>
      </div>
      <div class="wb-leader-card__name"></div>
      <div class="wb-leader-card__meta">
        <span class="wb-leader-card__status"></span>
        <span class="wb-leader-card__sub wb-num"></span>
      </div>
    `;
    this.leaderCardEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedRef) {
        this.onSelect?.(this.selectedRef, { openPip: true });
      }
    });

    this.edgeLayerEl = document.createElement('div');
    this.edgeLayerEl.className = 'wb-edge-layer';

    this.root.appendChild(this.layerEl);
    this.root.appendChild(this.svgEl);
    this.root.appendChild(this.leaderCardEl);
    this.root.appendChild(this.edgeLayerEl);

    window.addEventListener('resize', this._onResize);
  }

  setEntities({ cameras = [], nvrs = [] }) {
    const prevKey = Array.from(this.entities.keys()).join(',');
    const nextIds = new Set();

    for (const cam of cameras) {
      nextIds.add(cam.id);
      this.entities.set(cam.id, {
        id: cam.id,
        type: 'camera',
        name: cam.name,
        floor: cam.floor,
        isIndoor: Boolean(cam.isIndoor),
        groupId: cam.groupId,
        nvrId: cam.nvrId,
        state: cam.state || 'online',
      });
      if (!this.pinNodes.has(cam.id)) {
        this._createPinNode(cam.id, 'camera');
      }
    }

    for (const nvr of nvrs) {
      nextIds.add(nvr.id);
      this.entities.set(nvr.id, {
        id: nvr.id,
        type: 'nvr',
        name: nvr.name,
        floor: nvr.floor || '1F',
        isIndoor: true,
        groupId: 'grp-nvr-room',
        nvrId: nvr.id,
        state: nvr.status === 'offline' ? 'nvr_offline' : 'online',
        ip: nvr.ip,
      });
      if (!this.pinNodes.has(nvr.id)) {
        this._createPinNode(nvr.id, 'nvr');
      }
    }

    // 清理不再存在的节点
    for (const [id, node] of this.pinNodes.entries()) {
      if (!nextIds.has(id)) {
        node.el.remove();
        this.pinNodes.delete(id);
        this.entities.delete(id);
      }
    }

    this._syncPinVisualClasses();
    const nextKey = Array.from(this.entities.keys()).join(',');
    if (!this._unsubAnchors || prevKey !== nextKey) {
      this._bindSubscription();
    } else if (Object.keys(this.lastPositions).length > 0) {
      this.renderPositions(this.lastPositions);
    }
  }

  _createPinNode(id, type) {
    const el = document.createElement('div');
    el.className = 'wb-anchor-pin is-hidden';
    el.dataset.entityId = id;
    el.dataset.entityType = type;

    const core = document.createElement('div');
    core.className = 'wb-pin-core';

    const pulse = document.createElement('span');
    pulse.className = 'wb-pin-pulse';
    const dot = document.createElement('span');
    dot.className = 'wb-pin-dot';

    core.appendChild(pulse);
    core.appendChild(dot);

    const pill = document.createElement('div');
    pill.className = 'wb-pin-pill';
    const pillId = document.createElement('span');
    pillId.className = 'wb-pin-pill__id wb-num';
    const pillSep = document.createElement('span');
    pillSep.textContent = '·';
    pillSep.style.opacity = '0.45';
    const pillName = document.createElement('span');
    pillName.className = 'wb-pin-pill__name';

    pill.appendChild(pillId);
    pill.appendChild(pillSep);
    pill.appendChild(pillName);

    el.appendChild(core);
    el.appendChild(pill);

    el.addEventListener('mouseenter', () => {
      this.onHover?.({ type, id });
    });
    el.addEventListener('mouseleave', () => {
      this.onHover?.(null);
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSelect?.({ type, id }, { flyTo: true, openPip: type === 'camera' });
    });

    this.layerEl.appendChild(el);
    this.pinNodes.set(id, { el, core, pill, pillId, pillName });
  }

  _bindSubscription() {
    if (this._unsubAnchors) {
      this._unsubAnchors();
      this._unsubAnchors = null;
    }

    const ids = Array.from(this.entities.keys());
    if (ids.length === 0) return;

    if (typeof this.api?.subscribeAnchors === 'function') {
      this._unsubAnchors = this.api.subscribeAnchors(ids, (positions, meta) => {
        if (meta) this.meta = { ...this.meta, ...meta };
        this.renderPositions(positions || {});
      });
    } else {
      // 无 v2 subscribeAnchors 时的优雅静态回退（不启 60Hz rAF）
      this.refreshFromApi();
    }
  }

  refreshFromApi() {
    const ids = Array.from(this.entities.keys());
    if (ids.length === 0 || !this.api) return;

    if (typeof this.api.getScreenPositions === 'function') {
      const map = this.api.getScreenPositions(ids);
      this.renderPositions(map || {});
    } else if (typeof this.api.getScreenPosition === 'function') {
      const map = {};
      for (const id of ids) {
        map[id] = this.api.getScreenPosition(id);
      }
      this.renderPositions(map);
    }
  }

  setInsets(insets) {
    this.insets = { ...this.insets, ...insets };
    if (Object.keys(this.lastPositions).length > 0) {
      this.renderPositions(this.lastPositions);
    }
  }

  setUiState({ selectedRef, hoveredRef, activeGroupId, focusedFloor, camerasLayerVisible }) {
    if (selectedRef !== undefined) this.selectedRef = selectedRef;
    if (hoveredRef !== undefined) this.hoveredRef = hoveredRef;
    if (activeGroupId !== undefined) this.activeGroupId = activeGroupId;
    if (focusedFloor !== undefined) this.focusedFloor = focusedFloor;
    if (camerasLayerVisible !== undefined) this.camerasLayerVisible = Boolean(camerasLayerVisible);

    this._syncPinVisualClasses();
    if (Object.keys(this.lastPositions).length > 0) {
      this.renderPositions(this.lastPositions);
    }
  }

  _syncPinVisualClasses() {
    for (const [id, ent] of this.entities.entries()) {
      const node = this.pinNodes.get(id);
      if (!node) continue;

      const isSelected = this.selectedRef?.id === id;
      const isHovered = this.hoveredRef?.id === id;
      const isCritical = ent.state === 'alarm_critical' || ent.state === 'nvr_offline';
      const isWarning = ent.state === 'alarm_order';
      const isAlarm = isCritical || isWarning;
      const inActiveGroup = Boolean(this.activeGroupId && ent.groupId === this.activeGroupId);

      // NVR 在线时静默隐藏空间针，仅在离线或选中/悬停时显示，避免机房三点堆叠
      const shouldShowPin =
        ent.type === 'nvr'
          ? isCritical || isSelected || isHovered
          : isAlarm || isSelected || isHovered || this.camerasLayerVisible;

      node.pillId.textContent = ent.id;
      node.pillName.textContent = shortCameraTitle(ent.name);

      const cls = ['wb-anchor-pin'];
      if (!shouldShowPin) cls.push('is-hidden');
      if (isSelected) cls.push('is-selected');
      if (isHovered) cls.push('is-hovered');
      if (isAlarm) cls.push('is-alarm');
      if (inActiveGroup) cls.push('is-emphasized');
      if (!isAlarm && !isSelected && !isHovered && !inActiveGroup) {
        cls.push('is-compact');
      }
      cls.push(`is-${ent.state}`);

      node.el.className = cls.join(' ');
    }
  }

  renderPositions(positions) {
    this.lastPositions = positions;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const safeLeft = Math.min(vw * 0.4, (this.insets.left || 16) + 18);
    const safeRight = Math.max(vw * 0.6, vw - (this.insets.right || 16) - 18);
    const safeTop = Math.min(vh * 0.35, (this.insets.top || 64) + 16);
    const safeBottom = Math.max(vh * 0.65, vh - (this.insets.bottom || 64) - 16);

    const activeEdgeIds = new Set();

    for (const [id, ent] of this.entities.entries()) {
      const node = this.pinNodes.get(id);
      if (!node) continue;

      const pos = positions[id];
      const isCritical = ent.state === 'alarm_critical' || ent.state === 'nvr_offline';
      const isSelected = this.selectedRef?.id === id;
      const isHovered = this.hoveredRef?.id === id;
      const isAlarm = isCritical || ent.state === 'alarm_order';

      const shouldShow =
        ent.type === 'nvr'
          ? isCritical || isSelected || isHovered
          : isAlarm || isSelected || isHovered || this.camerasLayerVisible;

      if (!pos || !shouldShow) {
        node.el.classList.add('is-hidden');
        continue;
      }

      const inFront = pos.visible !== false && (pos.ndcZ === undefined || (pos.ndcZ >= -1 && pos.ndcZ <= 1));
      const inSafeBounds =
        inFront &&
        pos.x >= safeLeft - 12 &&
        pos.x <= safeRight + 12 &&
        pos.y >= safeTop - 12 &&
        pos.y <= safeBottom + 12;

      if (inSafeBounds) {
        node.el.classList.remove('is-hidden');
        node.el.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;

        // 遮挡幽灵化：优先使用 v2 API 返回的 occluded，否则对未爆炸时的室内点位轻度幽灵化
        const fallbackOccluded =
          ent.isIndoor &&
          (this.meta.explodeFactor || 0) < 0.16 &&
          this.focusedFloor === 'all' &&
          !isSelected;
        const isOccluded = typeof pos.occluded === 'boolean' ? pos.occluded : fallbackOccluded;
        node.el.classList.toggle('is-occluded', isOccluded);
      } else {
        node.el.classList.add('is-hidden');

        // 严重告警 / NVR 离线移出安全视口时，启用 Edge Clamping 方向箭头指示
        if (isCritical) {
          activeEdgeIds.add(id);
          this._updateEdgeChip(ent, pos, {
            safeLeft,
            safeRight,
            safeTop,
            safeBottom,
            vw,
            vh,
            inFront,
          });
        }
      }
    }

    // 清理不再需要贴边的 Edge Clamping 芯片
    for (const [id, edge] of this.edgeNodes.entries()) {
      if (!activeEdgeIds.has(id)) {
        edge.el.remove();
        this.edgeNodes.delete(id);
      }
    }

    this._renderSelectedLeader(positions, { safeLeft, safeRight, safeTop, safeBottom });
  }

  _updateEdgeChip(ent, pos, bounds) {
    let chip = this.edgeNodes.get(ent.id);
    if (!chip) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'wb-edge-chip';
      el.innerHTML = `
        <span class="wb-edge-chip__arrow">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 6h8M7 2.5L10.5 6 7 9.5"/>
          </svg>
        </span>
        <span class="wb-edge-chip__label wb-num"></span>
      `;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelect?.({ type: ent.type, id: ent.id }, { flyTo: true, openPip: ent.type === 'camera' });
      });
      this.edgeLayerEl.appendChild(el);
      chip = {
        el,
        arrowEl: el.querySelector('.wb-edge-chip__arrow'),
        labelEl: el.querySelector('.wb-edge-chip__label'),
      };
      this.edgeNodes.set(ent.id, chip);
    }

    const cx = (bounds.safeLeft + bounds.safeRight) * 0.5;
    const cy = (bounds.safeTop + bounds.safeBottom) * 0.5;
    let dx = pos.x - cx;
    let dy = pos.y - cy;
    if (!bounds.inFront) {
      dx = -dx;
      dy = -dy;
    }
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) dx = 1;

    const halfW = Math.max(80, (bounds.safeRight - bounds.safeLeft) * 0.5 - 66);
    const halfH = Math.max(60, (bounds.safeBottom - bounds.safeTop) * 0.5 - 22);
    const scale = Math.min(
      Math.abs(dx) > 0.001 ? halfW / Math.abs(dx) : Infinity,
      Math.abs(dy) > 0.001 ? halfH / Math.abs(dy) : Infinity
    );
    const clampedX = cx + dx * scale;
    const clampedY = cy + dy * scale;
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    chip.el.style.transform = `translate3d(${Math.round(clampedX)}px, ${Math.round(clampedY)}px, 0)`;
    chip.arrowEl.style.transform = `rotate(${angleDeg.toFixed(1)}deg)`;
    chip.labelEl.textContent = ent.type === 'nvr' ? `${ent.id} 离线` : `${ent.id} 告警`;
  }

  _renderSelectedLeader(positions, bounds) {
    const ref = this.selectedRef;
    const ent = ref ? this.entities.get(ref.id) : null;
    const pos = ref ? positions[ref.id] : null;

    if (!ent || !pos || pos.visible === false || (pos.ndcZ !== undefined && (pos.ndcZ < -1 || pos.ndcZ > 1))) {
      this.leaderLineEl.style.display = 'none';
      this.leaderDotEl.style.display = 'none';
      this.leaderCardEl.classList.remove('is-visible');
      return;
    }

    const x0 = Math.round(pos.x);
    const y0 = Math.round(pos.y);
    if (x0 < bounds.safeLeft - 24 || x0 > bounds.safeRight + 24 || y0 < bounds.safeTop - 24 || y0 > bounds.safeBottom + 24) {
      this.leaderLineEl.style.display = 'none';
      this.leaderDotEl.style.display = 'none';
      this.leaderCardEl.classList.remove('is-visible');
      return;
    }

    // 根据安全区边界自动决定 45° 引线朝向，防止托牌裁切
    const cardW = 198;
    const cardH = 56;
    const goLeft = x0 + 30 + cardW > bounds.safeRight;
    const goDown = y0 - 30 - cardH < bounds.safeTop;

    const dirX = goLeft ? -1 : 1;
    const dirY = goDown ? 1 : -1;
    const kneeX = x0 + dirX * 26;
    const kneeY = y0 + dirY * 26;
    const endX = kneeX + dirX * 140;

    this.leaderLineEl.setAttribute('points', `${x0},${y0} ${kneeX},${kneeY} ${endX},${kneeY}`);
    this.leaderLineEl.style.display = '';
    this.leaderDotEl.setAttribute('cx', String(x0));
    this.leaderDotEl.setAttribute('cy', String(y0));
    this.leaderDotEl.style.display = '';

    const isCritical = ent.state === 'alarm_critical' || ent.state === 'nvr_offline';
    const isWarning = ent.state === 'alarm_order';
    const isOccluded =
      typeof pos.occluded === 'boolean'
        ? pos.occluded
        : ent.isIndoor && (this.meta.explodeFactor || 0) < 0.16 && this.focusedFloor === 'all';

    this.leaderLineEl.setAttribute(
      'class',
      `wb-leader-line${isCritical ? ' is-critical' : isWarning ? ' is-warning' : ''}${isOccluded ? ' is-occluded' : ''}`
    );
    this.leaderDotEl.setAttribute(
      'class',
      `wb-leader-dot${isCritical ? ' is-critical' : isWarning ? ' is-warning' : ''}`
    );

    const statusLabelMap = {
      online: '运行正常',
      offline: '上游 NVR 离线',
      muted: '已静默',
      alarm_critical: '严重告警',
      alarm_order: '秩序预警',
      nvr_offline: '节点离线·根因收敛',
    };

    this.leaderCardEl.querySelector('.wb-leader-card__id').textContent = ent.id;
    this.leaderCardEl.querySelector('.wb-leader-card__floor').textContent =
      ent.floor === 'outdoor' ? '室外' : ent.floor || '1F';
    this.leaderCardEl.querySelector('.wb-leader-card__name').textContent = ent.name;
    this.leaderCardEl.querySelector('.wb-leader-card__status').textContent =
      statusLabelMap[ent.state] || '在线';
    this.leaderCardEl.querySelector('.wb-leader-card__sub').textContent =
      ent.type === 'nvr' ? ent.ip || '核心机房' : `${ent.nvrId} · 点击预览`;

    this.leaderCardEl.className = `wb-leader-card wb-chrome is-visible${
      isCritical ? ' is-critical' : isWarning ? ' is-warning' : ''
    }`;

    const cardLeft = goLeft ? kneeX - cardW : kneeX;
    const cardTop = goDown ? kneeY + 5 : kneeY - cardH - 5;
    this.leaderCardEl.style.transform = `translate3d(${Math.round(cardLeft)}px, ${Math.round(cardTop)}px, 0)`;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this._unsubAnchors) {
      this._unsubAnchors();
      this._unsubAnchors = null;
    }
    this.layerEl?.remove();
    this.svgEl?.remove();
    this.leaderCardEl?.remove();
    this.edgeLayerEl?.remove();
    this.pinNodes.clear();
    this.edgeNodes.clear();
    this.entities.clear();
  }
}
