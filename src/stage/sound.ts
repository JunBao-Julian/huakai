/**
 * 声音：全部用 Web Audio 实时合成，不需要音频文件。
 *  - 背景音：柔和的和弦铺底，花开得越大音色越明亮
 *  - 盛开音：一串清脆的风铃音
 */

const CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 392.0], // G
];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambientBus!: GainNode;
  private filter!: BiquadFilterNode;
  private voices: OscillatorNode[] = [];
  private chordTimer = 0;
  private chordIdx = 0;

  constructor(private volume: number, private ambient: boolean) {
    // 浏览器要求用户交互后才能出声；桌面版已在主进程放开限制
    const unlock = () => this.ensure()?.resume();
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(c.destination);
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.ambientBus = c.createGain();
    this.ambientBus.gain.value = 0;
    this.filter.connect(this.ambientBus).connect(this.master);
    if (this.ambient) this.startAmbient();
    return c;
  }

  start() {
    this.ensure()?.resume().catch(() => {});
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  setAmbient(on: boolean) {
    this.ambient = on;
    if (!this.ctx) return;
    if (on) this.startAmbient();
    else this.stopAmbient();
  }

  /** 每帧调用：花开得越大，背景音越明亮 */
  setBloom(openness: number) {
    if (this.ctx && this.voices.length) this.filter.frequency.setTargetAtTime(500 + 1800 * openness, this.ctx.currentTime, 0.4);
  }

  private startAmbient() {
    const c = this.ctx!;
    if (this.voices.length) return;
    this.voices = CHORDS[0].map((f, i) => {
      const o = c.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f / 2;
      o.detune.value = (i - 1.5) * 4;
      const g = c.createGain();
      g.gain.value = 0.05;
      o.connect(g).connect(this.filter);
      o.start();
      return o;
    });
    this.ambientBus.gain.setTargetAtTime(0.6, c.currentTime, 2);
    this.chordTimer = window.setInterval(() => {
      this.chordIdx = (this.chordIdx + 1) % CHORDS.length;
      this.voices.forEach((o, i) => o.frequency.setTargetAtTime(CHORDS[this.chordIdx][i] / 2, c.currentTime, 1.5));
    }, 8000);
  }

  private stopAmbient() {
    const c = this.ctx!;
    clearInterval(this.chordTimer);
    this.ambientBus.gain.setTargetAtTime(0, c.currentTime, 0.5);
    const old = this.voices;
    this.voices = [];
    setTimeout(() => old.forEach((o) => o.stop()), 2500);
  }

  /** 盛开时的风铃音 */
  chime() {
    const c = this.ensure();
    if (!c) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
    notes.forEach((f, i) => {
      const t = c.currentTime + i * 0.09;
      for (const [mult, amp] of [[1, 0.18], [2.01, 0.05]] as const) {
        const o = c.createOscillator();
        o.type = mult === 1 ? 'sine' : 'triangle';
        o.frequency.value = f * mult;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 1.9);
      }
    });
  }
}
