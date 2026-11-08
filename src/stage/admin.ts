import type { ExhibitConfig, LocalOverrides, Zone } from '../config';
import type { CompiledFlower } from '../flora/spec';
import type { HandView } from '../vision/interaction';

/**
 * 隐藏的管理面板：给工作人员调试和调整用，游客看不到。
 * 打开方式：依次点击屏幕 左上 → 右上 → 右下 → 左下 四个角（4 秒内），或按 Ctrl+Shift+A，然后输入密码。
 */

export interface AdminSnapshot {
  phase: string;
  flower: string;
  camera: string;
  model: string;
  fps: number;
  handPresent: boolean;
  hands: HandView[];
  raw: number;
  range: { lo: number; hi: number };
  openness: number;
}

export interface AdminDeps {
  getConfig(): ExhibitConfig;
  flowers: CompiledFlower[];
  currentFlower(): number;
  video: HTMLVideoElement;
  getRaw(): number;
  onOverrides(patch: LocalOverrides | null): void;
  onFlower(index: number): void;
  onManual(on: boolean, value: number): void;
  requirePin: boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export class Admin {
  open = false;
  private panel = $('admin');
  private canvas = $<HTMLCanvasElement>('cam-overlay');
  private ctx = this.canvas.getContext('2d')!;
  private lastDraw = 0;
  private cornerSeq: number[] = [];
  private cornerT = 0;

  constructor(private d: AdminDeps) {
    this.bindEntry();
    this.bindControls();
    this.syncFromConfig();
  }

  // ---------- 打开 / 关闭 ----------

  private bindEntry() {
    document.querySelectorAll<HTMLElement>('.corner').forEach((el) =>
      el.addEventListener('pointerdown', () => {
        const i = Number(el.dataset.i);
        const now = performance.now();
        if (now - this.cornerT > 4000) this.cornerSeq = [];
        this.cornerT = now;
        this.cornerSeq.push(i);
        const seq = this.cornerSeq.slice(-4).join('');
        if (seq === '0123') {
          this.cornerSeq = [];
          this.askPin();
        }
      }),
    );
    addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.open ? this.close() : this.askPin();
      }
      if (e.key === 'Escape' && this.open) this.close();
    });
    $('admin-close').onclick = () => this.close();

    const pin = $('pin'), input = $<HTMLInputElement>('pin-input'), err = $('pin-error');
    $('pin-cancel').onclick = () => pin.classList.add('hidden');
    $<HTMLFormElement>('pin-form').onsubmit = (e) => {
      e.preventDefault();
      if (input.value === this.d.getConfig().admin.pin) {
        pin.classList.add('hidden');
        this.show();
      } else {
        err.textContent = '密码不正确';
        input.select();
      }
    };
  }

  private askPin() {
    if (!this.d.requirePin || !this.d.getConfig().admin.pin) return this.show();
    const input = $<HTMLInputElement>('pin-input');
    input.value = '';
    $('pin-error').textContent = '';
    $('pin').classList.remove('hidden');
    input.focus();
  }

  private show() {
    this.open = true;
    this.panel.classList.remove('closed');
    document.body.classList.add('admin-open');
    this.syncFromConfig();
  }

  close() {
    this.open = false;
    this.panel.classList.add('closed');
    document.body.classList.remove('admin-open');
    // 离开管理面板时自动退出手动模式，避免展项卡在测试状态
    const manual = $<HTMLInputElement>('manual');
    if (manual.checked) {
      manual.checked = false;
      $<HTMLInputElement>('slider').disabled = true;
      this.d.onManual(false, 0);
    }
  }

  // ---------- 控件 ----------

  private syncFromConfig() {
    const c = this.d.getConfig();
    const z = c.vision.zone;
    $<HTMLInputElement>('zone-x').value = String(z.x);
    $<HTMLInputElement>('zone-y').value = String(z.y);
    $<HTMLInputElement>('zone-w').value = String(z.w);
    $<HTMLInputElement>('zone-h').value = String(z.h);
    $<HTMLInputElement>('min-size').value = String(c.vision.minHandSize);
    $<HTMLInputElement>('volume').value = String(c.audio.volume);
    $<HTMLInputElement>('ambient').checked = c.audio.ambient;
    const sel = $<HTMLSelectElement>('flower-select');
    sel.innerHTML = this.d.flowers.map((f, i) => `<option value="${i}">${f.name}</option>`).join('');
    sel.value = String(this.d.currentFlower());
  }

  private bindControls() {
    const zoneInputs = ['zone-x', 'zone-y', 'zone-w', 'zone-h'].map((id) => $<HTMLInputElement>(id));
    const readZone = (): Zone => {
      const [x, y, w, h] = zoneInputs.map((i) => parseFloat(i.value));
      return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
    };
    zoneInputs.forEach((i) => (i.oninput = () => this.d.onOverrides({ zone: readZone() })));
    $<HTMLInputElement>('min-size').oninput = (e) =>
      this.d.onOverrides({ minHandSize: parseFloat((e.target as HTMLInputElement).value) });

    const setCal = (key: 'closed' | 'open') => {
      const raw = this.d.getRaw();
      if (isNaN(raw)) return alert('摄像头前没有识别到手，请先把手放进绿框。');
      const cal = { ...this.d.getConfig().vision.calibration, [key]: raw };
      if (cal.open - cal.closed < 0.2) {
        if (key === 'closed') cal.open = cal.closed + 0.2;
        else cal.closed = cal.open - 0.2;
      }
      this.d.onOverrides({ calibration: cal });
    };
    $('cal-closed').onclick = () => setCal('closed');
    $('cal-open').onclick = () => setCal('open');
    $('cal-reset').onclick = () => this.d.onOverrides({ calibration: undefined });

    $<HTMLSelectElement>('flower-select').onchange = (e) => this.d.onFlower(Number((e.target as HTMLSelectElement).value));
    $('flower-next').onclick = () => {
      const i = (this.d.currentFlower() + 1) % this.d.flowers.length;
      $<HTMLSelectElement>('flower-select').value = String(i);
      this.d.onFlower(i);
    };

    $<HTMLInputElement>('volume').oninput = (e) => this.d.onOverrides({ volume: parseFloat((e.target as HTMLInputElement).value) });
    $<HTMLInputElement>('ambient').onchange = (e) => this.d.onOverrides({ ambient: (e.target as HTMLInputElement).checked });

    const manual = $<HTMLInputElement>('manual'), slider = $<HTMLInputElement>('slider');
    manual.onchange = () => {
      slider.disabled = !manual.checked;
      this.d.onManual(manual.checked, parseFloat(slider.value));
    };
    slider.oninput = () => this.d.onManual(manual.checked, parseFloat(slider.value));

    $('overrides-reset').onclick = () => {
      if (!confirm('清除在本机做过的所有调整（互动区、校准、音量），恢复展项配置文件里的设置？')) return;
      this.d.onOverrides(null);
      this.syncFromConfig();
    };

    // 桌面版才有的系统功能
    const k = window.kiosk;
    if (!k) return;
    $('sys-section').classList.remove('hidden');
    const auto = $<HTMLInputElement>('autostart');
    k.getAutoStart().then((on) => (auto.checked = on));
    auto.onchange = async () => (auto.checked = await k.setAutoStart(auto.checked));
    $('sys-reload').onclick = () => location.reload();
    $('sys-relaunch').onclick = () => confirm('重启程序？') && k.relaunch();
    $('sys-quit').onclick = () => confirm('退出程序？展项将停止运行。') && k.quit();
    k.info().then((i) => {
      $('sys-info').textContent = `版本 ${i.version} · ${i.kiosk ? '展台模式' : '窗口模式'}\n内容目录：${i.contentDir ?? '内置'}\n日志：${i.logFile}`;
      $('sys-info').style.whiteSpace = 'pre-wrap';
    });
  }

  // ---------- 刷新显示 ----------

  update(s: AdminSnapshot, now: number) {
    if (!this.open || now - this.lastDraw < 100) return;
    this.lastDraw = now;

    const rows: [string, string][] = [
      ['阶段', { idle: '待机吸引', play: '互动中', bloom: '盛开高光', card: '知识卡', reset: '复位换花' }[s.phase] ?? s.phase],
      ['当前花', s.flower],
      ['摄像头', s.camera],
      ['手势模型', s.model],
      ['识别速度', `${s.fps} 次/秒`],
      ['有人在玩', s.handPresent ? '是' : '否'],
      ['原始比值', isNaN(s.raw) ? '-' : s.raw.toFixed(2)],
      ['当前校准', `${s.range.lo.toFixed(2)} → ${s.range.hi.toFixed(2)}`],
      ['张开度', `${Math.round(s.openness * 100)}%`],
    ];
    $('admin-status').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');

    const v = this.d.video;
    const W = v.videoWidth || 1280, H = v.videoHeight || 720;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
      (this.canvas.parentElement as HTMLElement).style.aspectRatio = `${W} / ${H}`;
    }
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    const z = this.d.getConfig().vision.zone;
    g.strokeStyle = 'rgba(120, 230, 140, 0.9)';
    g.lineWidth = 4;
    g.setLineDash([16, 10]);
    g.strokeRect(z.x * W, z.y * H, z.w * W, z.h * H);
    g.setLineDash([]);
    for (const h of s.hands) {
      g.strokeStyle = h.locked ? 'rgba(255, 140, 190, 0.95)' : h.valid ? 'rgba(255,255,255,0.7)' : 'rgba(150,150,150,0.5)';
      g.lineWidth = h.locked ? 5 : 3;
      for (const [a, b] of BONES) {
        g.beginPath();
        g.moveTo(h.points[a].x * W, h.points[a].y * H);
        g.lineTo(h.points[b].x * W, h.points[b].y * H);
        g.stroke();
      }
      g.fillStyle = g.strokeStyle;
      g.font = '28px sans-serif';
      g.fillText(h.valid ? (h.locked ? '控制中' : '') : h.size < this.d.getConfig().vision.minHandSize ? '太远' : '区外', h.cx * W + 20, h.cy * H);
    }
  }
}
