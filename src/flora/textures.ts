import * as THREE from 'three';

/**
 * 程序化生成的写实纹理（无需外部图片）。
 * 每张颜色贴图都配一张法线贴图：叶脉、细小起伏会真实地受光、投出细微明暗，而不只是“画上去的线”。
 * 画布顶部 = 纹理 v=1（花瓣尖 / 叶尖），底部 = v=0（根部）。
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}

function toTexture(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** 可复现的随机数，同一种花每次生成的纹理一致 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** 低频噪声：小画布随机灰度，放大时双线性插值，得到柔和的斑驳 */
function noise(cols: number, rows: number, rand: () => number) {
  const [c, ctx] = canvas(cols, rows);
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < cols * rows; i++) {
    const v = rand() * 255;
    img.data.set([v, v, v, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function overlayNoise(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, cols: number, alpha: number, op: GlobalCompositeOperation = 'overlay') {
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(noise(cols, Math.round((cols * h) / w), rand), 0, 0, w, h);
  ctx.restore();
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, rand: () => number, alpha: number, n: number) {
  for (let i = 0; i < n; i++) {
    const v = rand() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
}

/** 由高度图（灰度）计算法线贴图 */
function heightToNormal(src: HTMLCanvasElement, strength: number) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const d = out.data;
  const H = (x: number, y: number) => s[((((y + h) % h) * w + ((x + w) % w)) << 2)] / 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) << 2;
      d[i] = (-dx / len * 0.5 + 0.5) * 255;
      d[i + 1] = (dy / len * 0.5 + 0.5) * 255; // 画布 y 向下，纹理 v 向上
      d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  ctx.putImageData(out, 0, 0);
  return c;
}

export interface PetalTextureOptions {
  stops: [number, string][];
  edgeRGB: string;
  veinRGB: string;
  /** 叶脉条数，莲花这种细密平行脉可以多一些 */
  veins?: number;
  seed?: string;
}

/** 花瓣：颜色渐变 + 斑驳 + 细密叶脉 + 边缘加深，配法线贴图 */
export function petalTextures(o: PetalTextureOptions) {
  const w = 1024, h = 2048;
  const rand = rng(hashSeed(o.seed ?? o.stops.map((s) => s[1]).join()));
  const [c, ctx] = canvas(w, h);

  const g = ctx.createLinearGradient(0, h, 0, 0);
  for (const [p, col] of o.stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 颜色向尖端、以及上半段的两侧边缘加深（真实莲瓣的粉色集中在尖端）
  const [ec, ectx] = canvas(w, h);
  const side = ectx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, `rgba(${o.edgeRGB},0.22)`);
  side.addColorStop(0.2, `rgba(${o.edgeRGB},0.05)`);
  side.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  side.addColorStop(0.8, `rgba(${o.edgeRGB},0.05)`);
  side.addColorStop(1, `rgba(${o.edgeRGB},0.22)`);
  ectx.fillStyle = side;
  ectx.fillRect(0, 0, w, h);
  ectx.globalCompositeOperation = 'destination-in';
  const fade = ectx.createLinearGradient(0, 0, 0, h * 0.65);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ectx.fillStyle = fade;
  ectx.fillRect(0, 0, w, h);
  ctx.drawImage(ec, 0, 0);
  const tip = ctx.createLinearGradient(0, 0, 0, h * 0.35);
  tip.addColorStop(0, `rgba(${o.edgeRGB},0.16)`);
  tip.addColorStop(1, `rgba(${o.edgeRGB},0)`);
  ctx.fillStyle = tip;
  ctx.fillRect(0, 0, w, h * 0.35);

  // 斑驳：大中小三层噪声，打破“一块平涂”的塑料感
  overlayNoise(ctx, w, h, rand, 6, 0.07);
  overlayNoise(ctx, w, h, rand, 24, 0.05);
  overlayNoise(ctx, w, h, rand, 120, 0.04);

  // 叶脉：从根部发散到边缘和尖端，细、密、若隐若现
  const n = o.veins ?? 70;
  const veinPaths: { pts: number[]; a: number; lw: number }[] = [];
  for (let i = 0; i < n; i++) {
    const k = (i / (n - 1)) * 2 - 1 + (rand() - 0.5) * 0.02;
    const x0 = w / 2 + k * w * 0.05;
    const x1 = w / 2 + k * w * 0.5 * (0.92 + rand() * 0.08);
    const y1 = h * (0.02 + Math.pow(Math.abs(k), 1.6) * 0.3 + rand() * 0.03);
    const cx = w / 2 + k * w * (0.3 + rand() * 0.06);
    const cy = h * (0.5 + (rand() - 0.5) * 0.08);
    veinPaths.push({ pts: [x0, h, cx, cy, x1, y1], a: 0.12 + rand() * 0.14, lw: 1.0 + rand() * 1.8 });
  }
  const drawVeins = (cx: CanvasRenderingContext2D, rgb: string, alphaMul: number, widthMul: number) => {
    for (const v of veinPaths) {
      cx.strokeStyle = `rgba(${rgb},${v.a * alphaMul})`;
      cx.lineWidth = v.lw * widthMul;
      cx.beginPath();
      cx.moveTo(v.pts[0], v.pts[1]);
      cx.quadraticCurveTo(v.pts[2], v.pts[3], v.pts[4], v.pts[5]);
      cx.stroke();
    }
  };
  // 叶脉在根部汇聚处淡出，避免出现一把“扇子”的图案
  const veinLayer = (scale: number, paint: (cx: CanvasRenderingContext2D) => void) => {
    const [vc, vctx] = canvas(w * scale, h * scale);
    vctx.scale(scale, scale);
    paint(vctx);
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.globalCompositeOperation = 'destination-in';
    const fade = vctx.createLinearGradient(0, h * scale, 0, h * scale * 0.55);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    vctx.fillStyle = fade;
    vctx.fillRect(0, 0, w * scale, h * scale);
    return vc;
  };
  ctx.drawImage(
    veinLayer(1, (vx) => {
      drawVeins(vx, o.veinRGB, 1, 1);
      vx.translate(2, 0); // 叶脉两侧略亮的“脊”
      drawVeins(vx, '255,255,255', 0.45, 0.8);
    }),
    0,
    0,
  );
  grain(ctx, w, h, rand, 0.04, 20000);

  // 高度图：叶脉凹陷成细沟 + 平行细褶 + 微小起伏
  const [hc, hctx] = canvas(w / 2, h / 2);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, w / 2, h / 2);
  overlayNoise(hctx, w / 2, h / 2, rand, 40, 0.12, 'source-over');
  hctx.globalAlpha = 1;
  hctx.filter = 'blur(1px)';
  hctx.drawImage(veinLayer(0.5, (vx) => drawVeins(vx, '40,40,40', 4, 2.2)), 0, 0);
  hctx.filter = 'none';
  grain(hctx, w / 2, h / 2, rand, 0.12, 12000);
  const normal = toTexture(heightToNormal(hc, 2.6), false);

  return { map: toTexture(c), normal };
}

/** 叶片 / 花萼：深绿、主脉 + 侧脉 */
export function leafTextures(seed = 'leaf', base: [string, string, string] = ['#3f6a22', '#35601d', '#4d7f2c']) {
  const w = 512, h = 1024;
  const rand = rng(hashSeed(seed));
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, base[0]);
  g.addColorStop(0.5, base[1]);
  g.addColorStop(1, base[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  overlayNoise(ctx, w, h, rand, 8, 0.25);
  overlayNoise(ctx, w, h, rand, 60, 0.1);
  const side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(20,40,10,0.35)');
  side.addColorStop(0.5, 'rgba(160,200,90,0.08)');
  side.addColorStop(1, 'rgba(20,40,10,0.35)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);

  const veins = (cx: CanvasRenderingContext2D, col: string, mid: number, lw: number) => {
    cx.strokeStyle = col;
    cx.lineWidth = mid;
    cx.beginPath();
    cx.moveTo(w / 2, h);
    cx.lineTo(w / 2, 0);
    cx.stroke();
    cx.lineWidth = lw;
    for (let i = 0; i < 16; i++) {
      const y = h * (0.94 - i * 0.058);
      for (const s of [-1, 1]) {
        cx.beginPath();
        cx.moveTo(w / 2, y);
        cx.quadraticCurveTo(w / 2 + s * w * 0.22, y - h * 0.05, w / 2 + s * w * 0.48, y - h * 0.13);
        cx.stroke();
      }
    }
  };
  veins(ctx, 'rgba(190,220,140,0.35)', 5, 1.6);
  grain(ctx, w, h, rand, 0.05, 6000);

  const [hc, hctx] = canvas(w, h);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, w, h);
  overlayNoise(hctx, w, h, rand, 30, 0.3, 'source-over');
  hctx.filter = 'blur(1.5px)';
  veins(hctx, 'rgba(255,255,255,0.8)', 7, 2.5);
  return { map: toTexture(c), normal: toTexture(heightToNormal(hc, 3), false) };
}

/** 荷叶：圆形，叶脉从中心放射，中心颜色浅 */
export function lotusPadTextures() {
  const S = 1024;
  const rand = rng(hashSeed('lotus-pad'));
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#9fb35a');
  g.addColorStop(0.08, '#5f8a33');
  g.addColorStop(0.6, '#3f6b24');
  g.addColorStop(1, '#2f5a1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  overlayNoise(ctx, S, S, rand, 10, 0.25);
  overlayNoise(ctx, S, S, rand, 70, 0.1);
  const radial = (cx: CanvasRenderingContext2D, col: string, lw: number) => {
    cx.strokeStyle = col;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.05;
      cx.lineWidth = lw;
      cx.beginPath();
      cx.moveTo(S / 2, S / 2);
      let x = S / 2, y = S / 2;
      for (let r = 0; r < S / 2; r += 16) {
        x = S / 2 + Math.cos(a + Math.sin(r * 0.01) * 0.04) * r;
        y = S / 2 + Math.sin(a + Math.sin(r * 0.01) * 0.04) * r;
        cx.lineTo(x, y);
      }
      cx.stroke();
      // 分叉
      for (const s of [-1, 1]) {
        cx.lineWidth = lw * 0.5;
        cx.beginPath();
        const r0 = S * (0.25 + rand() * 0.1);
        cx.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
        cx.lineTo(S / 2 + Math.cos(a + s * 0.12) * S * 0.5, S / 2 + Math.sin(a + s * 0.12) * S * 0.5);
        cx.stroke();
      }
    }
  };
  radial(ctx, 'rgba(170,200,110,0.35)', 3);
  grain(ctx, S, S, rand, 0.05, 15000);
  const [hc, hctx] = canvas(S / 2, S / 2);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, S / 2, S / 2);
  overlayNoise(hctx, S / 2, S / 2, rand, 50, 0.35, 'source-over');
  hctx.save();
  hctx.scale(0.5, 0.5);
  hctx.filter = 'blur(2px)';
  radial(hctx, 'rgba(255,255,255,0.9)', 7);
  hctx.restore();
  return { map: toTexture(c), normal: toTexture(heightToNormal(hc, 2.5), false) };
}

export function softDotTexture() {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/** 背景虚化光斑：中间平、边缘略亮的圆盘（相机镜头的光斑特征） */
export function bokehTexture() {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.82, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.92, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c);
}
