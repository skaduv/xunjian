/**
 * AI 安全巡检工作台 · 磨砂玻璃控制面板（唯一组件库：Shoelace）
 *
 * 设计原则（参考 Dribbble 数字孪生 / Glassmorphism dashboard 研究结论）：
 * - 面板色彩中性：去饱和石墨玻璃，颜色交给三维场景；强调色只用电光蓝一处，语义色只表达状态
 * - 信息分层：小号灰色标签 + 大号等宽数字；卡片内用浅色内瓦片分组
 * - 模式化导航：顶部「总览 / 监控 / 巡航 / 楼层」切换右侧上下文面板，避免所有控件同时铺满屏幕
 *
 * 面板只通过 window.CampusTwin API 驱动三维场景，不直接触碰 three.js 对象。
 */
import '@fontsource-variable/inter';
import '@shoelace-style/shoelace/dist/themes/light.css';
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
  alarm_critical: { label: '紧急', tone: 'crit' },
  alarm_order: { label: '工单', tone: 'warn' },
  tamper: { label: '遮挡', tone: 'tamper' },
};
const ALARM_STATES = new Set(['alarm_critical', 'alarm_order', 'tamper']);

const FLOOR_LABEL = { outdoor: '室外', '1F': '1F', '2F': '2F', '3F': '3F' };

const FLOOR_STACK = [
  { key: 'roof', name: '屋顶', desc: '光伏 · 冷却塔 · 采光顶' },
  { key: '3F', name: '3F', desc: '办公 · 会议 · 报告厅上层' },
  { key: '2F', name: '2F', desc: '实验室 · 中庭回廊' },
  { key: '1F', name: '1F', desc: '门厅 · 实验室 · 机房' },
  { key: 'all', name: '整楼', desc: '全部楼层 · 室外园区' },
];

const MODES = [
  { key: 'overview', label: '总览', icon: 'grid-1x2' },
  { key: 'monitor', label: '监控', icon: 'camera-video' },
  { key: 'drone', label: '巡航', icon: 'airplane' },
  { key: 'floors', label: '楼层', icon: 'stack' },
];

// ---- 演示数据（接入业务后由后端替换）----
const DEMO_TREND = {
  '24h': { labels: ['0时', '4时', '8时', '12时', '16时', '20时'], values: [1, 0, 4, 3, 6, 2], total: 16, delta: -12 },
  '7d': { labels: ['一', '二', '三', '四', '五', '六', '日'], values: [6, 4, 9, 5, 12, 3, 7], total: 46, delta: 8 },
};
const DEMO_EVENTS = [
  { cam: 'CAM-15', title: '湖滨步道人员越界', level: 'crit', mins: 2 },
  { cam: 'CAM-13', title: '北大门车辆违停 3 分钟', level: 'warn', mins: 9 },
  { cam: 'CAM-01', title: '危化实验室未戴护目镜', level: 'warn', mins: 21 },
  { cam: 'CAM-16', title: '西门访客车辆登记', level: 'info', mins: 34 },
  { cam: 'CAM-14', title: '观景亭夜间巡检打卡', level: 'info', mins: 52 },
  { cam: 'CAM-06', title: '主入口人流密度偏高', level: 'warn', mins: 76 },
  { cam: 'CAM-12', title: 'NVR 机房门禁开启', level: 'info', mins: 98 },
];
const DEMO_WEATHER = { temp: '22°', sky: '晴', wind: '东北 3.2 m/s', humidity: '62%' };

const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function headingText(h) {
  const d = ((h % 360) + 360) % 360;
  return { dir: DIRS[Math.round(d / 45) % 8], deg: Math.round(d) };
}

/* ---------------- SVG 小组件 ---------------- */

function trendSvg(values) {
  const w = 300;
  const h = 92;
  const max = Math.max(...values, 1);
  const n = values.length;
  const slot = w / n;
  const bw = Math.min(22, slot * 0.46);
  const peak = values.indexOf(max);
  const bars = values
    .map((v, i) => {
      const bh = Math.max(4, (v / max) * (h - 18));
      const x = i * slot + (slot - bw) / 2;
      const y = h - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bw / 2.6).toFixed(1)}" class="bar ${i === peak ? 'bar--peak' : ''}"/>
        ${i === peak ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="bar__val">${v}</text>` : ''}`;
    })
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="trend-svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="barPeak" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="#ffb48f"/><stop offset="1" stop-color="#e8461e"/>
        </linearGradient>
      </defs>
      <line x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}" class="trend-base"/>
      ${bars}
    </svg>`;
}

function compassSvg() {
  const ticks = [];
  for (let a = 0; a < 360; a += 10) {
    const major = a % 90 === 0;
    const mid = a % 30 === 0;
    const r1 = 84;
    const r2 = major ? 74 : mid ? 77 : 80;
    const rad = ((a - 90) * Math.PI) / 180;
    ticks.push(
      `<line x1="${(100 + Math.cos(rad) * r1).toFixed(1)}" y1="${(100 + Math.sin(rad) * r1).toFixed(1)}" x2="${(100 + Math.cos(rad) * r2).toFixed(1)}" y2="${(100 + Math.sin(rad) * r2).toFixed(1)}" class="tick ${major ? 'tick--major' : ''}"/>`
    );
  }
  const labels = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    ['W', 270],
  ]
    .map(([t, a]) => {
      const rad = ((a - 90) * Math.PI) / 180;
      return `<text x="${(100 + Math.cos(rad) * 62).toFixed(1)}" y="${(100 + Math.sin(rad) * 62 + 4).toFixed(1)}" class="clabel ${t === 'N' ? 'clabel--n' : ''}">${t}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 200 200" class="compass-svg">
      <circle cx="100" cy="100" r="92" class="c-ring"/>
      <circle cx="100" cy="100" r="44" class="c-core"/>
      ${ticks.join('')}
      ${labels}
      <circle cx="100" cy="100" r="88" class="c-progress" data-ref="cProgress" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 100 100)"/>
      <g class="c-needle" data-ref="cNeedle">
        <line x1="100" y1="54" x2="100" y2="22" class="c-needle__line"/>
        <circle cx="100" cy="18" r="7" class="c-needle__dot"/>
      </g>
      <text x="100" y="98" class="c-deg" data-ref="cDeg">—</text>
      <text x="100" y="116" class="c-dir" data-ref="cDir">待命</text>
    </svg>`;
}

/* ================================================================== */

export function mountHud(root, api, { setPreviewRectProvider } = {}) {
  if (!root) return { tick() {}, dispose() {} };
  registerHudIcons();
  document.documentElement.classList.add('sl-theme-light');
  document.body.classList.add('hud-on');

  const hud = el(`
    <div class="hud" data-mode="overview">
      <!-- ============ 顶栏 ============ -->
      <div class="brand glass">
        <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M16 3l11 6.3v13.4L16 29 5 22.7V9.3z" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M16 9l5.6 3.2v6.6L16 22l-5.6-3.2v-6.6z" fill="currentColor"/>
        </svg>
        <div class="brand__text">
          <div class="brand__title">IOPLY 安全巡检</div>
          <div class="brand__sub">溧阳 · 长三角物理研究中心</div>
        </div>
      </div>

      <sl-radio-group class="modes glass" value="overview" data-ref="modes" size="small">
        ${MODES.map((m) => `<sl-radio-button value="${m.key}" pill><sl-icon slot="prefix" name="${m.icon}"></sl-icon>${m.label}</sl-radio-button>`).join('')}
      </sl-radio-group>

      <div class="top-right">
        <div class="weather glass">
          <span class="wx"><sl-icon name="cloud-sun"></sl-icon><b>${DEMO_WEATHER.temp}</b><span>${DEMO_WEATHER.sky}</span></span>
          <span class="wx-sep"></span>
          <span class="wx"><sl-icon name="wind"></sl-icon><span>${DEMO_WEATHER.wind}</span></span>
          <span class="wx-sep"></span>
          <span class="wx"><sl-icon name="droplet"></sl-icon><span>${DEMO_WEATHER.humidity}</span></span>
          <span class="wx-sep"></span>
          <span class="wx wx--clock" data-ref="clock">--:--:--</span>
        </div>
        <div class="account glass">
          <span class="bell">
            <sl-icon-button name="bell" label="告警" data-ref="bell"></sl-icon-button>
            <span class="bell__dot" data-ref="bellDot"></span>
          </span>
          <sl-avatar initials="巡" label="值班员"></sl-avatar>
        </div>
      </div>

      <!-- ============ 左列：态势 ============ -->
      <aside class="col-left">
        <section class="card glass">
          <header class="card__head">
            <span class="eyebrow">安防态势</span>
            <span class="live"><span class="live__dot"></span>实时</span>
          </header>
          <div class="hero-kpi">
            <div>
              <div class="hero-kpi__num"><span data-ref="kOnlineRate">100</span><small>%</small></div>
              <div class="hero-kpi__label">设备在线率 · <span data-ref="kTotal">16</span> 路摄像头</div>
            </div>
            <sl-progress-ring data-ref="ring" value="100"></sl-progress-ring>
          </div>
          <div class="tiles">
            <div class="tile"><span class="tile__k"><i class="sw sw--ok"></i>在线</span><b data-ref="kOnline">0</b></div>
            <div class="tile"><span class="tile__k"><i class="sw sw--crit"></i>告警</span><b data-ref="kAlarm">0</b></div>
            <div class="tile"><span class="tile__k"><i class="sw sw--off"></i>离线</span><b data-ref="kOff">0</b></div>
            <div class="tile"><span class="tile__k"><i class="sw sw--acc"></i>NVR</span><b>3<small>/3</small></b></div>
          </div>
        </section>

        <section class="card glass">
          <header class="card__head">
            <span class="eyebrow">告警趋势</span>
            <sl-radio-group size="small" value="7d" data-ref="trendRange" class="seg">
              <sl-radio-button value="24h">24h</sl-radio-button>
              <sl-radio-button value="7d">7 天</sl-radio-button>
            </sl-radio-group>
          </header>
          <div class="trend-head">
            <span class="trend-total" data-ref="tTotal">0</span>
            <span class="delta" data-ref="tDelta"></span>
          </div>
          <div class="trend" data-ref="trend"></div>
          <div class="trend-axis" data-ref="trendAxis"></div>
        </section>

        <section class="card glass card--grow">
          <header class="card__head">
            <span class="eyebrow">实时事件</span>
            <span class="muted small">AI 识别 · 演示</span>
          </header>
          <ul class="events" data-ref="events"></ul>
        </section>
      </aside>

      <!-- ============ 右列：上下文面板 ============ -->
      <aside class="col-right">
        <!-- 总览 -->
        <section class="card glass panel" data-panel="overview">
          <header class="card__head"><span class="eyebrow">图层</span></header>
          <div class="layers">
            <label class="layer">
              <span class="layer__icon layer__icon--cyan"><sl-icon name="pin-map"></sl-icon></span>
              <span class="layer__text"><b>摄像头点位</b><small>16 路设备定位钉</small></span>
              <sl-switch size="small" checked data-ref="tgMarkers"></sl-switch>
            </label>
            <label class="layer">
              <span class="layer__icon layer__icon--violet"><sl-icon name="cone-striped"></sl-icon></span>
              <span class="layer__text"><b>全部视锥</b><small>视场范围与地面覆盖区</small></span>
              <sl-switch size="small" data-ref="tgFov"></sl-switch>
            </label>
            <label class="layer">
              <span class="layer__icon layer__icon--amber"><sl-icon name="bounding-box"></sl-icon></span>
              <span class="layer__text"><b>安全防区</b><small>危化 · 消防 · 临水 · 禁区</small></span>
              <sl-switch size="small" data-ref="tgZones"></sl-switch>
            </label>
          </div>
          <div class="divider"></div>
          <header class="card__head"><span class="eyebrow">状态图例</span></header>
          <div class="legend">
            <span><i class="sw sw--pin"></i>在线</span>
            <span><i class="sw sw--crit"></i>紧急告警</span>
            <span><i class="sw sw--warn"></i>工单告警</span>
            <span><i class="sw sw--tamper"></i>遮挡篡改</span>
            <span><i class="sw sw--off"></i>离线</span>
          </div>
          <div class="hint"><sl-icon name="crosshair"></sl-icon>点击场景中的定位钉查看实时画面</div>
        </section>

        <!-- 监控 -->
        <section class="panel panel--monitor" data-panel="monitor">
          <div class="detail" data-ref="detail">
            <div class="detail__bg glass" data-ref="detailBg"></div>
            <header class="detail__head">
              <div class="detail__titles">
                <div class="detail__title" data-ref="dTitle"></div>
                <div class="detail__sub" data-ref="dSub"></div>
              </div>
              <sl-icon-button name="x-lg" label="取消选中" data-ref="dClose"></sl-icon-button>
            </header>
            <div class="preview" data-ref="preview">
              <span class="ov ov--tl"><i class="rec"></i>LIVE</span>
              <span class="ov ov--tr" data-ref="dId"></span>
              <span class="ov ov--bl" data-ref="dFovText"></span>
              <span class="ov ov--br" data-ref="dTime"></span>
              <span class="frame frame--tl"></span><span class="frame frame--tr"></span>
              <span class="frame frame--bl"></span><span class="frame frame--br"></span>
            </div>
            <div class="meta">
              <div><span>状态</span><b data-ref="dState"></b></div>
              <div><span>视场角</span><b data-ref="dFov"></b></div>
              <div><span>可视距离</span><b data-ref="dRange"></b></div>
              <div><span>汇聚 NVR</span><b data-ref="dNvr"></b></div>
            </div>
            <div class="actions">
              <sl-button size="small" variant="primary" pill data-ref="dFly"><sl-icon slot="prefix" name="crosshair"></sl-icon>定位设备</sl-button>
              <sl-button size="small" pill data-ref="dFovBtn"><sl-icon slot="prefix" name="cone-striped"></sl-icon><span data-ref="dFovLabel">隐藏视锥</span></sl-button>
            </div>
          </div>
          <div class="empty card glass" data-ref="empty">
            <sl-icon name="camera-video"></sl-icon>
            <b>未选中摄像头</b>
            <span>点击场景定位钉或下方列表查看实时画面</span>
          </div>

          <div class="listcard card glass">
          <div class="list-tools">
            <sl-input size="small" pill placeholder="搜索名称 / 编号" clearable data-ref="search">
              <sl-icon name="search" slot="prefix"></sl-icon>
            </sl-input>
            <div class="chips" data-ref="chips">
              <button class="chip is-on" data-f="all">全部 <em data-c="all"></em></button>
              <button class="chip" data-f="alarm">告警 <em data-c="alarm"></em></button>
              <button class="chip" data-f="outdoor">室外 <em data-c="outdoor"></em></button>
              <button class="chip" data-f="indoor">室内 <em data-c="indoor"></em></button>
            </div>
          </div>
          <ul class="cams" data-ref="camList"></ul>
          </div>
        </section>

        <!-- 巡航 -->
        <section class="card glass panel" data-panel="drone">
          <header class="card__head">
            <span class="eyebrow">无人机环绕巡航</span>
            <span class="status" data-ref="droneStatus"></span>
          </header>
          <div class="compass">${compassSvg()}</div>
          <div class="drone-stats">
            <div><span>圈数</span><b data-ref="droneLaps">0</b></div>
            <div><span>航高</span><b data-ref="droneAlt">175 m</b></div>
            <div><span>半径</span><b data-ref="droneRad">360 m</b></div>
          </div>
          <sl-button variant="primary" pill class="drone-btn" data-ref="droneBtn"></sl-button>
          <div class="sliders">
            <div class="slider">
              <div class="slider__head"><span>一圈用时</span><b data-ref="vSpeed">60 s</b></div>
              <sl-range min="30" max="120" step="5" value="60" data-ref="rSpeed"></sl-range>
            </div>
            <div class="slider">
              <div class="slider__head"><span>飞行高度</span><b data-ref="vHeight">175 m</b></div>
              <sl-range min="110" max="320" step="10" value="175" data-ref="rHeight"></sl-range>
            </div>
            <div class="slider">
              <div class="slider__head"><span>环绕半径</span><b data-ref="vRadius">360 m</b></div>
              <sl-range min="260" max="520" step="10" value="360" data-ref="rRadius"></sl-range>
            </div>
          </div>
          <div class="seg-row">
            <span class="muted small">方向</span>
            <sl-radio-group size="small" value="ccw" data-ref="droneDir" class="seg">
              <sl-radio-button value="ccw">逆时针</sl-radio-button>
              <sl-radio-button value="cw">顺时针</sl-radio-button>
            </sl-radio-group>
          </div>
          <div class="hint"><sl-icon name="crosshair"></sl-icon>拖拽画面或按 Esc 随时退出巡航</div>
        </section>

        <!-- 楼层 -->
        <section class="card glass panel" data-panel="floors">
          <header class="card__head">
            <span class="eyebrow">楼层分层</span>
            <label class="inline-switch">拆层展开 <sl-switch size="small" data-ref="tgExplode"></sl-switch></label>
          </header>
          <div class="stack" data-ref="stack"></div>
          <div class="hint"><sl-icon name="layers"></sl-icon>选择楼层后，上部楼层剖切隐藏，露出该层室内</div>
        </section>
      </aside>

      <!-- ============ 地图工具 ============ -->
      <nav class="tools glass">
        <sl-tooltip content="放大" placement="left"><sl-icon-button name="plus-lg" label="放大" data-act="zoomIn"></sl-icon-button></sl-tooltip>
        <sl-tooltip content="缩小" placement="left"><sl-icon-button name="dash-lg" label="缩小" data-act="zoomOut"></sl-icon-button></sl-tooltip>
        <i class="tools__sep"></i>
        <sl-tooltip content="复位视角" placement="left"><sl-icon-button name="compass" label="复位视角" data-act="reset"></sl-icon-button></sl-tooltip>
        <sl-tooltip content="昼 / 夜" placement="left"><sl-icon-button name="moon-stars" label="昼夜" data-act="daynight"></sl-icon-button></sl-tooltip>
        <sl-tooltip content="全屏" placement="left"><sl-icon-button name="arrows-fullscreen" label="全屏" data-act="fullscreen"></sl-icon-button></sl-tooltip>
      </nav>

      <!-- ============ 状态栏 ============ -->
      <footer class="statusbar glass">
        <span class="sb"><sl-icon name="compass"></sl-icon><span data-ref="sbHeading">北 0°</span></span>
        <span class="sb"><sl-icon name="stack"></sl-icon><span data-ref="sbFloor">整楼</span></span>
        <span class="sb"><sl-icon name="sun"></sl-icon><span data-ref="sbLight">白昼</span></span>
        <span class="sb sb--orbit" data-ref="sbOrbit"><i class="live__dot"></i>巡航中</span>
        <span class="sb sb--hint">左键旋转 · 右键平移 · 滚轮缩放</span>
      </footer>

      <div class="pin-label" data-ref="pinLabel"><div class="pl"><b></b><span></span></div></div>
      <div class="floor-tags" data-ref="floorTags"></div>
    </div>
  `);
  root.appendChild(hud);

  const ref = {};
  hud.querySelectorAll('[data-ref]').forEach((n) => {
    ref[n.dataset.ref] = n;
  });

  /* ---------------- 模式切换 ---------------- */
  let mode = 'overview';
  function setMode(next) {
    mode = MODES.some((m) => m.key === next) ? next : 'overview';
    hud.dataset.mode = mode;
    if (ref.modes.value !== mode) ref.modes.value = mode;
  }
  ref.modes.addEventListener('sl-change', () => setMode(ref.modes.value));

  /* ---------------- 摄像头数据渲染 ---------------- */
  let filter = 'all';
  let query = '';

  function matchesFilter(c) {
    if (filter === 'alarm') return ALARM_STATES.has(c.state);
    if (filter === 'outdoor') return c.floor === 'outdoor';
    if (filter === 'indoor') return c.floor !== 'outdoor';
    return true;
  }

  function renderAll() {
    const cams = api.listCameras();
    const selected = api.getSelectedCamera();
    const online = cams.filter((c) => c.state === 'online').length;
    const alarm = cams.filter((c) => ALARM_STATES.has(c.state)).length;
    const off = cams.length - online - alarm;
    const rate = cams.length ? Math.round(((online + alarm) / cams.length) * 100) : 0;

    ref.kOnlineRate.textContent = rate;
    ref.ring.value = rate;
    ref.kTotal.textContent = cams.length;
    ref.kOnline.textContent = online;
    ref.kAlarm.textContent = alarm;
    ref.kOff.textContent = off;
    ref.bellDot.style.display = alarm ? '' : 'none';

    const counts = {
      all: cams.length,
      alarm,
      outdoor: cams.filter((c) => c.floor === 'outdoor').length,
      indoor: cams.filter((c) => c.floor !== 'outdoor').length,
    };
    ref.chips.querySelectorAll('em').forEach((n) => {
      n.textContent = counts[n.dataset.c];
    });

    const q = query.trim().toLowerCase();
    const shown = cams
      .filter((c) => matchesFilter(c) && (!q || c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(ALARM_STATES.has(b.state)) - Number(ALARM_STATES.has(a.state)));
    ref.camList.innerHTML = shown.length
      ? shown
          .map((c) => {
            const meta = STATE_META[c.state] || STATE_META.online;
            return `<li class="cam ${c.id === selected ? 'is-active' : ''}" data-id="${c.id}">
              <span class="cam__badge tone-${meta.tone}"><sl-icon name="camera-video"></sl-icon></span>
              <span class="cam__text">
                <span class="cam__name">${esc(c.name)}</span>
                <span class="cam__sub">${c.id} · ${FLOOR_LABEL[c.floor] || c.floor} · ${c.type === 'dome' ? '球机' : '枪机'}${c.source === 'component' ? '<em class="new">新增</em>' : ''}</span>
              </span>
              <span class="state tone-${meta.tone}"><i></i>${meta.label}</span>
            </li>`;
          })
          .join('')
      : '<li class="cams__empty">没有匹配的摄像头</li>';

    requestAnimationFrame(() => {
      const act = ref.camList.querySelector('.cam.is-active');
      if (!act) return;
      const lr = ref.camList.getBoundingClientRect();
      const ar = act.getBoundingClientRect();
      if (ar.top < lr.top) ref.camList.scrollTop += ar.top - lr.top - 4;
      else if (ar.bottom > lr.bottom) ref.camList.scrollTop += ar.bottom - lr.bottom + 4;
    });

    renderEvents(cams);
    renderDetail(cams, selected);
    renderStack(cams);
  }

  ref.camList.addEventListener('click', (e) => {
    const li = e.target.closest('.cam');
    if (li) api.selectCamera(li.dataset.id, { fly: true });
  });
  ref.chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    filter = b.dataset.f;
    ref.chips.querySelectorAll('.chip').forEach((n) => n.classList.toggle('is-on', n === b));
    renderAll();
  });
  ref.search.addEventListener('sl-input', () => {
    query = ref.search.value || '';
    renderAll();
  });
  ref.search.addEventListener('sl-clear', () => {
    query = '';
    renderAll();
  });

  /* ---------------- 事件流 ---------------- */
  function renderEvents(cams) {
    const byId = new Map(cams.map((c) => [c.id, c]));
    const live = cams
      .filter((c) => ALARM_STATES.has(c.state))
      .map((c) => ({ cam: c.id, title: `${STATE_META[c.state].label}告警 · 设备上报`, level: c.state === 'alarm_critical' ? 'crit' : 'warn', mins: 0 }))
      .sort((a, b) => Number(b.level === 'crit') - Number(a.level === 'crit'));
    const list = [...live, ...DEMO_EVENTS.filter((e) => !live.some((l) => l.cam === e.cam))].slice(0, 8);
    ref.events.innerHTML = list
      .map(
        (e) => `<li class="ev ev--${e.level}" data-id="${e.cam}">
          <i class="ev__bar"></i>
          <span class="ev__text">
            <b>${esc(e.title)}</b>
            <span>${e.cam} · ${esc(byId.get(e.cam)?.name?.slice(0, 12) || '')}</span>
          </span>
          <time>${e.mins === 0 ? '刚刚' : e.mins < 60 ? `${e.mins} 分钟前` : `${Math.floor(e.mins / 60)} 小时前`}</time>
        </li>`
      )
      .join('');
  }
  ref.events.addEventListener('click', (e) => {
    const li = e.target.closest('.ev');
    if (li) api.selectCamera(li.dataset.id, { fly: true });
  });

  /* ---------------- 告警趋势 ---------------- */
  function renderTrend() {
    const d = DEMO_TREND[ref.trendRange.value] || DEMO_TREND['7d'];
    ref.trend.innerHTML = trendSvg(d.values);
    ref.trendAxis.innerHTML = d.labels.map((l) => `<span>${l}</span>`).join('');
    ref.tTotal.innerHTML = `${d.total}<small> 起</small>`;
    ref.tDelta.className = `delta ${d.delta > 0 ? 'delta--up' : 'delta--down'}`;
    ref.tDelta.textContent = `${d.delta > 0 ? '↑' : '↓'} ${Math.abs(d.delta)}% 环比`;
  }
  ref.trendRange.addEventListener('sl-change', renderTrend);

  /* ---------------- 图层 ---------------- */
  ref.tgMarkers.addEventListener('sl-change', () => api.setMarkersVisible(ref.tgMarkers.checked));
  ref.tgFov.addEventListener('sl-change', () => api.setFovMode(ref.tgFov.checked ? 'all' : 'selected'));
  ref.tgZones.addEventListener('sl-change', () => api.setLayerVisible('safetyZones', ref.tgZones.checked));

  /* ---------------- 详情 + 画中画 ---------------- */
  function renderDetail(cams, selected) {
    const cam = selected && cams.find((c) => c.id === selected);
    ref.detail.hidden = !cam;
    ref.empty.hidden = Boolean(cam);
    if (!cam) return;
    const meta = STATE_META[cam.state] || STATE_META.online;
    ref.dTitle.textContent = cam.name;
    ref.dSub.textContent = `${cam.id} · ${FLOOR_LABEL[cam.floor] || cam.floor} · ${cam.type === 'dome' ? '球机' : '枪机'}`;
    ref.dId.textContent = cam.id;
    ref.dFovText.textContent = `FOV ${cam.fovDeg}° · ${cam.range} m`;
    ref.dState.innerHTML = `<span class="state tone-${meta.tone}"><i></i>${meta.label}</span>`;
    ref.dFov.textContent = `${cam.fovDeg}°`;
    ref.dRange.textContent = `${cam.range} m`;
    ref.dNvr.textContent = cam.nvrId || '—';
    ref.dFovLabel.textContent = api.getCatalog().state.fovMode === 'none' ? '显示视锥' : '隐藏视锥';
  }
  ref.dClose.addEventListener('click', () => api.selectCamera(null));
  ref.dFly.addEventListener('click', () => {
    const id = api.getSelectedCamera();
    if (id) api.flyToCamera(id);
  });
  ref.dFovBtn.addEventListener('click', () => {
    const cur = api.getCatalog().state.fovMode;
    api.setFovMode(cur === 'none' ? 'selected' : 'none');
    ref.tgFov.checked = false;
    renderAll();
  });

  // 磨砂背景在画中画区域挖空，让 WebGL 实时取景透出（backdrop-filter 无法局部豁免，只能遮罩）
  let lastHole = '';
  function syncPreviewHole() {
    const card = ref.detail.getBoundingClientRect();
    const r = ref.preview.getBoundingClientRect();
    const x = r.left - card.left;
    const y = r.top - card.top;
    const key = `${x}|${y}|${r.width}|${r.height}`;
    if (key === lastHole) return;
    lastHole = key;
    const s = ref.detailBg.style;
    const img = 'linear-gradient(#000 0 0), linear-gradient(#000 0 0)';
    s.webkitMaskImage = img;
    s.maskImage = img;
    s.webkitMaskSize = s.maskSize = `100% 100%, ${r.width}px ${r.height}px`;
    s.webkitMaskPosition = s.maskPosition = `0 0, ${x}px ${y}px`;
    s.webkitMaskRepeat = s.maskRepeat = 'no-repeat';
    s.webkitMaskComposite = 'xor';
    s.maskComposite = 'exclude';
  }

  setPreviewRectProvider?.(() => {
    if (mode !== 'monitor' || ref.detail.hidden) return null;
    const r = ref.preview.getBoundingClientRect();
    if (r.width < 8) return null;
    syncPreviewHole();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });

  /* ---------------- 巡航 ---------------- */
  let laps = 0;
  let sweep = 0;
  let lastH = null;
  const droneParams = () => ({
    periodSec: Number(ref.rSpeed.value),
    height: Number(ref.rHeight.value),
    radius: Number(ref.rRadius.value),
    clockwise: ref.droneDir.value === 'cw',
  });
  function setDroneUi(active) {
    ref.droneBtn.innerHTML = active
      ? '<sl-icon slot="prefix" name="stop-fill"></sl-icon>结束巡航'
      : '<sl-icon slot="prefix" name="play-fill"></sl-icon>开始环绕巡航';
    ref.droneBtn.variant = active ? 'default' : 'primary';
    ref.droneStatus.innerHTML = active
      ? '<span class="pillstate pillstate--on"><i class="live__dot"></i>巡航中</span>'
      : '<span class="pillstate">待命</span>';
    hud.classList.toggle('is-orbiting', active);
    if (!active) {
      ref.cDir.textContent = '待命';
    }
  }
  function startDrone() {
    laps = 0;
    sweep = 0;
    lastH = null;
    ref.droneLaps.textContent = '0';
    api.startDroneOrbit(droneParams());
  }
  ref.droneBtn.addEventListener('click', () => (api.isDroneOrbiting() ? api.stopDroneOrbit() : startDrone()));
  const onRange = () => {
    const p = droneParams();
    ref.vSpeed.textContent = `${p.periodSec} s`;
    ref.vHeight.textContent = ref.droneAlt.textContent = `${p.height} m`;
    ref.vRadius.textContent = ref.droneRad.textContent = `${p.radius} m`;
    api.setDroneOrbitParams(p);
  };
  ref.rSpeed.tooltipFormatter = (v) => `${v} 秒/圈`;
  ref.rHeight.tooltipFormatter = (v) => `${v} m`;
  ref.rRadius.tooltipFormatter = (v) => `${v} m`;
  [ref.rSpeed, ref.rHeight, ref.rRadius].forEach((r) => r.addEventListener('sl-input', onRange));
  ref.droneDir.addEventListener('sl-change', () => {
    if (api.isDroneOrbiting()) startDrone();
  });

  /* ---------------- 楼层 ---------------- */
  function renderStack(cams) {
    const view = api.getFloorView();
    const count = (k) => (k === 'all' ? cams.length : k === 'roof' ? 0 : cams.filter((c) => c.floor === k).length);
    ref.stack.innerHTML = FLOOR_STACK.map(
      (f) => `<button class="floor ${view === f.key ? 'is-on' : ''} ${f.key === 'all' ? 'floor--all' : ''}" data-k="${f.key}">
        <span class="floor__name">${f.name}</span>
        <span class="floor__desc">${f.desc}</span>
        <span class="floor__cnt"><sl-icon name="camera-video"></sl-icon>${count(f.key)}</span>
      </button>`
    ).join('');
  }
  ref.stack.addEventListener('click', (e) => {
    const b = e.target.closest('.floor');
    if (b) api.setFloorView(b.dataset.k, { fly: true });
  });
  ref.tgExplode.addEventListener('sl-change', () => api.setExploded(ref.tgExplode.checked));

  /* ---------------- 工具 ---------------- */
  hud.querySelector('.tools').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'zoomIn') api.zoomBy(0.72);
    else if (act === 'zoomOut') api.zoomBy(1.38);
    else if (act === 'reset') api.resetView();
    else if (act === 'daynight') api.setLightingMode(api.getLightingMode() === 'night' ? 'day' : 'night');
    else if (act === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    }
  });
  const syncLighting = (m) => {
    const night = m === 'night';
    hud.querySelector('[data-act="daynight"]').name = night ? 'sun' : 'moon-stars';
    ref.sbLight.textContent = night ? '星夜' : m === 'dusk' ? '暮光' : '白昼';
  };
  const onFs = () => {
    const b = hud.querySelector('[data-act="fullscreen"]');
    if (b) b.name = document.fullscreenElement ? 'fullscreen-exit' : 'arrows-fullscreen';
  };
  document.addEventListener('fullscreenchange', onFs);

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    if (api.isDroneOrbiting()) api.stopDroneOrbit();
    else if (api.getSelectedCamera()) api.selectCamera(null);
  };
  window.addEventListener('keydown', onKey);

  /* ---------------- 事件订阅 ---------------- */
  const offs = [
    api.on('select', (id) => {
      if (id) setMode('monitor');
      renderAll();
    }),
    api.on('state', renderAll),
    api.on('add', renderAll),
    api.on('remove', renderAll),
    api.on('orbit', ({ active }) => {
      setDroneUi(active);
      if (active) setMode('drone');
    }),
    api.on('floor', (view) => {
      ref.sbFloor.textContent = FLOOR_STACK.find((f) => f.key === view)?.name || '整楼';
      renderAll();
    }),
    api.on('explode', (v) => {
      ref.tgExplode.checked = v;
    }),
    api.on('fovMode', (m) => {
      ref.tgFov.checked = m === 'all';
    }),
    api.on('lighting', syncLighting),
  ];

  renderTrend();
  renderAll();
  setDroneUi(api.isDroneOrbiting());
  syncLighting(api.getLightingMode());
  setMode('overview');

  /* ---------------- 每帧 ---------------- */
  const tagEls = new Map();
  let lastClock = '';
  let lastHeadingTxt = '';

  function updateFloorTags() {
    const anchors = api.getFloorAnchors();
    const f = anchors.length ? anchors[0].explodeFactor : 0;
    const show = f > 0.25;
    ref.floorTags.style.opacity = show ? String(Math.min(1, (f - 0.25) / 0.5)) : '0';
    if (!show) return;
    const view = api.getFloorView();
    const seen = new Set();
    for (const a of anchors) {
      seen.add(a.key);
      let n = tagEls.get(a.key);
      if (!n) {
        n = el('<button class="floor-tag"><b></b><span></span></button>');
        n.addEventListener('click', () => api.setFloorView(a.key));
        ref.floorTags.appendChild(n);
        tagEls.set(a.key, n);
      }
      const sp = api.getScreenPosition(a.position);
      n.style.transform = `translate(${sp.x + 30}px, ${sp.y}px) translate(0, -50%)`;
      n.style.display = sp.visible ? '' : 'none';
      const [k, t] = a.label.split(' ');
      n.querySelector('b').textContent = k;
      n.querySelector('span').textContent = t || '';
      n.classList.toggle('is-on', view === a.key);
    }
    for (const [k, n] of tagEls) if (!seen.has(k)) n.style.display = 'none';
  }

  function updatePinLabel() {
    const id = api.getSelectedCamera();
    if (!id) {
      ref.pinLabel.classList.remove('is-on');
      return;
    }
    const sp = api.getScreenPosition(id);
    const cam = api.listCameras().find((c) => c.id === id);
    if (!cam || !sp.visible) {
      ref.pinLabel.classList.remove('is-on');
      return;
    }
    ref.pinLabel.classList.add('is-on');
    ref.pinLabel.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
    const b = ref.pinLabel.querySelector('b');
    if (b.textContent !== cam.id) {
      b.textContent = cam.id;
      ref.pinLabel.querySelector('span').textContent = cam.name;
    }
  }

  function tick() {
    const now = new Date();
    const clock = now.toLocaleTimeString('zh-CN', { hour12: false });
    if (clock !== lastClock) {
      lastClock = clock;
      ref.clock.textContent = clock;
      if (!ref.detail.hidden) ref.dTime.textContent = `${now.toLocaleDateString('zh-CN')} ${clock}`;
    }

    const h = api.getViewHeading();
    const ht = headingText(h);
    const txt = `${ht.dir} ${ht.deg}°`;
    if (txt !== lastHeadingTxt) {
      lastHeadingTxt = txt;
      ref.sbHeading.textContent = txt;
    }

    if (api.isDroneOrbiting()) {
      ref.cNeedle.setAttribute('transform', `rotate(${h.toFixed(1)} 100 100)`);
      ref.cDeg.textContent = `${ht.deg}°`;
      ref.cDir.textContent = ht.dir;
      if (lastH !== null) {
        let d = h - lastH;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        sweep += Math.abs(d);
        const l = Math.floor(sweep / 360);
        if (l !== laps) {
          laps = l;
          ref.droneLaps.textContent = String(l);
        }
        ref.cProgress.setAttribute('stroke-dasharray', `${((sweep % 360) / 3.6).toFixed(2)} 100`);
      }
      lastH = h;
    }

    updatePinLabel();
    updateFloorTags();
  }

  return {
    tick,
    dispose() {
      offs.forEach((off) => off());
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      hud.remove();
      document.body.classList.remove('hud-on');
    },
  };
}
