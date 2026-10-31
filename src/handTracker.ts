import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;

/** 封装 MediaPipe HandLandmarker（轻量模型，本地 WASM 推理） */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  delegate: 'GPU' | 'CPU' = 'GPU';

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      this.landmarker = await make('GPU');
    } catch (e) {
      console.warn('GPU 委托失败，回退到 CPU', e);
      this.delegate = 'CPU';
      this.landmarker = await make('CPU');
    }
  }

  /** 视频有新帧时返回检测结果，否则返回 null */
  detect(video: HTMLVideoElement, now: number): HandLandmarkerResult | null {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    return this.landmarker.detectForVideo(video, now);
  }
}

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}
