import type { CompiledFlower } from '../flora/spec';

/** 画面上的文字层：提示、盛开横幅、知识卡 */

export type HintKind = 'attract' | 'open' | 'more' | 'none';

const $ = (id: string) => document.getElementById(id)!;

const HINT_TEXT: Record<Exclude<HintKind, 'none'>, string> = {
  attract: '伸出手掌，唤醒一朵花',
  open: '慢慢张开手掌',
  more: '再张开一点…',
};

export class Overlay {
  private hint = $('hint');
  private hintText = $('hint-text');
  private hintFlower = $('hint-flower');
  private banner = $('banner');
  private card = $('card');
  private bannerTimer = 0;
  private hintKind: HintKind | null = null;

  setTitle(title: string, subtitle: string) {
    $('title').textContent = title;
    $('subtitle').textContent = subtitle;
    document.title = `${title} · 手势互动`;
  }

  setHint(kind: HintKind, flowerName = '') {
    if (kind === this.hintKind) return;
    this.hintKind = kind;
    this.hint.classList.toggle('show', kind !== 'none');
    this.hint.classList.toggle('attract', kind === 'attract');
    if (kind !== 'none') this.hintText.textContent = HINT_TEXT[kind];
    this.hintFlower.textContent = kind === 'attract' && flowerName ? `此刻花开：${flowerName}` : '';
  }

  showBanner(name: string) {
    this.banner.innerHTML = `你唤醒了一朵<b>${escapeHtml(name)}</b>`;
    this.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 3500);
  }

  showCard(f: CompiledFlower) {
    const k = f.knowledge;
    $('card-name').textContent = f.name;
    $('card-latin').textContent = k.latin ?? '';
    const rows: [string, string | undefined][] = [
      ['科属', k.family],
      ['花期', k.bloom],
      ['花语', k.meaning],
      ['在本中心', k.location],
    ];
    $('card-rows').innerHTML = rows
      .filter(([, v]) => v)
      .map(([t, v]) => `<dt>${t}</dt><dd>${escapeHtml(v!)}</dd>`)
      .join('');
    $('card-intro').textContent = k.intro ?? '';
    this.card.classList.add('show');
  }

  hideCard() {
    this.card.classList.remove('show');
  }

  setMeter(v: number) {
    ($('meter-fill') as HTMLElement).style.width = `${v * 100}%`;
  }

  /** 给工作人员看的故障提示（如摄像头未连接），平时为空 */
  setStatus(text: string) {
    $('status').textContent = text;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
