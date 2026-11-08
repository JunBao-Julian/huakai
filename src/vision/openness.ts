/** 由 21 个手部关键点计算手掌张开度，并按每位游客自动校准 */

type P = { x: number; y: number; z: number };

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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

/**
 * 自动校准：在一位游客的一次互动里，记录他手掌比值的最小 / 最大值，
 * 把“握拳 → 张开”的范围向他的实际范围靠拢。手小、手指张不开的孩子也能开满花。
 * base 是基准值（展项配置或管理面板里手动校准的结果），调整幅度有上下限，避免被噪声带偏。
 */
export class AutoCalibrator {
  private min = Infinity;
  private max = -Infinity;
  private n = 0;
  private smooth = NaN;

  constructor(public base: Calibration) {}

  reset() {
    this.min = Infinity;
    this.max = -Infinity;
    this.n = 0;
    this.smooth = NaN;
  }

  push(raw: number) {
    this.smooth = isNaN(this.smooth) ? raw : this.smooth + 0.35 * (raw - this.smooth);
    this.n++;
    this.min = Math.min(this.min, this.smooth);
    this.max = Math.max(this.max, this.smooth);
  }

  range(): { lo: number; hi: number } {
    const { closed, open } = this.base;
    if (this.n < 5) return { lo: closed, hi: open };
    let lo = clamp(this.min, closed - 0.15, closed + 0.25);
    let hi = clamp(this.max, open - 0.3, open + 0.2);
    if (hi - lo < 0.35) {
      const mid = (hi + lo) / 2;
      lo = mid - 0.175;
      hi = mid + 0.175;
    }
    return { lo, hi };
  }

  map(raw: number): number {
    const { lo, hi } = this.range();
    return clamp((raw - lo) / (hi - lo), 0, 1);
  }
}
