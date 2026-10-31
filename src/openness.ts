/** 由 21 个手部关键点计算手掌张开度 */

type P = { x: number; y: number; z: number };

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const FINGER_TIPS = [8, 12, 16, 20];

/**
 * 原始张开比值：指尖到腕部的平均距离 / 手掌尺度（腕部到中指根）。
 * 用 worldLandmarks（米制 3D）计算，不受手离镜头远近和手掌朝向影响。
 * 握拳约 1.0，完全张开约 2.0。
 */
export function rawOpenRatio(lm: P[]): number {
  const wrist = lm[0];
  const palm = Math.max(1e-6, dist(wrist, lm[9]));
  let sum = 0;
  for (const t of FINGER_TIPS) sum += dist(lm[t], wrist) / palm;
  const fingers = sum / FINGER_TIPS.length;
  // 拇指：指尖到小指根的距离，握拳时拇指收拢
  const thumb = dist(lm[4], lm[17]) / palm;
  return fingers * 0.85 + thumb * 0.15;
}

export interface Calibration {
  closed: number;
  open: number;
}

const KEY = 'huakai.calibration';
export const DEFAULT_CALIBRATION: Calibration = { closed: 1.15, open: 1.85 };

export function loadCalibration(): Calibration {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || '');
    if (typeof c.closed === 'number' && typeof c.open === 'number' && c.open > c.closed) return c;
  } catch {}
  return { ...DEFAULT_CALIBRATION };
}

export function saveCalibration(c: Calibration | null) {
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
}

export function mapOpenness(raw: number, c: Calibration): number {
  const t = (raw - c.closed) / (c.open - c.closed);
  return Math.min(1, Math.max(0, t));
}

/** 指数平滑 + 丢手处理 */
export class OpennessFilter {
  value = 0;
  private lastSeen = -Infinity;

  constructor(private alpha = 0.3, private holdMs = 1500, private closeRate = 0.25) {}

  pushHand(v: number, now: number) {
    this.value += this.alpha * (v - this.value);
    this.lastSeen = now;
  }

  /** 未检测到手：保持一段时间后缓慢闭合 */
  pushNoHand(now: number, dt: number) {
    if (now - this.lastSeen > this.holdMs) {
      this.value = Math.max(0, this.value - this.closeRate * dt);
    }
  }

  get handVisible() {
    return performance.now() - this.lastSeen < 300;
  }
}
