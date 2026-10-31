# 花开 · 手势控制 3D 花朵

张开手掌，花朵绽放；握拳，花朵闭合；手半握，花就半开。

<p align="center">
  <img src="docs/images/bud.png" width="32%" alt="花苞" />
  <img src="docs/images/half.png" width="32%" alt="半开" />
  <img src="docs/images/full-clean.png" width="32%" alt="盛开" />
</p>

- **手势识别**：Google MediaPipe HandLandmarker 轻量模型（约 7.8 MB），在本机运行，**不联网、不上传任何画面**
- **3D 花朵**：Three.js 程序化建模的写实莲花，5 层花瓣，外层先开、内层后开，带光影、阴影、花粉粒子
- **跨平台**：Windows / macOS 桌面程序，下载即用

## 下载

到本仓库的 **[Releases](../../releases)** 页面下载对应文件：

| 你的电脑 | 下载这个文件 |
|---|---|
| Windows 10 / 11（64 位） | `HuaKai-0.1.0-win-x64.zip` |
| Mac（M1 / M2 / M3 / M4 芯片） | `HuaKai-0.1.0-mac-arm64.dmg` |
| Mac（Intel 芯片） | `HuaKai-0.1.0-mac-x64.dmg` |

> 不确定 Mac 是哪种芯片：点屏幕左上角  →「关于本机」，“芯片”一栏写 Apple M… 就选 arm64，写 Intel 就选 x64。

## 30 秒上手

1. 安装并打开程序（Windows 解压后双击 `HuaKai.exe`；Mac 打开 dmg 拖进「应用程序」）
2. 允许使用摄像头
3. 把手掌放到摄像头前，张开 → 花开，握拳 → 花合

第一次打开遇到“无法验证开发者”“已阻止此应用”等提示，或者想调整灵敏度，请看 👉 **[详细使用教程](docs/使用教程.md)**

## 想换一种花？

花瓣颜色、层数、片数、张开角度、花蕊、叶子……都可以改，改完重新打包即可。
👉 **[自定义花朵指南](docs/自定义花朵.md)**（含粉莲 → 白莲、红色郁金香、重瓣牡丹等现成示例）

## 开发者

需要 [Node.js](https://nodejs.org/) 20 或更高版本。

```bash
npm install          # 安装依赖
npm run dev          # 浏览器预览：http://localhost:5173
npm run app          # 以桌面程序方式运行
npm run dist:win     # 在 Windows 上打包 → release/
npm run dist:mac     # 在 Mac 上打包 → release/
```

**用 GitHub 同时打包两个平台**：打开仓库的 Actions 页 → 左侧选 `build` → 右侧 `Run workflow`。约 5 分钟后，在这次运行页面底部的 Artifacts 里下载 `HuaKai-Windows` 和 `HuaKai-macOS`。（macOS 安装包只能在 Mac 上构建，没有 Mac 就用这个方法。）

### 项目结构

```
src/
├─ flower/Flower.ts    3D 花朵建模与开合动画（换花主要改这里）
├─ flower/textures.ts  花瓣、叶子纹理（程序生成，无图片）
├─ scene.ts            灯光、相机、花粉粒子
├─ openness.ts         手掌张开度计算、平滑、校准
├─ handTracker.ts      摄像头与手势模型
└─ main.ts             主循环和界面
electron/main.cjs      桌面程序主进程（加载页面、摄像头权限）
public/models          手势模型 hand_landmarker.task
public/wasm            MediaPipe 推理引擎
.github/workflows      云端打包流程
```

### 原理

摄像头画面 → MediaPipe 识别手部 21 个关键点 → 计算「指尖到手腕的平均距离 ÷ 手掌长度」得到张开度（握拳约 1.0，张开约 2.0）→ 映射到 0~100% 并平滑 → 驱动每片花瓣从“花苞形态”转到“盛开形态”。
