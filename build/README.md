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

## 重新生成

```bash
pnpm run gen:app-icon
```

该脚本（`scripts/generate-app-icon.mjs`）把 PNG 母版拷贝为 `build/icon.png`，
再用 Electron `nativeImage` 缩放并打包成多尺寸 ICO。**仅在更换图标时手动运行**，日常构建不依赖它。

## 注意

- Windows 有图标缓存（`%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db`）。
  换图标后若任务栏仍是旧图，先彻底退出应用；仍不对则重启资源管理器（任务管理器里重启
  「Windows 资源管理器」）以刷新缓存。
- 这两个文件是**打包必需的源资产**，不在 `.gitignore` 里，需随仓库提交。
