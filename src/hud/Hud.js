/**
 * AI 安全巡检工作台 · 磨砂玻璃控制面板（唯一组件库：Shoelace）
 *
 * 布局参考深色玻璃拟态航拍 dashboard：
 * - 顶部：标题 + 天气胶囊 + 时钟 / 右上搜索、告警铃、头像
 * - 左列：安防在线率环、告警趋势、摄像头列表（点击飞至并选中）
 * - 右侧：图层开关卡、竖向地图控件（缩放 / 复位 / 昼夜 / 全屏）
 * - 底部：无人机环绕卡、分层卡、摄像头详情卡（含实时画中画取景）
 *
 * 面板只通过 window.CampusTwin API 驱动 3D 场景，不直接触碰 three.js 对象。
 */
import '@shoelace-style/shoelace/dist/themes/dark.css';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/radio-group/radio-group.js';
import '@shoelace-style/shoelace/dist/components/radio-button/radio-button.js';
import '@shoelace-style/shoelace/dist/components/range/range.js';
import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import '@shoelace-style/shoelace/dist/components/progress-ring/progress-ring.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/avatar/avatar.js';
import './hud.css';
import { registerHudIcons } from './icons.js';

const STATE_META = {
  online: { label: '在线', tone: 'ok' },
  offline: { label: '离线', tone: 'off' },
  muted: { label: '静默', tone: 'off' },
  alarm_critical: { label: '紧急告警', tone: 'crit' },
  alarm_order: { label: '工单告警', tone: 'warn' },
  tamper: { label: '遮挡篡改', tone: 'tamper' },
};

const FLOOR_LABEL = { outdoor: '室外', '1F': '1F', '2F': '2F', '3F': '3F' };

// 演示数据：告警趋势与气象（接入真实业务后由后端替换）
const DEMO_ALARM_TREND = {
  '7d': { labels: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], values: [6, 4, 9, 5, 12, 3, 7] },
  '24h': {
    labels: ['00', '04', '08', '12', '16', '20', '24'],
    values: [1, 0, 3, 2, 4, 2, 1],
  },
};
const DEMO_WEATHER = { temp: '22°', sky: '晴', wind: '东北 3.2m/s', humidity: '62%' };

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function sparkline(values, w = 300, h = 86) {
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 10 - (v / max) * (h - 22)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${w},${h} L0,${h} Z`;
  const peak = values.indexOf(max);
  const [px, py] = pts[peak];
  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark">
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#c7f26a" stop-opacity="0.32"/>
          <stop offset="1" stop-color="#c7f26a" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="0" x2="${w}" y1="${h * 0.42}" y2="${h * 0.42}" class="spark__guide"/>
      <path d="${area}" fill="url(#sparkFill)"/>
      <path d="${d}" class="spark__line"/>
      <rect x="${px - 9}" y="${py}" width="18" height="${h - py}" class="spark__bar"/>
      <circle cx="${px}" cy="${py}" r="4" class="spark__dot"/>
    </svg>`;
}

export function mountHud(root, api, { setPreviewRectProvider } = {}) {
  if (!root) return { dispose() {} };
  registerHudIcons();
  document.documentElement.classList.add('sl-theme-dark');
  document.body.classList.add('hud-on');

  const hud = el(`
    <div class="hud">
      <header class="hud-top glass">
        <div class="brand">
          <span class="brand__dot"></span>
          <div>
            <div class="brand__eyebrow">IOPLY · AI 安全巡检</div>
            <div class="brand__title">园区态势总览</div>
          </div>
        </div>
        <div class="chips">
          <span class="chip"><sl-icon name="cloud-sun"></sl-icon><b>${DEMO_WEATHER.temp}</b>${DEMO_WEATHER.sky}</span>
          <span class="chip"><sl-icon name="wind"></sl-icon><b>${DEMO_WEATHER.wind}</b></span>
          <span class="chip"><sl-icon name="droplet"></sl-icon><b>${DEMO_WEATHER.humidity}</b>湿度</span>
          <span class="chip chip--clock" data-ref="clock">--:--</span>
        </div>
      </header>

      <div class="hud-account glass">
        <sl-icon-button name="search" label="搜索"></sl-icon-button>
        <span class="bell">
          <sl-icon-button name="bell" label="告警"></sl-icon-button>
          <sl-badge variant="danger" pill pulse data-ref="bellBadge" style="display:none">0</sl-badge>
        </span>
        <sl-avatar initials="巡" label="值班员"></sl-avatar>
      </div>

      <aside class="hud-left">
        <section class="card glass">
          <div class="card__head"><span>安防在线率</span><sl-icon name="shield-check"></sl-icon></div>
          <div class="kpi">
            <sl-progress-ring data-ref="ring" value="100"><b data-ref="ringText">100%</b></sl-progress-ring>
            <div class="kpi__side">
              <div class="kpi__big" data-ref="camTotal">16</div>
              <div class="muted">路摄像头</div>
              <div class="kpi__row">
                <span class="dot dot--ok"></span><span data-ref="cntOnline">0</span> 在线
                <span class="dot dot--crit"></span><span data-ref="cntAlarm">0</span> 告警
                <span class="dot dot--off"></span><span data-ref="cntOff">0</span> 离线
              </div>
            </div>
          </div>
        </section>

        <section class="card glass">
          <div class="card__head">
            <span>告警趋势</span>
            <sl-radio-group size="small" value="7d" data-ref="trendRange">
              <sl-radio-button value="24h">24h</sl-radio-button>
              <sl-radio-button value="7d">7 天</sl-radio-button>
            </sl-radio-group>
          </div>
          <div class="trend" data-ref="trend"></div>
          <div class="trend__axis" data-ref="trendAxis"></div>
        </section>

        <section class="card glass card--list">
          <div class="card__head">
            <span>摄像头点位</span>
            <span class="muted" data-ref="listCount"></span>
          </div>
          <sl-input size="small" placeholder="搜索名称 / 编号" clearable data-ref="search">
            <sl-icon name="search" slot="prefix"></sl-icon>
          </sl-input>
          <ul class="cam-list" data-ref="camList"></ul>
        </section>
      </aside>

      <aside class="hud-right">
        <section class="card glass layers">
          <div class="card__head"><span>图层</span><sl-icon name="layers"></sl-icon></div>
          <label class="layer"><sl-icon name="pin-map"></sl-icon><span>摄像头点位</span><sl-switch size="small" checked data-ref="tgMarkers"></sl-switch></label>
          <label class="layer"><sl-icon name="cone-striped"></sl-icon><span>全部视锥</span><sl-switch size="small" data-ref="tgFov"></sl-switch></label>
          <label class="layer"><sl-icon name="bounding-box"></sl-icon><span>安全防区</span><sl-switch size="small" data-ref="tgZones"></sl-switch></label>
        </section>

        <nav class="map-tools glass">
          <sl-tooltip content="放大" placement="left"><sl-icon-button name="plus-lg" label="放大" data-act="zoomIn"></sl-icon-button></sl-tooltip>
          <sl-tooltip content="缩小" placement="left"><sl-icon-button name="dash-lg" label="缩小" data-act="zoomOut"></sl-icon-button></sl-tooltip>
          <span class="map-tools__sep"></span>
          <sl-tooltip content="复位视角" placement="left"><sl-icon-button name="compass" label="复位" data-act="reset"></sl-icon-button></sl-tooltip>
          <sl-tooltip content="昼 / 夜" placement="left"><sl-icon-button name="moon-stars" label="昼夜" data-act="daynight"></sl-icon-button></sl-tooltip>
          <sl-tooltip content="全屏" placement="left"><sl-icon-button name="arrows-fullscreen" label="全屏" data-act="fullscreen"></sl-icon-button></sl-tooltip>
        </nav>
      </aside>

      <div class="floor-tags" data-ref="floorTags"></div>

      <footer class="hud-bottom">
        <section class="card glass drone">
          <div class="card__head">
            <span>无人机环绕巡航</span>
            <span class="status" data-ref="droneStatus"><span class="dot dot--off"></span>待命</span>
          </div>
          <div class="drone__body">
            <sl-button variant="primary" pill data-ref="droneBtn">
              <sl-icon slot="prefix" name="airplane"></sl-icon>开始环绕
            </sl-button>
            <div class="drone__meta">
              <div><span class="muted">方位</span><b data-ref="droneHeading">—</b></div>
              <div><span class="muted">圈数</span><b data-ref="droneLaps">0</b></div>
            </div>
          </div>
          <div class="slider-row"><span>一圈用时</span><sl-range min="30" max="120" step="5" value="60" data-ref="droneSpeed"></sl-range><b data-ref="droneSpeedVal">60s</b></div>
          <div class="slider-row"><span>飞行高度</span><sl-range min="110" max="320" step="10" value="175" data-ref="droneHeight"></sl-range><b data-ref="droneHeightVal">175m</b></div>
        </section>

        <section class="card glass floors">
          <div class="card__head">
            <span>楼层分层</span>
            <label class="explode">拆层展开 <sl-switch size="small" data-ref="tgExplode"></sl-switch></label>
          </div>
          <sl-radio-group value="all" data-ref="floorPick" class="floor-pick">
            <sl-radio-button value="all">整楼</sl-radio-button>
            <sl-radio-button value="1F">1F</sl-radio-button>
            <sl-radio-button value="2F">2F</sl-radio-button>
            <sl-radio-button value="3F">3F</sl-radio-button>
            <sl-radio-button value="roof">屋顶</sl-radio-button>
          </sl-radio-group>
          <div class="floor-stats" data-ref="floorStats"></div>
        </section>

        <section class="card detail" data-ref="detail" hidden>
          <div class="detail__bg glass" data-ref="detailBg"></div>
          <div class="card__head">
            <div>
              <div class="detail__title" data-ref="dTitle"></div>
              <div class="muted" data-ref="dSub"></div>
            </div>
            <sl-icon-button name="x-lg" label="关闭" data-ref="dClose"></sl-icon-button>
          </div>
          <div class="preview" data-ref="preview">
            <span class="preview__rec"><span class="rec-dot"></span>LIVE</span>
            <span class="preview__time" data-ref="dTime"></span>
            <span class="preview__id" data-ref="dId"></span>
          </div>
          <div class="detail__grid">
            <div><span class="muted">状态</span><b data-ref="dState"></b></div>
            <div><span class="muted">视场角</span><b data-ref="dFov"></b></div>
            <div><span class="muted">可视距离</span><b data-ref="dRange"></b></div>
            <div><span class="muted">汇聚 NVR</span><b data-ref="dNvr"></b></div>
          </div>
          <div class="detail__actions">
            <sl-button size="small" pill data-ref="dFly"><sl-icon slot="prefix" name="crosshair"></sl-icon>定位</sl-button>
            <sl-button size="small" pill data-ref="dFov2"><sl-icon slot="prefix" name="cone-striped"></sl-icon>视锥</sl-button>
          </div>
        </section>
      </footer>
    </div>
  `);
  root.appendChild(hud);

  const ref = {};
  hud.querySelectorAll('[data-ref]').forEach((n) => {
    ref[n.dataset.ref] = n;
  });

  /* ---------------- 摄像头列表 & KPI ---------------- */
  let filter = '';
  let fovSelectedOnly = true;

  function renderCameras() {
    const cams = api.listCameras();
    const selected = api.getSelectedCamera();
    const online = cams.filter((c) => c.state === 'online').length;
    const alarm = cams.filter((c) => ['alarm_critical', 'alarm_order', 'tamper'].includes(c.state)).length;
    const off = cams.length - online - alarm;
    const healthy = cams.length ? Math.round(((online + alarm) / cams.length) * 100) : 0;

    ref.ring.value = healthy;
    ref.ringText.textContent = `${healthy}%`;
    ref.camTotal.textContent = cams.length;
    ref.cntOnline.textContent = online;
    ref.cntAlarm.textContent = alarm;
    ref.cntOff.textContent = off;
    ref.bellBadge.textContent = alarm;
    ref.bellBadge.style.display = alarm === 0 ? 'none' : '';

    const q = filter.trim().toLowerCase();
    const shown = cams.filter((c) => !q || c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    ref.listCount.textContent = `${shown.length} / ${cams.length}`;
    ref.camList.innerHTML = shown
      .map((c) => {
        const meta = STATE_META[c.state] || STATE_META.online;
        return `
        <li class="cam ${c.id === selected ? 'is-active' : ''}" data-id="${c.id}">
          <span class="cam__icon"><sl-icon name="camera-video"></sl-icon></span>
          <span class="cam__text">
            <span class="cam__name">${c.name}</span>
            <span class="cam__sub">${c.id} · ${FLOOR_LABEL[c.floor] || c.floor}${c.source === 'component' ? ' · 新增' : ''}</span>
          </span>
          <span class="pill pill--${meta.tone}">${meta.label}</span>
        </li>`;
      })
      .join('');
    renderFloorStats(cams);
    renderDetail(cams);
  }

  ref.camList.addEventListener('click', (e) => {
    const li = e.target.closest('.cam');
    if (!li) return;
    api.selectCamera(li.dataset.id, { fly: true });
  });
  ref.search.addEventListener('sl-input', () => {
    filter = ref.search.value || '';
    renderCameras();
  });
  ref.search.addEventListener('sl-clear', () => {
    filter = '';
    renderCameras();
  });

  /* ---------------- 告警趋势 ---------------- */
  function renderTrend() {
    const data = DEMO_ALARM_TREND[ref.trendRange.value] || DEMO_ALARM_TREND['7d'];
    ref.trend.innerHTML = sparkline(data.values);
    ref.trendAxis.innerHTML = data.labels.map((l) => `<span>${l}</span>`).join('');
  }
  ref.trendRange.addEventListener('sl-change', renderTrend);

  /* ---------------- 图层 ---------------- */
  ref.tgMarkers.addEventListener('sl-change', () => api.setMarkersVisible(ref.tgMarkers.checked));
  ref.tgFov.addEventListener('sl-change', () => {
    api.setFovMode(ref.tgFov.checked ? 'all' : 'selected');
    fovSelectedOnly = !ref.tgFov.checked;
  });
  ref.tgZones.addEventListener('sl-change', () => api.setLayerVisible('safetyZones', ref.tgZones.checked));

  /* ---------------- 地图工具 ---------------- */
  hud.querySelector('.map-tools').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'zoomIn') api.zoomBy(0.72);
    else if (act === 'zoomOut') api.zoomBy(1.38);
    else if (act === 'reset') api.resetView();
    else if (act === 'daynight') {
      const mode = api.getCatalog().state.lightingMode === 'night' ? 'day' : 'night';
      api.setLightingMode(mode);
      btn.name = mode === 'night' ? 'sun' : 'moon-stars';
    } else if (act === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
  });
  const onFs = () => {
    const btn = hud.querySelector('[data-act="fullscreen"]');
    if (btn) btn.name = document.fullscreenElement ? 'fullscreen-exit' : 'arrows-fullscreen';
  };
  document.addEventListener('fullscreenchange', onFs);

  /* ---------------- 无人机环绕 ---------------- */
  let droneLaps = 0;
  let lastAngle = null;
  let sweep = 0;
  function droneParams() {
    return { periodSec: Number(ref.droneSpeed.value), height: Number(ref.droneHeight.value) };
  }
  function setDroneUi(active) {
    ref.droneBtn.innerHTML = active
      ? '<sl-icon slot="prefix" name="stop-fill"></sl-icon>停止环绕'
      : '<sl-icon slot="prefix" name="airplane"></sl-icon>开始环绕';
    ref.droneBtn.variant = active ? 'default' : 'primary';
    ref.droneStatus.innerHTML = active
      ? '<span class="dot dot--ok dot--pulse"></span>巡航中'
      : '<span class="dot dot--off"></span>待命';
    hud.classList.toggle('is-orbiting', active);
  }
  ref.droneBtn.addEventListener('click', () => {
    if (api.isDroneOrbiting()) api.stopDroneOrbit();
    else {
      droneLaps = 0;
      sweep = 0;
      lastAngle = null;
      ref.droneLaps.textContent = '0';
      api.startDroneOrbit(droneParams());
    }
  });
  ref.droneSpeed.tooltipFormatter = (v) => `${v}s / 圈`;
  ref.droneHeight.tooltipFormatter = (v) => `${v} m`;
  const onDroneParam = () => {
    ref.droneSpeedVal.textContent = `${ref.droneSpeed.value}s`;
    ref.droneHeightVal.textContent = `${ref.droneHeight.value}m`;
    api.setDroneOrbitParams(droneParams());
  };
  ref.droneSpeed.addEventListener('sl-input', onDroneParam);
  ref.droneHeight.addEventListener('sl-input', onDroneParam);

  /* ---------------- 分层 ---------------- */
  ref.floorPick.addEventListener('sl-change', () => api.setFloorView(ref.floorPick.value, { fly: true }));
  ref.tgExplode.addEventListener('sl-change', () => api.setExploded(ref.tgExplode.checked));

  function renderFloorStats(cams) {
    const count = (f) => cams.filter((c) => c.floor === f).length;
    const view = api.getFloorView();
    const rows = [
      ['1F', '首层 · 门厅 / 实验室'],
      ['2F', '二层 · 实验室 / 中庭'],
      ['3F', '三层 · 办公 / 报告厅'],
      ['outdoor', '室外 · 道路 / 湖滨'],
    ];
    ref.floorStats.innerHTML = rows
      .map(
        ([k, label]) => `
        <div class="fs ${view === k ? 'is-active' : ''}">
          <span class="fs__k">${FLOOR_LABEL[k]}</span>
          <span class="fs__l">${label}</span>
          <span class="fs__n"><sl-icon name="camera-video"></sl-icon>${count(k)}</span>
        </div>`
      )
      .join('');
  }

  /* ---------------- 摄像头详情 + 画中画 ---------------- */
  function renderDetail(cams) {
    const id = api.getSelectedCamera();
    const cam = id && cams.find((c) => c.id === id);
    ref.detail.hidden = !cam;
    hud.classList.toggle('has-detail', Boolean(cam));
    if (!cam) return;
    const meta = STATE_META[cam.state] || STATE_META.online;
    ref.dTitle.textContent = cam.name;
    ref.dSub.textContent = `${cam.id} · ${FLOOR_LABEL[cam.floor] || cam.floor} · ${cam.type === 'dome' ? '球机' : '枪机'}`;
    ref.dId.textContent = cam.id;
    ref.dState.innerHTML = `<span class="pill pill--${meta.tone}">${meta.label}</span>`;
    ref.dFov.textContent = `${cam.fovDeg}°`;
    ref.dRange.textContent = `${cam.range} m`;
    ref.dNvr.textContent = cam.nvrId || '—';
  }
  ref.dClose.addEventListener('click', () => api.selectCamera(null));
  ref.dFly.addEventListener('click', () => {
    const id = api.getSelectedCamera();
    if (id) api.flyToCamera(id);
  });
  ref.dFov2.addEventListener('click', () => {
    // 在「仅选中」与「全部隐藏」之间切换选中摄像头的视锥
    fovSelectedOnly = !fovSelectedOnly;
    api.setFovMode(fovSelectedOnly ? 'selected' : 'none');
    ref.tgFov.checked = false;
  });

  // 磨砂背景在画中画区域挖空，让 WebGL 实时取景透出（backdrop-filter 无法局部豁免，只能遮罩）
  let lastHole = '';
  function syncPreviewHole() {
    const card = ref.detail.getBoundingClientRect();
    const r = ref.preview.getBoundingClientRect();
    const key = `${r.left - card.left}|${r.top - card.top}|${r.width}|${r.height}`;
    if (key === lastHole) return;
    lastHole = key;
    const bg = ref.detailBg.style;
    const img = 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)';
    bg.webkitMaskImage = img;
    bg.maskImage = img;
    bg.webkitMaskSize = bg.maskSize = `100% 100%, ${r.width}px ${r.height}px`;
    bg.webkitMaskPosition = bg.maskPosition = `0 0, ${r.left - card.left}px ${r.top - card.top}px`;
    bg.webkitMaskRepeat = bg.maskRepeat = 'no-repeat';
    bg.webkitMaskComposite = 'xor';
    bg.maskComposite = 'exclude';
  }

  setPreviewRectProvider?.(() => {
    if (ref.detail.hidden) return null;
    const r = ref.preview.getBoundingClientRect();
    if (r.width < 8) return null;
    syncPreviewHole();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });

  /* ---------------- 事件订阅 ---------------- */
  const offs = [
    api.on('select', renderCameras),
    api.on('state', renderCameras),
    api.on('add', renderCameras),
    api.on('remove', renderCameras),
    api.on('orbit', ({ active }) => setDroneUi(active)),
    api.on('floor', (view) => {
      if (ref.floorPick.value !== view) ref.floorPick.value = view;
      renderCameras();
    }),
    api.on('explode', (v) => {
      ref.tgExplode.checked = v;
    }),
    api.on('fovMode', (mode) => {
      ref.tgFov.checked = mode === 'all';
    }),
  ];

  renderTrend();
  renderCameras();
  setDroneUi(api.isDroneOrbiting());

  /* ---------------- 每帧 ---------------- */
  const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  let lastClock = '';
  function tick() {
    const now = new Date();
    const clock = now.toLocaleTimeString('zh-CN', { hour12: false });
    if (clock !== lastClock) {
      lastClock = clock;
      ref.clock.textContent = clock;
      if (!ref.detail.hidden) ref.dTime.textContent = `${now.toLocaleDateString('zh-CN')} ${clock}`;
    }
    if (api.isDroneOrbiting()) {
      const h = api.getViewHeading();
      // 机位方位：相机相对园区中心所在方向（0=北，顺时针）
      const idx = Math.round(((h % 360) + 360) % 360 / 45) % 8;
      ref.droneHeading.textContent = `${DIRS[idx]} ${Math.round(((h % 360) + 360) % 360)}°`;
      if (lastAngle !== null) {
        let d = h - lastAngle;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        sweep += Math.abs(d);
        const laps = Math.floor(sweep / 360);
        if (laps !== droneLaps) {
          droneLaps = laps;
          ref.droneLaps.textContent = String(laps);
        }
      }
      lastAngle = h;
    }
  }

  // 拆层浮标
  const tagEls = new Map();
  function updateFloorTags() {
    const anchors = api.getFloorAnchors();
    const show = anchors.length && anchors[0].explodeFactor > 0.25;
    ref.floorTags.style.opacity = show ? String(Math.min(1, (anchors[0].explodeFactor - 0.25) / 0.5)) : '0';
    if (!show) return;
    const view = api.getFloorView();
    const seen = new Set();
    for (const a of anchors) {
      seen.add(a.key);
      let n = tagEls.get(a.key);
      if (!n) {
        n = el(`<div class="floor-tag"><b></b><span></span></div>`);
        n.addEventListener('click', () => api.setFloorView(a.key, { fly: false }));
        ref.floorTags.appendChild(n);
        tagEls.set(a.key, n);
      }
      const sp = api.getScreenPosition(a.position);
      n.style.transform = `translate(${sp.x + 34}px, ${sp.y}px) translate(0, -50%)`;
      n.style.display = sp.visible ? '' : 'none';
      n.querySelector('b').textContent = a.label.split(' ')[0];
      n.querySelector('span').textContent = a.label.split(' ')[1] || '';
      n.classList.toggle('is-active', view === a.key);
    }
    for (const [k, n] of tagEls) if (!seen.has(k)) n.style.display = 'none';
  }

  return {
    tick() {
      tick();
      updateFloorTags();
    },
    dispose() {
      offs.forEach((off) => off());
      document.removeEventListener('fullscreenchange', onFs);
      hud.remove();
      document.body.classList.remove('hud-on');
    },
  };
}
