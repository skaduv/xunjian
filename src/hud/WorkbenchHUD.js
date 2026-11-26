import './workbench.css';
import { SpatialAnchors } from './SpatialAnchors.js';
import { PipViewer } from './PipViewer.js';

/**
 * IOPLY · 园区智能安全巡检工作台主控 HUD（挂载于 #hud-root）
 * 核心能力：
 * 1. 顶部 48px 轻量化状态胶囊：品牌 + 4 项实时 KPI + Ctrl+K 全局快搜 + 三态昼暮夜切换 + 专注看模
 * 2. 左侧 272px 可折叠抽屉：[NVR 设备树（支持真实模拟掉线与上游故障收敛）] / [园区 11 分组]
 * 3. 右侧 296px 可折叠抽屉：AI 安全告警流（全部 / AI 安防 / 设备运维，3 行高扫读卡片 + 根因收敛卡）
 * 4. 底部 44px 居中单排控制坞 + 垂直五层楼层胶囊尺（支持四类防区向上浮层与自动巡检联动）
 * 5. 3D-to-2D 零抖动空间锚点（45° 引线 + 遮挡幽灵化 + Edge Clamping）与 320×180 AI 画中画卡
 * 6. 视口安全区光学居中补偿（setViewportInsets）+ 完整 HMR dispose() 零残留清理
 */

const FLOOR_ITEMS = [
  { key: 'floatingCanopy', label: '顶棚' },
  { key: 'roof', label: '屋顶' },
  { key: '3F', label: '3F' },
  { key: '2F', label: '2F' },
  { key: '1F', label: '1F' },
  { key: 'all', label: '全部' },
];

const ZONE_META = [
  { key: 'restricted', label: '禁止区域', colorVar: 'var(--zone-restricted)' },
  { key: 'parking', label: '合规停车', colorVar: 'var(--zone-parking)' },
  { key: 'firelane', label: '消防通道', colorVar: 'var(--zone-firelane)' },
  { key: 'ignore', label: '屏蔽忽略', colorVar: 'var(--zone-ignore)' },
];

function createInitialDemoAlarms() {
  return [
    {
      id: 'ALM-101',
      category: 'ai',
      severity: 'critical',
      cameraId: 'CAM-01',
      zoneId: 'ZONE-R01',
      floor: '1F',
      scenario: 'hazmat',
      title: 'W1 危化实验室禁区人员越界',
      detail: '未授权人员闯入高压电池禁区 · 置信度 96.4%',
      time: '14:22:08',
      status: 'active',
    },
    {
      id: 'ALM-102',
      category: 'ai',
      severity: 'warning',
      cameraId: 'CAM-02',
      zoneId: 'ZONE-F01',
      floor: '1F',
      scenario: 'firelane',
      title: 'W2 一层消防疏散通道堆物占用',
      detail: '通道滞留大型设备箱超 4 分钟 · 置信度 93.1%',
      time: '14:19:41',
      status: 'active',
    },
    {
      id: 'ALM-103',
      category: 'ai',
      severity: 'warning',
      cameraId: 'CAM-09',
      zoneId: 'ZONE-F03',
      floor: 'outdoor',
      scenario: 'parking',
      title: '北迎宾主干道消防禁停段违停',
      detail: '车辆 苏D·8F29A 禁停段滞留 06:42 · 置信度 98.2%',
      time: '14:15:26',
      status: 'active',
    },
  ];
}

function nowTimeStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const ICONS = {
  brand: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5L17 6.5v7L10 17.5 3 13.5v-7L10 2.5z"/><path d="M10 17.5v-7M17 6.5l-7 4-7-4"/></svg>`,
  search: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>`,
  sun: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.8"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/></svg>`,
  dusk: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 11.5h12M4 11.5a4 4 0 018 0M8 3.5v2M3.5 6.8l1.2 1.2M12.5 6.8l-1.2 1.2"/></svg>`,
  moon: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 9.7A5.2 5.2 0 116.3 3a4.2 4.2 0 006.7 6.7z"/></svg>`,
  focus: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8 10 12.5"/></svg>`,
  chevronRight: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>`,
  chevronDown: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>`,
  server: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="4.5" rx="1.2"/><rect x="2" y="9" width="12" height="4.5" rx="1.2"/><circle cx="4.5" cy="4.75" r="0.6" fill="currentColor"/><circle cx="4.5" cy="11.25" r="0.6" fill="currentColor"/></svg>`,
  shield: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l5 2v4c0 3.1-2.1 5.2-5 6-2.9-.8-5-2.9-5-6V4l5-2z"/><path d="M8 5.5v3M8 10.7h.01"/></svg>`,
  layers: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2L14 5.5 8 8.8 2 5.5 8 2.2z"/><path d="M2 8.6L8 11.9 14 8.6"/><path d="M2 11.6L8 14.8 14 11.6"/></svg>`,
  camera: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="4.5" width="8.8" height="7" rx="1.5"/><path d="M10.6 7l3.6-1.8v5.6L10.6 9"/></svg>`,
  fov: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l11.5-5v10L2 8z"/></svg>`,
  zone: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="8,2 14,5.5 12,13.5 4,13.5 2,5.5"/></svg>`,
  play: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3.3l8 4.7-8 4.7V3.3z"/></svg>`,
  pause: `<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3.2" width="2.8" height="9.6" rx="0.8"/><rect x="9.2" y="3.2" width="2.8" height="9.6" rx="0.8"/></svg>`,
  reset: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 101.4-3.5L3 6"/><path d="M3 2.8V6h3.2"/></svg>`,
  checkCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.3 2.3 4.8-5"/></svg>`,
  spark: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"/></svg>`,
};

class WorkbenchHUDController {
  constructor({ mountEl, api }) {
    this.mountEl = mountEl;
    this.api = api;

    this.catalog = null;
    this.alarms = createInitialDemoAlarms();
    this.collapsedNvrs = new Set();

    this.state = {
      leftOpen: true,
      rightOpen: true,
      focusMode: false,
      prevDrawerState: { leftOpen: true, rightOpen: true },
      leftTab: 'nvr', // 'nvr' | 'groups'
      alarmFilter: 'all', // 'all' | 'ai' | 'ops'
      selectedRef: null, // { type, id }
      hoveredRef: null,
      activeGroupId: null,
      focusedFloor: 'all',
      exploded: false,
      lightingMode: 'day',
      layers: {
        cameras: true,
        cameraFov: false,
        safetyZones: false,
      },
      zoneFilter: {
        restricted: true,
        parking: true,
        firelane: true,
        ignore: true,
      },
      zonePopoverOpen: false,
      demoMenuOpen: false,
      cmdOpen: false,
      cmdQuery: '',
      cmdActiveIdx: 0,
      singleFovCamId: null,
      patrol: { status: 'idle', index: 0, total: 12, currentTarget: null },
    };

    this._unsubs = [];
    this._toastTimer = 0;
    this._bodyObserver = null;
    this._disposed = false;

    this._init();
  }

  _init() {
    this.mountEl.innerHTML = '';
    document.body.classList.add('workbench-active');

    this.shellEl = document.createElement('div');
    this.shellEl.className = 'wb-shell';
    this.mountEl.appendChild(this.shellEl);

    // 1. 同步初始 3D 状态与演示告警到 3D 底座
    this._refreshCatalog();
    this._applyDemoAlarmsTo3D();
    this._refreshCatalog();

    // 2. 初始化空间锚点层与 320×180 AI 画中画组件
    this.anchors = new SpatialAnchors({
      root: this.shellEl,
      api: this.api,
      onSelect: (ref, opts) => this._handleEntitySelect(ref, opts),
      onHover: (ref) => this._handleEntityHover(ref, { fromCanvas: false }),
    });

    this.pip = new PipViewer({
      root: this.shellEl,
      onLocate: (cameraId) => this._focusCameraIn3D(cameraId),
      onToggleFov: (cameraId, enabled) => this._setSingleCameraFov(enabled ? cameraId : null),
      onAcknowledge: (alarmId) => this._acknowledgeAlarm(alarmId),
      onClose: () => {
        if (this.state.singleFovCamId) {
          this._setSingleCameraFov(null);
        }
      },
    });

    // 3. 构建四大悬浮区 DOM
    this._buildTopBar();
    this._buildLeftDrawer();
    this._buildRightDrawer();
    this._buildFloorRuler();
    this._buildBottomDock();
    this._buildCommandPalette();
    this._buildToast();

    // 4. 绑定事件、快捷键、3D 双向联动与主题观察器
    this._bindGlobalEvents();
    this._bindApiEvents();
    this._bindThemeObserver();

    // 5. 首次全量渲染与视口安全区光学居中补偿（并触发初始黄金视距适配，避免双栏裁切白模底座）
    this.anchors.setEntities({
      cameras: this.catalog.cameras,
      nvrs: this.catalog.nvrs,
    });
    this._syncAllUI();
    this._syncViewportInsets();
    this.api.resetView?.({ duration: 220 });
  }

  _refreshCatalog() {
    this.catalog = this.api.getCatalog();
    this.state.exploded = Boolean(this.catalog.state?.exploded);
    this.state.focusedFloor = this.catalog.state?.focusedFloor || 'all';
    this.state.lightingMode = this.catalog.state?.lightingMode || this._detectBodyTheme();
    this.state.layers = {
      cameras: Boolean(this.catalog.layers?.cameras),
      cameraFov: Boolean(this.catalog.layers?.cameraFov),
      safetyZones: Boolean(this.catalog.layers?.safetyZones),
    };
    if (this.catalog.state?.safetyZoneFilter) {
      this.state.zoneFilter = { ...this.catalog.state.safetyZoneFilter };
    }
    if (typeof this.api.getPatrolState === 'function') {
      const p = this.api.getPatrolState();
      if (p) this.state.patrol = { ...this.state.patrol, ...p };
    }
  }

  _detectBodyTheme() {
    if (document.body.classList.contains('mode-night')) return 'night';
    if (document.body.classList.contains('mode-dusk')) return 'dusk';
    return 'day';
  }

  _applyDemoAlarmsTo3D() {
    this._suppressApiStateSync = true;
    try {
      for (const alarm of this.alarms) {
        if (alarm.category !== 'ai' || alarm.status !== 'active') continue;
        const targetState = alarm.severity === 'critical' ? 'alarm_critical' : 'alarm_order';
        this.api.setCameraState?.(alarm.cameraId, targetState);
      }
    } finally {
      this._suppressApiStateSync = false;
    }
  }

  /* ======================== DOM 构建 ======================== */

  _buildTopBar() {
    this.topbarEl = document.createElement('header');
    this.topbarEl.className = 'wb-topbar wb-chrome';
    this.topbarEl.innerHTML = `
      <div class="wb-brand">
        <div class="wb-brand__mark">${ICONS.brand}</div>
        <div class="wb-brand__text">
          <span class="wb-brand__code">IOPLY</span>
          <span class="wb-brand__sep">·</span>
          <span class="wb-brand__title">园区智能安全巡检工作台</span>
        </div>
      </div>

      <div class="wb-kpi-strip">
        <button type="button" class="wb-kpi-pill" data-kpi="cameras" title="查看摄像头设备树">
          <span class="wb-kpi-pill__dot" data-kpi-dot="cameras"></span>
          <span class="wb-kpi-pill__label">在线摄像机</span>
          <span class="wb-kpi-pill__val wb-num" data-kpi-val="cameras">12/12</span>
        </button>
        <button type="button" class="wb-kpi-pill" data-kpi="nvrs" title="查看大华 NVR 汇聚节点">
          <span class="wb-kpi-pill__dot" data-kpi-dot="nvrs"></span>
          <span class="wb-kpi-pill__label">大华 NVR</span>
          <span class="wb-kpi-pill__val wb-num" data-kpi-val="nvrs">3/3</span>
        </button>
        <button type="button" class="wb-kpi-pill" data-kpi="alarms" title="展开安全告警队列">
          <span class="wb-kpi-pill__dot" data-kpi-dot="alarms"></span>
          <span class="wb-kpi-pill__label">待处置告警</span>
          <span class="wb-kpi-pill__val wb-num" data-kpi-val="alarms">0</span>
        </button>
        <button type="button" class="wb-kpi-pill" data-kpi="patrol" title="启停自动巡检">
          <span class="wb-kpi-pill__dot is-idle" data-kpi-dot="patrol"></span>
          <span class="wb-kpi-pill__label">巡检态</span>
          <span class="wb-kpi-pill__val wb-num" data-kpi-val="patrol">待命</span>
        </button>
      </div>

      <div class="wb-top-actions">
        <button type="button" class="wb-search-trigger" data-act="open-cmd" title="快速搜索摄像机、NVR、分组或防区">
          ${ICONS.search}
          <span>快搜点位</span>
          <kbd class="wb-kbd">Ctrl K</kbd>
        </button>

        <div class="wb-segmented" role="group" aria-label="昼夜光照模式">
          <button type="button" class="wb-seg-btn" data-light="day" title="白模日间棚拍">${ICONS.sun}<span>白模日间</span></button>
          <button type="button" class="wb-seg-btn" data-light="dusk" title="暮光蓝调巡检">${ICONS.dusk}<span>暮光</span></button>
          <button type="button" class="wb-seg-btn" data-light="night" title="星夜实景巡检">${ICONS.moon}<span>夜间</span></button>
        </div>

        <button type="button" class="wb-btn wb-focus-btn" data-act="toggle-focus" title="一键折叠侧栏专注看模">
          ${ICONS.focus}
          <span>专注看模</span>
        </button>
      </div>
    `;

    this.topbarEl.addEventListener('click', (e) => {
      const kpiBtn = e.target.closest('[data-kpi]');
      if (kpiBtn) {
        const k = kpiBtn.dataset.kpi;
        if (k === 'cameras' || k === 'nvrs') {
          this.state.leftTab = 'nvr';
          this._setDrawers({ leftOpen: true });
        } else if (k === 'alarms') {
          this._setDrawers({ rightOpen: true });
        } else if (k === 'patrol') {
          this._togglePatrol();
        }
        return;
      }

      const lightBtn = e.target.closest('[data-light]');
      if (lightBtn) {
        this._setLightingMode(lightBtn.dataset.light);
        return;
      }

      const actBtn = e.target.closest('[data-act]');
      if (!actBtn) return;
      if (actBtn.dataset.act === 'open-cmd') {
        this._openCommandPalette();
      } else if (actBtn.dataset.act === 'toggle-focus') {
        this._toggleFocusMode();
      }
    });

    this.shellEl.appendChild(this.topbarEl);
  }

  _buildLeftDrawer() {
    this.leftDrawerEl = document.createElement('aside');
    this.leftDrawerEl.className = 'wb-drawer wb-drawer--left wb-chrome';
    this.leftDrawerEl.setAttribute('aria-label', '设备树与园区空间分组');
    this.leftDrawerEl.innerHTML = `
      <div class="wb-drawer__head">
        <div class="wb-drawer__tabs" role="tablist">
          <button type="button" class="wb-tab-btn is-active" data-ltab="nvr">NVR 设备树</button>
          <button type="button" class="wb-tab-btn" data-ltab="groups">园区 11 分组</button>
        </div>
        <button type="button" class="wb-btn wb-icon-btn" data-act="collapse-left" title="收起左侧设备栏">
          ${ICONS.chevronLeft}
        </button>
      </div>
      <div class="wb-drawer__body" data-left-body></div>
    `;

    this.leftBodyEl = this.leftDrawerEl.querySelector('[data-left-body]');

    this.leftDrawerEl.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('[data-ltab]');
      if (tabBtn) {
        this.state.leftTab = tabBtn.dataset.ltab;
        this._renderLeftDrawer();
        return;
      }

      if (e.target.closest('[data-act="collapse-left"]')) {
        this._setDrawers({ leftOpen: false });
        return;
      }

      const simBtn = e.target.closest('[data-nvr-toggle]');
      if (simBtn) {
        e.stopPropagation();
        this._toggleNvrOffline(simBtn.dataset.nvrToggle);
        return;
      }

      const nvrHead = e.target.closest('[data-nvr-head]');
      if (nvrHead) {
        const nvrId = nvrHead.dataset.nvrHead;
        if (e.target.closest('[data-nvr-collapse]')) {
          if (this.collapsedNvrs.has(nvrId)) this.collapsedNvrs.delete(nvrId);
          else this.collapsedNvrs.add(nvrId);
          this._renderLeftDrawer();
        } else {
          this._handleEntitySelect({ type: 'nvr', id: nvrId }, { flyTo: true });
        }
        return;
      }

      const camRow = e.target.closest('[data-cam-id]');
      if (camRow) {
        const camId = camRow.dataset.camId;
        this._handleEntitySelect({ type: 'camera', id: camId }, { flyTo: true, openPip: true });
        return;
      }

      const grpItem = e.target.closest('[data-group-id]');
      if (grpItem) {
        this._selectGroup(grpItem.dataset.groupId);
      }
    });

    this.leftDrawerEl.addEventListener('mouseover', (e) => {
      const camRow = e.target.closest('[data-cam-id]');
      if (camRow) {
        this._handleEntityHover({ type: 'camera', id: camRow.dataset.camId });
      }
    });
    this.leftDrawerEl.addEventListener('mouseleave', () => {
      this._handleEntityHover(null);
    });

    // 折叠后的左缘恢复胶囊
    this.leftRestoreEl = document.createElement('button');
    this.leftRestoreEl.type = 'button';
    this.leftRestoreEl.className = 'wb-edge-restore wb-edge-restore--left wb-chrome is-hidden';
    this.leftRestoreEl.innerHTML = `${ICONS.chevronRight}<span>设备树</span>`;
    this.leftRestoreEl.addEventListener('click', () => this._setDrawers({ leftOpen: true }));

    this.shellEl.appendChild(this.leftDrawerEl);
    this.shellEl.appendChild(this.leftRestoreEl);
  }

  _buildRightDrawer() {
    this.rightDrawerEl = document.createElement('aside');
    this.rightDrawerEl.className = 'wb-drawer wb-drawer--right wb-chrome';
    this.rightDrawerEl.setAttribute('aria-label', 'AI 安全告警队列');
    this.rightDrawerEl.innerHTML = `
      <div class="wb-drawer__head">
        <div class="wb-drawer__title-row">
          <span class="wb-drawer__title">安全告警队列</span>
          <span class="wb-drawer__badge wb-num" data-alarm-badge>0</span>
        </div>
        <div class="wb-drawer__head-actions">
          <button type="button" class="wb-btn" style="height:24px;padding:0 7px;font-size:10.5px;" data-act="toggle-demo" title="触发巡检与故障演练场景">
            ${ICONS.spark}<span>演练</span>
          </button>
          <div class="wb-demo-menu wb-chrome" data-demo-menu>
            <button type="button" class="wb-menu-item" data-demo="nvr-01">模拟 NVR-01 掉线收敛</button>
            <button type="button" class="wb-menu-item" data-demo="nvr-02">模拟 NVR-02 掉线收敛</button>
            <button type="button" class="wb-menu-item" data-demo="e3-fire">触发 E3 报告厅出口占道</button>
            <button type="button" class="wb-menu-item" data-demo="reset-demos">重置全部 AI 演练告警</button>
          </div>
          <button type="button" class="wb-btn wb-icon-btn" data-act="collapse-right" title="收起右侧告警栏">
            ${ICONS.chevronRight}
          </button>
        </div>
      </div>

      <div class="wb-filter-bar" role="tablist">
        <button type="button" class="wb-filter-pill is-active" data-af="all">
          <span>全部</span><span class="wb-filter-pill__count wb-num" data-afc="all">0</span>
        </button>
        <button type="button" class="wb-filter-pill" data-af="ai">
          <span>AI 安防</span><span class="wb-filter-pill__count wb-num" data-afc="ai">0</span>
        </button>
        <button type="button" class="wb-filter-pill" data-af="ops">
          <span>设备运维</span><span class="wb-filter-pill__count wb-num" data-afc="ops">0</span>
        </button>
      </div>

      <div class="wb-drawer__body" data-right-body></div>
    `;

    this.rightBodyEl = this.rightDrawerEl.querySelector('[data-right-body]');
    this.demoMenuEl = this.rightDrawerEl.querySelector('[data-demo-menu]');

    this.rightDrawerEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="collapse-right"]')) {
        this._setDrawers({ rightOpen: false });
        return;
      }

      if (e.target.closest('[data-act="toggle-demo"]')) {
        e.stopPropagation();
        this.state.demoMenuOpen = !this.state.demoMenuOpen;
        this.demoMenuEl.classList.toggle('is-open', this.state.demoMenuOpen);
        return;
      }

      const demoBtn = e.target.closest('[data-demo]');
      if (demoBtn) {
        e.stopPropagation();
        this.state.demoMenuOpen = false;
        this.demoMenuEl.classList.remove('is-open');
        this._runDemoScenario(demoBtn.dataset.demo);
        return;
      }

      const filterBtn = e.target.closest('[data-af]');
      if (filterBtn) {
        this.state.alarmFilter = filterBtn.dataset.af;
        this._renderRightDrawer();
        return;
      }

      const cardAct = e.target.closest('[data-alarm-act]');
      if (cardAct) {
        e.stopPropagation();
        const alarmId = cardAct.dataset.alarmId;
        const act = cardAct.dataset.alarmAct;
        if (act === 'locate') this._locateAlarm(alarmId);
        else if (act === 'confirm') this._acknowledgeAlarm(alarmId);
        else if (act === 'mute') this._muteAlarm(alarmId);
        else if (act === 'retry-nvr') this._toggleNvrOffline(cardAct.dataset.nvrId, false);
        return;
      }

      const card = e.target.closest('[data-alarm-card]');
      if (card) {
        this._locateAlarm(card.dataset.alarmCard);
      }
    });

    // 折叠后的右缘恢复胶囊
    this.rightRestoreEl = document.createElement('button');
    this.rightRestoreEl.type = 'button';
    this.rightRestoreEl.className = 'wb-edge-restore wb-edge-restore--right wb-chrome is-hidden';
    this.rightRestoreEl.innerHTML = `<span data-right-restore-label>告警</span><span class="wb-drawer__badge wb-num" data-right-restore-badge>0</span>${ICONS.chevronLeft}`;
    this.rightRestoreEl.addEventListener('click', () => this._setDrawers({ rightOpen: true }));

    this.shellEl.appendChild(this.rightDrawerEl);
    this.shellEl.appendChild(this.rightRestoreEl);
  }

  _buildFloorRuler() {
    this.floorRulerEl = document.createElement('nav');
    this.floorRulerEl.className = 'wb-floor-ruler wb-chrome';
    this.floorRulerEl.setAttribute('aria-label', '五层建筑楼层标尺');

    const parts = [`<div class="wb-floor-ruler__cap">层高</div>`];
    FLOOR_ITEMS.forEach((item, idx) => {
      if (idx === FLOOR_ITEMS.length - 1) {
        parts.push(`<div class="wb-floor-sep"></div>`);
      }
      parts.push(
        `<button type="button" class="wb-floor-btn wb-num${item.key === 'all' ? ' is-active' : ''}" data-floor="${item.key}">${item.label}</button>`
      );
    });
    this.floorRulerEl.innerHTML = parts.join('');

    this.floorRulerEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-floor]');
      if (!btn) return;
      this._focusFloor(btn.dataset.floor);
    });

    this.shellEl.appendChild(this.floorRulerEl);
  }

  _buildBottomDock() {
    this.dockWrapEl = document.createElement('div');
    this.dockWrapEl.className = 'wb-dock-wrap';

    this.dockEl = document.createElement('div');
    this.dockEl.className = 'wb-dock wb-chrome';
    this.dockEl.setAttribute('role', 'toolbar');
    this.dockEl.setAttribute('aria-label', '3D 巡检控制坞');

    const zoneRowsHtml = ZONE_META.map(
      (z) => `
        <div class="wb-zone-row" data-zone-type="${z.key}">
          <span class="wb-zone-row__left">
            <span class="wb-zone-swatch" style="background:${z.colorVar};"></span>
            <span>${z.label}</span>
          </span>
          <span class="wb-switch is-on" data-zone-switch="${z.key}"></span>
        </div>
      `
    ).join('');

    this.dockEl.innerHTML = `
      <button type="button" class="wb-btn wb-dock-btn" data-dock="explode" title="切换整体建筑与五层垂直爆炸透视">
        ${ICONS.layers}<span data-explode-label>五层爆炸</span>
      </button>

      <span class="wb-divider-v"></span>

      <button type="button" class="wb-btn wb-dock-btn is-active" data-dock="cameras" title="显隐 12 路 3D 摄像头点位">
        ${ICONS.camera}<span>点位</span>
      </button>
      <button type="button" class="wb-btn wb-dock-btn" data-dock="fov" title="显隐全局 3D 监控视锥">
        ${ICONS.fov}<span>视锥</span>
      </button>
      <button type="button" class="wb-btn wb-dock-btn" data-dock="zones" title="筛选并显隐四类 3D 安全防区">
        ${ICONS.zone}<span>四类防区 ▾</span>
      </button>

      <span class="wb-divider-v"></span>

      <button type="button" class="wb-btn wb-dock-btn wb-dock-btn--patrol" data-dock="patrol" title="启停园区自动巡检漫游">
        <span data-patrol-icon>${ICONS.play}</span>
        <span data-patrol-label>自动巡检</span>
      </button>
      <div class="wb-dock-patrol-steps" data-patrol-steps style="display:none;">
        <button type="button" class="wb-btn wb-dock-step-btn" data-dock="patrol-prev" title="上一个巡检点">${ICONS.chevronLeft}</button>
        <button type="button" class="wb-btn wb-dock-step-btn" data-dock="patrol-next" title="下一个巡检点">${ICONS.chevronRight}</button>
      </div>
      <button type="button" class="wb-btn wb-dock-btn" data-dock="reset" title="平滑复位至 24° 等轴测主视角">
        ${ICONS.reset}<span>视角复位</span>
      </button>

      <div class="wb-zone-popover wb-chrome" data-zone-popover>
        <div class="wb-zone-popover__head">
          <span>3D 安全防区图层</span>
          <span class="wb-switch" data-zone-master></span>
        </div>
        ${zoneRowsHtml}
      </div>
    `;

    this.zonePopoverEl = this.dockEl.querySelector('[data-zone-popover]');

    this.dockEl.addEventListener('click', (e) => {
      const master = e.target.closest('[data-zone-master]');
      if (master) {
        e.stopPropagation();
        this._toggleSafetyZonesLayer();
        return;
      }

      const zoneRow = e.target.closest('[data-zone-type]');
      if (zoneRow) {
        e.stopPropagation();
        this._toggleZoneType(zoneRow.dataset.zoneType);
        return;
      }

      const btn = e.target.closest('[data-dock]');
      if (!btn) return;
      const act = btn.dataset.dock;
      if (act === 'explode') {
        const next = !this.state.exploded;
        this.api.setExploded?.(next);
        this.state.exploded = next;
        if (!next && this.state.focusedFloor !== 'all') {
          this.state.focusedFloor = 'all';
          this.api.focusFloor?.('all');
        }
        this._syncDockAndRuler();
        this._showToast(next ? '已展开五层建筑爆炸透视' : '已恢复整楼闭合形态');
      } else if (act === 'cameras') {
        const next = !this.state.layers.cameras;
        this.api.setLayerVisible?.('cameras', next);
        this.state.layers.cameras = next;
        this.anchors.setUiState({ camerasLayerVisible: next });
        this._syncDockAndRuler();
      } else if (act === 'fov') {
        const next = !this.state.layers.cameraFov;
        this.api.setLayerVisible?.('cameraFov', next);
        this.state.layers.cameraFov = next;
        this._syncDockAndRuler();
      } else if (act === 'zones') {
        e.stopPropagation();
        this.state.zonePopoverOpen = !this.state.zonePopoverOpen;
        this.zonePopoverEl.classList.toggle('is-open', this.state.zonePopoverOpen);
        // 首次点开若防区图层未开启，默认一键开启便于即刻预览
        if (this.state.zonePopoverOpen && !this.state.layers.safetyZones) {
          this._toggleSafetyZonesLayer(true);
        }
      } else if (act === 'patrol') {
        this._togglePatrol();
      } else if (act === 'patrol-prev') {
        this.api.stepPatrol?.(-1);
        this._syncPatrolState();
      } else if (act === 'patrol-next') {
        this.api.stepPatrol?.(1);
        this._syncPatrolState();
      } else if (act === 'reset') {
        this.api.stopPatrol?.();
        this.api.focusFloor?.('all');
        this.api.setNvrTopologyVisible?.(false);
        this._setSingleCameraFov(null);
        this.state.focusedFloor = 'all';
        this.state.activeGroupId = null;
        this.state.selectedRef = null;
        this.api.setSelectedEntity?.(null);
        this.api.resetView?.();
        this.anchors.setUiState({
          selectedRef: null,
          activeGroupId: null,
          focusedFloor: 'all',
        });
        this._syncAllUI();
        this._showToast('视角已复位至园区全景');
      }
    });

    this.dockWrapEl.appendChild(this.dockEl);
    this.shellEl.appendChild(this.dockWrapEl);
  }

  _buildCommandPalette() {
    this.cmdBackdropEl = document.createElement('div');
    this.cmdBackdropEl.className = 'wb-cmd-backdrop';
    this.cmdBackdropEl.innerHTML = `
      <div class="wb-cmd-dialog wb-chrome" role="dialog" aria-label="快捷定位与指令搜索">
        <div class="wb-cmd-input-row">
          ${ICONS.search}
          <input type="text" class="wb-cmd-input" placeholder="搜索摄像头 (CAM-01)、大华 NVR、园区 11 分组、安全防区或快捷指令..." />
          <kbd class="wb-kbd">ESC</kbd>
        </div>
        <div class="wb-cmd-list" data-cmd-list></div>
        <div class="wb-cmd-foot">
          <span>↑↓ 切换 · Enter 飞跃定位</span>
          <span class="wb-num" data-cmd-count>0 项结果</span>
        </div>
      </div>
    `;

    this.cmdInputEl = this.cmdBackdropEl.querySelector('.wb-cmd-input');
    this.cmdListEl = this.cmdBackdropEl.querySelector('[data-cmd-list]');
    this.cmdCountEl = this.cmdBackdropEl.querySelector('[data-cmd-count]');

    this.cmdBackdropEl.addEventListener('click', (e) => {
      if (e.target === this.cmdBackdropEl) {
        this._closeCommandPalette();
        return;
      }
      const item = e.target.closest('[data-cmd-idx]');
      if (item) {
        this._executeCommandItem(Number(item.dataset.cmdIdx));
      }
    });

    this.cmdInputEl.addEventListener('input', () => {
      this.state.cmdQuery = this.cmdInputEl.value.trim();
      this.state.cmdActiveIdx = 0;
      this._renderCommandItems();
    });

    this.cmdInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.state.cmdActiveIdx = Math.min(
          Math.max(0, this._cmdResults.length - 1),
          this.state.cmdActiveIdx + 1
        );
        this._renderCommandItems();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.state.cmdActiveIdx = Math.max(0, this.state.cmdActiveIdx - 1);
        this._renderCommandItems();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this._executeCommandItem(this.state.cmdActiveIdx);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._closeCommandPalette();
      }
    });

    this._cmdResults = [];
    this.shellEl.appendChild(this.cmdBackdropEl);
  }

  _buildToast() {
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'wb-toast wb-chrome';
    this.shellEl.appendChild(this.toastEl);
  }

  /* ======================== 事件绑定与 3D 双向联动 ======================== */

  _bindGlobalEvents() {
    this._onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (this.state.cmdOpen) this._closeCommandPalette();
        else this._openCommandPalette();
        return;
      }
      if (e.key === 'Escape') {
        if (this.state.cmdOpen) this._closeCommandPalette();
        if (this.state.zonePopoverOpen) {
          this.state.zonePopoverOpen = false;
          this.zonePopoverEl.classList.remove('is-open');
        }
        if (this.state.demoMenuOpen) {
          this.state.demoMenuOpen = false;
          this.demoMenuEl.classList.remove('is-open');
        }
      }
    };

    this._onDocClick = (e) => {
      if (this.state.zonePopoverOpen && !this.dockEl.contains(e.target)) {
        this.state.zonePopoverOpen = false;
        this.zonePopoverEl.classList.remove('is-open');
      }
      if (this.state.demoMenuOpen && !this.rightDrawerEl.contains(e.target)) {
        this.state.demoMenuOpen = false;
        this.demoMenuEl.classList.remove('is-open');
      }
    };

    this._onResize = () => {
      this._syncViewportInsets();
    };

    window.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('pointerdown', this._onDocClick);
    window.addEventListener('resize', this._onResize);
  }

  _bindApiEvents() {
    if (typeof this.api?.on !== 'function') return;

    const addSub = (ev, fn) => {
      const unsub = this.api.on(ev, fn);
      if (typeof unsub === 'function') this._unsubs.push(unsub);
    };

    addSub('entity:hover', (payload) => {
      const ref = payload?.id ? { type: payload.type, id: payload.id } : null;
      this._handleEntityHover(ref, { fromCanvas: true });
    });

    addSub('entity:click', (payload) => {
      if (!payload?.id) return;
      if (payload.type === 'camera') {
        this._handleEntitySelect(
          { type: 'camera', id: payload.id },
          { flyTo: false, openPip: true, fromCanvas: true }
        );
      } else if (payload.type === 'nvr') {
        this._handleEntitySelect(
          { type: 'nvr', id: payload.id },
          { flyTo: false, fromCanvas: true }
        );
      } else if (payload.type === 'wing' || payload.type === 'group') {
        const gid = payload.groupId || payload.id;
        if (gid) this._selectGroup(gid, { flyTo: false });
      } else if (payload.type === 'zone') {
        const zone = this.catalog.safetyZones.find((z) => z.id === payload.id);
        if (zone?.cameraId) {
          this._handleEntitySelect(
            { type: 'camera', id: zone.cameraId },
            { flyTo: false, openPip: true }
          );
        }
      }
    });

    addSub('canvas:click', () => {
      if (this.state.selectedRef) {
        this.state.selectedRef = null;
        this.state.singleFovCamId = null;
        this.api.setNvrTopologyVisible?.(false);
        this.anchors.setUiState({ selectedRef: null });
        this._renderLeftDrawer();
        this._renderRightDrawer();
      }
    });

    addSub('state:change', (ev) => {
      if (this._suppressApiStateSync) return;
      this._refreshCatalog();

      // 兼容外部控制台直接调用 CampusTwin.setNvrOffline(nvrId, bool) 的根因收敛联动
      if (ev?.kind === 'nvrOffline' && ev.nvrId) {
        this._reconcileNvrConvergenceCard(ev.nvrId, Boolean(ev.isOffline));
      }

      if (ev?.kind === 'patrol' || typeof this.api.getPatrolState === 'function') {
        const p = this.api.getPatrolState?.();
        if (p) {
          this.state.patrol = { ...this.state.patrol, ...p };
          if (p.status === 'running' && p.currentTarget?.type === 'camera') {
            this.state.selectedRef = { type: 'camera', id: p.currentTarget.id };
          }
        }
      }

      this.anchors.setEntities({
        cameras: this.catalog.cameras,
        nvrs: this.catalog.nvrs,
      });
      this.anchors.setUiState({
        selectedRef: this.state.selectedRef,
        focusedFloor: this.state.focusedFloor,
        camerasLayerVisible: this.state.layers.cameras,
      });
      this._syncAllUI();
    });

    addSub('patrol:change', (patrolState) => {
      if (!patrolState) return;
      this.state.patrol = { ...this.state.patrol, ...patrolState };
      if (patrolState.currentTarget?.type === 'camera') {
        this.state.selectedRef = { type: 'camera', id: patrolState.currentTarget.id };
        const cam = this.catalog.cameras.find((c) => c.id === patrolState.currentTarget.id);
        if (cam && this.pip.isOpen) {
          this.pip.open({
            camera: cam,
            alarm: this._findActiveAlarmForCamera(cam.id),
            fovActive: true,
          });
        }
      }
      this._refreshCatalog();
      this.anchors.setUiState({
        selectedRef: this.state.selectedRef,
        focusedFloor: this.state.focusedFloor,
      });
      this._syncAllUI();
    });
  }

  _bindThemeObserver() {
    this._bodyObserver = new MutationObserver(() => {
      const mode = this._detectBodyTheme();
      if (mode !== this.state.lightingMode) {
        this.state.lightingMode = mode;
        this._syncTopBar();
      }
    });
    this._bodyObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  /* ======================== 核心业务动作 ======================== */

  _setLightingMode(mode) {
    const normalized = mode === 'night' ? 'night' : mode === 'dusk' ? 'dusk' : 'day';
    this.state.lightingMode = normalized;
    this.api.setLightingMode?.(normalized);
    this._syncTopBar();
  }

  _setDrawers({ leftOpen, rightOpen }) {
    if (typeof leftOpen === 'boolean') this.state.leftOpen = leftOpen;
    if (typeof rightOpen === 'boolean') this.state.rightOpen = rightOpen;
    this.state.focusMode = !this.state.leftOpen && !this.state.rightOpen;

    this._syncDrawerVisibility();
    this._syncViewportInsets();
  }

  _toggleFocusMode() {
    if (!this.state.focusMode) {
      this.state.prevDrawerState = {
        leftOpen: this.state.leftOpen,
        rightOpen: this.state.rightOpen,
      };
      this.state.leftOpen = false;
      this.state.rightOpen = false;
      this.state.focusMode = true;
      this._showToast('已进入专注看模视图（点击再次恢复侧栏）');
    } else {
      this.state.leftOpen = this.state.prevDrawerState.leftOpen ?? true;
      this.state.rightOpen = this.state.prevDrawerState.rightOpen ?? true;
      if (!this.state.leftOpen && !this.state.rightOpen) {
        this.state.leftOpen = true;
        this.state.rightOpen = true;
      }
      this.state.focusMode = false;
    }
    this._syncDrawerVisibility();
    this._syncViewportInsets();
  }

  _syncDrawerVisibility() {
    this.leftDrawerEl.classList.toggle('is-collapsed', !this.state.leftOpen);
    this.leftRestoreEl.classList.toggle('is-hidden', this.state.leftOpen);

    this.rightDrawerEl.classList.toggle('is-collapsed', !this.state.rightOpen);
    this.rightRestoreEl.classList.toggle('is-hidden', this.state.rightOpen);

    this.floorRulerEl.classList.toggle('is-left-closed', !this.state.leftOpen);
    this.pip.setRightDrawerOpen(this.state.rightOpen);

    const focusBtn = this.topbarEl.querySelector('[data-act="toggle-focus"]');
    focusBtn?.classList.toggle('is-active', this.state.focusMode);
  }

  _syncViewportInsets() {
    const compact = window.innerWidth <= 1180;
    const leftW = this.state.leftOpen ? (compact ? 260 : 288) : 16;
    const rightW = this.state.rightOpen ? (compact ? 282 : 312) : 16;
    const insets = {
      top: 66,
      bottom: 66,
      left: leftW,
      right: rightW,
    };
    this.api.setViewportInsets?.(insets);
    this.anchors?.setInsets(insets);
  }

  _handleEntityHover(ref, { fromCanvas = false } = {}) {
    const prevId = this.state.hoveredRef?.id || null;
    const nextId = ref?.id || null;
    if (prevId === nextId) return;

    this.state.hoveredRef = ref;
    this.anchors.setUiState({ hoveredRef: ref });
    if (!fromCanvas) {
      this.api.setHoveredEntity?.(ref);
    }
  }

  _handleEntitySelect(ref, { flyTo = true, openPip = false, fromCanvas = false } = {}) {
    if (!ref) return;
    this.state.selectedRef = ref;

    this._suppressApiStateSync = true;
    try {
      if (ref.type === 'camera') {
        const cam = this.catalog.cameras.find((c) => c.id === ref.id);
        if (!cam) return;
        this.state.activeGroupId = cam.groupId;

        if (!fromCanvas) {
          this.api.setNvrTopologyVisible?.(false);
          this.api.setSelectedEntity?.(ref, { showFov: true, showNvrLinks: false, flyTo: false });
        }
        this._setSingleCameraFov(cam.id);

        if (flyTo) {
          this._focusCameraIn3D(cam.id);
        }
        if (openPip) {
          const activeAlarm = this._findActiveAlarmForCamera(cam.id);
          this.pip.open({
            camera: cam,
            alarm: activeAlarm,
            fovActive: this.state.singleFovCamId === cam.id,
          });
        }
      } else if (ref.type === 'nvr') {
        this.state.activeGroupId = 'grp-nvr-room';
        this.state.singleFovCamId = null;
        if (!fromCanvas) {
          this.api.setSelectedEntity?.(ref, { showNvrLinks: true, flyTo: false });
          this.api.setNvrTopologyVisible?.(ref.id);
        }
        if (flyTo) {
          this.api.flyToGroup?.('grp-nvr-room');
        }
        this._showToast(`已点亮 ${ref.id} 3D 拓扑光路`);
      }
    } finally {
      this._suppressApiStateSync = false;
    }

    this.anchors.setUiState({
      selectedRef: this.state.selectedRef,
      activeGroupId: this.state.activeGroupId,
    });
    this._renderLeftDrawer();
    this._renderRightDrawer();
  }

  _focusCameraIn3D(cameraId) {
    const cam = this.catalog.cameras.find((c) => c.id === cameraId);
    if (!cam) return;

    // 室内摄像头自动透出对应楼层，避免 2F/1F 被上层屋顶遮挡
    if (cam.isIndoor && cam.floor && cam.floor !== 'outdoor') {
      if (typeof this.api.focusFloor === 'function') {
        this.api.focusFloor(cam.floor, { ghostUpper: true });
        this.state.focusedFloor = cam.floor;
      } else if (!this.state.exploded) {
        this.api.setExploded?.(true);
        this.state.exploded = true;
      }
    }

    this.api.flyToCamera?.(cameraId, { autoExposeFloor: true, duration: 920 });
    this._syncDockAndRuler();
    this.anchors.setUiState({ focusedFloor: this.state.focusedFloor });
  }

  _setSingleCameraFov(cameraId) {
    this.state.singleFovCamId = cameraId || null;
    this._suppressApiStateSync = true;
    try {
      if (!cameraId && this.state.selectedRef?.type === 'camera') {
        this.api.setSelectedEntity?.(this.state.selectedRef, { showFov: false, flyTo: false });
      }
      this.api.setCameraFovOverride?.(cameraId || null);
    } finally {
      this._suppressApiStateSync = false;
    }
  }

  _selectGroup(groupId, { flyTo = true } = {}) {
    this.state.activeGroupId = groupId;
    if (flyTo) {
      this.api.flyToGroup?.(groupId);
    }
    this.anchors.setUiState({ activeGroupId: groupId });
    this._renderLeftDrawer();
  }

  _focusFloor(floorKey) {
    this.state.focusedFloor = floorKey;
    if (typeof this.api.focusFloor === 'function') {
      this.api.focusFloor(floorKey, { ghostUpper: true });
    } else if (floorKey !== 'all' && !this.state.exploded) {
      this.api.setExploded?.(true);
      this.state.exploded = true;
    } else if (floorKey === 'all' && this.state.exploded) {
      this.api.setExploded?.(false);
      this.state.exploded = false;
    }
    this.anchors.setUiState({ focusedFloor: floorKey });
    this._syncDockAndRuler();
  }

  /* ======================== NVR 掉线根因收敛核心逻辑 ======================== */

  _reconcileNvrConvergenceCard(nvrId, isOffline) {
    const nvr = this.catalog.nvrs.find((n) => n.id === nvrId);
    const affectedIds = nvr?.cameraIds || [];
    const opsAlarmId = `OPS-${nvrId}`;

    if (isOffline) {
      const existing = this.alarms.find((a) => a.id === opsAlarmId);
      const cardData = {
        id: opsAlarmId,
        category: 'ops',
        severity: 'critical',
        nvrId,
        affectedCameraIds: affectedIds,
        title: `${nvrId} 节点离线 · 影响 ${affectedIds.length} 路画面`,
        detail: `已根因收敛 ${affectedIds.join('/')}，自动抑制 ${affectedIds.length} 条重复断线告警`,
        time: nowTimeStr(),
        status: 'active',
      };
      if (existing) Object.assign(existing, cardData);
      else this.alarms.unshift(cardData);
    } else {
      const idx = this.alarms.findIndex((a) => a.id === opsAlarmId);
      if (idx >= 0) this.alarms.splice(idx, 1);
    }
    return affectedIds;
  }

  _toggleNvrOffline(nvrId, forceOffline) {
    const nvr = this.catalog.nvrs.find((n) => n.id === nvrId);
    if (!nvr) return;
    const nextOffline =
      typeof forceOffline === 'boolean' ? forceOffline : nvr.status !== 'offline';

    this._suppressApiStateSync = true;
    try {
      this.api.setNvrOffline?.(nvrId, nextOffline);
      this._refreshCatalog();

      const affectedIds = this._reconcileNvrConvergenceCard(nvrId, nextOffline);

      if (nextOffline) {
        // 3D 点亮该离线 NVR 的红色拓扑弧线，一眼溯源影响面
        this.api.setNvrTopologyVisible?.(nvrId);
        this.state.selectedRef = { type: 'nvr', id: nvrId };
        this._showToast(`${nvrId} 离线：已根因收敛为 1 条告警，下属 ${affectedIds.length} 路自动置灰`);
      } else {
        for (const camId of affectedIds) {
          const activeAi = this._findActiveAlarmForCamera(camId);
          if (activeAi) {
            this.api.setCameraState?.(
              camId,
              activeAi.severity === 'critical' ? 'alarm_critical' : 'alarm_order'
            );
          }
        }
        this._refreshCatalog();

        const anyOfflineNvr = this.catalog.nvrs.find((n) => n.status === 'offline');
        this.api.setNvrTopologyVisible?.(anyOfflineNvr ? anyOfflineNvr.id : false);
        this._showToast(`${nvrId} 链路已恢复，下属 ${affectedIds.length} 路画面自动重连`);
      }
    } finally {
      this._suppressApiStateSync = false;
    }

    // 同步当前已打开的 PiP（若正在观看受影响的摄像头）
    if (this.pip.isOpen && this.pip.camera) {
      const updatedCam = this.catalog.cameras.find((c) => c.id === this.pip.camera.id);
      if (updatedCam) {
        this.pip.update({
          camera: updatedCam,
          alarm: this._findActiveAlarmForCamera(updatedCam.id),
        });
      }
    }

    this.anchors.setEntities({
      cameras: this.catalog.cameras,
      nvrs: this.catalog.nvrs,
    });
    this.anchors.setUiState({ selectedRef: this.state.selectedRef });
    this._syncAllUI();
  }

  /* ======================== 告警定位 / 确认 / 静默 ======================== */

  _findActiveAlarmForCamera(cameraId) {
    return this.alarms.find(
      (a) => a.category === 'ai' && a.cameraId === cameraId && a.status === 'active'
    );
  }

  _locateAlarm(alarmId) {
    const alarm = this.alarms.find((a) => a.id === alarmId);
    if (!alarm) return;

    if (alarm.category === 'ops' && alarm.nvrId) {
      this._handleEntitySelect({ type: 'nvr', id: alarm.nvrId }, { flyTo: true });
      return;
    }

    if (alarm.cameraId) {
      // 如果关联了安全防区且防区关闭，可温和提示或保持整洁，直接飞跃并打开画中画
      this._handleEntitySelect(
        { type: 'camera', id: alarm.cameraId },
        { flyTo: true, openPip: true }
      );
    }
  }

  _acknowledgeAlarm(alarmId) {
    const alarm = this.alarms.find((a) => a.id === alarmId);
    if (!alarm) return;

    if (alarm.category === 'ops' && alarm.nvrId) {
      this._toggleNvrOffline(alarm.nvrId, false);
      return;
    }

    alarm.status = 'resolved';
    this._reconcileCamera3DState(alarm.cameraId);
    this._refreshCatalog();

    if (this.pip.isOpen && this.pip.camera?.id === alarm.cameraId) {
      const updatedCam = this.catalog.cameras.find((c) => c.id === alarm.cameraId);
      if (updatedCam) {
        this.pip.update({
          camera: updatedCam,
          alarm: this._findActiveAlarmForCamera(alarm.cameraId),
        });
      }
    }

    this.anchors.setEntities({
      cameras: this.catalog.cameras,
      nvrs: this.catalog.nvrs,
    });
    this._syncAllUI();
    this._showToast(`已确认处置：${alarm.title}`);
  }

  _muteAlarm(alarmId) {
    const alarm = this.alarms.find((a) => a.id === alarmId);
    if (!alarm) return;

    alarm.status = alarm.status === 'muted' ? 'active' : 'muted';
    if (alarm.category === 'ai' && alarm.cameraId) {
      this._reconcileCamera3DState(alarm.cameraId);
      this._refreshCatalog();
      if (this.pip.isOpen && this.pip.camera?.id === alarm.cameraId) {
        const updatedCam = this.catalog.cameras.find((c) => c.id === alarm.cameraId);
        if (updatedCam) {
          this.pip.update({
            camera: updatedCam,
            alarm: this._findActiveAlarmForCamera(alarm.cameraId),
          });
        }
      }
    }

    this.anchors.setEntities({
      cameras: this.catalog.cameras,
      nvrs: this.catalog.nvrs,
    });
    this._syncAllUI();
    this._showToast(alarm.status === 'muted' ? '已静默该条告警' : '已取消静默');
  }

  _reconcileCamera3DState(cameraId) {
    const cam = this.catalog.cameras.find((c) => c.id === cameraId);
    if (!cam) return;
    const parentNvr = this.catalog.nvrs.find((n) => n.id === cam.nvrId);
    if (parentNvr?.status === 'offline') {
      this.api.setCameraState?.(cameraId, 'offline');
      return;
    }

    const active = this.alarms.filter(
      (a) => a.category === 'ai' && a.cameraId === cameraId && a.status === 'active'
    );
    if (active.some((a) => a.severity === 'critical')) {
      this.api.setCameraState?.(cameraId, 'alarm_critical');
    } else if (active.length > 0) {
      this.api.setCameraState?.(cameraId, 'alarm_order');
    } else if (
      this.alarms.some((a) => a.category === 'ai' && a.cameraId === cameraId && a.status === 'muted')
    ) {
      this.api.setCameraState?.(cameraId, 'muted');
    } else {
      this.api.setCameraState?.(cameraId, 'online');
    }
  }

  _runDemoScenario(key) {
    if (key === 'nvr-01') {
      this._toggleNvrOffline('NVR-01', true);
    } else if (key === 'nvr-02') {
      this._toggleNvrOffline('NVR-02', true);
    } else if (key === 'e3-fire') {
      const id = 'ALM-104';
      const existing = this.alarms.find((a) => a.id === id);
      const payload = {
        id,
        category: 'ai',
        severity: 'critical',
        cameraId: 'CAM-08',
        zoneId: 'ZONE-F02',
        floor: '2F',
        scenario: 'firelane',
        title: 'E3 报告厅 2F 安全出口堵塞告警',
        detail: '二层疏散通道异常堆物阻挡出口 · 置信度 95.8%',
        time: nowTimeStr(),
        status: 'active',
      };
      if (existing) Object.assign(existing, payload);
      else this.alarms.unshift(payload);

      this._reconcileCamera3DState('CAM-08');
      this._refreshCatalog();
      this.anchors.setEntities({ cameras: this.catalog.cameras, nvrs: this.catalog.nvrs });
      this._syncAllUI();
      this._locateAlarm(id);
    } else if (key === 'reset-demos') {
      // 恢复所有离线 NVR + 重置 3 条初始演练告警
      for (const nvr of this.catalog.nvrs) {
        if (nvr.status === 'offline') this.api.setNvrOffline?.(nvr.id, false);
      }
      for (const cam of this.catalog.cameras) {
        this.api.setCameraState?.(cam.id, 'online');
      }
      this.api.setNvrTopologyVisible?.(false);
      this.alarms = createInitialDemoAlarms();
      this._applyDemoAlarmsTo3D();
      this._refreshCatalog();
      this.anchors.setEntities({ cameras: this.catalog.cameras, nvrs: this.catalog.nvrs });
      this._syncAllUI();
      this._showToast('已重置园区 AI 安防演练告警场景');
    }
  }

  /* ======================== 图层、防区与自动巡检 ======================== */

  _toggleSafetyZonesLayer(forceState) {
    const next =
      typeof forceState === 'boolean' ? forceState : !this.state.layers.safetyZones;
    this.api.setLayerVisible?.('safetyZones', next);
    this.state.layers.safetyZones = next;
    this._syncDockAndRuler();
  }

  _toggleZoneType(zoneType) {
    this.state.zoneFilter[zoneType] = !this.state.zoneFilter[zoneType];
    if (!this.state.layers.safetyZones && this.state.zoneFilter[zoneType]) {
      this.api.setLayerVisible?.('safetyZones', true);
      this.state.layers.safetyZones = true;
    }
    this.api.setSafetyZoneFilter?.({ ...this.state.zoneFilter });
    this._syncDockAndRuler();
  }

  _togglePatrol() {
    if (typeof this.api.startPatrol !== 'function') {
      this._showToast('自动巡检引擎初始化中');
      return;
    }
    const status = this.api.getPatrolState?.()?.status || this.state.patrol.status;
    if (status === 'running') {
      this.api.pausePatrol?.();
      this._showToast('自动巡检已暂停（可随时拖拽查看）');
    } else if (status === 'paused') {
      this.api.resumePatrol?.();
      this._showToast('继续全园自动巡检');
    } else {
      this.api.startPatrol({
        loop: true,
        pauseOnUserInteract: true,
        showFov: true,
        autoExposeFloor: true,
      });
      this._showToast('已启动全园智能自动巡检（拖拽画面自动暂停让权）');
    }
    this._syncPatrolState();
  }

  _syncPatrolState() {
    if (typeof this.api.getPatrolState === 'function') {
      const p = this.api.getPatrolState();
      if (p) this.state.patrol = { ...this.state.patrol, ...p };
    }
    this._syncTopBar();
    this._syncDockAndRuler();
  }

  /* ======================== Ctrl+K 全局快搜 ======================== */

  _openCommandPalette() {
    this.state.cmdOpen = true;
    this.state.cmdQuery = '';
    this.state.cmdActiveIdx = 0;
    this.cmdInputEl.value = '';
    this.cmdBackdropEl.classList.add('is-open');
    this._renderCommandItems();
    window.setTimeout(() => this.cmdInputEl.focus(), 16);
  }

  _closeCommandPalette() {
    this.state.cmdOpen = false;
    this.cmdBackdropEl.classList.remove('is-open');
  }

  _buildCommandIndex() {
    const items = [];
    for (const cam of this.catalog.cameras) {
      items.push({
        typeLabel: '摄像机',
        title: `${cam.id} · ${cam.name}`,
        sub: `${cam.floor === 'outdoor' ? '室外' : cam.floor} / ${cam.nvrId}`,
        searchText: `${cam.id} ${cam.name} ${cam.floor} ${cam.nvrId} ${cam.groupId}`.toLowerCase(),
        run: () => this._handleEntitySelect({ type: 'camera', id: cam.id }, { flyTo: true, openPip: true }),
      });
    }
    for (const nvr of this.catalog.nvrs) {
      items.push({
        typeLabel: '大华 NVR',
        title: `${nvr.id} · ${nvr.name}`,
        sub: `${nvr.ip} · ${nvr.status === 'offline' ? '离线' : '在线'}`,
        searchText: `${nvr.id} ${nvr.name} ${nvr.ip} nvr 机房`.toLowerCase(),
        run: () => this._handleEntitySelect({ type: 'nvr', id: nvr.id }, { flyTo: true }),
      });
    }
    for (const grp of this.catalog.groups) {
      items.push({
        typeLabel: '园区分组',
        title: grp.name,
        sub: `${grp.cameraIds?.length || 0} 路点位`,
        searchText: `${grp.id} ${grp.name} 分组`.toLowerCase(),
        run: () => this._selectGroup(grp.id, { flyTo: true }),
      });
    }
    for (const zone of this.catalog.safetyZones) {
      items.push({
        typeLabel: '安全防区',
        title: `${zone.id} · ${zone.name}`,
        sub: zone.type,
        searchText: `${zone.id} ${zone.name} ${zone.type} 防区`.toLowerCase(),
        run: () => {
          this._toggleSafetyZonesLayer(true);
          if (zone.cameraId) {
            this._handleEntitySelect({ type: 'camera', id: zone.cameraId }, { flyTo: true, openPip: true });
          } else if (zone.groupId) {
            this._selectGroup(zone.groupId, { flyTo: true });
          }
        },
      });
    }
    items.push(
      {
        typeLabel: '快捷指令',
        title: this.state.exploded ? '闭合五层建筑形态' : '展开五层建筑爆炸透视',
        sub: 'Explode',
        searchText: '爆炸 五层 透视 explode 建筑',
        run: () => {
          const next = !this.state.exploded;
          this.api.setExploded?.(next);
          this.state.exploded = next;
          this._syncDockAndRuler();
        },
      },
      {
        typeLabel: '快捷指令',
        title: '切换星夜巡检光照模式',
        sub: 'Night',
        searchText: '夜间 夜景 night 光照 昼夜',
        run: () => this._setLightingMode('night'),
      },
      {
        typeLabel: '快捷指令',
        title: '模拟 NVR-01 掉线根因收敛',
        sub: 'Ops Demo',
        searchText: '模拟 掉线 收敛 nvr-01 故障',
        run: () => this._toggleNvrOffline('NVR-01', true),
      }
    );
    return items;
  }

  _renderCommandItems() {
    const q = this.state.cmdQuery.toLowerCase();
    const all = this._buildCommandIndex();
    const filtered = q ? all.filter((item) => item.searchText.includes(q)) : all.slice(0, 14);
    this._cmdResults = filtered;
    this.cmdCountEl.textContent = `${filtered.length} 项结果`;

    if (filtered.length === 0) {
      this.cmdListEl.innerHTML = `<div class="wb-empty-state"><div class="wb-empty-state__title">未匹配到相关点位或指令</div></div>`;
      return;
    }

    this.cmdListEl.innerHTML = filtered
      .map(
        (item, idx) => `
          <div class="wb-cmd-item${idx === this.state.cmdActiveIdx ? ' is-active' : ''}" data-cmd-idx="${idx}">
            <div class="wb-cmd-item__left">
              <span class="wb-cmd-type">${escapeHtml(item.typeLabel)}</span>
              <span class="wb-cmd-item__title">${escapeHtml(item.title)}</span>
            </div>
            <span class="wb-cmd-item__sub wb-num">${escapeHtml(item.sub)}</span>
          </div>
        `
      )
      .join('');
  }

  _executeCommandItem(idx) {
    const item = this._cmdResults[idx];
    if (!item) return;
    this._closeCommandPalette();
    item.run();
  }

  /* ======================== 全量 UI 渲染同步 ======================== */

  _syncAllUI() {
    this._syncTopBar();
    this._renderLeftDrawer();
    this._renderRightDrawer();
    this._syncDockAndRuler();
    this._syncDrawerVisibility();
  }

  _syncTopBar() {
    const cams = this.catalog.cameras;
    const nvrs = this.catalog.nvrs;
    const onlineCams = cams.filter((c) => c.state !== 'offline').length;
    const onlineNvrs = nvrs.filter((n) => n.status !== 'offline').length;
    const activeAlarms = this.alarms.filter((a) => a.status === 'active').length;
    const hasCritical = this.alarms.some(
      (a) => a.status === 'active' && a.severity === 'critical'
    );

    const camVal = this.topbarEl.querySelector('[data-kpi-val="cameras"]');
    const camDot = this.topbarEl.querySelector('[data-kpi-dot="cameras"]');
    camVal.textContent = `${onlineCams}/${cams.length}`;
    camVal.className = `wb-kpi-pill__val wb-num${onlineCams < cams.length ? ' is-warning' : ''}`;
    camDot.className = `wb-kpi-pill__dot${onlineCams < cams.length ? ' is-warning' : ''}`;

    const nvrVal = this.topbarEl.querySelector('[data-kpi-val="nvrs"]');
    const nvrDot = this.topbarEl.querySelector('[data-kpi-dot="nvrs"]');
    nvrVal.textContent = `${onlineNvrs}/${nvrs.length}`;
    nvrVal.className = `wb-kpi-pill__val wb-num${onlineNvrs < nvrs.length ? ' is-critical' : ''}`;
    nvrDot.className = `wb-kpi-pill__dot${onlineNvrs < nvrs.length ? ' is-critical' : ''}`;

    const almVal = this.topbarEl.querySelector('[data-kpi-val="alarms"]');
    const almDot = this.topbarEl.querySelector('[data-kpi-dot="alarms"]');
    almVal.textContent = String(activeAlarms);
    almVal.className = `wb-kpi-pill__val wb-num${
      hasCritical ? ' is-critical' : activeAlarms > 0 ? ' is-warning' : ''
    }`;
    almDot.className = `wb-kpi-pill__dot${
      hasCritical ? ' is-critical' : activeAlarms > 0 ? ' is-warning' : ''
    }`;

    const patVal = this.topbarEl.querySelector('[data-kpi-val="patrol"]');
    const patDot = this.topbarEl.querySelector('[data-kpi-dot="patrol"]');
    const p = this.state.patrol;
    if (p.status === 'running') {
      patVal.textContent = `巡检 ${(p.index ?? 0) + 1}/${p.total || 12}`;
      patVal.className = 'wb-kpi-pill__val wb-num is-accent';
      patDot.className = 'wb-kpi-pill__dot is-accent';
    } else if (p.status === 'paused') {
      patVal.textContent = '已暂停';
      patVal.className = 'wb-kpi-pill__val wb-num is-warning';
      patDot.className = 'wb-kpi-pill__dot is-warning';
    } else {
      patVal.textContent = '待命';
      patVal.className = 'wb-kpi-pill__val wb-num';
      patDot.className = 'wb-kpi-pill__dot is-idle';
    }

    this.topbarEl.querySelectorAll('[data-light]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.light === this.state.lightingMode);
    });
  }

  _renderLeftDrawer() {
    this.leftDrawerEl.querySelectorAll('[data-ltab]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.ltab === this.state.leftTab);
    });

    if (this.state.leftTab === 'nvr') {
      this._renderNvrTree();
    } else {
      this._renderGroupList();
    }
  }

  _renderNvrTree() {
    const camById = new Map(this.catalog.cameras.map((c) => [c.id, c]));
    const html = this.catalog.nvrs
      .map((nvr) => {
        const isOffline = nvr.status === 'offline';
        const isCollapsed = this.collapsedNvrs.has(nvr.id);
        const isSelected = this.state.selectedRef?.type === 'nvr' && this.state.selectedRef.id === nvr.id;
        const childCams = (nvr.cameraIds || []).map((id) => camById.get(id)).filter(Boolean);
        const onlineCount = childCams.filter((c) => c.state !== 'offline').length;

        const childrenHtml = childCams
          .map((cam) => {
            const camSelected =
              this.state.selectedRef?.type === 'camera' && this.state.selectedRef.id === cam.id;
            const floorTxt = cam.floor === 'outdoor' ? '室外' : cam.floor;

            let rightTag = '';
            if (isOffline) {
              rightTag = `<span class="wb-cam-row__tag is-upstream">上游 NVR 离线</span>`;
            } else if (cam.state === 'alarm_critical') {
              rightTag = `<span class="wb-cam-row__tag is-critical">告警</span>`;
            } else if (cam.state === 'alarm_order') {
              rightTag = `<span class="wb-cam-row__tag is-warning">预警</span>`;
            }

            return `
              <div class="wb-cam-row${camSelected ? ' is-selected' : ''}${isOffline ? ' is-upstream-offline' : ''}" data-cam-id="${escapeHtml(cam.id)}">
                <span class="wb-status-dot is-${escapeHtml(isOffline ? 'offline' : cam.state)}"></span>
                <div class="wb-cam-row__main">
                  <div class="wb-cam-row__line1">
                    <span class="wb-cam-row__id wb-num">${escapeHtml(cam.id)}</span>
                    <span class="wb-cam-row__floor wb-num">${escapeHtml(floorTxt)}</span>
                    <span class="wb-cam-row__name">${escapeHtml(cam.name)}</span>
                  </div>
                </div>
                ${rightTag}
              </div>
            `;
          })
          .join('');

        return `
          <div class="wb-nvr-card${isOffline ? ' is-offline' : ''}${isCollapsed ? ' is-collapsed-node' : ''}${isSelected ? ' is-selected' : ''}">
            <div class="wb-nvr-head" data-nvr-head="${escapeHtml(nvr.id)}">
              <div class="wb-nvr-top">
                <div class="wb-nvr-id-wrap">
                  <span class="wb-nvr-chevron" data-nvr-collapse="1">${ICONS.chevronDown}</span>
                  <span class="wb-nvr-icon">${ICONS.server}</span>
                  <span class="wb-nvr-id wb-num">${escapeHtml(nvr.id)}</span>
                </div>
                <span class="wb-nvr-status-badge wb-num${isOffline ? ' is-offline' : ''}">
                  ${isOffline ? `离线 · 影响 ${childCams.length} 路` : `在线 ${onlineCount}/${childCams.length}`}
                </span>
              </div>
              <div class="wb-nvr-meta">
                <span class="wb-nvr-ip wb-num">${escapeHtml(nvr.ip)} · ${escapeHtml(nvr.name.split('·')[1]?.trim() || '汇聚节点')}</span>
                <button type="button" class="wb-nvr-sim-btn${isOffline ? ' is-recover' : ''}" data-nvr-toggle="${escapeHtml(nvr.id)}">
                  ${isOffline ? '恢复在线' : '模拟掉线'}
                </button>
              </div>
            </div>
            <div class="wb-nvr-children">${childrenHtml}</div>
          </div>
        `;
      })
      .join('');

    this.leftBodyEl.innerHTML = html;
  }

  _renderGroupList() {
    const camById = new Map(this.catalog.cameras.map((c) => [c.id, c]));
    const typeLabels = { building: '建筑体量', outdoor: '室外道路/广场', core: '核心机房' };

    const html = this.catalog.groups
      .map((grp) => {
        const isActive = this.state.activeGroupId === grp.id;
        const cams = (grp.cameraIds || []).map((id) => camById.get(id)).filter(Boolean);
        const hasAlert = cams.some(
          (c) => c.state === 'alarm_critical' || c.state === 'alarm_order'
        );

        return `
          <div class="wb-group-item${isActive ? ' is-active' : ''}" data-group-id="${escapeHtml(grp.id)}">
            <div class="wb-group-item__left">
              <span class="wb-group-item__name">${escapeHtml(grp.name)}</span>
              <span class="wb-group-item__sub">
                <span>${typeLabels[grp.zoneType] || '园区区域'}</span>
                <span class="wb-num">${escapeHtml(cams.map((c) => c.id).join(' / ') || '无点位')}</span>
              </span>
            </div>
            <div class="wb-group-item__right">
              ${hasAlert ? '<span class="wb-group-alert-pip" title="该分组存在活跃告警"></span>' : ''}
              <span class="wb-group-count wb-num">${cams.length} 路</span>
            </div>
          </div>
        `;
      })
      .join('');

    this.leftBodyEl.innerHTML = html;
  }

  _renderRightDrawer() {
    const allActive = this.alarms.filter((a) => a.status === 'active');
    const aiActive = allActive.filter((a) => a.category === 'ai');
    const opsActive = allActive.filter((a) => a.category === 'ops');

    const badgeEl = this.rightDrawerEl.querySelector('[data-alarm-badge]');
    badgeEl.textContent = String(allActive.length);
    badgeEl.classList.toggle('is-clean', allActive.length === 0);

    const restoreBadge = this.rightRestoreEl.querySelector('[data-right-restore-badge]');
    restoreBadge.textContent = String(allActive.length);
    restoreBadge.classList.toggle('is-clean', allActive.length === 0);

    this.rightDrawerEl.querySelector('[data-afc="all"]').textContent = String(allActive.length);
    this.rightDrawerEl.querySelector('[data-afc="ai"]').textContent = String(aiActive.length);
    this.rightDrawerEl.querySelector('[data-afc="ops"]').textContent = String(opsActive.length);

    this.rightDrawerEl.querySelectorAll('[data-af]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.af === this.state.alarmFilter);
    });

    const filtered = this.alarms
      .filter((a) => this.state.alarmFilter === 'all' || a.category === this.state.alarmFilter)
      .slice()
      .sort((a, b) => {
        // 活跃优先 -> 根因/严重优先 -> 其余
        const order = { active: 0, muted: 1, resolved: 2 };
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        if (a.category !== b.category) return a.category === 'ops' ? -1 : 1;
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        return 0;
      });

    if (filtered.length === 0) {
      this.rightBodyEl.innerHTML = `
        <div class="wb-empty-state">
          ${ICONS.checkCircle}
          <div class="wb-empty-state__title">当前筛选无告警事件</div>
          <div style="font-size:10.5px;">可通过右上角「演练」或左侧 NVR 模拟掉线测试联动</div>
        </div>
      `;
      return;
    }

    const camMap = new Map(this.catalog.cameras.map((c) => [c.id, c]));

    this.rightBodyEl.innerHTML = filtered
      .map((alarm) => {
        const isOps = alarm.category === 'ops';
        const isCritical = alarm.severity === 'critical';
        const isSelected =
          (isOps && this.state.selectedRef?.id === alarm.nvrId) ||
          (!isOps && this.state.selectedRef?.id === alarm.cameraId);

        const cam = alarm.cameraId ? camMap.get(alarm.cameraId) : null;
        const upstreamOffline = !isOps && cam?.state === 'offline';

        const sevText =
          alarm.status === 'resolved'
            ? '已处置'
            : alarm.status === 'muted'
              ? '已静默'
              : upstreamOffline
                ? '上游中断'
                : isOps
                  ? '根因收敛'
                  : isCritical
                    ? '严重'
                    : '预警';

        const locTag = isOps
          ? `${alarm.nvrId} · 东北核心机房`
          : `${alarm.cameraId} · ${alarm.floor === 'outdoor' ? '室外' : alarm.floor}`;

        const actionsHtml = isOps
          ? `
              <button type="button" class="wb-card-act is-primary" data-alarm-act="locate" data-alarm-id="${escapeHtml(alarm.id)}">定位机房</button>
              <button type="button" class="wb-card-act is-confirm" data-alarm-act="retry-nvr" data-alarm-id="${escapeHtml(alarm.id)}" data-nvr-id="${escapeHtml(alarm.nvrId)}">链路重试</button>
              <button type="button" class="wb-card-act" data-alarm-act="mute" data-alarm-id="${escapeHtml(alarm.id)}">${alarm.status === 'muted' ? '恢复' : '静默'}</button>
            `
          : `
              <button type="button" class="wb-card-act is-primary" data-alarm-act="locate" data-alarm-id="${escapeHtml(alarm.id)}">定位</button>
              <button type="button" class="wb-card-act is-confirm" data-alarm-act="confirm" data-alarm-id="${escapeHtml(alarm.id)}" ${alarm.status === 'resolved' ? 'disabled style="opacity:0.45;cursor:default;"' : ''}>确认</button>
              <button type="button" class="wb-card-act" data-alarm-act="mute" data-alarm-id="${escapeHtml(alarm.id)}">${alarm.status === 'muted' ? '取消静默' : '静默'}</button>
            `;

        return `
          <article class="wb-alarm-card${isCritical ? ' is-critical' : ''}${isOps ? ' is-ops' : ''}${alarm.status === 'muted' ? ' is-muted' : ''}${alarm.status === 'resolved' ? ' is-resolved' : ''}${isSelected ? ' is-selected' : ''}" data-alarm-card="${escapeHtml(alarm.id)}">
            <div class="wb-alarm-card__row1">
              <div class="wb-alarm-card__title-wrap">
                <span class="wb-alarm-card__icon">${isOps ? ICONS.server : ICONS.shield}</span>
                <span class="wb-alarm-card__title" title="${escapeHtml(alarm.title)}">${escapeHtml(alarm.title)}</span>
              </div>
              <span class="wb-alarm-card__sev">${sevText}</span>
            </div>
            <div class="wb-alarm-card__row2">
              <div class="wb-alarm-card__detail" title="${escapeHtml(alarm.detail)}">${escapeHtml(alarm.detail)}</div>
              <div class="wb-alarm-card__meta">
                <span class="wb-num">${escapeHtml(locTag)}</span>
                <span class="wb-num">${escapeHtml(alarm.time)}</span>
              </div>
            </div>
            <div class="wb-alarm-card__row3">${actionsHtml}</div>
          </article>
        `;
      })
      .join('');
  }

  _syncDockAndRuler() {
    const expBtn = this.dockEl.querySelector('[data-dock="explode"]');
    expBtn.classList.toggle('is-active', this.state.exploded);
    this.dockEl.querySelector('[data-explode-label]').textContent = this.state.exploded
      ? '整体闭合'
      : '五层爆炸';

    this.dockEl.querySelector('[data-dock="cameras"]').classList.toggle('is-active', this.state.layers.cameras);
    this.dockEl.querySelector('[data-dock="fov"]').classList.toggle('is-active', this.state.layers.cameraFov);
    this.dockEl.querySelector('[data-dock="zones"]').classList.toggle('is-active', this.state.layers.safetyZones);

    this.dockEl.querySelector('[data-zone-master]').classList.toggle('is-on', this.state.layers.safetyZones);
    for (const z of ZONE_META) {
      const sw = this.dockEl.querySelector(`[data-zone-switch="${z.key}"]`);
      if (sw) sw.classList.toggle('is-on', Boolean(this.state.zoneFilter[z.key]));
    }

    // 巡检按钮态
    const patrolBtn = this.dockEl.querySelector('[data-dock="patrol"]');
    const patrolIcon = this.dockEl.querySelector('[data-patrol-icon]');
    const patrolLabel = this.dockEl.querySelector('[data-patrol-label]');
    const patrolSteps = this.dockEl.querySelector('[data-patrol-steps]');
    const ps = this.state.patrol.status;

    patrolBtn.classList.toggle('is-running', ps === 'running');
    patrolBtn.classList.toggle('is-active', ps === 'paused');
    patrolIcon.innerHTML = ps === 'running' ? ICONS.pause : ICONS.play;
    patrolLabel.textContent = ps === 'running' ? '巡检中' : ps === 'paused' ? '继续巡检' : '自动巡检';
    patrolSteps.style.display = ps === 'running' || ps === 'paused' ? 'inline-flex' : 'none';

    // 垂直五层楼层标尺
    this.floorRulerEl.querySelectorAll('[data-floor]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.floor === this.state.focusedFloor);
    });
  }

  _showToast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    if (this._toastTimer) window.clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => {
      this.toastEl?.classList.remove('is-visible');
    }, 2400);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._toastTimer) window.clearTimeout(this._toastTimer);
    window.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('pointerdown', this._onDocClick);
    window.removeEventListener('resize', this._onResize);

    if (this._bodyObserver) {
      this._bodyObserver.disconnect();
      this._bodyObserver = null;
    }

    for (const unsub of this._unsubs) {
      try {
        unsub();
      } catch {
        // ignore unsubscribe errors on teardown
      }
    }
    this._unsubs = [];

    this.anchors?.dispose();
    this.pip?.dispose();

    this.api?.setViewportInsets?.({ top: 0, right: 0, bottom: 0, left: 0 });
    document.body.classList.remove('workbench-active');
    if (this.mountEl) {
      this.mountEl.innerHTML = '';
    }
  }
}

/**
 * 挂载 IOPLY「园区智能安全巡检工作台」HUD 到 #hud-root
 * @param {object} [options]
 * @param {HTMLElement} [options.container] - 默认读取 #hud-root
 * @param {object} [options.api] - 默认读取 window.CampusTwin
 * @returns {{ dispose: () => void, controller: WorkbenchHUDController }}
 */
export function initWorkbenchHUD(options = {}) {
  const mountEl = options.container || document.getElementById('hud-root');
  if (!mountEl) {
    throw new Error('#hud-root container not found for WorkbenchHUD');
  }
  const api = options.api || window.CampusTwin;
  if (!api) {
    throw new Error('window.CampusTwin API not initialized before initWorkbenchHUD()');
  }

  // 防御重复挂载（例如热重载场景）
  if (typeof window.__workbenchHudDispose === 'function') {
    window.__workbenchHudDispose();
  }

  const controller = new WorkbenchHUDController({ mountEl, api });
  const dispose = () => {
    controller.dispose();
    if (window.__workbenchHudDispose === dispose) {
      window.__workbenchHudDispose = null;
    }
  };
  window.__workbenchHudDispose = dispose;

  return { dispose, controller };
}
