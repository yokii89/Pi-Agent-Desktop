# 文件类型图标来源与许可（生成于 2026-09-13）

- 图标与映射来源：[peakoss/vscode-jetbrains-icon-theme](https://github.com/peakoss/vscode-jetbrains-icon-theme)（2023 图标集，`assets/2023/`）。
- 图标原始出处：[JetBrains Design Resources](https://intellij-icons.jetbrains.design/)（IntelliJ 平台开源仓库图标，Apache 2.0）。
- 上游主题映射代码：MIT，全文见同目录 [LICENSE.md](./LICENSE.md)；其中 Elixir 相关图标来自 intellij-elixir（Apache 2.0），见 LICENSE.md 内说明。
- 本目录相对上游的改动仅为文件名归一化：以主题 iconDefinitions 的定义名命名，暗色变体从 `<base>_dark.svg` 拆分到 `assets/dark/`；未使用的图标与文件夹图标未打包。
- 重新生成：`pnpm run gen:file-icons`（scripts/generate-file-icons.mjs，需要网络）。
- **补充图标**（PiDesk 自绘，风格对齐上游 16×16）：`icons-extra/{light,dark}/` + `extraMapping.ts`（Office/音视频/部分图片后缀）。不随 `gen:file-icons` 重写，许可见同目录（与主资产同源风格，形状为本仓库绘制）。
- `icons-extra/{light,dark}/vscode.svg`：**Visual Studio Code 品牌 logo**（官方 1.35 图标的矢量路径扁平简化版，去除滤镜与叠色层）。形状属公有领域（简单几何图形，Wikimedia Commons「Visual Studio Code 1.35 icon.svg」PD-shape 标注），出处为 code.visualstudio.com/brand；**VS Code 名称与 logo 是 Microsoft 的商标**，此处仅作「在 VS Code 中打开」入口的品牌指示（nominative）使用，不用于任何来源背示。不随 `gen:file-icons` 重写。
- `icons-extra/{light,dark}/file-explorer.svg`：**Windows 文件资源管理器的黄色文件夹图标**（Windows 11 23H2 `imageres.dll.mun` 图标的社区矢量化，内容未改动）。形状属公有领域（简单几何图形，Wikimedia Commons「Windows 11 FOLDER.svg」PD-shape 标注，作者标注 Microsoft Corporation）；**File Explorer / Windows 是 Microsoft 的商标**，此处仅作「在资源管理器中打开」入口的品牌指示（nominative）使用。不随 `gen:file-icons` 重写。
