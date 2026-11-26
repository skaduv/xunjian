/**
 * 320×180 (16:9) 按需悬浮 AI 监控画中画卡（PipViewer）
 * - 停靠右下安全象限（绝不遮挡中央 3D 白模建筑），自动随右栏展开/折叠平移让位
 * - 低负载 8FPS Canvas 实时 AI 视觉仿真画面（仅打开且标签页前台时运行，关闭即 0 开销）
 * - 精准匹配场景检测框：危化禁区越界 / 消防通道占道 / 北主干道违停 / 正常巡检 / 上游 NVR 离线无信号
 * - 内置单路 FOV 视锥切换、[定位]、[确认处置]、[关闭] 快捷按钮
 */

function formatClock(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = Math.floor(date.getMilliseconds() / 100);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${d}`;
}

function drawCornerBox(ctx, x, y, w, h, color, label, confText) {
  const c = Math.min(12, w * 0.24, h * 0.24);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.fillStyle = color.replace('1)', '0.12)');
  ctx.fillRect(x, y, w, h);

  ctx.beginPath();
  // TL
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  // TR
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  // BR
  ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
  // BL
  ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
  ctx.stroke();

  // 标签条
  ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const tag = `${label} ${confText}`;
  const tw = ctx.measureText(tag).width + 8;
  const ty = Math.max(24, y - 15);
  ctx.fillStyle = color;
  ctx.fillRect(x, ty, tw, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(tag, x + 4, ty + 10.2);
  ctx.restore();
}

export class PipViewer {
  constructor({ root, onLocate, onToggleFov, onAcknowledge, onClose }) {
    this.root = root;
    this.onLocate = onLocate;
    this.onToggleFov = onToggleFov;
    this.onAcknowledge = onAcknowledge;
    this.onClose = onClose;

    this.isOpen = false;
    this.rightDrawerOpen = true;
    this.camera = null;
    this.alarm = null;
    this.fovActive = false;
    this.timerId = 0;
    this.frameTick = 0;

    this._mountDOM();
  }

  _mountDOM() {
    this.el = document.createElement('section');
    this.el.className = 'wb-pip wb-chrome';
    this.el.setAttribute('aria-label', 'AI 监控实时画中画预览');
    this.el.innerHTML = `
      <div class="wb-pip__head">
        <div class="wb-pip__title-wrap">
          <span class="wb-pip__id wb-num"></span>
          <span class="wb-pip__name"></span>
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
          <span class="wb-pip__nvr wb-num"></span>
          <button type="button" class="wb-btn wb-icon-btn" data-act="close" title="关闭画中画">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="M4 4l8 8M12 4l-8 8"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="wb-pip__stage">
        <canvas class="wb-pip__canvas" width="320" height="180"></canvas>
        <div class="wb-pip__hud-top">
          <span class="wb-pip__live">
            <span class="wb-pip__live-dot"></span>
            <span class="wb-pip__live-text">LIVE</span>
          </span>
          <span class="wb-pip__clock wb-num">00:00:00.0</span>
        </div>
        <div class="wb-pip__hud-bottom">
          <span class="wb-pip__scenario-tag">AI 实时分析</span>
          <span class="wb-pip__meta-tag wb-num">1080P · 25fps</span>
        </div>
      </div>

      <div class="wb-pip__foot">
        <div class="wb-pip__foot-group">
          <button type="button" class="wb-pip-act" data-act="fov" title="开关单路 3D 视锥">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="width:12px;height:12px;">
              <path d="M2 8l11-5v10L2 8z"/>
            </svg>
            <span>视锥</span>
          </button>
          <button type="button" class="wb-pip-act" data-act="locate" title="3D 相机飞跃定位">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="width:12px;height:12px;">
              <circle cx="8" cy="8" r="3"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/>
            </svg>
            <span>定位</span>
          </button>
        </div>
        <div class="wb-pip__foot-group">
          <button type="button" class="wb-pip-act is-confirm" data-act="confirm" style="display:none;">
            <span>确认处置</span>
          </button>
          <button type="button" class="wb-pip-act" data-act="close">
            <span>关闭</span>
          </button>
        </div>
      </div>
    `;

    this.canvas = this.el.querySelector('.wb-pip__canvas');
    this.ctx = this.canvas.getContext('2d');
    this.idEl = this.el.querySelector('.wb-pip__id');
    this.nameEl = this.el.querySelector('.wb-pip__name');
    this.nvrEl = this.el.querySelector('.wb-pip__nvr');
    this.liveWrapEl = this.el.querySelector('.wb-pip__live');
    this.liveTextEl = this.el.querySelector('.wb-pip__live-text');
    this.clockEl = this.el.querySelector('.wb-pip__clock');
    this.scenarioEl = this.el.querySelector('.wb-pip__scenario-tag');
    this.metaEl = this.el.querySelector('.wb-pip__meta-tag');
    this.fovBtnEl = this.el.querySelector('[data-act="fov"]');
    this.confirmBtnEl = this.el.querySelector('[data-act="confirm"]');

    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !this.camera) return;
      const act = btn.dataset.act;
      if (act === 'close') {
        this.close();
        this.onClose?.();
      } else if (act === 'locate') {
        this.onLocate?.(this.camera.id);
      } else if (act === 'fov') {
        this.fovActive = !this.fovActive;
        this.fovBtnEl.classList.toggle('is-active', this.fovActive);
        this.onToggleFov?.(this.camera.id, this.fovActive);
      } else if (act === 'confirm' && this.alarm) {
        this.onAcknowledge?.(this.alarm.id);
      }
    });

    this.root.appendChild(this.el);
  }

  setRightDrawerOpen(open) {
    this.rightDrawerOpen = Boolean(open);
    this.el.classList.toggle('is-right-closed', !this.rightDrawerOpen);
  }

  open({ camera, alarm = null, fovActive = false }) {
    if (!camera) return;
    this.camera = camera;
    this.alarm = alarm && alarm.status === 'active' ? alarm : null;
    this.fovActive = Boolean(fovActive);
    this.isOpen = true;

    this._syncHeaderAndControls();
    this.el.classList.add('is-open');
    this.el.classList.toggle('is-right-closed', !this.rightDrawerOpen);

    this._renderFrame();
    this._ensureTimer();
  }

  update({ camera, alarm = null, fovActive }) {
    if (!this.isOpen || !camera || this.camera?.id !== camera.id) return;
    this.camera = camera;
    this.alarm = alarm && alarm.status === 'active' ? alarm : null;
    if (typeof fovActive === 'boolean') this.fovActive = fovActive;
    this._syncHeaderAndControls();
    this._renderFrame();
  }

  close() {
    this.isOpen = false;
    this.camera = null;
    this.alarm = null;
    this.el.classList.remove('is-open');
    this._stopTimer();
  }

  _syncHeaderAndControls() {
    const cam = this.camera;
    const isOffline = cam.state === 'offline';
    const floorTag = cam.floor === 'outdoor' ? '室外' : cam.floor;

    this.idEl.textContent = cam.id;
    this.nameEl.textContent = cam.name;
    this.nvrEl.textContent = `${cam.nvrId} · ${floorTag}`;

    this.liveWrapEl.classList.toggle('is-offline', isOffline);
    this.liveTextEl.textContent = isOffline ? 'NO SIGNAL' : 'LIVE';
    this.metaEl.textContent = isOffline ? '链路中断' : `${cam.type === 'dome' ? '球机' : '枪机'} · AI-Sec`;

    this.fovBtnEl.classList.toggle('is-active', this.fovActive);
    this.confirmBtnEl.style.display = this.alarm && !isOffline ? '' : 'none';

    this.scenarioEl.className = 'wb-pip__scenario-tag';
    if (isOffline) {
      this.scenarioEl.textContent = `上游 ${cam.nvrId} 离线 · 等待链路恢复`;
    } else if (this.alarm?.severity === 'critical') {
      this.scenarioEl.classList.add('is-critical');
      this.scenarioEl.textContent = `AI 告警 · ${this.alarm.title}`;
    } else if (this.alarm?.severity === 'warning') {
      this.scenarioEl.classList.add('is-warning');
      this.scenarioEl.textContent = `AI 预警 · ${this.alarm.title}`;
    } else if (cam.state === 'muted') {
      this.scenarioEl.textContent = '已静默 · 仅录像留存';
    } else {
      this.scenarioEl.textContent = 'AI 视觉巡检正常 · 0 异常目标';
    }
  }

  _ensureTimer() {
    if (this.timerId) return;
    // 轻量 8 FPS 动画（125ms），仅画中画打开时运行，几乎 0 GPU 负载
    this.timerId = window.setInterval(() => {
      if (!this.isOpen || document.hidden) return;
      this.frameTick += 1;
      this._renderFrame();
    }, 125);
  }

  _stopTimer() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = 0;
    }
  }

  _resolveScenario() {
    if (!this.camera) return 'normal';
    if (this.camera.state === 'offline') return 'offline';
    if (this.alarm?.scenario) return this.alarm.scenario;
    if (this.camera.state === 'alarm_critical') return 'hazmat';
    if (this.camera.state === 'alarm_order') {
      return this.camera.id === 'CAM-09' ? 'parking' : 'firelane';
    }
    return 'normal';
  }

  _renderFrame() {
    const ctx = this.ctx;
    if (!ctx || !this.camera) return;

    const w = 320;
    const h = 180;
    const t = this.frameTick * 0.125;
    const scenario = this._resolveScenario();

    this.clockEl.textContent = formatClock(new Date());

    // 1. 背景基调
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    if (scenario === 'offline') {
      bg.addColorStop(0, '#0b1120');
      bg.addColorStop(1, '#111827');
    } else if (scenario === 'hazmat') {
      bg.addColorStop(0, '#101827');
      bg.addColorStop(0.55, '#192334');
      bg.addColorStop(1, '#0e1522');
    } else if (scenario === 'parking') {
      bg.addColorStop(0, '#162233');
      bg.addColorStop(0.42, '#1e2c3e');
      bg.addColorStop(1, '#111926');
    } else {
      bg.addColorStop(0, '#0f1b2b');
      bg.addColorStop(0.52, '#17273a');
      bg.addColorStop(1, '#0d1624');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (scenario === 'offline') {
      this._drawOfflineScreen(ctx, w, h, t);
      return;
    }

    // 2. 建筑透视走廊/道路空间参考线
    this._drawPerspectiveRoom(ctx, w, h, scenario);

    // 3. 按场景绘制目标与 AI 识别检测框
    if (scenario === 'hazmat') {
      this._drawHazmatScenario(ctx, w, h, t);
    } else if (scenario === 'firelane') {
      this._drawFirelaneScenario(ctx, w, h, t);
    } else if (scenario === 'parking') {
      this._drawParkingScenario(ctx, w, h, t);
    } else {
      this._drawNormalPatrol(ctx, w, h, t);
    }

    // 4. 极轻安防扫描线与十字准星
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1;
    const scanY = ((t * 36) % (h - 32)) + 16;
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(w, scanY);
    ctx.stroke();

    // 角落光学定界符
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8, h / 2); ctx.lineTo(w / 2 + 8, h / 2);
    ctx.moveTo(w / 2, h / 2 - 8); ctx.lineTo(w / 2, h / 2 + 8);
    ctx.stroke();
    ctx.restore();
  }

  _drawOfflineScreen(ctx, w, h, t) {
    ctx.save();
    // 微妙信号条纹
    ctx.fillStyle = 'rgba(148, 163, 184, 0.045)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1);
    }
    // 中央断连图标
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.72)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2 - 14, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 10, h / 2 - 24);
    ctx.lineTo(w / 2 + 10, h / 2 - 4);
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`视频流中断 · 上游 ${this.camera.nvrId} 离线`, w / 2, h / 2 + 18);

    const dots = '.'.repeat((Math.floor(t * 2) % 3) + 1);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(`已由根因策略收敛，等待大华 NVR 链路重连${dots}`, w / 2, h / 2 + 34);
    ctx.restore();
  }

  _drawPerspectiveRoom(ctx, w, h, scenario) {
    ctx.save();
    const vpX = scenario === 'parking' ? 190 : 162;
    const vpY = scenario === 'parking' ? 58 : 66;

    // 地面梯形网格
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(vpX + i * 16, vpY + 8);
      ctx.lineTo(vpX + i * 74, h);
      ctx.stroke();
    }
    for (let j = 1; j <= 4; j++) {
      const y = vpY + 8 + Math.pow(j / 4, 1.45) * (h - vpY - 8);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // 墙体/建筑柱廊轮廓
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 22); ctx.lineTo(vpX - 42, vpY - 8); ctx.lineTo(vpX - 42, vpY + 26); ctx.lineTo(0, h - 18);
    ctx.moveTo(w, 22); ctx.lineTo(vpX + 42, vpY - 8); ctx.lineTo(vpX + 42, vpY + 26); ctx.lineTo(w, h - 18);
    ctx.stroke();
    ctx.restore();
  }

  _drawHazmatScenario(ctx, w, h, t) {
    ctx.save();
    // 红色禁区地面电子围栏多边形
    ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(78, 98);
    ctx.lineTo(246, 98);
    ctx.lineTo(276, 152);
    ctx.lineTo(48, 152);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // 实验室操作台轮廓
    ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.fillRect(216, 74, 58, 34);
    ctx.fillRect(46, 78, 48, 28);

    // 移动的未授权人员剪影
    const px = 148 + Math.sin(t * 1.4) * 16;
    const py = 92;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
    ctx.beginPath();
    ctx.arc(px + 12, py + 9, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(px + 5, py + 16, 14, 24);
    ctx.fillRect(px + 6, py + 40, 5, 16);
    ctx.fillRect(px + 13, py + 40, 5, 16);

    // 红色 AI 入侵检测框
    drawCornerBox(ctx, px - 6, py - 2, 36, 62, 'rgba(239, 68, 68, 1)', 'INTRUSION', '96.4%');
    ctx.restore();
  }

  _drawFirelaneScenario(ctx, w, h, t) {
    ctx.save();
    // 琥珀黄消防通道斜纹带
    ctx.fillStyle = 'rgba(245, 158, 11, 0.14)';
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(94, 86);
    ctx.lineTo(226, 86);
    ctx.lineTo(268, 158);
    ctx.lineTo(54, 158);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 通道中违规堆放的实验设备箱
    const bx = 132;
    const by = 104;
    ctx.fillStyle = 'rgba(203, 213, 225, 0.34)';
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.52)';
    ctx.lineWidth = 1;
    ctx.fillRect(bx, by, 54, 34);
    ctx.strokeRect(bx, by, 54, 34);
    ctx.fillRect(bx + 10, by - 16, 32, 16);
    ctx.strokeRect(bx + 10, by - 16, 32, 16);

    const pulsePad = Math.sin(t * 2.2) * 1.5;
    drawCornerBox(
      ctx,
      bx - 7 - pulsePad,
      by - 21 - pulsePad,
      68 + pulsePad * 2,
      62 + pulsePad * 2,
      'rgba(245, 158, 11, 1)',
      'FIRELANE BLOCK',
      '93.1%'
    );
    ctx.restore();
  }

  _drawParkingScenario(ctx, w, h, t) {
    ctx.save();
    // 禁停道路边缘标线
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 146);
    ctx.lineTo(240, 72);
    ctx.stroke();

    // 违停白色轿车轮廓
    const vx = 114;
    const vy = 94;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.78)';
    ctx.beginPath();
    ctx.roundRect(vx, vy + 14, 96, 26, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.beginPath();
    ctx.roundRect(vx + 18, vy + 3, 56, 15, 5);
    ctx.fill();
    // 双闪提示灯
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(vx + 2, vy + 20, 6, 5);
      ctx.fillRect(vx + 88, vy + 20, 6, 5);
    }

    drawCornerBox(
      ctx,
      vx - 8,
      vy - 4,
      112,
      50,
      'rgba(245, 158, 11, 1)',
      '苏D·8F29A 违停',
      '98.2%'
    );
    ctx.restore();
  }

  _drawNormalPatrol(ctx, w, h, t) {
    ctx.save();
    // 柔和青色 AI 巡检视野框
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.36)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(58, 48, 204, 88);
    ctx.setLineDash([]);

    // 雷达微脉冲点
    const rx = 160 + Math.cos(t * 0.9) * 42;
    const ry = 94 + Math.sin(t * 1.1) * 16;
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
    ctx.beginPath();
    ctx.arc(rx, ry, 8 + (Math.sin(t * 2.5) + 1) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.arc(rx, ry, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(52, 211, 153, 0.85)';
    ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('AI PATROL · CLEAR', 66, 62);
    ctx.restore();
  }

  dispose() {
    this._stopTimer();
    this.el?.remove();
  }
}
