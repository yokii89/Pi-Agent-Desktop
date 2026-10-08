# 文件类型图标来源与许可（生成于 2026-09-13）

- 图标与映射来源：[peakoss/vscode-jetbrains-icon-theme](https://github.com/peakoss/vscode-jetbrains-icon-theme)（2023 图标集，`assets/2023/`）。
- 图标原始出处：[JetBrains Design Resources](https://intellij-icons.jetbrains.design/)（IntelliJ 平台开源仓库图标，Apache 2.0）。
- 上游主题映射代码：MIT，全文见同目录 [LICENSE.md](./LICENSE.md)；其中 Elixir 相关图标来自 intellij-elixir（Apache 2.0），见 LICENSE.md 内说明。
- 本目录相对上游的改动仅为文件名归一化：以主题 iconDefinitions 的定义名命名，暗色变体从 `<base>_dark.svg` 拆分到 `assets/dark/`；未使用的图标与文件夹图标未打包。
- 重新生成：`pnpm run gen:file-icons`（scripts/generate-file-icons.mjs，需要网络）。
- **补充图标**（PiDesk 自绘，风格对齐上游 16×16）：`icons-extra/{light,dark}/` + `extraMapping.ts`（Office/音视频/部分图片后缀）。不随 `gen:file-icons` 重写，许可见同目录（与主资产同源风格，形状为本仓库绘制）。
