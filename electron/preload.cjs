// 只向页面暴露展项需要的几个功能（window.kiosk），页面本身拿不到 Node.js 能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  heartbeat: () => ipcRenderer.send('kiosk:heartbeat'),
  log: (level, msg) => ipcRenderer.send('kiosk:log', String(level), String(msg)),
  quit: () => ipcRenderer.invoke('kiosk:quit'),
  relaunch: () => ipcRenderer.invoke('kiosk:relaunch'),
  getAutoStart: () => ipcRenderer.invoke('kiosk:get-autostart'),
  setAutoStart: (on) => ipcRenderer.invoke('kiosk:set-autostart', !!on),
  info: () => ipcRenderer.invoke('kiosk:info'),
});
