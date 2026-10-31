import { BloomScene } from './scene';
import { HandTracker, startCamera } from './handTracker';
import {
  DEFAULT_CALIBRATION,
  loadCalibration,
  mapOpenness,
  OpennessFilter,
  rawOpenRatio,
  saveCalibration,
} from './openness';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const video = $<HTMLVideoElement>('video');
const overlay = $<HTMLCanvasElement>('overlay');
const octx = overlay.getContext('2d')!;
const statusEl = $('status');
const manual = $<HTMLInputElement>('manual');
const slider = $<HTMLInputElement>('slider');

const scene = new BloomScene($('stage'));
const tracker = new HandTracker();
const filter = new OpennessFilter();
let calib = loadCalibration();
let lastRaw = NaN;
let trackerReady = false;

// 手部骨架连线
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

function drawHand(lm: { x: number; y: number }[] | undefined) {
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lm) return;
  const W = overlay.width, H = overlay.height;
  octx.strokeStyle = 'rgba(255,170,200,0.9)';
  octx.lineWidth = 3;
  for (const [a, b] of BONES) {
    octx.beginPath();
    octx.moveTo(lm[a].x * W, lm[a].y * H);
    octx.lineTo(lm[b].x * W, lm[b].y * H);
    octx.stroke();
  }
  octx.fillStyle = '#fff';
  for (const p of lm) {
    octx.beginPath();
    octx.arc(p.x * W, p.y * H, 4, 0, Math.PI * 2);
    octx.fill();
  }
}

async function boot() {
  try {
    await startCamera(video);
  } catch (e) {
    console.error(e);
    statusEl.textContent = '无法打开摄像头，已切换为手动模式（拖动右下角滑块）';
    setManual(true);
    return;
  }
  try {
    await tracker.init();
    trackerReady = true;
    statusEl.textContent = `手势识别已就绪（${tracker.delegate}）· 请把手放到摄像头前`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = '手势模型加载失败，已切换为手动模式';
    setManual(true);
  }
}

function setManual(on: boolean) {
  manual.checked = on;
  slider.disabled = !on;
  if (on) slider.value = String(filter.value);
}
manual.addEventListener('change', () => setManual(manual.checked));

function fixCalib() {
  if (calib.open - calib.closed < 0.2) calib.open = calib.closed + 0.2;
  saveCalibration(calib);
}
$('cal-closed').onclick = () => {
  if (!isNaN(lastRaw)) { calib.closed = lastRaw; fixCalib(); }
};
$('cal-open').onclick = () => {
  if (!isNaN(lastRaw)) { calib.open = lastRaw; fixCalib(); }
};
$('cal-reset').onclick = () => {
  calib = { ...DEFAULT_CALIBRATION };
  saveCalibration(null);
};

addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') $('panel').classList.toggle('hidden');
});

// ---- 主循环 ----
let display = 0;
let prev = performance.now();
let detCount = 0;
let detT = prev;
const vOpen = $('v-open'), vRaw = $('v-raw'), vFps = $('v-fps'), meter = $('meter-fill');

function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
  prev = now;

  if (manual.checked) {
    filter.value = parseFloat(slider.value);
  } else if (trackerReady) {
    const res = tracker.detect(video, now);
    if (res) {
      detCount++;
      const world = res.worldLandmarks?.[0];
      if (world) {
        lastRaw = rawOpenRatio(world);
        filter.pushHand(mapOpenness(lastRaw, calib), now);
      } else {
        filter.pushNoHand(now, dt);
      }
      drawHand(res.landmarks?.[0]);
    } else if (!filter.handVisible) {
      filter.pushNoHand(now, dt);
    }
  }

  // 花朵本身带一点“惯性”，动作更柔和
  display += (filter.value - display) * (1 - Math.exp(-dt * 5));
  scene.render(display, now / 1000, dt);

  if (now - detT > 500) {
    vFps.textContent = manual.checked ? '手动' : `${Math.round((detCount * 1000) / (now - detT))} FPS`;
    detCount = 0;
    detT = now;
  }
  vOpen.textContent = `${Math.round(display * 100)}%`;
  vRaw.textContent = isNaN(lastRaw)
    ? '-'
    : `${lastRaw.toFixed(2)}  [${calib.closed.toFixed(2)}→${calib.open.toFixed(2)}]`;
  meter.style.width = `${display * 100}%`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
boot();
