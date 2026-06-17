# NexPlay

NexPlay 是一个基于 Electron + React 前端、Rust 本地后端的番剧媒体库桌面应用。

当前前端参考 `/home/xia/Downloads/123` 的视觉方向重写：暗色 Mica 质感、左侧导航栏、Home/Library/Detail/Settings 工作区、媒体卡片、匹配状态、扫描与设置操作入口。

Electron 渲染端通过 preload 暴露的 IPC API 调用 Rust 后端：

- `window.nexplay.getSnapshot()` -> `cargo run --quiet -- snapshot`
- `window.nexplay.scanLibrary()` -> `cargo run --quiet -- scan`

Rust 后端负责读取 `config.toml`、初始化 SQLite、扫描媒体目录，并把媒体库快照序列化为 JSON 返回给前端。

## 运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 渲染进程和 Electron 主进程。

## 构建

```bash
npm run build
npm start
```

构建产物输出到 `dist/renderer`，Electron 生产模式会加载该目录下的 `index.html`。

## 目录结构

- `electron/main.cjs`: Electron 主进程和窗口生命周期
- `electron/preload.cjs`: 安全暴露给渲染端的 preload API
- `src/`: Rust 后端，提供媒体库扫描、SQLite、Bangumi/dandanplay 服务和 JSON 命令入口
- `frontend/src/`: React 渲染端源码
- `frontend/src/pages/`: Home、Library、Detail、Settings 页面
- `frontend/src/ui.tsx`: 通用按钮、徽标、进度条、搜索框等 UI 控件
- `frontend/src/data.ts`: 当前前端演示数据
- `vite.config.ts`: Vite + React + Tailwind 构建配置

旧 Slint 前端已经作废，不再作为当前应用入口；Rust 后端继续保留，并通过 Electron IPC 接入。
