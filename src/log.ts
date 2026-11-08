/** 日志：浏览器里打到控制台；桌面版同时写入本机日志文件（见 electron/main.cjs） */

export type Level = 'info' | 'warning' | 'error';

export interface KioskBridge {
  heartbeat(): void;
  log(level: Level, msg: string): void;
  quit(): Promise<void>;
  relaunch(): Promise<void>;
  getAutoStart(): Promise<boolean>;
  setAutoStart(on: boolean): Promise<boolean>;
  info(): Promise<{ version: string; kiosk: boolean; contentDir: string | null; logFile: string }>;
}

declare global {
  interface Window {
    kiosk?: KioskBridge;
  }
}

export function log(level: Level, msg: string) {
  // “[app]” 前缀让桌面版主进程知道这条已经通过 kiosk.log 记过，不再重复记录
  (level === 'error' ? console.error : level === 'warning' ? console.warn : console.log)(`[app] ${msg}`);
  window.kiosk?.log(level, msg);
}
