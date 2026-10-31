# 花开 · 手势控制花朵

张开手掌，花朵绽放；握拳，花朵闭合。手势识别使用 MediaPipe HandLandmarker 轻量模型（约 7.8 MB），全部在本机运行，不联网、不上传画面。

## 直接运行（打包好的程序）

### Windows
1. 解压 `HuaKai-0.1.0-win-x64.zip`
2. 双击文件夹里的 `HuaKai.exe`

> 如果系统提示“已阻止此应用”（Windows 11 智能应用控制 / SmartScreen），是因为程序没有购买代码签名证书。可点击“更多信息 → 仍要运行”；若被智能应用控制拦截且无法放行，需要正式发布时购买代码签名证书。

### macOS
1. 打开 `HuaKai-0.1.0-mac-arm64.dmg`（M 系列芯片）或 `-mac-x64.dmg`（Intel 芯片），把 HuaKai 拖进“应用程序”
2. 第一次打开时，macOS 会提示“无法验证开发者”：到 **系统设置 → 隐私与安全性**，点 **仍要打开**
   - 如果提示“已损坏”，在终端执行：`xattr -cr /Applications/HuaKai.app`
3. 首次启动会请求摄像头权限，请允许

## 打包

| 平台 | 在哪里打包 | 命令 | 产物 |
|---|---|---|---|
| Windows | Windows 电脑 | `npm run dist:win` | `release/HuaKai-版本-win-x64.zip` |
| macOS | Mac 电脑 | `npm run dist:mac` | `release/HuaKai-版本-mac-{arm64,x64}.dmg / .zip` |
| 两者 | GitHub Actions | 推到 GitHub 后在 Actions 页运行 `build`，或推送 `v*` 标签 | 在该次运行的 Artifacts 里下载 |

macOS 安装包只能在 macOS 上构建（Apple 工具链限制），所以没有 Mac 时请用 GitHub Actions。

## 开发

```bash
npm install
npm run dev      # 浏览器预览 http://localhost:5173
npm run app      # 以桌面应用方式运行
```

调试打包后的程序：设置环境变量 `HUAKAI_DEBUG=<日志文件路径>`，页面日志会写入该文件。

## 目录

- `src/flower/` 3D 花朵建模与开合动画
- `src/openness.ts` 手掌张开度计算、平滑、校准
- `src/handTracker.ts` 摄像头与手势模型
- `electron/main.cjs` 桌面应用主进程（加载页面、摄像头权限）
- `public/models`、`public/wasm` 本地模型与推理引擎
