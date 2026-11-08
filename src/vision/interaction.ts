import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Zone } from '../config';
import { AutoCalibrator, rawOpenRatio, type Calibration } from './openness';

/**
 * 交互引擎：把 MediaPipe 的原始识别结果变成“当前由谁在玩、手张开多少”。
 *  - 互动区：只认画面指定区域内、足够大的手（太小 = 站得太远或是围观人群）
 *  - 目标锁定：多只手时选最近（最大）且最靠中间的那只，锁定到他离开为止
 *  - 防误触：连续几帧都看到才算“有手”，短暂丢失不立刻判定离开
 *  - 自动校准：每位游客单独学习其握拳 / 张开范围
 * 坐标统一用“镜像后”的画面坐标（和管理面板里看到的一致），0~1。
 */

export interface VisionSettings {
  zone: Zone;
  minHandSize: number;
  calibration: Calibration;
}

export interface HandView {
  cx: number;
  cy: number;
  size: number;
  valid: boolean;
  locked: boolean;
  points: { x: number; y: number }[];
}

const CONFIRM_FRAMES = 3; // 连续多少帧看到手才算“有人在玩”
const LOST_MS = 500; // 手消失多久算“离开”
const LOCK_RADIUS = 0.25; // 锁定的手每帧最多移动多远仍算同一只

export class InteractionEngine {
  handPresent = false;
  /** 校准并平滑后的张开度 0~1 */
  openness = 0;
  /** 锁定那只手的原始比值（调试 / 手动校准用） */
  raw = NaN;
  /** 本帧所有手（给管理面板画图） */
  hands: HandView[] = [];
  readonly calib: AutoCalibrator;

  private lock: { cx: number; cy: number } | null = null;
  private lastSeen = -Infinity;
  private streak = 0;

  constructor(public settings: VisionSettings) {
    this.calib = new AutoCalibrator(settings.calibration);
  }

  setSettings(s: VisionSettings) {
    this.settings = s;
    this.calib.base = s.calibration;
  }

  /** 每拿到一帧识别结果调用一次；aspect = 视频宽 / 高 */
  update(res: HandLandmarkerResult, aspect: number, now: number) {
    const { zone, minHandSize } = this.settings;
    const views: HandView[] = (res.landmarks ?? []).map((lm) => {
      const pts = lm.map((p) => ({ x: 1 - p.x, y: p.y })); // 镜像
      const palm = [0, 5, 9, 13, 17].map((i) => pts[i]);
      const cx = palm.reduce((s, p) => s + p.x, 0) / palm.length;
      const cy = palm.reduce((s, p) => s + p.y, 0) / palm.length;
      const size = Math.hypot((pts[0].x - pts[9].x) * aspect, pts[0].y - pts[9].y);
      const inZone = cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h;
      return { cx, cy, size, valid: inZone && size >= minHandSize, locked: false, points: pts };
    });
    this.hands = views;

    let pick = -1;
    if (this.lock) {
      let best = LOCK_RADIUS;
      views.forEach((v, i) => {
        const d = Math.hypot(v.cx - this.lock!.cx, v.cy - this.lock!.cy);
        if (v.valid && d < best) {
          best = d;
          pick = i;
        }
      });
    }
    // 没有锁定，或锁定的手已离开足够久：重新挑一只
    if (pick < 0 && (!this.lock || now - this.lastSeen > LOST_MS)) {
      const zx = zone.x + zone.w / 2, zy = zone.y + zone.h / 2;
      let bestScore = -Infinity;
      views.forEach((v, i) => {
        if (!v.valid) return;
        const score = v.size * 4 - Math.abs(v.cx - zx) - Math.abs(v.cy - zy) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          pick = i;
        }
      });
    }

    const world = pick >= 0 ? res.worldLandmarks?.[pick] : undefined;
    if (pick >= 0 && world) {
      const v = views[pick];
      v.locked = true;
      this.lock = { cx: v.cx, cy: v.cy };
      this.lastSeen = now;
      this.streak++;
      if (!this.handPresent && this.streak >= CONFIRM_FRAMES) {
        this.handPresent = true;
        this.calib.reset(); // 新的一位游客
        this.openness = 0;
      }
      this.raw = rawOpenRatio(world);
      this.calib.push(this.raw);
      if (this.handPresent) this.openness += 0.35 * (this.calib.map(this.raw) - this.openness);
    } else {
      this.streak = 0;
      this.tick(now);
    }
  }

  /** 没有新识别结果时也要调用，用来判定“手离开了” */
  tick(now: number) {
    if (now - this.lastSeen > LOST_MS) {
      this.handPresent = false;
      this.lock = null;
    }
  }
}
