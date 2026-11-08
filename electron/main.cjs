// Electron 主进程：把 Vite 打包后的 dist/ 作为展项程序运行
//
// 运行模式
//   展台模式（打包后的程序默认）：全屏锁定、隐藏鼠标、防休眠、崩溃 / 卡死自动恢复、每日定时重启
//   窗口模式（开发时默认，或加 --windowed 参数）：普通窗口，方便调试
//   开发时想试展台模式：npm run app:kiosk
// 工作人员退出程序：管理面板里点“退出程序”，或按 Ctrl+Alt+Shift+Q
const { app, BrowserWindow, protocol, net, session, systemPreferences, Menu, powerSaveBlocker, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ARGS = process.argv.slice(1);
const KIOSK = ARGS.includes('--kiosk') || (app.isPackaged && !ARGS.includes('--windowed'));
const HEARTBEAT_TIMEOUT_MS = 30000;

// ---------- 日志：写到 用户数据目录/logs/huakai.log，超过 5 MB 自动轮换 ----------
let logFile = '';
function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  if (!app.isPackaged) process.stdout.write(line);
  if (!logFile) return;
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.1`);
    fs.appendFileSync(logFile, line);
  } catch {}
}

// ---------- 内容目录：可以放在程序外面，员工改花朵 / 文案不用重新打包 ----------
// 依次查找：程序所在文件夹/content、用户数据目录/content，都没有则用程序内置的
function contentDirs() {
  return [path.join(path.dirname(process.execPath), 'content'), path.join(app.getPath('userData'), 'content')];
}
function activeContentDir() {
  return contentDirs().find((d) => fs.existsSync(path.join(d, 'exhibit.json'))) ?? null;
}
function readExhibitConfig() {
  const dir = activeContentDir();
  const file = dir ? path.join(dir, 'exhibit.json') : path.join(DIST, 'content', 'exhibit.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    log('warning', `读取 ${file} 失败：${e.message}`);
    return {};
  }
}

// 用自定义协议加载页面：file:// 下 fetch 不能读取 wasm / 模型文件
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit(); // 已经有一个在运行（比如被重复双击），不再开第二个
}

let win = null;
let allowQuit = false;
let lastBeat = Date.now();

function loadPage() {
  lastBeat = Date.now();
  win.loadURL('app://bundle/index.html');
}

function quitApp(reason) {
  log('info', `退出程序：${reason}`);
  allowQuit = true;
  app.quit();
}

function relaunchApp(reason) {
  log('info', `重启程序：${reason}`);
  allowQuit = true;
  app.relaunch();
  app.exit(0);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#07060b',
    title: '花开',
    autoHideMenuBar: true,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required', // 展项需要自动播放声音
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  win.webContents.on('console-message', (e) => {
    // “[app]” 开头的已经通过 kiosk.log 记过，不重复记录
    const msg = e.message ?? '';
    if ((e.level === 'warning' || e.level === 'error') && !msg.startsWith('[app]')) log(e.level, `[页面] ${msg}`);
  });

  // 页面崩溃：1 秒后重新加载
  win.webContents.on('render-process-gone', (_e, d) => {
    log('error', `页面进程退出（${d.reason}），重新加载`);
    setTimeout(loadPage, 1000);
  });

  // 页面卡死：等 10 秒仍无响应就强制重载
  let hangTimer = null;
  win.on('unresponsive', () => {
    log('warning', '页面无响应');
    hangTimer = setTimeout(() => {
      log('error', '页面持续无响应，强制重新加载');
      win.webContents.forcefullyCrashRenderer();
      loadPage();
    }, 10000);
  });
  win.on('responsive', () => clearTimeout(hangTimer));

  // 展台模式下不允许被关掉（Alt+F4 等），只能通过管理面板或专用快捷键退出
  win.on('close', (e) => {
    if (KIOSK && !allowQuit) {
      e.preventDefault();
      log('warning', '已阻止关闭窗口（展台模式）');
    }
  });


  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (input.control && input.alt && input.shift && k === 'q') {
      e.preventDefault();
      quitApp('快捷键 Ctrl+Alt+Shift+Q');
      return;
    }
    if (!KIOSK) return;
    const blocked =
      ['f5', 'f11', 'f12'].includes(k) ||
      (input.control && ['r', 'w', 'p', '+', '-', '=', '0'].includes(k)) ||
      (input.control && input.shift && k === 'i') ||
      (input.alt && k === 'f4');
    if (blocked) e.preventDefault();
  });

  loadPage();
}

// ---------- 页面通过 preload.cjs 调用的功能 ----------
ipcMain.on('kiosk:heartbeat', () => (lastBeat = Date.now()));
ipcMain.on('kiosk:log', (_e, level, msg) => log(level, `[页面] ${msg}`));
ipcMain.handle('kiosk:quit', () => quitApp('管理面板'));
ipcMain.handle('kiosk:relaunch', () => relaunchApp('管理面板'));
ipcMain.handle('kiosk:get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('kiosk:set-autostart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  log('info', `开机自启：${on ? '开启' : '关闭'}`);
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('kiosk:info', () => ({
  version: app.getVersion(),
  kiosk: KIOSK,
  contentDir: activeContentDir(),
  logFile,
}));

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  logFile = path.join(app.getPath('userData'), 'logs', 'huakai.log');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  log('info', `启动 v${app.getVersion()}（${KIOSK ? '展台模式' : '窗口模式'}），内容目录：${activeContentDir() ?? '内置'}`);

  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'windowMenu' }]) : null);

  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    // /content/ 下的文件优先从外部内容目录读取
    if (rel.startsWith('/content/')) {
      for (const dir of contentDirs()) {
        const f = path.normalize(path.join(dir, rel.slice('/content/'.length)));
        if (f.startsWith(dir + path.sep) && fs.existsSync(f)) return net.fetch(pathToFileURL(f).toString());
      }
    }
    const file = path.normalize(path.join(DIST, rel));
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

  if (!KIOSK) return;

  powerSaveBlocker.start('prevent-display-sleep'); // 不让屏幕休眠

  // 心跳看门狗：页面每 5 秒报一次平安，30 秒没消息就重新加载
  setInterval(() => {
    if (Date.now() - lastBeat > HEARTBEAT_TIMEOUT_MS) {
      log('error', '页面心跳超时，重新加载');
      loadPage();
    }
  }, 5000);

  // 每日定时重启（释放长时间运行积累的内存），时间在 exhibit.json 的 kiosk.dailyRestart 里设置
  const restartAt = readExhibitConfig()?.kiosk?.dailyRestart;
  if (typeof restartAt === 'string' && /^\d{1,2}:\d{2}$/.test(restartAt)) {
    const startedAt = Date.now();
    setInterval(() => {
      const now = new Date();
      const hm = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
      const target = restartAt.replace(/^0(\d)/, '$1');
      if (hm === target && Date.now() - startedAt > 10 * 60 * 1000) relaunchApp(`每日定时重启 ${restartAt}`);
    }, 30000);
  }
});

app.on('window-all-closed', () => {
  // 展台模式下窗口被意外关掉（不是通过管理面板 / 快捷键），立刻重新打开
  if (KIOSK && !allowQuit) {
    log('warning', '窗口被意外关闭，重新打开');
    createWindow();
    return;
  }
  if (process.platform !== 'darwin' || KIOSK) app.quit();
});
