import type { ExhibitConfig } from '../config';

/**
 * 体验状态机：
 *   idle  待机吸引：花朵缓慢“呼吸”，提示游客伸手
 *   play  互动：花朵跟随手掌开合
 *   bloom 盛开高光：完全张开保持一会儿 → 花粉爆发 + 音效 + 横幅
 *   card  知识卡：显示这朵花的知识，花朵仍跟随手
 *   reset 复位：游客离开后花朵合上，换下一种花，回到待机
 * 只负责“现在处于哪个阶段、花该开多少”，画面和声音通过 hooks 交给外部。
 */

export type Phase = 'idle' | 'play' | 'bloom' | 'card' | 'reset';

export interface ExperienceHooks {
  onBloom(): void;
  onShowCard(): void;
  onHideCard(): void;
  /** 复位完成，该换下一朵花了 */
  onNextFlower(): void;
  onPhase(p: Phase): void;
}

const BLOOM_LEVEL = 0.9; // 张开度达到多少算“完全张开”
const REARM_LEVEL = 0.5; // 收拢到多少以下，才能再次触发盛开高光
const BANNER_SECONDS = 1.2; // 盛开横幅显示多久后出知识卡

export class Experience {
  phase: Phase = 'idle';
  /** 花朵目标张开度 0~1 */
  target = 0;
  private since = 0;
  private lastHand = -Infinity;
  private bloomSince = -1;
  private armed = true;

  constructor(private timing: ExhibitConfig['timing'], private hooks: ExperienceHooks) {}

  setTiming(t: ExhibitConfig['timing']) {
    this.timing = t;
  }

  private go(p: Phase, now: number) {
    if (p === this.phase) return;
    if (this.phase === 'card' || (this.phase === 'bloom' && p !== 'card')) this.hooks.onHideCard();
    this.phase = p;
    this.since = now;
    this.bloomSince = -1;
    if (p === 'bloom') {
      this.armed = false;
      this.hooks.onBloom();
    }
    if (p === 'card') this.hooks.onShowCard();
    if (p === 'idle') this.armed = true;
    this.hooks.onPhase(p);
  }

  /**
   * 每帧调用。now 毫秒；hand 为当前是否有人在玩及其张开度；display 为花朵当前实际张开度。
   * 返回花朵的目标张开度。
   */
  update(now: number, handPresent: boolean, handOpenness: number, display: number): number {
    const T = this.timing;
    const elapsed = (now - this.since) / 1000;
    if (handPresent) this.lastHand = now;
    const away = (now - this.lastHand) / 1000;

    switch (this.phase) {
      case 'idle': {
        const t = (now / 1000) % T.breathPeriod;
        // 幅度很小：保持花苞的样子，只是微微一张一合
        this.target = 0.02 + 0.1 * (0.5 - 0.5 * Math.cos((t / T.breathPeriod) * Math.PI * 2));
        if (handPresent) this.go('play', now);
        break;
      }
      case 'play':
      case 'bloom':
      case 'card': {
        if (handPresent) this.target = handOpenness; // 手短暂丢失时保持原样
        if (away > T.leaveTimeout) {
          this.go('reset', now);
          break;
        }
        if (this.target < REARM_LEVEL) this.armed = true;
        if (this.phase === 'play') {
          // 手张开、并且画面上的花也确实开满了，才算盛开
          if (this.armed && handPresent && this.target >= BLOOM_LEVEL && display >= BLOOM_LEVEL - 0.05) {
            if (this.bloomSince < 0) this.bloomSince = now;
            if ((now - this.bloomSince) / 1000 >= T.bloomHold) this.go('bloom', now);
          } else this.bloomSince = -1;
        } else if (this.phase === 'bloom') {
          if (elapsed >= BANNER_SECONDS) this.go('card', now);
        } else if (elapsed >= T.cardDuration) {
          this.go('play', now);
        }
        break;
      }
      case 'reset': {
        this.target = 0;
        if (handPresent) {
          this.go('play', now); // 人又回来了，不换花
        } else if (display < 0.04 && elapsed > 1.5) {
          this.hooks.onNextFlower();
          this.go('idle', now);
        }
        break;
      }
    }
    return this.target;
  }

  /** 管理面板手动切花时调用 */
  forceIdle(now: number) {
    this.go('idle', now);
  }
}
