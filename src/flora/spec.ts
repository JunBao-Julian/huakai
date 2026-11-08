/**
 * FlowerSpec：一种花 = 一份 JSON 数据（content/flowers/*.json）。
 * 员工只需填写直观参数（花瓣数、长短、宽窄、张开角度、颜色），
 * 花苞半径、错开距离、开放延迟等内部参数由 compileFlower() 自动推算。
 */

export interface Knowledge {
  latin?: string; // 学名
  family?: string; // 科属
  bloom?: string; // 花期
  meaning?: string; // 花语
  location?: string; // 在本中心哪里能看到（为空则不显示）
  intro?: string; // 一段简介
}

export interface LayerSpec {
  count: number; // 花瓣数
  length: number; // 花瓣长度（外层约 1.0~1.3）
  width: number; // 花瓣半宽（最宽处的一半）
  openAngle: number; // 完全张开时与竖直方向的夹角，单位：度（0 竖直，90 水平）
  tipCurl?: number; // 完全张开时花瓣尖外翻，单位：度
  cup?: number; // 横向内凹 0~1
  tint?: string; // 这一层的颜色微调（与花瓣颜色相乘）
  // 以下可选，不填则自动推算
  budRadius?: number;
  baseRadius?: number;
  baseHeight?: number;
  delay?: number;
}

export interface SepalSpec extends Partial<LayerSpec> {
  count: number;
}

export interface StamenSpec {
  count?: number;
  radius?: number;
  length?: [number, number];
  spread?: number; // 张开时散开角度，单位：度
  antherSize?: number;
  filamentColor?: string;
  antherColor?: string;
  pod?: string | false; // 莲蓬颜色，false 表示没有
}

export interface FlowerSpec {
  id: string;
  name: string;
  knowledge?: Knowledge;
  appearance: {
    petalColors: [number, string][]; // [位置 0~1, 颜色]，0 = 花瓣根部，1 = 花瓣尖
    edgeColor?: string; // 花瓣边缘加深色
    veinColor?: string; // 叶脉颜色
    sheenColor?: string; // 丝绒光泽色
    glowColor?: string; // 透光色
    ruffle?: number; // 边缘波浪倍数，1 为默认
    span?: number; // 每层从开始开放到完全开放所占的进度
    layers: LayerSpec[]; // 从外到内
    sepals?: SepalSpec | false;
    stamens?: StamenSpec | false;
  };
}

/** 引擎内部使用的参数（弧度、绝对尺寸） */
export interface LayerDef {
  n: number;
  L: number;
  W: number;
  rb: number;
  pr: number;
  py: number;
  tilt: number;
  bend: number;
  cup: number;
  delay: number;
  tint: string;
}

export interface StamenDef {
  count: number;
  radius: number;
  length: [number, number];
  spread: number;
  antherSize: number;
  filamentColor: string;
  antherColor: string;
  pod: string | null;
}

export interface CompiledFlower {
  id: string;
  name: string;
  knowledge: Knowledge;
  petalColors: [number, string][];
  edgeRGB: string;
  veinRGB: string;
  sheenColor: string;
  glowColor: string;
  ruffle: number;
  span: number;
  layers: LayerDef[];
  sepal: LayerDef | null;
  stamens: StamenDef | null;
}

const DEG = Math.PI / 180;
const STAGGER = 0.007; // 同层花瓣在花苞里依次错开的距离

function hexToRgb(hex: string, name: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`${name} 不是有效颜色：${hex}（应为 #RRGGBB）`);
  const v = parseInt(m[1], 16);
  return `${(v >> 16) & 255},${(v >> 8) & 255},${v & 255}`;
}

function num(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`${name} 必须是数字`);
  if (v < min || v > max) throw new Error(`${name} 应在 ${min}~${max} 之间，当前为 ${v}`);
  return v;
}

/** 校验并换算成引擎参数；数据有误时抛出带中文说明的错误 */
export function compileFlower(spec: FlowerSpec): CompiledFlower {
  if (!spec || typeof spec.id !== 'string' || typeof spec.name !== 'string') throw new Error('缺少 id 或 name');
  const A = spec.appearance;
  if (!A || !Array.isArray(A.layers) || A.layers.length === 0) throw new Error('appearance.layers 至少要有一层花瓣');
  if (!Array.isArray(A.petalColors) || A.petalColors.length < 2) throw new Error('petalColors 至少要有两个颜色');
  A.petalColors.forEach(([o, c], i) => {
    num(o, `petalColors[${i}] 的位置`, 0, 1);
    hexToRgb(c, `petalColors[${i}]`);
  });

  const layers: LayerDef[] = [];
  A.layers.forEach((l, i) => {
    const p = `第 ${i + 1} 层`;
    const n = Math.round(num(l.count, `${p} count`, 1, 16));
    const prev = layers[i - 1];
    // 外层花苞半径默认 0.3；内层自动缩小，保证和外层留出足够间隙（避免花瓣穿插）
    const minGap = prev ? prev.n * STAGGER + 0.008 : 0;
    let rb = l.budRadius ?? (prev ? prev.rb - Math.max(0.045, minGap) : 0.3);
    if (prev && rb > prev.rb - minGap) rb = prev.rb - minGap;
    rb = Math.max(0.04, rb);
    layers.push({
      n,
      L: num(l.length, `${p} length`, 0.1, 3),
      W: num(l.width, `${p} width`, 0.05, 1.5),
      rb,
      pr: l.baseRadius ?? Math.max(0.03, 0.13 - i * 0.02),
      py: l.baseHeight ?? i * 0.033,
      tilt: num(l.openAngle, `${p} openAngle`, 0, 150) * DEG,
      bend: num(l.tipCurl ?? 0, `${p} tipCurl`, -60, 90) * DEG,
      cup: num(l.cup ?? 0.5, `${p} cup`, 0, 1.5),
      delay: num(l.delay ?? i * 0.08, `${p} delay`, 0, 0.8),
      tint: l.tint ?? '#ffffff',
    });
    hexToRgb(layers[i].tint, `${p} tint`);
  });

  const maxDelay = Math.max(...layers.map((l) => l.delay));
  const span = Math.min(num(A.span ?? 0.62, 'span', 0.1, 1), Math.max(0.1, 1 - maxDelay));

  let sepal: LayerDef | null = null;
  if (A.sepals) {
    const s = A.sepals;
    const outer = layers[0];
    sepal = {
      n: Math.round(num(s.count, 'sepals.count', 0, 12)),
      L: s.length ?? 0.62,
      W: s.width ?? 0.2,
      rb: s.budRadius ?? outer.rb + outer.n * STAGGER + 0.015,
      pr: s.baseRadius ?? 0.12,
      py: s.baseHeight ?? -0.06,
      tilt: (s.openAngle ?? 112) * DEG,
      bend: (s.tipCurl ?? 20) * DEG,
      cup: s.cup ?? 0.25,
      delay: 0,
      tint: '#ffffff',
    };
    if (sepal.n === 0) sepal = null;
  }

  let stamens: StamenDef | null = null;
  if (A.stamens) {
    const s = A.stamens;
    stamens = {
      count: Math.round(num(s.count ?? 120, 'stamens.count', 1, 400)),
      radius: s.radius ?? 0.1,
      length: s.length ?? [0.2, 0.3],
      spread: (s.spread ?? 57) * DEG,
      antherSize: s.antherSize ?? 1,
      filamentColor: s.filamentColor ?? '#f3e3a0',
      antherColor: s.antherColor ?? '#e8a422',
      pod: s.pod === undefined ? '#c9d46a' : s.pod || null,
    };
  }

  return {
    id: spec.id,
    name: spec.name,
    knowledge: spec.knowledge ?? {},
    petalColors: A.petalColors,
    edgeRGB: hexToRgb(A.edgeColor ?? '#be285a', 'edgeColor'),
    veinRGB: hexToRgb(A.veinColor ?? '#b93269', 'veinColor'),
    sheenColor: A.sheenColor ?? '#ffd6e4',
    glowColor: A.glowColor ?? '#ff7aa6',
    ruffle: num(A.ruffle ?? 1, 'ruffle', 0, 6),
    span,
    layers,
    sepal,
    stamens,
  };
}

/** 内置粉莲：内容文件全部加载失败时兜底，保证展项始终有花可看 */
export const FALLBACK_FLOWER: FlowerSpec = {
  id: 'lotus',
  name: '荷花',
  knowledge: { latin: 'Nelumbo nucifera', family: '莲科 莲属', bloom: '6–9 月', meaning: '清白、坚贞' },
  appearance: {
    petalColors: [[0, '#f7f0d8'], [0.18, '#fbe8e6'], [0.5, '#f7c3d2'], [0.8, '#ee8fb0'], [1, '#d9638e']],
    layers: [
      { count: 6, length: 1.3, width: 0.5, openAngle: 81, tipCurl: 31, cup: 0.32, budRadius: 0.3, baseRadius: 0.13, baseHeight: 0, delay: 0 },
      { count: 6, length: 1.2, width: 0.46, openAngle: 68, tipCurl: 22, cup: 0.42, budRadius: 0.255, baseRadius: 0.11, baseHeight: 0.04, delay: 0.08, tint: '#fff6f8' },
      { count: 6, length: 1.06, width: 0.42, openAngle: 54, tipCurl: 13, cup: 0.55, budRadius: 0.21, baseRadius: 0.09, baseHeight: 0.08, delay: 0.16, tint: '#fff0f4' },
      { count: 5, length: 0.88, width: 0.36, openAngle: 41, tipCurl: 7, cup: 0.68, budRadius: 0.165, baseRadius: 0.07, baseHeight: 0.11, delay: 0.24, tint: '#ffeef3' },
      { count: 5, length: 0.66, width: 0.3, openAngle: 29, tipCurl: 3, cup: 0.8, budRadius: 0.12, baseRadius: 0.05, baseHeight: 0.13, delay: 0.32, tint: '#fff4f6' },
    ],
    sepals: { count: 5, budRadius: 0.355 },
    stamens: {},
  },
};
