import { defineMessages } from "../types";

/** 右栏、底部终端、标题栏等主界面 chrome 文案。 */
export const panelMessages = defineMessages({
  "panels.context.review": { "zh-CN": "审阅", "en-US": "Review" },
  "panels.context.files": { "zh-CN": "工作区文件", "en-US": "Workspace files" },
  "panels.context.browser": { "zh-CN": "浏览器", "en-US": "Browser" },
  "panels.context.terminal": { "zh-CN": "终端", "en-US": "Terminal" },
  "panels.context.extStarting": {
    "zh-CN": "正在启动会话并连接扩展…",
    "en-US": "Starting session and connecting extensions…",
  },
  "panels.context.extDisconnected": {
    "zh-CN": "扩展尚未连接。点击下方按钮启动会话并打开面板。",
    "en-US": "Extension not connected. Use the button below to start a session and open the panel.",
  },
  "panels.context.widenHint": {
    "zh-CN": "加宽侧栏以查看完整检查器",
    "en-US": "Widen the sidebar for the full inspector",
  },
  "panels.context.widen": { "zh-CN": "加宽侧栏", "en-US": "Widen sidebar" },

  /* 面板徽章（docs/06 R7）：语义必须进可访问名称，不能只靠颜色/圆点。 */
  "panels.context.badgeAttention": {
    "zh-CN": "{title}，{count} 项需要处理",
    "en-US": "{title}, {count} need attention",
  },
  "panels.context.badgeAttentionHint": {
    "zh-CN": "{title}，有需要处理的事项",
    "en-US": "{title}, needs attention",
  },
  "panels.context.badgeSuccess": {
    "zh-CN": "{title}，{count} 项已完成",
    "en-US": "{title}, {count} completed",
  },
  "panels.context.badgeSuccessHint": {
    "zh-CN": "{title}，有新完成的事项",
    "en-US": "{title}, has new completions",
  },
  "panels.context.badgeMuted": {
    "zh-CN": "{title}，{count} 项更新",
    "en-US": "{title}, {count} updates",
  },
  "panels.context.badgeMutedHint": {
    "zh-CN": "{title}，有更新",
    "en-US": "{title}, updated",
  },

  "panels.files.imageTooLarge": {
    "zh-CN": "图片过大，无法在侧栏预览（上限 40MiB）",
    "en-US": "Image is too large to preview (limit: 40MiB)",
  },
  "panels.files.imageNotFile": {
    "zh-CN": "图片路径不是常规文件",
    "en-US": "Image path is not a regular file",
  },
  "panels.files.media.notFile": {
    "zh-CN": "媒体路径不是常规文件",
    "en-US": "Media path is not a regular file",
  },
  "panels.files.media.failed": {
    "zh-CN": "无法播放此文件，可能是文件已变更、已损坏或编码不受支持。可用系统应用打开。",
    "en-US":
      "Cannot play this file. It may have changed, be damaged, or use an unsupported codec. Try opening it with a system app.",
  },
  "panels.files.media.playbackRate": { "zh-CN": "播放速度", "en-US": "Playback speed" },
  "panels.files.media.duration": { "zh-CN": "时长 {duration}", "en-US": "Duration {duration}" },
  "panels.files.mermaid.tooLarge": {
    "zh-CN": "图表较大，已显示源码。",
    "en-US": "This diagram is large; showing source.",
  },
  "panels.files.searchPlaceholder": {
    "zh-CN": "搜索文件…",
    "en-US": "Search files…",
  },
  "panels.files.openBesideTree": {
    "zh-CN": "在目录右侧打开",
    "en-US": "Open beside file tree",
  },
  "panels.files.closePreview": { "zh-CN": "关闭文件预览", "en-US": "Close file preview" },
  "panels.files.resizePanes": {
    "zh-CN": "调整目录与预览宽度",
    "en-US": "Resize file tree and preview",
  },
  "panels.files.resizePanesHint": {
    "zh-CN": "拖动调整宽度，双击复位；方向键调整，Home / End 移至边界",
    "en-US":
      "Drag to resize, double-click to reset; use arrow keys to adjust or Home / End for limits",
  },
  "panels.files.empty": {
    "zh-CN": "在文件树中选择文件进行预览",
    "en-US": "Select a file in the tree to preview",
  },
  "panels.files.emptyTree": { "zh-CN": "目录为空", "en-US": "Folder is empty" },
  "panels.files.binary": {
    "zh-CN": "二进制文件，暂不支持预览",
    "en-US": "Binary file; preview not available",
  },
  "panels.files.tooLarge": {
    "zh-CN": "文件过大，已截断预览",
    "en-US": "File is large; preview truncated",
  },
  "panels.files.csvRows": { "zh-CN": "{count} 行", "en-US": "{count} rows" },
  "panels.files.csvEmpty": {
    "zh-CN": "没有可显示的表格数据",
    "en-US": "No tabular data to display",
  },
  "panels.files.notebook": {
    "zh-CN": "Notebook · {count} 个单元格",
    "en-US": "Notebook · {count} cells",
  },
  "panels.files.notebookInvalid": {
    "zh-CN": "Notebook 内容无法解析，显示原始 JSON",
    "en-US": "Notebook could not be parsed; showing raw JSON",
  },
  "panels.files.notebookCode": { "zh-CN": "代码", "en-US": "Code" },
  "panels.files.notebookMarkdown": { "zh-CN": "Markdown", "en-US": "Markdown" },
  "panels.files.notebookOutput": { "zh-CN": "输出", "en-US": "Output" },
  "panels.files.office.searchTitle": {
    "zh-CN": "搜索文档（Ctrl+F）",
    "en-US": "Search document (Ctrl+F)",
  },
  "panels.files.office.searchPlaceholder": {
    "zh-CN": "搜索文字，Enter 跳到下一个结果",
    "en-US": "Search text; Enter for next result",
  },
  "panels.files.office.searchProgress": {
    "zh-CN": "正在搜索 · {processed} / {total}",
    "en-US": "Searching · {processed} / {total}",
  },
  "panels.files.office.searchCount": { "zh-CN": "找到 {count} 个结果", "en-US": "{count} results" },
  "panels.files.office.searchCancelled": {
    "zh-CN": "搜索已停止，保留已找到的结果",
    "en-US": "Search stopped; results found so far are retained",
  },
  "panels.files.office.cancelSearch": { "zh-CN": "停止搜索", "en-US": "Stop search" },
  "panels.files.office.searchFailed": {
    "zh-CN": "搜索未完成，请重试",
    "en-US": "Search could not complete. Try again.",
  },
  "panels.files.office.searchLimited": {
    "zh-CN": "已达到搜索上限，当前显示部分结果。可缩小关键词后重试。",
    "en-US": "Search limit reached; only partial results are shown. Try a more specific query.",
  },
  "panels.files.office.searchDocumentScope": {
    "zh-CN": "搜索文档文字和表格，不含图片内文字",
    "en-US": "Search document text and tables; text inside images is excluded",
  },
  "panels.files.office.searchPreviewScope": {
    "zh-CN": "当前工作表的预览范围",
    "en-US": "Current worksheet's preview range",
  },
  "panels.files.office.searchWorkbookScope": { "zh-CN": "整个工作簿", "en-US": "Entire workbook" },
  "panels.files.office.searchWorkbook": {
    "zh-CN": "搜索整个工作簿",
    "en-US": "Search entire workbook",
  },
  "panels.files.office.slideNumber": { "zh-CN": "幻灯片 {page}", "en-US": "Slide {page}" },
  "panels.files.office.readingPageNumber": {
    "zh-CN": "阅读页 {page}",
    "en-US": "Reading page {page}",
  },
  "panels.files.office.slideLabel": { "zh-CN": "幻灯片", "en-US": "Slide" },
  "panels.files.office.readingPage": { "zh-CN": "阅读页", "en-US": "Reading page" },
  "panels.files.office.rowBatch": { "zh-CN": "表格页", "en-US": "Table page" },
  "panels.files.office.jumpPage": { "zh-CN": "跳转到页码", "en-US": "Page to jump to" },
  "panels.files.office.goPage": { "zh-CN": "跳转", "en-US": "Go to page" },
  "panels.files.office.invalidPage": {
    "zh-CN": "请输入 1–{total} 之间的页码",
    "en-US": "Enter a page between 1 and {total}",
  },
  "panels.files.office.quoteCells": {
    "zh-CN": "工作表：{sheet} · 单元格：{range}",
    "en-US": "Worksheet: {sheet} · Cells: {range}",
  },
  "panels.files.office.quoteHeading": {
    "zh-CN": "标题路径：{heading}",
    "en-US": "Heading path: {heading}",
  },
  "panels.files.office.quoteReadingPage": {
    "zh-CN": "阅读页 {page}（非原文档打印页码）",
    "en-US": "Reading page {page} (not the original printed page number)",
  },
  "panels.files.office.quoteOriginal": { "zh-CN": "原文片段：", "en-US": "Original excerpt:" },
  "panels.files.office.document": { "zh-CN": "办公文档预览", "en-US": "Office document preview" },
  "panels.files.office.loading": { "zh-CN": "正在解析文档…", "en-US": "Loading document…" },
  "panels.files.office.slide": {
    "zh-CN": "第 {page} / {total} 张",
    "en-US": "Slide {page} of {total}",
  },
  "panels.files.office.sheet": { "zh-CN": "工作表", "en-US": "Worksheet" },
  "panels.files.office.row": { "zh-CN": "行号", "en-US": "Row number" },
  "panels.files.office.copyCells": {
    "zh-CN": "复制预览范围内的单元格",
    "en-US": "Copy cells in preview range",
  },
  "panels.files.office.previousRows": { "zh-CN": "上一批行", "en-US": "Previous rows" },
  "panels.files.office.nextRows": { "zh-CN": "下一批行", "en-US": "Next rows" },
  "panels.files.office.rowPage": {
    "zh-CN": "第 {start}–{end} 行 · 可预览 {total} 行",
    "en-US": "Rows {start}–{end} · {total} rows available",
  },
  "panels.files.office.range": { "zh-CN": "预览范围：{range}", "en-US": "Preview range: {range}" },
  "panels.files.office.sheetSize": {
    "zh-CN": "{rows} 行 × {columns} 列",
    "en-US": "{rows} rows × {columns} columns",
  },
  "panels.files.office.sheetTruncated": {
    "zh-CN": "预览 {rows} 行、{columns} 列（工作表共 {totalRows} 行、{totalColumns} 列）",
    "en-US":
      "Previewing {rows} rows and {columns} columns ({totalRows} rows, {totalColumns} columns in the worksheet)",
  },
  "panels.files.office.valuesOnly": {
    "zh-CN": "仅预览单元格数据；公式使用已保存的结果，不显示图表和图片。",
    "en-US": "Cell values only. Formulas use saved results; charts and images are not shown.",
  },
  "panels.files.office.layoutNote": {
    "zh-CN": "只读预览，复杂排版可能与原文档不同。长文档会分成阅读页。",
    "en-US":
      "Read-only preview. Complex layouts may differ; long documents are split into reading pages.",
  },
  "panels.files.office.legacy": {
    "zh-CN": "此格式暂不支持内置预览。可用 Office/WPS 另存为 DOCX、PPTX 或 XLSX 后查看。",
    "en-US":
      "Built-in preview is not available for this format. Save a copy as DOCX, PPTX or XLSX in Office/WPS to preview it here.",
  },
  "panels.files.office.tooLarge": {
    "zh-CN": "文档过大或内容过于复杂，无法预览（文件上限 {limit} MB）。请使用系统应用打开。",
    "en-US":
      "The document is too large or complex to preview (file limit: {limit} MB). Open it in your system application.",
  },
  "panels.files.office.encrypted": {
    "zh-CN": "此文档可能受密码保护，暂不支持预览。",
    "en-US": "This document may be password-protected and cannot be previewed.",
  },
  "panels.files.office.invalid": {
    "zh-CN": "文件内容与格式不符，或文档已损坏。",
    "en-US": "The file does not match its format or the document is damaged.",
  },
  "panels.files.office.changed": {
    "zh-CN": "文件在读取期间发生了变化，请重新打开预览。",
    "en-US": "The file changed while it was being read. Reopen the preview.",
  },
  "panels.files.office.notRegular": {
    "zh-CN": "此路径不是可预览的常规文件。",
    "en-US": "This path is not a regular file that can be previewed.",
  },
  "panels.files.office.failed": {
    "zh-CN": "文档解析失败，文件可能已损坏或包含尚不支持的内容。",
    "en-US": "The document could not be read. It may be damaged or contain unsupported content.",
  },
  "panels.files.pdfPage": { "zh-CN": "第 {page} / {total} 页", "en-US": "Page {page} of {total}" },
  "panels.files.pdfLoadFailed": {
    "zh-CN": "PDF 无法读取或文件已损坏",
    "en-US": "PDF could not be loaded or is damaged",
  },
  "panels.files.pdfPassword": {
    "zh-CN": "此 PDF 受密码保护，暂不支持预览",
    "en-US": "Password-protected PDFs are not supported",
  },
  "panels.files.pdfPageFailed": { "zh-CN": "页面渲染失败", "en-US": "Page rendering failed" },
  "panels.files.openInBrowser": {
    "zh-CN": "在侧栏浏览器中打开",
    "en-US": "Open in sidebar browser",
  },
  "panels.files.copyPath": { "zh-CN": "复制路径", "en-US": "Copy path" },
  "panels.files.copyRelative": {
    "zh-CN": "复制相对路径",
    "en-US": "Copy relative path",
  },
  "panels.files.copyPageText": {
    "zh-CN": "复制本页文本",
    "en-US": "Copy page text",
  },
  "panels.files.findPlaceholder": {
    "zh-CN": "在文件中查找（Enter 下一个）",
    "en-US": "Find in file (Enter for next)",
  },
  "panels.files.findNoMatch": { "zh-CN": "无匹配", "en-US": "No matches" },
  "panels.files.findPrev": { "zh-CN": "上一个匹配", "en-US": "Previous match" },
  "panels.files.findNext": { "zh-CN": "下一个匹配", "en-US": "Next match" },
  "panels.files.copyContent": { "zh-CN": "复制全文", "en-US": "Copy all text" },
  "panels.files.copySelection": {
    "zh-CN": "复制选中内容",
    "en-US": "Copy selection",
  },
  "panels.files.selectAll": { "zh-CN": "全选预览内容", "en-US": "Select all preview text" },
  "panels.files.revealInExplorer": {
    "zh-CN": "在资源管理器中显示",
    "en-US": "Show in File Explorer",
  },
  "panels.files.quoteNoSession": {
    "zh-CN": "没有进行中的会话，无法添加到输入栏",
    "en-US": "No active session to add it to",
  },
  "panels.files.openFolder": {
    "zh-CN": "打开此文件夹",
    "en-US": "Open this folder",
  },

  /* 就地编辑（docs/design/141） */
  "panels.files.edit": { "zh-CN": "编辑文件", "en-US": "Edit file" },
  "panels.files.save": { "zh-CN": "保存", "en-US": "Save" },
  "panels.files.saveHint": { "zh-CN": "保存（Ctrl+S）", "en-US": "Save (Ctrl+S)" },
  "panels.files.exitEdit": { "zh-CN": "退出编辑", "en-US": "Exit editing" },
  "panels.files.unsaved": { "zh-CN": "未保存", "en-US": "Unsaved" },
  "panels.files.savedToast": { "zh-CN": "已保存", "en-US": "Saved" },
  "panels.files.saveFailed": { "zh-CN": "保存失败：{message}", "en-US": "Save failed: {message}" },
  "panels.files.editorLoading": {
    "zh-CN": "正在加载源码…",
    "en-US": "Loading source…",
  },
  "panels.files.editorFailed": {
    "zh-CN": "源码加载失败，请重新打开文件",
    "en-US": "Source failed to load; reopen the file",
  },
  "panels.files.editorAria": {
    "zh-CN": "文件源码：{path}",
    "en-US": "File source: {path}",
  },
  "panels.files.externalChanged": {
    "zh-CN": "磁盘已更新",
    "en-US": "Changed on disk",
  },
  "panels.files.fileGone": {
    "zh-CN": "文件已被删除或在编辑期间被替换",
    "en-US": "The file was deleted or replaced while you were editing",
  },
  "panels.files.discardTitle": {
    "zh-CN": "放弃未保存的改动？",
    "en-US": "Discard unsaved changes?",
  },
  "panels.files.discardMessage": {
    "zh-CN": "{path} 还有未保存的改动，继续操作会丢掉它们。",
    "en-US": "{path} has unsaved changes; continuing will discard them.",
  },
  "panels.files.discardConfirm": { "zh-CN": "放弃改动", "en-US": "Discard" },
  "panels.files.saveAndContinue": { "zh-CN": "保存并继续", "en-US": "Save and continue" },
  "panels.files.keepEditing": { "zh-CN": "继续编辑", "en-US": "Keep editing" },
  "panels.files.conflictTitle": {
    "zh-CN": "文件已在磁盘上被修改",
    "en-US": "The file changed on disk",
  },
  "panels.files.conflictMessage": {
    "zh-CN":
      "{path} 在你编辑期间被其他程序（例如 pi 会话）改过。覆盖会丢掉对方的改动，重新加载会丢掉你的改动。",
    "en-US":
      "{path} was changed by another program (a pi session, for example) while you were editing. Overwriting loses their changes; reloading loses yours.",
  },
  "panels.files.conflictOverwrite": { "zh-CN": "覆盖磁盘", "en-US": "Overwrite" },
  "panels.files.conflictReload": {
    "zh-CN": "重新加载（丢弃我的改动）",
    "en-US": "Reload (discard mine)",
  },

  "panels.terminal.title": { "zh-CN": "终端", "en-US": "Terminal" },
  "panels.terminal.newTab": { "zh-CN": "新建终端", "en-US": "New terminal" },
  "panels.terminal.closeTab": { "zh-CN": "关闭终端", "en-US": "Close terminal" },
  "panels.terminal.clear": { "zh-CN": "清屏", "en-US": "Clear" },
  "panels.terminal.kill": { "zh-CN": "结束进程", "en-US": "End process" },
  "panels.terminal.exited": {
    "zh-CN": "进程已退出（代码 {code}）",
    "en-US": "Process exited (code {code})",
  },
  "panels.terminal.restart": { "zh-CN": "重启终端", "en-US": "Restart terminal" },

  "panels.review.empty": {
    "zh-CN": "暂无待审查的修改",
    "en-US": "No changes to review yet",
  },
  "panels.review.accept": { "zh-CN": "接受", "en-US": "Accept" },
  "panels.review.reject": { "zh-CN": "拒绝", "en-US": "Reject" },
  "panels.review.diff": { "zh-CN": "差异", "en-US": "Diff" },
  "panels.review.filesChanged": {
    "zh-CN": "{count} 个文件有变更",
    "en-US": "{count} files changed",
  },
  "panels.review.added": { "zh-CN": "新增", "en-US": "Added" },
  "panels.review.removed": { "zh-CN": "删除", "en-US": "Removed" },

  "titleBar.back": { "zh-CN": "后退", "en-US": "Back" },
  "titleBar.forward": { "zh-CN": "前进", "en-US": "Forward" },
  "titleBar.minimize": { "zh-CN": "最小化", "en-US": "Minimize" },
  "titleBar.maximize": { "zh-CN": "最大化", "en-US": "Maximize" },
  "titleBar.restore": { "zh-CN": "还原", "en-US": "Restore" },
  "titleBar.close": { "zh-CN": "关闭", "en-US": "Close" },
  "titleBar.sessionBranch": { "zh-CN": "分支 {name}", "en-US": "Branch {name}" },
  "titleBar.workspace": { "zh-CN": "工作区", "en-US": "Workspace" },

  "toast.copyFailed": { "zh-CN": "复制失败", "en-US": "Copy failed" },
  "toast.copied": { "zh-CN": "已复制到剪贴板", "en-US": "Copied to clipboard" },
});
