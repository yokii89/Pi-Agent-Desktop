# build/ — 打包资源

## icon.ico / icon.png

应用图标的**栅格产物**，源文件是 PNG 母版：`src/renderer/assets/app-icon/app-icon.png`。

| 文件 | 用途 |
|------|------|
| `icon.ico` | **Windows 原生图标（打包用）**，内置 16/24/32/48/64/128/256 七档尺寸。`electron-builder.yml` 的 `icon` 字段指向它。 |
| `icon.png` | 1024×1024 RGBA 母版，供重新生成 ICO 或非 Windows 平台使用。 |

**为什么必须有 ICO**：Windows 任务栏、Alt+Tab、资源管理器都是原生图层，取图时按场景向系统要
不同尺寸（16/32/48…）。只提供单尺寸 PNG 时，小尺寸档会被降采样得模糊，或直接判为不合格而
回退到宿主进程（开发态即 `electron.exe`）的默认图标 —— **表现为任务栏始终是 Electron 原子图标**。

## installerSidebar.bmp / installerHeader.bmp

NSIS 安装向导的品牌位图（方案二「晴空 · 浅色向导」，2026-11-08 设计确认），
由 `electron-builder.yml` 的 `nsis.installerSidebar` / `nsis.installerHeader` /
`nsis.uninstallerSidebar` 引用（卸载向导复用侧栏图）。

| 文件 | 尺寸 | 出现位置 |
|------|------|---------|
| `installerSidebar.bmp` | **164×314** | 欢迎页 / 完成页左栏大图 |
| `installerHeader.bmp` | **150×57** | 选目录等中间页右上角横幅 |

**尺寸是 NSIS 硬性要求**，electron-builder 也只收 BMP 格式；尺寸不对时 NSIS 编译直接失败。
胶囊文案刻意不写版本号，避免每次发版都要重生成美术。

## 重新生成

```bash
pnpm run gen:app-icon
pnpm run gen:installer-art
```

- `scripts/generate-app-icon.mjs` 把 PNG 母版拷贝为 `build/icon.png`，
  再用 Electron `nativeImage` 缩放并打包成多尺寸 ICO。
- `scripts/generate-installer-art.ps1` 用 GDI+（零新增依赖）按脚本内登记的色板 / 文案
  重画两张 BMP；改美术先改脚本常量再运行。

两个脚本都**仅在更换图标 / 调整安装器美术时手动运行**，日常构建不依赖它们。

## 注意

- Windows 有图标缓存（`%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db`）。
  换图标后若任务栏仍是旧图，先彻底退出应用；仍不对则重启资源管理器（任务管理器里重启
  「Windows 资源管理器」）以刷新缓存。
- 这两个文件是**打包必需的源资产**，不在 `.gitignore` 里，需随仓库提交。
