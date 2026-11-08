import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { log } from '../log';

const BASE = import.meta.env.BASE_URL;

/** 封装 MediaPipe HandLandmarker（轻量模型，本地 WASM 推理） */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  delegate: 'GPU' | 'CPU' = 'GPU';
  /** 最近一次拿到新视频帧的时间，用于发现摄像头“卡住” */
  lastFrameAt = 0;

  async init(numHands: number): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const make = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      this.landmarker = await make('GPU');
    } catch (e) {
      log('warning', `GPU 推理不可用，改用 CPU：${(e as Error).message}`);
      this.delegate = 'CPU';
      this.landmarker = await make('CPU');
    }
  }

  get ready() {
    return !!this.landmarker;
  }

  /** 视频有新帧时返回检测结果，否则返回 null */
  detect(video: HTMLVideoElement, now: number): HandLandmarkerResult | null {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    this.lastFrameAt = now;
    return this.landmarker.detectForVideo(video, now);
  }
}

/** 打开摄像头；重复调用会先关掉旧的视频流 */
export async function startCamera(video: HTMLVideoElement, width: number, height: number, onEnded: () => void) {
  stopCamera(video);
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: width }, height: { ideal: height }, facingMode: 'user' },
    audio: false,
  });
  stream.getVideoTracks().forEach((t) => (t.onended = onEnded)); // 摄像头被拔掉时触发
  video.srcObject = stream;
  await video.play();
}

export function stopCamera(video: HTMLVideoElement) {
  const old = video.srcObject as MediaStream | null;
  old?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
