import { SECURITY_CAMERAS, SECURITY_GROUPS } from '../config/campusConfig.js';

/**
 * 园区智能自动巡检漫游控制器（PatrolController）
 *
 * 特性：
 * - 精选顺时针全园 12 点位巡检路线（覆盖北迎宾主干道、中央大入口、西翼 W1-W5、西停车场、东翼 E2-E3、东消防环道与东北 NVR 核心机房）
 * - 支持自定义 targets（camera 或 group）、可配置停留时长 dwellMs、单路视锥 showFov、室内自动掀层 autoExposeFloor
 * - 内置人工拖拽自动让权（监听 OrbitControls 'start' 事件立即 pausePatrol('user_interact')，绝不与操作员抢镜头）
 * - 完全由主渲染循环 update(dt) 驱动（无后台定时器堆积，切后台 0% 负载，停留期间自然回落 12FPS 节能态）
 * - 完整 dispose() 清理，适配 Vite HMR
 */

const DEFAULT_PATROL_CAMERA_ORDER = [
  'CAM-09', // 北迎宾主干道违停监测
  'CAM-06', // 中央大入口门廊
  'CAM-05', // W5 西主入口扶梯大厅 (1F)
  'CAM-01', // W1 危化与电池实验室禁区 (1F)
  'CAM-02', // W2 主楼消防疏散通道 (1F)
  'CAM-10', // 西侧地面停车场与充电车棚
  'CAM-03', // W3 二层挑空中庭 (2F)
  'CAM-04', // W4 临湖木平台与台阶
  'CAM-07', // E2 二层实验室中央走廊 (2F)
  'CAM-08', // E3 报告厅与体育馆安全出口 (2F)
  'CAM-11', // 东侧消防环道与装卸区
  'CAM-12', // 东北核心机房/NVR 汇聚间 (1F)
];

const DEFAULT_DWELL_MS = 5200;
const DEFAULT_FLY_MS = 1150;

function resolveTargetMeta(raw) {
  if (!raw) return null;
  const item = typeof raw === 'string'
    ? { type: raw.startsWith('grp-') ? 'group' : 'camera', id: raw }
    : { ...raw };

  const type = item.type === 'group' ? 'group' : 'camera';
  if (type === 'camera') {
    const cam = SECURITY_CAMERAS.find((c) => c.id === item.id);
    if (!cam) return null;
    return {
      type: 'camera',
      id: cam.id,
      name: cam.name,
      floor: cam.floor,
      isIndoor: Boolean(cam.isIndoor),
      dwellMs: item.dwellMs,
      showFov: item.showFov,
      autoExposeFloor: item.autoExposeFloor,
      duration: item.duration,
      distanceScale: item.distanceScale,
    };
  }

  const grp = SECURITY_GROUPS.find((g) => g.id === item.id);
  if (!grp) return null;
  return {
    type: 'group',
    id: grp.id,
    name: grp.name,
    floor: grp.zoneType === 'building' ? 'all' : 'outdoor',
    isIndoor: false,
    dwellMs: item.dwellMs,
    showFov: item.showFov,
    autoExposeFloor: item.autoExposeFloor,
    duration: item.duration,
    distanceScale: item.distanceScale,
  };
}

function buildDefaultTargets() {
  return DEFAULT_PATROL_CAMERA_ORDER
    .map((id) => resolveTargetMeta({ type: 'camera', id }))
    .filter(Boolean);
}

export class PatrolController {
  constructor({
    studio,
    actions,
    onStateChange = null,
  }) {
    this.studio = studio;
    this.actions = actions;
    this._onStateChange = onStateChange;

    this.disposed = false;
    this._status = 'idle'; // 'idle' | 'running' | 'paused'
    this._targets = buildDefaultTargets();
    this._index = -1;
    this._loop = true;
    this._dwellMs = DEFAULT_DWELL_MS;
    this._flyDurationMs = DEFAULT_FLY_MS;
    this._showFov = true;
    this._autoExposeFloor = true;
    this._pauseOnUserInteract = true;
    this._pauseReason = null;

    this._phaseElapsedMs = 0;
    this._currentTotalMs = DEFAULT_DWELL_MS + DEFAULT_FLY_MS;
    this._patrolModifiedFloor = false;

    // 监听 OrbitControls 用户主动交互：一旦拖拽/缩放立即平滑让权暂停巡检
    this._onUserControlStart = () => {
      if (this.disposed) return;
      if (this._status === 'running' && this._pauseOnUserInteract) {
        this.pausePatrol('user_interact');
      }
    };
    this.studio?.controls?.addEventListener('start', this._onUserControlStart);
  }

  startPatrol(options = {}) {
    if (this.disposed) return this.getPatrolState();

    if (Array.isArray(options.targets) && options.targets.length > 0) {
      const resolved = options.targets.map(resolveTargetMeta).filter(Boolean);
      if (resolved.length > 0) {
        this._targets = resolved;
      }
    } else if (this._targets.length === 0) {
      this._targets = buildDefaultTargets();
    }

    this._loop = options.loop !== undefined ? Boolean(options.loop) : true;
    this._dwellMs =
      typeof options.dwellMs === 'number' && options.dwellMs >= 1000
        ? options.dwellMs
        : DEFAULT_DWELL_MS;
    this._flyDurationMs =
      typeof options.flyDurationMs === 'number' && options.flyDurationMs >= 250
        ? options.flyDurationMs
        : DEFAULT_FLY_MS;
    this._showFov = options.showFov !== undefined ? Boolean(options.showFov) : true;
    this._autoExposeFloor =
      options.autoExposeFloor !== undefined ? Boolean(options.autoExposeFloor) : true;
    this._pauseOnUserInteract =
      options.pauseOnUserInteract !== undefined ? Boolean(options.pauseOnUserInteract) : true;

    const startIdx =
      typeof options.startIndex === 'number'
        ? ((options.startIndex % this._targets.length) + this._targets.length) % this._targets.length
        : 0;

    this._status = 'running';
    this._pauseReason = null;
    this._visitIndex(startIdx);
    this._emitStateChange();
    return this.getPatrolState();
  }

  pausePatrol(reason = 'manual') {
    if (this._status !== 'running') return this.getPatrolState();
    this._status = 'paused';
    this._pauseReason = reason || 'manual';
    this._emitStateChange();
    return this.getPatrolState();
  }

  resumePatrol() {
    if (this.disposed) return this.getPatrolState();
    if (this._status === 'idle') {
      return this.startPatrol();
    }
    if (this._status === 'running') {
      return this.getPatrolState();
    }

    this._status = 'running';
    this._pauseReason = null;
    // 恢复时重新定位到当前点位，确保用户拖拽后平滑回到巡检轨道
    if (this._index >= 0 && this._index < this._targets.length) {
      this._visitIndex(this._index);
    } else {
      this._visitIndex(0);
    }
    this._emitStateChange();
    return this.getPatrolState();
  }

  stepPatrol(delta = 1) {
    if (this.disposed || this._targets.length === 0) return this.getPatrolState();
    const step = delta < 0 ? -1 : 1;
    const baseIdx = this._index < 0 ? 0 : this._index;
    const nextIdx = (baseIdx + step + this._targets.length) % this._targets.length;

    if (this._status === 'idle') {
      this._status = 'paused';
      this._pauseReason = 'step';
    }
    this._visitIndex(nextIdx);
    this._emitStateChange();
    return this.getPatrolState();
  }

  stopPatrol(options = {}) {
    if (this._status === 'idle' && this._index === -1) {
      return this.getPatrolState();
    }
    this._status = 'idle';
    this._index = -1;
    this._pauseReason = null;
    this._phaseElapsedMs = 0;

    if (this._patrolModifiedFloor) {
      this._patrolModifiedFloor = false;
      this.actions?.focusFloor?.('all');
    }
    this.actions?.setCameraFovOverride?.(null);
    if (options.restoreView) {
      this.actions?.resetView?.({ duration: 900 });
    }
    this._emitStateChange();
    return this.getPatrolState();
  }

  getPatrolState() {
    const current =
      this._index >= 0 && this._index < this._targets.length
        ? this._targets[this._index]
        : null;
    const progress =
      this._status === 'idle' || this._currentTotalMs <= 0
        ? 0
        : Math.min(1, Math.max(0, this._phaseElapsedMs / this._currentTotalMs));

    return {
      status: this._status,
      index: this._index,
      total: this._targets.length,
      currentTarget: current
        ? {
            type: current.type,
            id: current.id,
            name: current.name,
            floor: current.floor,
          }
        : null,
      loop: this._loop,
      dwellMs: this._dwellMs,
      progress: Number(progress.toFixed(3)),
      pauseReason: this._pauseReason,
    };
  }

  _visitIndex(idx) {
    const target = this._targets[idx];
    if (!target) return;

    this._index = idx;
    this._phaseElapsedMs = 0;

    const flyDuration = target.duration ?? this._flyDurationMs;
    const dwellMs = target.dwellMs ?? this._dwellMs;
    this._currentTotalMs = flyDuration + dwellMs;

    const showFov = target.showFov !== undefined ? Boolean(target.showFov) : this._showFov;
    const autoExposeFloor =
      target.autoExposeFloor !== undefined
        ? Boolean(target.autoExposeFloor)
        : this._autoExposeFloor;

    if (target.type === 'camera') {
      if (autoExposeFloor) {
        if (target.isIndoor && target.floor && target.floor !== 'outdoor') {
          this._patrolModifiedFloor = true;
        } else if (this._patrolModifiedFloor) {
          this._patrolModifiedFloor = false;
          this.actions?.focusFloor?.('all');
        }
      }

      this.actions?.setSelectedEntity?.(
        { type: 'camera', id: target.id },
        { showFov, showNvrLinks: false }
      );
      this.actions?.flyToCamera?.(target.id, {
        duration: flyDuration,
        distanceScale: target.distanceScale ?? 1.04,
        autoExposeFloor,
      });
    } else {
      if (this._patrolModifiedFloor) {
        this._patrolModifiedFloor = false;
        this.actions?.focusFloor?.('all');
      }
      this.actions?.setSelectedEntity?.(
        { type: 'group', id: target.id },
        { showFov: false, showNvrLinks: false }
      );
      this.actions?.flyToGroup?.(target.id, {
        duration: flyDuration,
        distanceScale: target.distanceScale ?? 1.0,
      });
    }
  }

  update(dt) {
    if (this.disposed || this._status !== 'running') return;
    if (this._targets.length === 0) return;

    this._phaseElapsedMs += dt * 1000;
    if (this._phaseElapsedMs >= this._currentTotalMs) {
      const nextIdx = this._index + 1;
      if (nextIdx < this._targets.length) {
        this._visitIndex(nextIdx);
        this._emitStateChange();
      } else if (this._loop) {
        this._visitIndex(0);
        this._emitStateChange();
      } else {
        this.stopPatrol({ restoreView: false });
      }
    }
  }

  _emitStateChange() {
    if (typeof this._onStateChange === 'function') {
      this._onStateChange(this.getPatrolState());
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.studio?.controls?.removeEventListener('start', this._onUserControlStart);
    this._status = 'idle';
    this._index = -1;
    this._onStateChange = null;
  }
}
