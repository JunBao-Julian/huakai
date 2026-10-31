// Electron 主进程：把 Vite 打包后的 dist/ 作为桌面应用运行
const { app, BrowserWindow, protocol, net, session, systemPreferences, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

// 用自定义协议加载页面：file:// 下 fetch 不能读取 wasm / 模型文件
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#07060b',
    title: '花开',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // 调试：HUAKAI_DEBUG=<日志文件路径> 时把页面日志写入文件（打包后的 GUI 程序没有控制台）
  if (process.env.HUAKAI_DEBUG) {
    const fs = require('node:fs');
    win.webContents.on('console-message', (e) => fs.appendFileSync(process.env.HUAKAI_DEBUG, `${e.message}\n`));
  }
  win.loadURL('app://bundle/index.html');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'windowMenu' }]) : null);

  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // 只允许摄像头权限
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const types = details.mediaTypes || [];
    cb(permission === 'media' && !types.includes('audio'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  if (process.platform === 'darwin') {
    try {
      await systemPreferences.askForMediaAccess('camera');
    } catch {}
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
