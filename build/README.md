# build/ — 打包资源

## icon.ico / icon.png

应用安装包使用的经典图标栅格产物，源文件是 PNG 母版：`src/renderer/assets/app-icon/app-icon.png`。其他可选图标见下方「内置应用图标变体」。

| 文件 | 用途 |
|------|------|
| `icon.ico` | **Windows 原生图标（打包用）**，内置 16/24/32/48/64/128/256 七档尺寸。`electron-builder.yml` 的 `icon` 字段指向它。 |
| `icon.png` | 1024×1024 RGBA 母版，供重新生成 ICO 或非 Windows 平台使用。 |

**为什么必须有 ICO**：Windows 任务栏、Alt+Tab、资源管理器都是原生图层，取图时按场景向系统要
不同尺寸（16/32/48…）。只提供单尺寸 PNG 时，小尺寸档会被降采样得模糊，或直接判为不合格而
回退到宿主进程（开发态即 `electron.exe`）的默认图标 —— **表现为任务栏始终是 Electron 原子图标**。

## 内置应用图标变体

`src/renderer/assets/app-icon/` 存放五款 1024×1024 PNG 图标母版。设置 → 个性化提供经典粉、湛蓝气泡、薄荷花园、霓虹藤蔓和柠檬涂鸦五款图标。

- `build/app-icons/<id>.png`：各款 1024×1024 PNG，用于 Windows 系统通知图标。
- `build/app-icons/<id>.ico`：各款 16/24/32/48/64/128/256 多尺寸 Windows ICO，用于窗口、任务栏和托盘。
- 修改任一 PNG 母版后运行 `pnpm run gen:app-icon` 更新以上资源；发布打包会收录这些图标，并将 PNG / ICO 解包到真实文件路径供 Windows 系统调用。
- 用户偏好保存在本机 `settings.json`，不跟随账号同步。更换图标需要重启应用；安装版启动时同时更新用户桌面及公共桌面上已有、可写且指向本次安装的 `PiDesk.lnk`，保留启动参数等属性。开发版不修改桌面快捷方式。

## installerSidebar.bmp / installerHeader.bmp / uninstallerSidebar.bmp

NSIS 安装/卸载向导的品牌位图（安装 = 方案二「晴空 · 浅色向导」，
卸载 = 方案一「同源告别 · 幽灵卡」，2026-11-08 设计确认），
由 `electron-builder.yml` 的 `nsis.installerSidebar` / `nsis.installerHeader` /
`nsis.uninstallerSidebar` 引用。

| 文件 | 逻辑尺寸 | 输出尺寸 | 出现位置 |
|------|---------|---------|---------|
| `installerSidebar.bmp` | 164×314 | **492×942（3×）** | 安装欢迎页 / 完成页左栏大图 |
| `installerHeader.bmp` | 150×57 | **450×171（3×）** | 选目录等中间页右上角横幅 |
| `uninstallerSidebar.bmp` | 164×314 | **492×942（3×）** | 卸载欢迎页 / 完成页左栏大图（告别构图） |

**为什么输出 3×**：MUI2 的侧栏图控件是 109×193 对话框单位（96 DPI 下 ≈164×314 px），
高 DPI 下控件按比例放大，NSIS 用近邻采样把位图缩放到控件像素尺寸——1× 位图在 150% 缩放的
屏幕上会被放大 1.5 倍而发糊。3× 输出让 100% / 150% / 200% 三档常用缩放都是整数倍下采样，
保持锐利（详见 `scripts/generate-installer-art.ps1` 顶部注释）。

胶囊文案刻意不写版本号，避免每次发版都要重生成美术。

## installer.nsh

向导文案覆盖（`nsis.include`）：安装/卸载欢迎页的标题与正文，双语随安装器语言切换，
与设计稿文案一致。会被同时拼进安装与卸载两份 NSIS 脚本，头注释里有生效原理。

## 重新生成

```bash
pnpm run gen:app-icon
pnpm run gen:installer-art
```

- `scripts/generate-app-icon.mjs` 使用 Electron `nativeImage` 缩放各款 PNG 母版，并生成 `build/app-icons/` 下的 1024×1024 PNG 与多尺寸 ICO。
- `scripts/generate-installer-art.ps1` 用 GDI+（零新增依赖）按脚本内登记的色板 / 文案
  重画三张 BMP；改美术先改脚本常量再运行。

两个脚本都**仅在更换图标 / 调整安装器美术时手动运行**，日常构建不依赖它们。

## 注意

- Windows 有图标缓存（`%LOCALAPPDATA%\Microsoft\Windows\Explorer\iconcache_*.db`）。
  换图标后若任务栏仍是旧图，先彻底退出应用；仍不对则重启资源管理器（任务管理器里重启
  「Windows 资源管理器」）以刷新缓存。
- 这两个文件是**打包必需的源资产**，不在 `.gitignore` 里，需随仓库提交。
