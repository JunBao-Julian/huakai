import { BloomScene } from './scene';
import { applyOverrides, loadConfig, loadFlowers, loadOverrides, saveOverrides, type ExhibitConfig } from './config';
import { HandTracker, startCamera } from './vision/handTracker';
import { InteractionEngine } from './vision/interaction';
import { Experience } from './stage/experience';
import { Overlay } from './stage/overlay';
import { Sound } from './stage/sound';
import { Admin } from './stage/admin';
import { log } from './log';

const STALE_CAMERA_MS = 5000; // 摄像头多久没有新画面就重新打开
const CAMERA_RETRY_MS = 10000; // 摄像头打开失败后多久重试

async function main() {
  const { base, config } = await loadConfig();
  let cfg: ExhibitConfig = config;
  const flowers = await loadFlowers(cfg.flowers);
  const info = await window.kiosk?.info().catch(() => null);
  const kiosk = info?.kiosk ?? false;
  document.body.classList.toggle('kiosk', kiosk);

  const overlay = new Overlay();
  overlay.setTitle(cfg.title, cfg.subtitle);
  const scene = new BloomScene(document.getElementById('stage')!, !kiosk);
  let flowerIdx = 0;
  scene.setFlower(flowers[0]);

  const sound = new Sound(cfg.audio.volume, cfg.audio.ambient);
  sound.start();

  const visionSettings = (c: ExhibitConfig) => ({
    zone: c.vision.zone,
    minHandSize: c.vision.minHandSize,
    calibration: c.vision.calibration,
  });
  const vision = new InteractionEngine(visionSettings(cfg));
  const tracker = new HandTracker();
  const video = document.getElementById('video') as HTMLVideoElement;
  const manual = { on: false, value: 0 };

  const showFlower = (i: number, animate: boolean) => {
    flowerIdx = i;
    animate ? scene.swapFlower(flowers[i]) : scene.setFlower(flowers[i]);
  };

  const exp = new Experience(cfg.timing, {
    onBloom: () => {
      scene.burst();
      sound.chime();
      overlay.showBanner(flowers[flowerIdx].name);
    },
    onShowCard: () => {
      overlay.showCard(flowers[flowerIdx]);
      scene.makeRoomForCard(true);
    },
    onHideCard: () => {
      overlay.hideCard();
      scene.makeRoomForCard(false);
    },
    onNextFlower: () => flowers.length > 1 && showFlower((flowerIdx + 1) % flowers.length, true),
    onPhase: () => {},
  });

  // ---------- 摄像头与手势模型 ----------
  let camState: 'starting' | 'ok' | 'error' = 'starting';
  let modelState: 'loading' | 'ok' | 'error' = 'loading';
  let camRetry = 0;

  async function openCamera() {
    clearTimeout(camRetry);
    camState = 'starting';
    try {
      await startCamera(video, cfg.vision.camera.width, cfg.vision.camera.height, () => {
        log('warning', '摄像头断开，稍后重试');
        camState = 'error';
        camRetry = window.setTimeout(openCamera, CAMERA_RETRY_MS);
      });
      camState = 'ok';
      tracker.lastFrameAt = performance.now();
      log('info', `摄像头已打开：${video.videoWidth}×${video.videoHeight}`);
    } catch (e) {
      camState = 'error';
      log('error', `摄像头打开失败：${(e as Error).message}`);
      camRetry = window.setTimeout(openCamera, CAMERA_RETRY_MS);
    }
  }

  tracker
    .init(cfg.vision.numHands)
    .then(() => {
      modelState = 'ok';
      log('info', `手势模型已加载（${tracker.delegate}）`);
    })
    .catch((e) => {
      modelState = 'error';
      log('error', `手势模型加载失败：${(e as Error).message}`);
    });
  openCamera();

  // ---------- 管理面板 ----------
  const admin = new Admin({
    getConfig: () => cfg,
    flowers,
    currentFlower: () => flowerIdx,
    video,
    getRaw: () => vision.raw,
    requirePin: !import.meta.env.DEV,
    onOverrides: (patch) => {
      saveOverrides(patch);
      cfg = applyOverrides(base, loadOverrides());
      vision.setSettings(visionSettings(cfg));
      sound.setVolume(cfg.audio.volume);
      sound.setAmbient(cfg.audio.ambient);
    },
    onFlower: (i) => {
      showFlower(i, true);
      exp.forceIdle(performance.now());
    },
    onManual: (on, value) => {
      manual.on = on;
      manual.value = value;
    },
  });

  // ---------- 主循环 ----------
  let display = 0;
  let prev = performance.now();
  let detCount = 0, detFps = 0, detT = prev, lastBeat = 0, lastErr = 0;
  const camText = { starting: '正在打开', ok: '正常', error: '未连接（自动重试中）' };
  const modelText = { loading: '加载中', ok: '', error: '加载失败' };

  function frame(now: number) {
    requestAnimationFrame(frame); // 先排下一帧，单帧出错也不会让画面停住
    try {
      const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
      prev = now;

      if (camState === 'ok' && modelState === 'ok') {
        const res = tracker.detect(video, now);
        if (res) {
          detCount++;
          vision.update(res, video.videoWidth / video.videoHeight || 16 / 9, now);
        } else vision.tick(now);
        if (now - tracker.lastFrameAt > STALE_CAMERA_MS) {
          log('warning', '摄像头超过 5 秒没有新画面，重新打开');
          openCamera();
        }
      } else vision.tick(now);

      const present = manual.on || vision.handPresent;
      const openness = manual.on ? manual.value : vision.openness;
      const target = exp.update(now, present, openness, display);
      const speed = exp.phase === 'idle' || exp.phase === 'reset' ? 1.6 : 5; // 待机和复位时动作更舒缓
      display += (target - display) * (1 - Math.exp(-dt * speed));

      scene.render(display, now / 1000, dt);
      sound.setBloom(display);

      const p = exp.phase;
      overlay.setHint(
        p === 'idle' ? 'attract' : p === 'play' ? (display < 0.3 ? 'open' : display < 0.85 ? 'more' : 'none') : 'none',
        flowers[flowerIdx].name,
      );
      overlay.setMeter(display);
      overlay.setStatus(camState === 'error' ? '摄像头未连接' : modelState === 'error' ? '手势模型加载失败' : '');

      if (now - detT >= 1000) {
        detFps = Math.round((detCount * 1000) / (now - detT));
        detCount = 0;
        detT = now;
      }
      admin.update(
        {
          phase: p,
          flower: flowers[flowerIdx].name,
          camera: camState === 'ok' ? `${camText.ok} ${video.videoWidth}×${video.videoHeight}` : camText[camState],
          model: modelState === 'ok' ? `正常（${tracker.delegate}）` : modelText[modelState],
          fps: detFps,
          handPresent: present,
          hands: vision.hands,
          raw: vision.raw,
          range: vision.calib.range(),
          openness: display,
        },
        now,
      );

      if (now - lastBeat > 5000) {
        window.kiosk?.heartbeat(); // 桌面版主进程据此判断页面是否卡死
        lastBeat = now;
      }
    } catch (e) {
      if (now - lastErr > 10000) {
        log('error', `主循环异常：${(e as Error).stack ?? e}`);
        lastErr = now;
      }
    }
  }
  requestAnimationFrame(frame);

  addEventListener('error', (e) => log('error', `未捕获异常：${e.message} @ ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => log('error', `未处理的 Promise 异常：${e.reason}`));
}

main().catch((e) => log('error', `启动失败：${(e as Error).stack ?? e}`));
