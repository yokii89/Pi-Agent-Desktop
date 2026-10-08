import { defineMessages } from "../types";

export const sessionMessages = defineMessages({
  "session.restoring": {
    "zh-CN": "正在恢复会话…",
    "en-US": "Restoring session…",
  },
  "session.restoringShort": {
    "zh-CN": "正在恢复会话",
    "en-US": "Restoring session",
  },
  "session.blockedByOverlay": {
    "zh-CN": "请先关闭浮层",
    "en-US": "Close the overlay first",
  },
  "session.welcome.headline": {
    "zh-CN": "接下来交给我吧",
    "en-US": "I'll take it from here",
  },
  "session.emptySession": { "zh-CN": "空会话", "en-US": "Empty session" },
  "session.newSession": { "zh-CN": "新会话", "en-US": "New session" },
  "session.copyFailed": { "zh-CN": "复制失败", "en-US": "Copy failed" },
  "session.copiedWorkdir": {
    "zh-CN": "已复制工作目录",
    "en-US": "Copied working directory",
  },

  "session.input.placeholder": {
    "zh-CN": "描述你的任务，或用 @ 引用文件、/ 调用能力…",
    "en-US": "Describe a task, or use @ for files and / for skills…",
  },
  "session.input.placeholder.empty": {
    "zh-CN": "接下来交给我吧…",
    "en-US": "I'll take it from here…",
  },
  "session.input.placeholder.ask": {
    "zh-CN": "向 PiDesk 提问，使用 @ 添加上下文，使用 / 选择命令或能力",
    "en-US": "Ask PiDesk. Use @ for context and / for commands or skills",
  },
  "session.input.placeholder.followUp": {
    "zh-CN": "提出后续修改要求",
    "en-US": "Ask for follow-up changes",
  },
  "session.input.placeholder.composer": {
    "zh-CN": "描述任务，输入 / 调用技能",
    "en-US": "Describe a task, type / for skills",
  },
  "session.input.placeholder.runningDraft": {
    "zh-CN": "pi 正在回复，可继续输入，回复结束后发送",
    "en-US": "pi is replying — keep typing and send when it finishes",
  },
  "session.input.placeholder.switchingMode": {
    "zh-CN": "正在切换访问模式",
    "en-US": "Switching access mode…",
  },
  "session.input.send": { "zh-CN": "发送", "en-US": "Send" },
  "session.input.stop": { "zh-CN": "停止", "en-US": "Stop" },
  "session.input.more": { "zh-CN": "更多", "en-US": "More" },
  "session.input.attach": { "zh-CN": "添加附件", "en-US": "Add attachment" },
  "session.input.mention": {
    "zh-CN": "使用 @ 添加上下文",
    "en-US": "Use @ to add context",
  },
  "session.input.slash": {
    "zh-CN": "使用 / 选择能力",
    "en-US": "Use / to pick a skill",
  },
  "session.input.running": { "zh-CN": "pi 运行中", "en-US": "pi is running" },
  "session.input.filesTitle": {
    "zh-CN": "文件与文件夹",
    "en-US": "Files and folders",
  },
  "session.input.fileSearchHint": {
    "zh-CN": "输入关键字搜索文件或文件夹（支持部分匹配）",
    "en-US": "Type to search files or folders (partial match)",
  },
  "session.input.thinking": { "zh-CN": "思考", "en-US": "Thinking" },
  "session.input.thinkingLevel": {
    "zh-CN": "思考等级",
    "en-US": "Thinking level",
  },
  "session.context.tooltip": {
    "zh-CN": "上下文用量",
    "en-US": "Context usage",
  },
  "session.context.aria": {
    "zh-CN": "上下文用量 {value}",
    "en-US": "Context usage {value}",
  },
  "session.context.auto": { "zh-CN": "(自动压缩)", "en-US": "(auto)" },
  "session.context.usedPct": {
    "zh-CN": "{used}%已用(剩余{remaining}%)",
    "en-US": "{used}% used ({remaining}% left)",
  },
  "session.context.usedTokens": {
    "zh-CN": "已用{used},共{total}",
    "en-US": "{used} of {total} used",
  },
  "session.context.unknown": { "zh-CN": "用量未知", "en-US": "Usage unknown" },
  "session.context.bucket.user": {
    "zh-CN": "用户消息",
    "en-US": "User messages",
  },
  "session.context.bucket.assistant": {
    "zh-CN": "助手回复",
    "en-US": "Assistant",
  },
  "session.context.bucket.thinking": {
    "zh-CN": "思考内容",
    "en-US": "Thinking",
  },
  "session.context.bucket.toolResult": {
    "zh-CN": "工具结果",
    "en-US": "Tool results",
  },
  "session.context.bucket.summary": { "zh-CN": "摘要", "en-US": "Summaries" },
  "session.context.bucket.skills": {
    "zh-CN": "Skills 元数据",
    "en-US": "Skills metadata",
  },
  "session.context.bucket.other": {
    "zh-CN": "其它 / 开销",
    "en-US": "Other / overhead",
  },
  "session.context.breakdownAria": {
    "zh-CN": "上下文分类占比",
    "en-US": "Context breakdown",
  },
  "session.thinking.low": { "zh-CN": "低", "en-US": "Low" },
  "session.thinking.high": { "zh-CN": "高", "en-US": "High" },
  "session.thinking.max": { "zh-CN": "最高", "en-US": "Max" },
  "session.image.hint": {
    "zh-CN": "模型目录未声明支持图片",
    "en-US": "This model's catalog does not declare image support",
  },
  "session.image.toast": {
    "zh-CN": "模型目录未声明支持图片，若失败可换支持视觉的模型",
    "en-US":
      "This model's catalog does not declare image support; switch to a vision model if it fails",
  },
  "session.image.placeholder": { "zh-CN": "图片", "en-US": "Image" },
  "session.image.copyOne": { "zh-CN": "[图片]", "en-US": "[image]" },
  "session.image.copyMany": {
    "zh-CN": "[图片 ×{count}]",
    "en-US": "[images ×{count}]",
  },
  "session.image.resultAlt": {
    "zh-CN": "工具结果图片",
    "en-US": "Tool result image",
  },
  "session.toolAction.terminal": { "zh-CN": "运行", "en-US": "Run" },
  "session.toolAction.read": { "zh-CN": "已读取", "en-US": "Read" },
  "session.toolAction.write": { "zh-CN": "已写入", "en-US": "Wrote" },
  "session.toolAction.edit": { "zh-CN": "已修改", "en-US": "Edited" },
  "session.toolAction.search": { "zh-CN": "搜索", "en-US": "Search" },
  "session.toolAction.diff": { "zh-CN": "查看变更", "en-US": "View changes" },
  "session.toolAction.generic": { "zh-CN": "调用", "en-US": "Called" },
  "session.error.unknown": { "zh-CN": "未知错误", "en-US": "Unknown error" },
  "session.error.aborted": {
    "zh-CN": "请求已中断",
    "en-US": "Request aborted",
  },
  "session.error.length": {
    "zh-CN": "输出被截断",
    "en-US": "Output truncated",
  },
  "session.error.lengthDetail": {
    "zh-CN": "模型输出在完成前被截断（达到长度上限）。",
    "en-US": "The model output was truncated before finishing (hit the length limit).",
  },
  "session.error.processTitle": { "zh-CN": "pi 进程", "en-US": "pi process" },
  "session.compact.manual": {
    "zh-CN": "手动压缩上下文",
    "en-US": "Manual context compact",
  },
  "session.compact.overflow": {
    "zh-CN": "上下文溢出压缩",
    "en-US": "Context overflow compact",
  },
  "session.compact.threshold": {
    "zh-CN": "上下文阈值压缩",
    "en-US": "Context threshold compact",
  },
  "session.compact.runningSuffix": { "zh-CN": "中…", "en-US": "…" },
  "session.compact.failedSuffix": { "zh-CN": "失败", "en-US": " failed" },
  "session.compact.doneSuffix": { "zh-CN": "完成", "en-US": " done" },
  "session.compact.tokenDetail": {
    "zh-CN": "（{before} → 约 {after}）",
    "en-US": " ({before} → ~{after})",
  },
  "session.access.mode": { "zh-CN": "访问模式", "en-US": "Access mode" },
  "session.access.activating": {
    "zh-CN": "正在切换：{title}",
    "en-US": "Switching: {title}",
  },
  "session.access.pausedSuffix": { "zh-CN": " · 已暂停", "en-US": " · paused" },
  "image.svgRejected": {
    "zh-CN": "SVG 不能作为视觉附件，请改用位图",
    "en-US": "SVG cannot be used as a visual attachment; use a bitmap instead",
  },
  "image.readFailed": {
    "zh-CN": "读取图片失败",
    "en-US": "Failed to read image",
  },
  "image.empty": { "zh-CN": "图片内容为空", "en-US": "Image is empty" },
  "image.unknownFormat": {
    "zh-CN": "无法识别的图片格式",
    "en-US": "Unrecognized image format",
  },
  "image.gifTooLarge": {
    "zh-CN": "GIF 超过 6MB，请先压缩后再附上",
    "en-US": "GIF is over 6MB; compress it first",
  },
  "image.webpTooLarge": {
    "zh-CN": "WebP 超过 6MB，请先压缩后再附上",
    "en-US": "WebP is over 6MB; compress it first",
  },
  "image.gifTooBigEdge": {
    "zh-CN": "GIF 过大，请先压缩到长边 2000 以内（缩放会丢动图）",
    "en-US": "GIF is too large; compress to ≤2000px on the long edge (scaling drops animation)",
  },
  "image.webpTooBigEdge": {
    "zh-CN": "WebP 过大，请先压缩到长边 2000 以内（缩放会丢动图）",
    "en-US": "WebP is too large; compress to ≤2000px on the long edge (scaling drops animation)",
  },
  "image.decodeFailed": {
    "zh-CN": "图片无法解码",
    "en-US": "Could not decode image",
  },
  "image.decodeOrFormat": {
    "zh-CN": "图片无法解码或格式不受支持",
    "en-US": "Could not decode image or format is unsupported",
  },
  "image.scaleFailed": {
    "zh-CN": "图片缩放失败",
    "en-US": "Failed to scale image",
  },
  "image.tooLargeAfterScale": {
    "zh-CN": "图片过大，缩放后仍超过 6MB",
    "en-US": "Image is too large; still over 6MB after scaling",
  },
  "image.pngConvertFailed": {
    "zh-CN": "图片转换为 PNG 失败",
    "en-US": "Failed to convert image to PNG",
  },
  "image.tooLargeAfterConvert": {
    "zh-CN": "图片过大，转换后超过 6MB",
    "en-US": "Image is too large; over 6MB after conversion",
  },
  "image.hint.converted": {
    "zh-CN": "已从 {format} 转为 png",
    "en-US": "Converted from {format} to png",
  },
  "image.hint.scaled": {
    "zh-CN": "已缩小到 {width}×{height}",
    "en-US": "Scaled to {width}×{height}",
  },
  "session.input.aria": { "zh-CN": "任务输入", "en-US": "Task input" },
  "session.input.sendAfterReply": {
    "zh-CN": "回复结束后可发送",
    "en-US": "You can send after the reply finishes",
  },
  "session.input.maxImages": {
    "zh-CN": "最多附 {count} 张图片",
    "en-US": "Attach at most {count} images",
  },
  "session.input.loadingSlash": {
    "zh-CN": "正在加载 pi 命令…",
    "en-US": "Loading pi commands…",
  },
  "session.input.group.commands": { "zh-CN": "命令", "en-US": "Commands" },
  "session.input.group.skills": { "zh-CN": "技能", "en-US": "Skills" },
  "session.input.selectWorkspaceFirst": {
    "zh-CN": "请先选择工作区",
    "en-US": "Choose a workspace first",
  },
  "session.input.noSlashCommands": {
    "zh-CN": "pi 未返回可用命令（检查 pi 是否已安装并配置）",
    "en-US": "pi returned no commands (check that pi is installed and configured)",
  },
  "session.input.searchSlashHint": {
    "zh-CN": "输入内容以搜索命令、技能或子智能体",
    "en-US": "Type to search commands, skills, or subagents",
  },
  "session.input.suggestKeysFile": {
    "zh-CN": "↑↓ 选择 · Enter 引用 · Esc 关闭",
    "en-US": "↑↓ to choose · Enter to insert · Esc to close",
  },
  "session.input.suggestKeysSlash": {
    "zh-CN": "↑↓ 选择 · Enter 插入 · Esc 关闭",
    "en-US": "↑↓ to choose · Enter to insert · Esc to close",
  },
  "session.input.staleConfirm": {
    "zh-CN": "{count} 个上下文元素已过期（页面已刷新），仍要发送吗？",
    "en-US": "{count} context elements are stale (page refreshed). Send anyway?",
  },
  "session.input.staleConfirm.send": {
    "zh-CN": "仍要发送",
    "en-US": "Send anyway",
  },
  "session.input.staleConfirm.remove": {
    "zh-CN": "移除过期元素",
    "en-US": "Remove stale elements",
  },
  "session.input.hintTitle": {
    "zh-CN": "仅元数据提示，不阻止发送",
    "en-US": "Metadata hint only — does not block sending",
  },

  "session.reasoning.label": { "zh-CN": "思考过程", "en-US": "Thinking" },
  "session.reasoning.thinking": { "zh-CN": "思考中", "en-US": "Thinking…" },
  "session.reasoning.thinkingMore": {
    "zh-CN": "思考中…",
    "en-US": "Thinking…",
  },
  "session.reasoning.words": {
    "zh-CN": "{count} 词",
    "en-US": "{count} words",
  },

  "session.fileEdits.one": {
    "zh-CN": "已编辑 {count} 个文件",
    "en-US": "Edited {count} file",
  },
  "session.fileEdits.many": {
    "zh-CN": "本轮修改了 {count} 个文件",
    "en-US": "Changed {count} files this turn",
  },
  "session.fileEdits.agent": {
    "zh-CN": "Agent 报告编辑了 {count} 个文件",
    "en-US": "The agent reported editing {count} files",
  },
  "session.fileEdits.aria": {
    "zh-CN": "本轮文件编辑汇总",
    "en-US": "Files edited this turn",
  },
  "session.fileEdits.showMore": {
    "zh-CN": "再显示 {count} 个文件",
    "en-US": "Show {count} more files",
  },
  "session.fileEdits.collapse": {
    "zh-CN": "收起文件列表",
    "en-US": "Collapse file list",
  },
  "session.fileEdits.sameAsUndo": {
    "zh-CN": "与撤销范围一致",
    "en-US": "Matches undo scope",
  },
  "session.fileEdits.undo": { "zh-CN": "撤销", "en-US": "Undo" },
  "session.fileEdits.undoing": { "zh-CN": "撤销中…", "en-US": "Undoing…" },
  "session.fileEdits.review": { "zh-CN": "审阅", "en-US": "Review" },

  "session.tool.batchRead": {
    "zh-CN": "已读取 {count} 个文件",
    "en-US": "Read {count} files",
  },
  "session.tool.batchSearch": {
    "zh-CN": "已搜索 {count} 次",
    "en-US": "Searched {count} times",
  },
  "session.tool.batchEdit": {
    "zh-CN": "已编辑 {count} 处",
    "en-US": "Edited {count} places",
  },
  "session.tool.batchMore": {
    "zh-CN": "另有 {count} 项操作",
    "en-US": "{count} more actions",
  },
  "session.tool.result": { "zh-CN": "结果", "en-US": "Result" },
  "session.tool.output": { "zh-CN": "输出", "en-US": "Output" },
  "session.tool.args": { "zh-CN": "参数", "en-US": "Arguments" },
  "session.tool.errorLabel": { "zh-CN": "错误", "en-US": "Error" },
  "session.tool.running": { "zh-CN": "运行中", "en-US": "Running" },
  "session.tool.runningEllipsis": { "zh-CN": "运行中…", "en-US": "Running…" },
  "session.tool.executing": { "zh-CN": "执行中", "en-US": "Running" },
  "session.tool.pending": { "zh-CN": "等待中", "en-US": "Pending" },
  "session.tool.waitingResult": {
    "zh-CN": "等待结果…",
    "en-US": "Waiting for result…",
  },
  "session.tool.failed": { "zh-CN": "失败", "en-US": "Failed" },
  "session.tool.interrupted": { "zh-CN": "已中断", "en-US": "Interrupted" },
  "session.tool.success": { "zh-CN": "成功", "en-US": "OK" },
  "session.tool.read": { "zh-CN": "读取", "en-US": "Read" },
  "session.tool.write": { "zh-CN": "写入", "en-US": "Write" },
  "session.tool.edit": { "zh-CN": "编辑", "en-US": "Edit" },
  "session.tool.bash": { "zh-CN": "命令", "en-US": "Command" },
  "session.tool.search": { "zh-CN": "搜索", "en-US": "Search" },
  "session.tool.view": { "zh-CN": "视图", "en-US": "View" },
  "session.tool.change": { "zh-CN": "变更", "en-US": "Change" },
  "session.tool.tool": { "zh-CN": "工具", "en-US": "Tool" },
  "session.tool.mcp": { "zh-CN": "调用", "en-US": "Call" },
  "session.tool.past.read": { "zh-CN": "已读取", "en-US": "Read" },
  "session.tool.past.write": { "zh-CN": "已写入", "en-US": "Wrote" },
  "session.tool.past.edit": { "zh-CN": "已编辑", "en-US": "Edited" },
  "session.tool.past.terminal": {
    "zh-CN": "已执行命令",
    "en-US": "Ran command",
  },
  "session.tool.past.search": { "zh-CN": "已搜索", "en-US": "Searched" },
  "session.tool.past.diff": {
    "zh-CN": "已查看变更",
    "en-US": "Viewed changes",
  },
  "session.tool.past.generic": { "zh-CN": "已调用", "en-US": "Called" },
  "session.tool.past.mcp": { "zh-CN": "已调用", "en-US": "Called" },
  "session.tool.past.run": { "zh-CN": "已运行", "en-US": "Ran" },
  "session.tool.past.view": { "zh-CN": "已查看", "en-US": "Viewed" },
  "session.tool.kindFailed": {
    "zh-CN": "{kind}失败",
    "en-US": "{kind} failed",
  },
  "session.tool.notExecuted": {
    "zh-CN": "未执行 · {kind}",
    "en-US": "Not run · {kind}",
  },
  "session.tool.hits": { "zh-CN": "{count} 处命中", "en-US": "{count} hits" },
  "session.tool.lineFrom": { "zh-CN": "L{line}起", "en-US": "From L{line}" },
  "session.tool.unit.files": { "zh-CN": "个文件", "en-US": "files" },
  "session.tool.unit.times": { "zh-CN": "次", "en-US": "times" },
  "session.tool.unit.commands": { "zh-CN": "条命令", "en-US": "commands" },
  "session.tool.errors": {
    "zh-CN": "{count} 次失败",
    "en-US": "{count} failed",
  },
  "session.tool.readFailed": { "zh-CN": "读取失败", "en-US": "Read failed" },
  "session.tool.writeFailed": { "zh-CN": "写入失败", "en-US": "Write failed" },
  "session.tool.editFailed": { "zh-CN": "修改失败", "en-US": "Edit failed" },
  "session.tool.truncated": { "zh-CN": "已截断", "en-US": "Truncated" },
  "session.tool.noDiff": {
    "zh-CN": "暂无可展示的变更内容",
    "en-US": "No changes to show",
  },
  "session.tool.unparsableDiff": {
    "zh-CN": "无法解析 diff 内容",
    "en-US": "Could not parse the diff",
  },
  "session.tool.expandHunks": {
    "zh-CN": "展开其余 {count} 个 hunk",
    "en-US": "Show {count} more hunks",
  },
  "session.tool.collapseHunks": {
    "zh-CN": "收起 hunk",
    "en-US": "Collapse hunks",
  },
  "session.tool.streamingOutput": {
    "zh-CN": "正在输出…",
    "en-US": "Streaming output…",
  },
  "session.tool.noOutput": { "zh-CN": "（无输出）", "en-US": "(no output)" },
  "session.tool.expandAll": { "zh-CN": "展开全文", "en-US": "Expand all" },
  "session.tool.noHits": { "zh-CN": "无命中", "en-US": "No hits" },
  "session.tool.moreHits": {
    "zh-CN": "还有 {count} 处未展开",
    "en-US": "{count} more hits",
  },
  "session.tool.resultsTruncated": {
    "zh-CN": "结果已截断",
    "en-US": "Results truncated",
  },

  "session.error.llm": {
    "zh-CN": "模型调用失败",
    "en-US": "Model call failed",
  },
  "session.error.process": {
    "zh-CN": "会话进程异常",
    "en-US": "Session process error",
  },
  "session.error.compact": {
    "zh-CN": "压缩历史失败",
    "en-US": "Failed to compact history",
  },

  "session.scrollToBottom": {
    "zh-CN": "回到底部",
    "en-US": "Scroll to bottom",
  },
  "session.scrollToBottom.title": {
    "zh-CN": "跳到最新 (Ctrl+End)",
    "en-US": "Jump to latest (Ctrl+End)",
  },
  "session.scrollToBottom.aria": {
    "zh-CN": "跳到最新{suffix}",
    "en-US": "Jump to latest{suffix}",
  },
  "session.scrollToBottom.ariaSuffix": {
    "zh-CN": "，{label}",
    "en-US": ", {label}",
  },
  "session.unread.entries": {
    "zh-CN": "新 {count} 条",
    "en-US": "{count} new",
  },
  "session.unread.lines": { "zh-CN": "+{count} 行", "en-US": "+{count} lines" },

  "session.rail.label": {
    "zh-CN": "对话问题导航",
    "en-US": "Conversation question navigation",
  },
  "session.rail.jumpTo": {
    "zh-CN": "跳转到第 {index} 条问题",
    "en-US": "Jump to question {index}",
  },

  "session.copyMessage": { "zh-CN": "复制", "en-US": "Copy" },
  "session.copyMessage.title": { "zh-CN": "复制消息", "en-US": "Copy message" },
  "session.quoteMessage": {
    "zh-CN": "添加到对话栏",
    "en-US": "Add to composer",
  },
  "session.resend": { "zh-CN": "重新发送", "en-US": "Resend" },
  "session.resend.title": {
    "zh-CN": "重新发送这条消息",
    "en-US": "Resend this message",
  },
  "session.retry": { "zh-CN": "重试", "en-US": "Retry" },
  "session.retryLastMessage": {
    "zh-CN": "重试上一条消息",
    "en-US": "Retry the last message",
  },
  "session.planMode": { "zh-CN": "计划模式", "en-US": "Plan mode" },

  "session.rollback": {
    "zh-CN": "撤销本轮修改",
    "en-US": "Undo this turn's edits",
  },
  "session.rollback.title": {
    "zh-CN": "撤销本轮文件修改",
    "en-US": "Undo this turn's file edits",
  },
  "session.rollback.confirm": { "zh-CN": "撤销", "en-US": "Undo" },
  "session.review": { "zh-CN": "审阅修改", "en-US": "Review changes" },
  "session.review.openDiff": { "zh-CN": "打开 Diff", "en-US": "Open diff" },
  "session.review.openIn": {
    "zh-CN": "在审查面板打开",
    "en-US": "Open in review panel",
  },
  "session.review.noChanges": {
    "zh-CN": "审查面板暂无变更",
    "en-US": "No changes in the review panel",
  },
  "session.review.fileNotFound": {
    "zh-CN": "审查面板中未找到该文件（可能已提交或不在当前仓库）",
    "en-US": "File not found in the review panel (may be committed or outside this repo)",
  },

  "session.copyCode": { "zh-CN": "复制代码", "en-US": "Copy code" },
  "session.coldStart": {
    "zh-CN": "正在启动会话…首次可能稍慢",
    "en-US": "Starting session… first launch may be slower",
  },
  "session.coldStart.process": {
    "zh-CN": "pi 进程启动中…",
    "en-US": "Starting pi process…",
  },
  "session.firstToken": {
    "zh-CN": "等待模型响应…",
    "en-US": "Waiting for the model…",
  },
  "session.selectMenu.copy": { "zh-CN": "复制", "en-US": "Copy" },
  "session.selectMenu.quote": {
    "zh-CN": "添加到对话栏",
    "en-US": "Add to composer",
  },

  "session.a11y.assistantReplying": {
    "zh-CN": "AI 正在回复",
    "en-US": "Assistant is replying",
  },
  "session.a11y.replyEnded": {
    "zh-CN": "回复已结束",
    "en-US": "Reply finished",
  },

  "session.snapshot.title": {
    "zh-CN": "刷新并截图",
    "en-US": "Refresh and capture",
  },
  "session.snapshot.alt": {
    "zh-CN": "视口截图",
    "en-US": "Viewport screenshot",
  },

  "session.header.renameAria": {
    "zh-CN": "重命名会话：{title}",
    "en-US": "Rename session: {title}",
  },
  "session.header.titleHint": {
    "zh-CN": "{title}（双击重命名）",
    "en-US": "{title} (double-click to rename)",
  },
  "session.header.moreActions": {
    "zh-CN": "更多操作",
    "en-US": "More actions",
  },
  "session.header.moreActionsAria": {
    "zh-CN": "更多操作：{title}",
    "en-US": "More actions: {title}",
  },
  "session.header.copyPath": { "zh-CN": "复制路径", "en-US": "Copy path" },
  "session.header.pin": { "zh-CN": "置顶", "en-US": "Pin" },
  "session.header.unpin": { "zh-CN": "取消置顶", "en-US": "Unpin" },
  "session.header.deleteTask": { "zh-CN": "删除任务", "en-US": "Delete task" },

  "session.chip.stale": { "zh-CN": "过期", "en-US": "Stale" },
  "session.chip.remove": { "zh-CN": "移除", "en-US": "Remove" },
  "session.chip.removeItem": {
    "zh-CN": "移除 {name}",
    "en-US": "Remove {name}",
  },
  "session.chip.screenshot": { "zh-CN": "截图", "en-US": "Screenshot" },

  "session.image.attachment": {
    "zh-CN": "附件图片",
    "en-US": "Attached image",
  },
  "session.image.clipboard": {
    "zh-CN": "剪贴板图片",
    "en-US": "Clipboard image",
  },
  "session.image.preview": {
    "zh-CN": "预览 {name}",
    "en-US": "Preview {name}",
  },
  "session.image.save": { "zh-CN": "保存图片", "en-US": "Save image" },
  "session.image.saved": {
    "zh-CN": "已保存到「下载」：{name}",
    "en-US": "Saved to Downloads: {name}",
  },
  "session.image.revealFolder": { "zh-CN": "打开下载文件夹", "en-US": "Open Downloads" },
  "session.image.saveFailed": {
    "zh-CN": "保存失败：{error}",
    "en-US": "Save failed: {error}",
  },

  "session.file.attachment": { "zh-CN": "附件文件", "en-US": "Attached file" },
  "session.file.noPath": {
    "zh-CN": "无法获取该文件的本地路径（可能不是磁盘文件），已跳过",
    "en-US": "Could not read a local path for this file (not a disk file?); skipped",
  },
  "session.input.maxFiles": {
    "zh-CN": "最多附带 {count} 个文件",
    "en-US": "Attach at most {count} files",
  },

  "session.element.detail": { "zh-CN": "元素详情", "en-US": "Element details" },
  "session.element.text": { "zh-CN": "文本", "en-US": "Text" },
  "session.element.a11y": { "zh-CN": "无障碍", "en-US": "Accessibility" },
  "session.element.source": { "zh-CN": "来源", "en-US": "Source" },
  "session.element.size": { "zh-CN": "尺寸", "en-US": "Size" },
  "session.element.styles": { "zh-CN": "样式", "en-US": "Styles" },
  "session.element.viewport": {
    "zh-CN": "{width}×{height}（视口 {vw}×{vh}）",
    "en-US": "{width}×{height} (viewport {vw}×{vh})",
  },
  "session.element.screenshot": {
    "zh-CN": "元素截图",
    "en-US": "Element screenshot",
  },

  "session.access.full": { "zh-CN": "完全访问", "en-US": "Full access" },
  "session.access.fullDesc": {
    "zh-CN": "pi 默认运行方式",
    "en-US": "pi's default run mode",
  },
  "session.access.unresolved": {
    "zh-CN": "未解析（进程未就绪）",
    "en-US": "Unresolved (process not ready)",
  },
  "session.access.notConnected": {
    "zh-CN": "未连接 · 点击启用",
    "en-US": "Not connected · Click to enable",
  },
  "session.access.starting": {
    "zh-CN": "正在启动 / 连接扩展…",
    "en-US": "Starting / connecting extension…",
  },
  "session.access.activateFailed": {
    "zh-CN": "激活失败，点击重试",
    "en-US": "Activation failed — click to retry",
  },
  "session.access.suspended": {
    "zh-CN": "已暂停 · 点击恢复",
    "en-US": "Paused · Click to resume",
  },
  "session.access.switching": { "zh-CN": "切换中…", "en-US": "Switching…" },
  "session.access.waitUntilIdle": {
    "zh-CN": "pi 回复结束后再切换",
    "en-US": "Wait until pi finishes before switching",
  },

  "session.model.switch": { "zh-CN": "切换模型", "en-US": "Switch model" },
  "session.model.select": { "zh-CN": "选择模型", "en-US": "Select model" },
  "session.model.current": { "zh-CN": "当前", "en-US": "Current" },
  "session.model.loading": {
    "zh-CN": "正在探测可用模型…",
    "en-US": "Detecting available models…",
  },
  "session.model.empty": {
    "zh-CN": "暂无可用模型，请检查激活凭据",
    "en-US": "No models available — check active credentials",
  },
  "session.model.savedDefault": {
    "zh-CN": "已保存默认模型：{label}（新会话生效）",
    "en-US": "Saved default model: {label} (applies to new sessions)",
  },
  "session.model.switched": {
    "zh-CN": "已切换模型：{label}",
    "en-US": "Switched model: {label}",
  },
  "session.model.switchFailed": {
    "zh-CN": "模型切换失败",
    "en-US": "Failed to switch model",
  },

  "session.run.autoRetry": {
    "zh-CN": "自动重试 {attempt}/{max}",
    "en-US": "Auto retry {attempt}/{max}",
  },
  "session.run.retryFailed": {
    "zh-CN": "重试 {count} 次后失败",
    "en-US": "Failed after {count} retries",
  },
  "session.run.elapsedTitle": {
    "zh-CN": "本轮用时",
    "en-US": "Time this turn",
  },
  "session.run.usageInput": {
    "zh-CN": "输入 {value}",
    "en-US": "Input {value}",
  },
  "session.run.usageOutput": {
    "zh-CN": "输出 {value}",
    "en-US": "Output {value}",
  },
  "session.run.usageCacheRead": {
    "zh-CN": "缓存读 {value}",
    "en-US": "Cache read {value}",
  },
  "session.run.usageCacheWrite": {
    "zh-CN": "缓存写 {value}",
    "en-US": "Cache write {value}",
  },
  "session.run.usageCost": { "zh-CN": "费用 {value}", "en-US": "Cost {value}" },

  "session.git.branch": { "zh-CN": "分支", "en-US": "Branch" },
  "session.git.branches": { "zh-CN": "分支", "en-US": "Branches" },
  "session.git.search": { "zh-CN": "搜索分支", "en-US": "Search branches" },
  "session.git.empty": { "zh-CN": "暂无分支", "en-US": "No branches" },
  "session.git.dirty": {
    "zh-CN": "未提交的更改：{count} 个文件",
    "en-US": "Uncommitted changes: {count} files",
  },
  "session.git.newBranchName": {
    "zh-CN": "新分支名",
    "en-US": "New branch name",
  },
  "session.git.create": { "zh-CN": "创建", "en-US": "Create" },
  "session.git.createCheckout": {
    "zh-CN": "创建并检出新分支…",
    "en-US": "Create and check out a new branch…",
  },
  "session.git.graph": { "zh-CN": "Git 图谱", "en-US": "Git graph" },

  "session.workspace.select": {
    "zh-CN": "选择工作区",
    "en-US": "Select workspace",
  },
  "session.workspace.search": {
    "zh-CN": "搜索工作区",
    "en-US": "Search workspaces",
  },
  "session.workspace.empty": {
    "zh-CN": "暂无匹配的工作区",
    "en-US": "No matching workspaces",
  },
  "session.workspace.openFolder": {
    "zh-CN": "打开文件夹",
    "en-US": "Open folder",
  },
  "session.workspace.remote": {
    "zh-CN": "远程连接",
    "en-US": "Remote connection",
  },
  "session.workspace.none": {
    "zh-CN": "不在项目中工作",
    "en-US": "Work outside a project",
  },

  "session.fileLink.openFailed": {
    "zh-CN": "系统打开失败",
    "en-US": "Failed to open with the system",
  },
  "session.fileLink.title": {
    "zh-CN": "{path}（点击在侧栏预览 · Ctrl+点击系统打开）",
    "en-US": "{path} (click to preview in sidebar · Ctrl+click to open with system)",
  },
  "session.fileMention.open": {
    "zh-CN": "打开 {path}",
    "en-US": "Open {path}",
  },

  "session.piState.running": { "zh-CN": "运行中", "en-US": "Running" },
  "session.piState.completed": { "zh-CN": "已完成", "en-US": "Completed" },
  "session.piState.failed": { "zh-CN": "失败", "en-US": "Failed" },
  "session.piState.interrupted": { "zh-CN": "已中断", "en-US": "Interrupted" },
});
