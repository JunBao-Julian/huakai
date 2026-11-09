import { compileFlower, FALLBACK_FLOWER, type CompiledFlower, type FlowerSpec } from './flora/spec';
import { log } from './log';

/** 展项配置：content/exhibit.json，管理面板里的调整会以“本机覆盖”的形式保存在本机 */

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExhibitConfig {
  title: string;
  subtitle: string;
  flowers: string[];
  timing: {
    leaveTimeout: number; // 手离开多少秒后复位
    bloomHold: number; // 完全张开保持多少秒算“盛开”
    cardDuration: number; // 知识卡显示多少秒
    breathPeriod: number; // 待机时花朵“呼吸”一次的秒数
  };
  vision: {
    numHands: number;
    camera: { width: number; height: number };
    zone: Zone; // 互动区（画面镜像后的归一化坐标）
    minHandSize: number; // 手掌最小尺寸（占画面高度的比例），太小说明人站得太远
    calibration: { closed: number; open: number };
  };
  audio: { volume: number; ambient: boolean };
  admin: { pin: string };
  kiosk: { dailyRestart: string | null };
  /** 画面质量：high 全部效果；medium 关闭环境光遮蔽；low 只保留基础渲染（性能较弱的电脑） */
  render: { quality: 'high' | 'medium' | 'low' };
}

export const DEFAULT_CONFIG: ExhibitConfig = {
  title: '花开',
  subtitle: '张开手掌，花朵绽放 · 握拳，花朵闭合',
  flowers: ['lotus'],
  timing: { leaveTimeout: 8, bloomHold: 0.8, cardDuration: 15, breathPeriod: 6 },
  vision: {
    numHands: 2,
    camera: { width: 1280, height: 720 },
    zone: { x: 0.1, y: 0, w: 0.8, h: 1 },
    minHandSize: 0.05,
    calibration: { closed: 1.15, open: 1.85 },
  },
  audio: { volume: 0.6, ambient: true },
  admin: { pin: '2580' },
  kiosk: { dailyRestart: '03:00' },
  render: { quality: 'high' },
};

/** 允许在本机覆盖的配置项 */
export interface LocalOverrides {
  zone?: Zone;
  minHandSize?: number;
  calibration?: { closed: number; open: number };
  volume?: number;
  ambient?: boolean;
}

const OVERRIDES_KEY = 'huakai.overrides';
const BASE = import.meta.env.BASE_URL;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function merge<T>(base: T, patch: unknown): T {
  if (!isObj(patch) || !isObj(base)) return (patch === undefined ? base : (patch as T));
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : v;
  return out as T;
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} 读取失败（${res.status}）`);
  return res.json();
}

export function loadOverrides(): LocalOverrides {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveOverrides(patch: LocalOverrides | null) {
  if (!patch) localStorage.removeItem(OVERRIDES_KEY);
  else localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ ...loadOverrides(), ...patch }));
}

export function applyOverrides(cfg: ExhibitConfig, o: LocalOverrides): ExhibitConfig {
  const c = structuredClone(cfg);
  if (o.zone) c.vision.zone = o.zone;
  if (o.minHandSize) c.vision.minHandSize = o.minHandSize;
  if (o.calibration) c.vision.calibration = o.calibration;
  if (o.volume !== undefined) c.audio.volume = o.volume;
  if (o.ambient !== undefined) c.audio.ambient = o.ambient;
  return c;
}

/** 读取 exhibit.json（失败则用默认配置），再叠加本机覆盖 */
export async function loadConfig(): Promise<{ base: ExhibitConfig; config: ExhibitConfig }> {
  let base = DEFAULT_CONFIG;
  try {
    base = merge(DEFAULT_CONFIG, await fetchJson('content/exhibit.json'));
  } catch (e) {
    log('error', `展项配置读取失败，使用默认配置：${(e as Error).message}`);
  }
  return { base, config: applyOverrides(base, loadOverrides()) };
}

/** 逐个读取并校验花朵数据；有问题的跳过并记日志，全部失败时用内置荷花兜底 */
export async function loadFlowers(ids: string[]): Promise<CompiledFlower[]> {
  const out: CompiledFlower[] = [];
  for (const id of ids) {
    try {
      out.push(compileFlower((await fetchJson(`content/flowers/${id}.json`)) as FlowerSpec));
    } catch (e) {
      log('error', `花朵 ${id} 加载失败：${(e as Error).message}`);
    }
  }
  if (out.length === 0) out.push(compileFlower(FALLBACK_FLOWER));
  return out;
}
