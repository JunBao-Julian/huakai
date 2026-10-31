import * as THREE from 'three';

/** 程序化生成的写实纹理（无需外部图片） */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// 画布顶部 = 纹理 v=1（花瓣尖），底部 = v=0（花瓣基部）
function drawVeins(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, count: number, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  for (let i = 0; i < count; i++) {
    const k = (i / (count - 1)) * 2 - 1; // -1..1
    const endX = w / 2 + k * w * 0.48;
    const ctrlX = w / 2 + k * w * 0.22 + (Math.random() - 0.5) * 20;
    ctx.beginPath();
    ctx.moveTo(w / 2 + k * w * 0.04, h);
    ctx.quadraticCurveTo(ctrlX, h * 0.55, endX, h * (0.04 + Math.abs(k) * 0.25 + Math.random() * 0.05));
    ctx.stroke();
    // 细分支
    if (Math.random() < 0.6) {
      const y0 = h * (0.35 + Math.random() * 0.3);
      ctx.beginPath();
      ctx.moveTo(ctrlX * 0.6 + (w / 2) * 0.4, y0);
      ctx.quadraticCurveTo(ctrlX + k * 30, y0 - h * 0.15, endX + k * 25, y0 - h * 0.3);
      ctx.stroke();
    }
  }
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, n = 6000) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() < 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * Math.random()})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
}

export function petalTextures(stops: [number, string][]) {
  const w = 512, h = 1024;
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, h, 0, 0);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 边缘略深、中间略亮
  const side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(190,40,90,0.22)');
  side.addColorStop(0.25, 'rgba(255,255,255,0)');
  side.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  side.addColorStop(0.75, 'rgba(255,255,255,0)');
  side.addColorStop(1, 'rgba(190,40,90,0.22)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);

  drawVeins(ctx, w, h, 'rgba(185,50,105,0.16)', 34, 1.6);
  speckle(ctx, w, h, 0.05);

  // 凹凸贴图：叶脉凸起
  const [bc, bctx] = canvas(w, h);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, w, h);
  drawVeins(bctx, w, h, 'rgba(255,255,255,0.55)', 34, 2.2);
  bctx.filter = 'blur(1px)';
  bctx.drawImage(bc, 0, 0);
  speckle(bctx, w, h, 0.08, 9000);

  return { map: toTexture(c), bump: toTexture(bc, false) };
}

export function leafTextures() {
  const w = 512, h = 1024;
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#4d7a2a');
  g.addColorStop(0.5, '#3f6e23');
  g.addColorStop(1, '#5b8a32');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(20,40,10,0.35)');
  side.addColorStop(0.5, 'rgba(160,200,90,0.12)');
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
    for (let i = 0; i < 14; i++) {
      const y = h * (0.92 - i * 0.065);
      for (const s of [-1, 1]) {
        cx.beginPath();
        cx.moveTo(w / 2, y);
        cx.quadraticCurveTo(w / 2 + s * w * 0.22, y - h * 0.05, w / 2 + s * w * 0.48, y - h * 0.12);
        cx.stroke();
      }
    }
  };
  veins(ctx, 'rgba(190,220,140,0.45)', 6, 2);
  speckle(ctx, w, h, 0.06);

  const [bc, bctx] = canvas(w, h);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, w, h);
  veins(bctx, 'rgba(30,30,30,0.7)', 8, 3);
  speckle(bctx, w, h, 0.1, 9000);

  return { map: toTexture(c), bump: toTexture(bc, false) };
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
