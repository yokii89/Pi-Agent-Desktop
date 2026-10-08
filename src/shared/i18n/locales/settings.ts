import { defineMessages } from "../types";

export const settingsMessages = defineMessages({
  "settings.title": { "zh-CN": "设置", "en-US": "Settings" },
  "settings.close": { "zh-CN": "关闭设置", "en-US": "Close settings" },
  "settings.searchPlaceholder": {
    "zh-CN": "搜索设置",
    "en-US": "Search settings",
  },
  "settings.navLabel": { "zh-CN": "设置分类", "en-US": "Settings categories" },
  "settings.navEmpty": {
    "zh-CN": "无匹配设置项",
    "en-US": "No matching settings",
  },

  "settings.section.general": { "zh-CN": "常规", "en-US": "General" },
  "settings.section.profile": { "zh-CN": "个人资料", "en-US": "Profile" },
  "settings.section.usage": {
    "zh-CN": "用量统计",
    "en-US": "Usage",
  },
  "settings.section.appearance": { "zh-CN": "外观", "en-US": "Appearance" },
  "settings.section.config": { "zh-CN": "配置", "en-US": "Configuration" },
  "settings.section.models": { "zh-CN": "模型", "en-US": "Models" },
  "settings.section.personalization": {
    "zh-CN": "个性化",
    "en-US": "Personalization",
  },
  "settings.section.shortcuts": {
    "zh-CN": "键盘快捷键",
    "en-US": "Keyboard shortcuts",
  },
  "settings.section.notifications": {
    "zh-CN": "通知",
    "en-US": "Notifications",
  },
  "settings.section.environment": { "zh-CN": "环境", "en-US": "Environment" },
  "settings.section.projects": { "zh-CN": "项目", "en-US": "Projects" },
  "settings.section.scheduled": {
    "zh-CN": "定时任务",
    "en-US": "Scheduled tasks",
  },
  "settings.section.extensions": {
    "zh-CN": "来自扩展",
    "en-US": "From extensions",
  },
  "settings.section.archived": {
    "zh-CN": "已归档对话",
    "en-US": "Archived chats",
  },
  "settings.section.about": { "zh-CN": "应用更新", "en-US": "App updates" },

  "settings.navGroup.personal": { "zh-CN": "个人", "en-US": "Personal" },
  "settings.navGroup.coding": { "zh-CN": "编码", "en-US": "Coding" },
  "settings.navGroup.extensions": { "zh-CN": "扩展", "en-US": "Extensions" },
  "settings.navGroup.archived": { "zh-CN": "已归档", "en-US": "Archived" },
  "settings.navGroup.about": { "zh-CN": "关于", "en-US": "About" },

  "settings.placeholder.profile.title": {
    "zh-CN": "个人资料",
    "en-US": "Profile",
  },
  "settings.placeholder.profile.description": {
    "zh-CN": "账号与个人资料管理将在后续版本提供。",
    "en-US": "Account and profile management will arrive in a later release.",
  },

  "settings.profile.identity": {
    "zh-CN": "GitHub 账号",
    "en-US": "GitHub account",
  },
  "settings.profile.signInLabel": {
    "zh-CN": "登录 GitHub",
    "en-US": "Sign in with GitHub",
  },
  "settings.profile.signInDescription": {
    "zh-CN": "使用 GitHub Device Flow 登录，用于展示身份，并把界面偏好同步到你的 Secret Gist。",
    "en-US":
      "Sign in with GitHub Device Flow to show your identity and sync UI preferences to your secret gist.",
  },
  "settings.profile.signIn": {
    "zh-CN": "使用 GitHub 登录",
    "en-US": "Sign in with GitHub",
  },
  "settings.profile.logout": {
    "zh-CN": "退出登录",
    "en-US": "Sign out",
  },
  "settings.profile.signedIn": {
    "zh-CN": "已登录 GitHub",
    "en-US": "Signed in to GitHub",
  },
  "settings.profile.loginSuccess": {
    "zh-CN": "已登录 GitHub。",
    "en-US": "Signed in to GitHub.",
  },
  "settings.profile.autoSyncDone": {
    "zh-CN": "已登录，并自动应用云端 {count} 项偏好。",
    "en-US": "Signed in and applied {count} cloud preferences.",
  },
  "settings.profile.loginFailed": {
    "zh-CN": "登录未完成。",
    "en-US": "Sign-in did not complete.",
  },
  "settings.profile.deviceWaiting": {
    "zh-CN": "在浏览器中完成授权",
    "en-US": "Finish authorization in the browser",
  },
  "settings.profile.deviceHint": {
    "zh-CN": "打开授权页后输入下面的验证码；期间可关闭本窗口，授权完成会自动更新。",
    "en-US":
      "Open the verification page and enter the code below. You may close this dialog; it updates when authorized.",
  },
  "settings.profile.deviceExpiry": {
    "zh-CN": "验证码剩余 {seconds} 秒",
    "en-US": "Code expires in {seconds}s",
  },
  "settings.profile.copyCode": {
    "zh-CN": "复制验证码",
    "en-US": "Copy code",
  },
  "settings.profile.copyFailed": {
    "zh-CN": "复制失败，请手动选择验证码。",
    "en-US": "Copy failed; select the code manually.",
  },
  "settings.profile.openVerify": {
    "zh-CN": "打开授权页",
    "en-US": "Open verification page",
  },
  "settings.profile.cancel": { "zh-CN": "取消", "en-US": "Cancel" },
  "settings.profile.sync": {
    "zh-CN": "设置同步",
    "en-US": "Settings sync",
  },
  "settings.profile.syncHint": {
    "zh-CN":
      "只同步界面偏好（主题、语言、字体、通知、快捷键等）。项目路径、pi 路径、会话记录等本机数据不会上传。",
    "en-US":
      "Only UI preferences (theme, language, fonts, notifications, shortcuts) are synced. Machine-local paths and sessions are never uploaded.",
  },
  "settings.profile.syncPush": {
    "zh-CN": "上传到 GitHub",
    "en-US": "Upload to GitHub",
  },
  "settings.profile.syncPushHint": {
    "zh-CN": "以本机当前偏好覆盖云端 Secret Gist。",
    "en-US": "Overwrite the secret gist with this device's preferences.",
  },
  "settings.profile.syncPull": {
    "zh-CN": "从 GitHub 下载",
    "en-US": "Download from GitHub",
  },
  "settings.profile.syncPullHint": {
    "zh-CN": "用云端偏好覆盖本机界面设置。",
    "en-US": "Overwrite local UI preferences with the gist.",
  },
  "settings.profile.syncing": { "zh-CN": "同步中…", "en-US": "Syncing…" },
  "settings.profile.syncPushDone": {
    "zh-CN": "已上传到 GitHub（{time}）。",
    "en-US": "Uploaded to GitHub ({time}).",
  },
  "settings.profile.syncPullDone": {
    "zh-CN": "已从 GitHub 下载并应用 {count} 项偏好。",
    "en-US": "Downloaded and applied {count} preferences.",
  },
  "settings.profile.syncRemoteOlder": {
    "zh-CN": "云端设置比本机上次同步更旧。可强制下载覆盖本机。",
    "en-US":
      "Remote settings are older than this device's last sync. Force download to overwrite local preferences.",
  },
  "settings.profile.syncNoGist": {
    "zh-CN": "GitHub 上还没有 PiDesk 设置，可先上传。",
    "en-US": "No PiDesk settings on GitHub yet — upload first.",
  },
  "settings.profile.previewTitle": {
    "zh-CN": "下载前预览",
    "en-US": "Preview before download",
  },
  "settings.profile.previewMeta": {
    "zh-CN": "云端来自 {device} · {time}",
    "en-US": "From {device} · {time}",
  },
  "settings.profile.previewSame": {
    "zh-CN": "与本机一致，无需下载。",
    "en-US": "Identical to this device; nothing to download.",
  },
  "settings.profile.previewConfirm": {
    "zh-CN": "确认下载",
    "en-US": "Download",
  },
  "settings.profile.syncPullForced": {
    "zh-CN": "强制下载",
    "en-US": "Force download",
  },
  "settings.profile.lastSync": {
    "zh-CN": "上次同步",
    "en-US": "Last sync",
  },
  "settings.profile.lastSyncLabel": {
    "zh-CN": "上次同步：",
    "en-US": "Last sync:",
  },
  "settings.profile.lastSyncHint": {
    "zh-CN": "{time} · {device} · {direction}",
    "en-US": "{time} · {device} · {direction}",
  },
  "settings.profile.directionPush": {
    "zh-CN": "上传",
    "en-US": "upload",
  },
  "settings.profile.directionPull": {
    "zh-CN": "下载",
    "en-US": "download",
  },
  "settings.archived.empty": {
    "zh-CN": "暂无归档对话",
    "en-US": "No archived chats",
  },
  "settings.archived.emptyHint": {
    "zh-CN": "在侧栏会话行的「更多操作」菜单中选择「归档」，会话会从这里消失于主列表并集中收纳。",
    "en-US":
      'Pick "Archive" in a session row\'s more-actions menu in the sidebar; archived chats leave the main list and are kept here.',
  },
  "settings.archived.restoreLabel": {
    "zh-CN": "恢复「{title}」",
    "en-US": 'Restore "{title}"',
  },
  "settings.archived.restoreAndOpen": {
    "zh-CN": "恢复并打开",
    "en-US": "Restore and open",
  },
  "settings.archived.archivedAt": {
    "zh-CN": "归档于 {time}",
    "en-US": "Archived {time}",
  },
  "settings.archived.deleteConfirm.title": {
    "zh-CN": "删除归档对话？",
    "en-US": "Delete this archived chat?",
  },
  "settings.archived.deleteConfirm.message": {
    "zh-CN": "将删除会话历史文件（移入系统回收站），操作不可撤销。",
    "en-US": "This moves the session history file to the system trash and cannot be undone.",
  },
  "settings.archived.deleteConfirm.confirm": {
    "zh-CN": "删除",
    "en-US": "Delete",
  },

  "settings.usage.range.today": { "zh-CN": "今日", "en-US": "Today" },
  "settings.usage.range.7d": { "zh-CN": "近 7 天", "en-US": "Last 7 days" },
  "settings.usage.range.30d": { "zh-CN": "近 30 天", "en-US": "Last 30 days" },
  "settings.usage.range.all": { "zh-CN": "全部", "en-US": "All time" },
  "settings.usage.refresh": { "zh-CN": "刷新统计", "en-US": "Refresh stats" },
  "settings.usage.loading": {
    "zh-CN": "正在统计…",
    "en-US": "Crunching numbers…",
  },
  "settings.usage.error": {
    "zh-CN": "用量统计读取失败，请重试。",
    "en-US": "Failed to load usage stats. Please retry.",
  },
  "settings.usage.empty.title": {
    "zh-CN": "暂无用量数据",
    "en-US": "No usage data yet",
  },
  "settings.usage.empty.description": {
    "zh-CN": "跑一轮 pi 会话后，这里会展示 token 用量与成本统计。",
    "en-US": "Run a pi session and token and cost stats will show up here.",
  },
  "settings.usage.totalTokens": {
    "zh-CN": "总 tokens",
    "en-US": "Total tokens",
  },
  "settings.usage.sessions": { "zh-CN": "会话", "en-US": "Sessions" },
  "settings.usage.messages": { "zh-CN": "消息", "en-US": "Messages" },
  "settings.usage.cost": { "zh-CN": "成本", "en-US": "Cost" },
  "settings.usage.costUnreported": {
    "zh-CN": "免费或供应方未上报成本",
    "en-US": "Free or no cost reported by the provider",
  },
  "settings.usage.input": { "zh-CN": "输入", "en-US": "Input" },
  "settings.usage.output": { "zh-CN": "输出", "en-US": "Output" },
  "settings.usage.cache": { "zh-CN": "缓存", "en-US": "Cache" },
  "settings.usage.cacheRead": { "zh-CN": "缓存读", "en-US": "Cache read" },
  "settings.usage.cacheWrite": { "zh-CN": "缓存写", "en-US": "Cache write" },
  "settings.usage.trend": { "zh-CN": "用量趋势", "en-US": "Usage trend" },
  "settings.usage.trend.monthly": {
    "zh-CN": "历史跨度较长，按月聚合展示",
    "en-US": "Long history shown aggregated by month",
  },
  "settings.usage.trendTooltip": {
    "zh-CN": "{label} · 输入 {input} · 输出 {output} · 缓存 {cache}",
    "en-US": "{label} · input {input} · output {output} · cache {cache}",
  },
  "settings.usage.byModel": { "zh-CN": "按模型", "en-US": "By model" },
  "settings.usage.model": { "zh-CN": "模型", "en-US": "Model" },
  "settings.usage.tokens": { "zh-CN": "Tokens", "en-US": "Tokens" },
  "settings.usage.model.unknown": { "zh-CN": "未知", "en-US": "Unknown" },
  "settings.usage.heatmap.projectLabel": {
    "zh-CN": "按项目筛选",
    "en-US": "Filter by project",
  },
  "settings.usage.heatmap.projectAll": {
    "zh-CN": "全部项目",
    "en-US": "All projects",
  },
  "settings.usage.heatmap.tooltip": {
    "zh-CN": "{date} · 输出 {output} · 输入 {input} · 缓存 {cache} · 会话 {sessions} · 成本 {cost}",
    "en-US":
      "{date} · output {output} · input {input} · cache {cache} · {sessions} sessions · {cost}",
  },
  "settings.usage.heatmap.tooltipEmpty": {
    "zh-CN": "{date} · 无用量记录",
    "en-US": "{date} · no usage",
  },
  "settings.usage.legend.less": { "zh-CN": "少", "en-US": "Less" },
  "settings.usage.legend.more": { "zh-CN": "多", "en-US": "More" },
  "settings.usage.weekday.mon": { "zh-CN": "一", "en-US": "Mon" },
  "settings.usage.weekday.wed": { "zh-CN": "三", "en-US": "Wed" },
  "settings.usage.weekday.fri": { "zh-CN": "五", "en-US": "Fri" },
  "settings.usage.byProject": { "zh-CN": "按项目", "en-US": "By project" },
  "settings.usage.project": { "zh-CN": "项目", "en-US": "Project" },
  "settings.usage.project.noCwd": {
    "zh-CN": "旧版会话未记录工作目录，按会话目录归类：{dir}",
    "en-US": "Legacy session without recorded cwd; grouped by session folder: {dir}",
  },
  "settings.usage.dataSource": {
    "zh-CN": "数据来自 pi 会话记录（~/.pi/agent/sessions），仅统计 assistant 消息用量。",
    "en-US":
      "Derived from pi session logs (~/.pi/agent/sessions). Only assistant message usage is counted.",
  },

  "settings.general.group.general": { "zh-CN": "常规", "en-US": "General" },
  "settings.general.group.session": { "zh-CN": "会话", "en-US": "Sessions" },
  "settings.general.group.browser": { "zh-CN": "浏览器", "en-US": "Browser" },
  "settings.general.defaultProjectDir": {
    "zh-CN": "默认新建项目位置",
    "en-US": "Default new project location",
  },
  "settings.general.defaultProjectDir.current": {
    "zh-CN": "当前：{path}",
    "en-US": "Current: {path}",
  },
  "settings.general.defaultProjectDir.fallback": {
    "zh-CN": "未设置时为用户目录下 PiDeskProjects",
    "en-US": "Defaults to PiDeskProjects under your user folder when unset",
  },
  "settings.general.defaultProjectDir.updated": {
    "zh-CN": "已更新默认新建项目位置",
    "en-US": "Default new project location updated",
  },
  "settings.general.defaultProjectDir.cleared": {
    "zh-CN": "已恢复默认 PiDeskProjects 目录",
    "en-US": "Restored the default PiDeskProjects folder",
  },
  "settings.general.language": { "zh-CN": "语言", "en-US": "Language" },
  "settings.general.language.description": {
    "zh-CN": "应用界面语言",
    "en-US": "Language for the app UI",
  },
  "settings.general.showInTray": {
    "zh-CN": "在系统托盘显示",
    "en-US": "Show in system tray",
  },
  "settings.general.showInTray.description": {
    "zh-CN":
      "在 Windows 系统托盘显示 PiDesk 图标；开启后关闭窗口会最小化到托盘、应用继续在后台运行",
    "en-US":
      "Show PiDesk in the Windows tray. Closing the window then minimizes to tray and keeps the app running",
  },
  "settings.general.maxParallelSessions": {
    "zh-CN": "并行会话上限",
    "en-US": "Max parallel sessions",
  },
  "settings.general.maxParallelSessions.description": {
    "zh-CN":
      "可同时存活的 pi 会话进程数（默认 8）。超限后新建会话会失败；请在侧栏「结束进程」释放额度。修改后对下一次启动的会话生效",
    "en-US":
      "How many pi session processes may stay alive (default 8). Starting over the limit fails; free slots via End process in the sidebar. Applies to sessions started after the change",
  },
  "settings.general.sessionPrefetch": {
    "zh-CN": "会话预热（实验）",
    "en-US": "Session prefetch (experimental)",
  },
  "settings.general.sessionPrefetch.description": {
    "zh-CN":
      "在 active 会话稳定停留后，用空余额度预启动 pi，加快首次发送/模式激活。不会挤占显式启动；关闭后完全退回按需启动",
    "en-US":
      "After the active session settles, prestart pi with spare slots to speed up first send / mode activation. Explicit starts always win; turn off to start strictly on demand",
  },
  "settings.general.welcomeRecents": {
    "zh-CN": "欢迎页历史记录",
    "en-US": "Welcome screen history",
  },
  "settings.general.welcomeRecents.description": {
    "zh-CN": "在欢迎界面的输入栏上方显示最近会话的快捷入口",
    "en-US": "Show shortcuts to recent sessions above the input box on the welcome screen",
  },
  "settings.general.browserEnabled": {
    "zh-CN": "Browser 插件",
    "en-US": "Browser plugin",
  },
  "settings.general.browserEnabled.description": {
    "zh-CN": "允许 PiDesk 使用内置浏览器；关闭后右栏菜单不再显示 Browser 工具",
    "en-US":
      "Allow PiDesk to use the built-in browser. Off hides Browser tools in the right sidebar",
  },

  "settings.appearance.group.theme": { "zh-CN": "主题", "en-US": "Theme" },
  "settings.appearance.group.layout": { "zh-CN": "布局", "en-US": "Layout" },
  "settings.appearance.theme": { "zh-CN": "主题", "en-US": "Theme" },
  "settings.appearance.theme.description": {
    "zh-CN": "亮色主题为预览版，后续版本校色。",
    "en-US": "Light theme is a preview and will be recolored later.",
  },
  "settings.appearance.theme.dark": { "zh-CN": "暗色", "en-US": "Dark" },
  "settings.appearance.theme.light": { "zh-CN": "亮色", "en-US": "Light" },
  "settings.appearance.navCollapsed": {
    "zh-CN": "侧边栏默认折叠",
    "en-US": "Collapse sidebar by default",
  },
  "settings.appearance.navCollapsed.description": {
    "zh-CN": "切换后立即生效并持久化。",
    "en-US": "Takes effect immediately and is saved.",
  },

  "settings.personalization.hint": {
    "zh-CN": "调整界面字体与会话区阅读密度；改动立即生效并写入本机设置。",
    "en-US":
      "Tune UI fonts and reading density in the session stream. Changes apply immediately and are saved.",
  },
  "settings.personalization.group.font": { "zh-CN": "字体", "en-US": "Font" },
  "settings.personalization.streamFont": {
    "zh-CN": "对话流字号",
    "en-US": "Stream font size",
  },
  "settings.personalization.streamFont.description": {
    "zh-CN": "AI 正文、工具行等会话文档流的基准字号；次级文案与工具展开区随之下调一档。",
    "en-US":
      "Base size for AI prose and tool rows in the session stream; secondary text and tool details step down one notch.",
  },
  "settings.personalization.fontSize.small": {
    "zh-CN": "小",
    "en-US": "Small",
  },
  "settings.personalization.fontSize.standard": {
    "zh-CN": "标准",
    "en-US": "Default",
  },
  "settings.personalization.fontSize.large": {
    "zh-CN": "大",
    "en-US": "Large",
  },
  "settings.personalization.fontSize.xlarge": {
    "zh-CN": "特大",
    "en-US": "Extra large",
  },
  "settings.personalization.preview": {
    "zh-CN": "当前预览",
    "en-US": "Live preview",
  },
  "settings.personalization.preview.description": {
    "zh-CN": "{md}px 正文 · {sm}px 次级",
    "en-US": "{md}px body · {sm}px secondary",
  },
  "settings.personalization.preview.sample": {
    "zh-CN": "和 pi 一起探索无限可能",
    "en-US": "Explore endless possibilities with pi",
  },
  "settings.personalization.fontUi": {
    "zh-CN": "界面字体",
    "en-US": "UI font",
  },
  "settings.personalization.fontUi.description": {
    "zh-CN": "菜单、侧栏、正文等界面文字使用的字体；改动立即生效。",
    "en-US": "Font for menus, sidebars, and body text. Applies immediately.",
  },
  "settings.personalization.fontUi.preset.default": {
    "zh-CN": "默认",
    "en-US": "Default",
  },
  "settings.personalization.fontUi.preset.segoe": {
    "zh-CN": "Segoe UI",
    "en-US": "Segoe UI",
  },
  "settings.personalization.fontUi.preset.yahei": {
    "zh-CN": "微软雅黑",
    "en-US": "Microsoft YaHei",
  },
  "settings.personalization.fontUi.preset.dengxian": {
    "zh-CN": "等线",
    "en-US": "DengXian",
  },
  "settings.personalization.fontUi.preset.simsun": {
    "zh-CN": "宋体",
    "en-US": "SimSun",
  },
  "settings.personalization.fontUi.preset.arial": {
    "zh-CN": "Arial",
    "en-US": "Arial",
  },
  "settings.personalization.fontMono": {
    "zh-CN": "等宽字体",
    "en-US": "Monospace font",
  },
  "settings.personalization.fontMono.description": {
    "zh-CN": "代码块、工具输出、终端等使用等宽字距的场景；改动立即生效。",
    "en-US": "Code blocks, tool output, and the terminal. Applies immediately.",
  },
  "settings.personalization.fontMono.preset.default": {
    "zh-CN": "默认",
    "en-US": "Default",
  },
  "settings.personalization.fontMono.preset.cascadia": {
    "zh-CN": "Cascadia Code",
    "en-US": "Cascadia Code",
  },
  "settings.personalization.fontMono.preset.consolas": {
    "zh-CN": "Consolas",
    "en-US": "Consolas",
  },
  "settings.personalization.fontMono.preset.courier": {
    "zh-CN": "Courier New",
    "en-US": "Courier New",
  },
  "settings.personalization.fontMono.preset.lucida": {
    "zh-CN": "Lucida Console",
    "en-US": "Lucida Console",
  },
  "settings.personalization.font.selected": {
    "zh-CN": "当前",
    "en-US": "Current",
  },
  "settings.personalization.monoPreview": {
    "zh-CN": "等宽预览",
    "en-US": "Monospace preview",
  },
  "settings.personalization.monoPreview.description": {
    "zh-CN": "0O1lI · const pi = '∞'",
    "en-US": "0O1lI · const pi = '∞'",
  },
  "settings.personalization.monoPreview.sample": {
    "zh-CN": "function explore() { return infinite(); }",
    "en-US": "function explore() { return infinite(); }",
  },

  "settings.personalization.group.rail": {
    "zh-CN": "对话流导航",
    "en-US": "Session rail",
  },
  "settings.personalization.railStyle.style.line": {
    "zh-CN": "短线",
    "en-US": "Line",
  },
  "settings.personalization.railStyle.style.dot": {
    "zh-CN": "圆点",
    "en-US": "Dot",
  },
  "settings.personalization.railStyle.style.tick": {
    "zh-CN": "竖刻度",
    "en-US": "Tick",
  },
  "settings.personalization.railStyle.style.pill": {
    "zh-CN": "胶囊",
    "en-US": "Pill",
  },
  "settings.personalization.railStyle.style.diamond": {
    "zh-CN": "菱形",
    "en-US": "Diamond",
  },
  "settings.personalization.railStyle.style.bar": {
    "zh-CN": "粗条",
    "en-US": "Bar",
  },
  "settings.personalization.railStyle.style.ring": {
    "zh-CN": "空心环",
    "en-US": "Ring",
  },

  "settings.config.group.runtime": {
    "zh-CN": "pi 运行时",
    "en-US": "pi runtime",
  },
  "settings.config.piPath": {
    "zh-CN": "pi 可执行路径",
    "en-US": "pi executable path",
  },
  "settings.config.piPath.configured": {
    "zh-CN": "已配置：{path}",
    "en-US": "Configured: {path}",
  },
  "settings.config.piPath.detected": {
    "zh-CN": "检测到：{path}",
    "en-US": "Detected: {path}",
  },
  "settings.config.piPath.missing": {
    "zh-CN": "未检测到 pi：请安装（pnpm/npm 全局或官方 standalone），或手动指定可执行文件",
    "en-US":
      "pi not detected. Install it (pnpm/npm global or official standalone), or pick the executable",
  },
  "settings.config.piPath.invalid": {
    "zh-CN": "该文件无法作为 pi 运行（未通过 --version 校验）",
    "en-US": "This file cannot run as pi (failed --version check)",
  },
  "settings.config.piPath.validated": {
    "zh-CN": "pi 校验通过：v{version}",
    "en-US": "pi check passed: v{version}",
  },
  "settings.config.validating": { "zh-CN": "校验中…", "en-US": "Validating…" },
  "settings.config.browse": { "zh-CN": "浏览…", "en-US": "Browse…" },
  "settings.config.piVersion": { "zh-CN": "pi 版本", "en-US": "pi version" },
  "settings.config.piVersion.ready": {
    "zh-CN": "已就绪：v{version}",
    "en-US": "Ready: v{version}",
  },
  "settings.config.piVersion.missing": {
    "zh-CN": "未找到 pi 或未安装",
    "en-US": "pi not found or not installed",
  },
  "settings.config.notConnected": {
    "zh-CN": "未接入",
    "en-US": "Not connected",
  },
  "settings.config.bashShell": {
    "zh-CN": "Shell（bash）",
    "en-US": "Shell (bash)",
  },
  "settings.config.gotoEnvironment": {
    "zh-CN": "去环境页配置",
    "en-US": "Configure on Environment",
  },
  "settings.config.shell.source.settings": {
    "zh-CN": "shellPath 配置",
    "en-US": "shellPath setting",
  },
  "settings.config.shell.source.gitBashDefault": {
    "zh-CN": "Git Bash 默认位置",
    "en-US": "Default Git Bash location",
  },
  "settings.config.shell.source.path": { "zh-CN": "PATH", "en-US": "PATH" },
  "settings.config.shell.resolved.loading": {
    "zh-CN": "正在读取探测结果…",
    "en-US": "Reading probe results…",
  },
  "settings.config.shell.resolved.found": {
    "zh-CN": "pi 将使用：{path}（来源 {source}）",
    "en-US": "pi will use: {path} (from {source})",
  },
  "settings.config.shell.resolved.missing": {
    "zh-CN": "未找到 bash：请安装 Git，或在环境页手动指定 bash.exe",
    "en-US": "bash not found. Install Git, or set bash.exe manually on the Environment page",
  },

  "settings.environment.group.terminal": {
    "zh-CN": "终端",
    "en-US": "Terminal",
  },
  "settings.environment.terminalShell": {
    "zh-CN": "终端 Shell",
    "en-US": "Terminal shell",
  },
  "settings.environment.terminalShell.description": {
    "zh-CN": "对新开终端实例生效；未找到 Git Bash 时回退 PowerShell。",
    "en-US":
      "Applies to new terminal instances. Falls back to PowerShell when Git Bash is missing.",
  },
  "settings.environment.piShell": {
    "zh-CN": "pi Shell（bash）",
    "en-US": "pi shell (bash)",
  },
  "settings.environment.select": { "zh-CN": "选择…", "en-US": "Choose…" },
  "settings.environment.clear": { "zh-CN": "清除", "en-US": "Clear" },
  "settings.environment.firstOnPath": {
    "zh-CN": "PATH 第一位",
    "en-US": "First on PATH",
  },
  "settings.environment.shellPath.set": {
    "zh-CN": "已写入 pi 配置：shellPath = {path}",
    "en-US": "Saved to pi config: shellPath = {path}",
  },
  "settings.environment.shellPath.cleared": {
    "zh-CN": "已清除 pi 的 shellPath 配置",
    "en-US": "Cleared pi shellPath setting",
  },
  "settings.environment.shellPath.failed": {
    "zh-CN": "写入失败",
    "en-US": "Write failed",
  },

  "settings.projects.list": { "zh-CN": "项目列表", "en-US": "Project list" },
  "settings.projects.empty": { "zh-CN": "暂无项目", "en-US": "No projects" },
  "settings.projects.add": { "zh-CN": "添加项目", "en-US": "Add project" },
  "settings.projects.add.description": {
    "zh-CN": "选择本地文件夹，加入项目列表并持久化。",
    "en-US": "Pick a local folder to add to the project list and save it.",
  },
  "settings.projects.addButton": { "zh-CN": "添加…", "en-US": "Add…" },

  "settings.shortcuts.group.navigation": {
    "zh-CN": "导航",
    "en-US": "Navigation",
  },
  "settings.shortcuts.group.panels": { "zh-CN": "面板", "en-US": "Panels" },
  "settings.shortcuts.group.session": { "zh-CN": "会话", "en-US": "Session" },
  "settings.shortcuts.group.review": { "zh-CN": "审查", "en-US": "Review" },
  "settings.shortcuts.group.manage": { "zh-CN": "管理", "en-US": "Manage" },
  "settings.shortcuts.hint": {
    "zh-CN":
      "点击右侧组合键重新录入；Esc 取消。需含 Ctrl 或 Alt；剪贴板等系统组合不可占用。输入框内不触发的快捷键见各项说明。",
    "en-US":
      "Click a combo on the right to rebind; Esc cancels. Requires Ctrl or Alt; clipboard shortcuts are reserved. See each entry for whether it fires while typing.",
  },
  "settings.shortcuts.listening": {
    "zh-CN": "请按下快捷键…",
    "en-US": "Press a shortcut…",
  },
  "settings.shortcuts.needModifier": {
    "zh-CN": "请使用 Ctrl 或 Alt 与字母、数字、F1–F12 或方向键组合",
    "en-US": "Use Ctrl or Alt with a letter, digit, F1–F12, or arrow key",
  },
  "settings.shortcuts.reserved": {
    "zh-CN": "{combo} 是系统编辑快捷键，不可占用",
    "en-US": "{combo} is a system editing shortcut and cannot be reassigned",
  },
  "settings.shortcuts.conflict": {
    "zh-CN": "{combo} 已分配给「{action}」",
    "en-US": "{combo} is already assigned to “{action}”",
  },
  "settings.shortcuts.rebind": {
    "zh-CN": "重新录入{action}快捷键",
    "en-US": "Rebind shortcut for {action}",
  },
  "settings.shortcuts.reset": {
    "zh-CN": "恢复默认",
    "en-US": "Restore defaults",
  },
  "settings.shortcuts.reset.description": {
    "zh-CN": "把全部快捷键恢复为出厂组合。",
    "en-US": "Reset every shortcut to its factory combo.",
  },
  "settings.shortcuts.reset.button": { "zh-CN": "恢复默认", "en-US": "Reset" },
  "settings.shortcuts.newTask.description": {
    "zh-CN": "创建一个空白会话任务。",
    "en-US": "Start a blank session task.",
  },
  "settings.shortcuts.openFiles.description": {
    "zh-CN": "展开右侧文件 Tab 并定位到搜索框。",
    "en-US": "Open the right-side Files tab and focus the search field.",
  },
  "settings.shortcuts.toggleTerminal.description": {
    "zh-CN": "显示或隐藏底部终端；不结束终端进程。",
    "en-US": "Show or hide the bottom terminal without ending the process.",
  },
  "settings.shortcuts.toggleSidebar.description": {
    "zh-CN": "折叠或展开左侧导航。",
    "en-US": "Collapse or expand the left navigation.",
  },
  "settings.shortcuts.openCommandPalette": {
    "zh-CN": "打开命令面板",
    "en-US": "Open the command palette",
  },
  "settings.shortcuts.openCommandPalette.description": {
    "zh-CN": "弹出命令面板，搜索命令 / 会话 / 文件并直达；面板开着时同键关闭。",
    "en-US": "Open the palette to search commands, sessions and files; press again to close it.",
  },
  "settings.shortcuts.openSettings.description": {
    "zh-CN": "打开设置浮窗。",
    "en-US": "Open the settings dialog.",
  },
  "settings.shortcuts.goSession.description": {
    "zh-CN": "回到会话页。",
    "en-US": "Go to the session page.",
  },
  "settings.shortcuts.goExtensions.description": {
    "zh-CN": "打开扩展页。",
    "en-US": "Open the extensions page.",
  },
  "settings.shortcuts.goScheduled.description": {
    "zh-CN": "打开定时任务页。",
    "en-US": "Open the scheduled tasks page.",
  },
  "settings.shortcuts.toggleRightSidebar.description": {
    "zh-CN": "显示或隐藏右侧上下文面板。",
    "en-US": "Show or hide the right context sidebar.",
  },
  "settings.shortcuts.openReview.description": {
    "zh-CN": "打开代码审查（停靠或浮窗随当前形态）。",
    "en-US": "Open code review (docked or floating, per current mode).",
  },
  "settings.shortcuts.rollbackLastRound.description": {
    "zh-CN": "把上一轮 Agent 触碰过的文件还原到任务开始前；先弹确认。",
    "en-US": "Restore files touched by the last agent round; asks for confirmation first.",
  },
  "settings.shortcuts.nextSession.description": {
    "zh-CN": "按侧栏顺序切到下一个会话（环绕）。",
    "en-US": "Switch to the next session in sidebar order (wraps around).",
  },
  "settings.shortcuts.prevSession.description": {
    "zh-CN": "按侧栏顺序切到上一个会话（环绕）。",
    "en-US": "Switch to the previous session in sidebar order (wraps around).",
  },

  "settings.about.group.version": { "zh-CN": "版本", "en-US": "Version" },
  "settings.about.pideskVersion": {
    "zh-CN": "PiDesk 版本",
    "en-US": "PiDesk version",
  },
  "settings.about.executablePath": {
    "zh-CN": "可执行文件：{path}",
    "en-US": "Executable: {path}",
  },
  "settings.about.checkUpdates": {
    "zh-CN": "检查更新",
    "en-US": "Check for updates",
  },
  "settings.about.checkUpdates.description": {
    "zh-CN": "启动时会静默检查；也可在这里手动检查并安装。",
    "en-US": "Checked silently on launch; you can also check and install here.",
  },
  "settings.about.update.checking": {
    "zh-CN": "检查中…",
    "en-US": "Checking…",
  },
  "settings.about.update.upToDate": {
    "zh-CN": "已是最新版本",
    "en-US": "You're up to date",
  },
  "settings.about.update.available": {
    "zh-CN": "发现新版本 v{version}",
    "en-US": "Update available: v{version}",
  },
  "settings.about.update.download": {
    "zh-CN": "下载并安装",
    "en-US": "Download and install",
  },
  "settings.about.update.openDownloads": {
    "zh-CN": "打开下载页",
    "en-US": "Open downloads",
  },
  "settings.about.update.downloading": {
    "zh-CN": "正在下载… {percent}%",
    "en-US": "Downloading… {percent}%",
  },
  "settings.about.update.downloaded": {
    "zh-CN": "安装包已就绪，重启后完成更新",
    "en-US": "Installer ready — restart to finish updating",
  },
  "settings.about.update.installNow": {
    "zh-CN": "立即重启安装",
    "en-US": "Restart and install",
  },
  "settings.about.update.error": {
    "zh-CN": "更新检查失败：{message}",
    "en-US": "Update check failed: {message}",
  },
  "settings.about.update.devHint": {
    "zh-CN": "当前为开发构建，无法安装更新",
    "en-US": "Development build — cannot install updates",
  },
  "settings.about.update.badge": {
    "zh-CN": "有更新",
    "en-US": "Update",
  },
  "settings.about.update.releaseNotes": {
    "zh-CN": "查看发布说明",
    "en-US": "View release notes",
  },
  "settings.about.group.openSource": {
    "zh-CN": "开源",
    "en-US": "Open source",
  },
  "settings.about.repo": { "zh-CN": "开源地址", "en-US": "Repository" },

  "settings.models.defaultModel": {
    "zh-CN": "默认模型",
    "en-US": "Default model",
  },
  "settings.models.defaultModel.descriptionActive": {
    "zh-CN": "打开下拉时刷新激活凭据的可用模型；选择后立即对当前会话生效并写入 pi 配置。",
    "en-US":
      "Opening the menu refreshes models for the active credential. Choosing one applies to the current session and saves to pi config.",
  },
  "settings.models.defaultModel.descriptionIdle": {
    "zh-CN": "打开下拉时刷新激活凭据的可用模型；选择后写入 pi 的 defaultProvider / defaultModel。",
    "en-US":
      "Opening the menu refreshes models for the active credential. Choosing one saves pi's defaultProvider / defaultModel.",
  },
  "settings.models.selectModel": {
    "zh-CN": "选择模型",
    "en-US": "Select model",
  },
  "settings.models.loading": {
    "zh-CN": "正在探测可用模型…",
    "en-US": "Probing available models…",
  },
  "settings.models.empty": {
    "zh-CN": "暂无可用模型，请检查激活凭据",
    "en-US": "No models available. Check the active credential",
  },
  "settings.models.current": { "zh-CN": "当前", "en-US": "Current" },
  "settings.models.refreshing": { "zh-CN": "刷新中…", "en-US": "Refreshing…" },
  "settings.models.applied.deferred": {
    "zh-CN": "已保存默认模型：{key}（当前会话未加载，新会话生效）",
    "en-US":
      "Saved default model: {key} (not loaded in the current session; applies to new sessions)",
  },
  "settings.models.applied.switched": {
    "zh-CN": "已切换模型：{key}",
    "en-US": "Switched model: {key}",
  },
  "settings.models.applied.saved": {
    "zh-CN": "已保存默认模型：{key}",
    "en-US": "Saved default model: {key}",
  },
  "settings.models.applyFailed": {
    "zh-CN": "模型切换失败",
    "en-US": "Failed to switch model",
  },
  "settings.models.group.credentials": {
    "zh-CN": "凭据",
    "en-US": "Credentials",
  },
  "settings.models.credentials.hintBefore": {
    "zh-CN": "同一厂商可添加多份命名凭据（如公司 / 个人），激活后密钥写入",
    "en-US":
      "Keep multiple named credentials per provider (e.g. work / personal). Activating one writes the key to",
  },
  "settings.models.credentials.hintAfter": {
    "zh-CN":
      "对应的标准键。注册表保存在 PiDesk 数据目录。官方源使用固定端点；New API 可自定义 Base URL 与协议。",
    "en-US":
      " the matching standard key. The registry lives in the PiDesk data folder. Official sources use fixed endpoints; New API can set a custom Base URL and protocol.",
  },
  "settings.models.credential.create": {
    "zh-CN": "新增凭据",
    "en-US": "Add credential",
  },
  "settings.models.credential.activate": {
    "zh-CN": "激活",
    "en-US": "Activate",
  },
  "settings.models.credential.edit": { "zh-CN": "编辑", "en-US": "Edit" },
  "settings.models.credential.activeBadge": {
    "zh-CN": "激活",
    "en-US": "Active",
  },
  "settings.models.credential.expired": {
    "zh-CN": "已过期",
    "en-US": "Expired",
  },
  "settings.models.credential.preferred": {
    "zh-CN": "偏好 {model}",
    "en-US": "Prefers {model}",
  },
  "settings.models.credential.activatedNeedModel": {
    "zh-CN": "已激活凭据：{name}，请在下方确认默认模型",
    "en-US": "Activated credential: {name}. Confirm the default model below",
  },
  "settings.models.credential.activated": {
    "zh-CN": "已激活凭据：{name}",
    "en-US": "Activated credential: {name}",
  },
  "settings.models.credential.activateFailed": {
    "zh-CN": "激活失败",
    "en-US": "Activation failed",
  },
  "settings.models.credential.removed": {
    "zh-CN": "已移除凭据：{name}",
    "en-US": "Removed credential: {name}",
  },
  "settings.models.credential.removeFailed": {
    "zh-CN": "移除失败",
    "en-US": "Remove failed",
  },
  "settings.models.credential.updated": {
    "zh-CN": "已更新凭据：{name}",
    "en-US": "Updated credential: {name}",
  },
  "settings.models.credential.added": {
    "zh-CN": "已添加凭据：{name}",
    "en-US": "Added credential: {name}",
  },
  "settings.models.credential.saveFailed": {
    "zh-CN": "保存凭据失败",
    "en-US": "Failed to save credential",
  },
  "settings.models.credential.providerRequired": {
    "zh-CN": "请选择 Provider",
    "en-US": "Select a provider",
  },
  "settings.models.credential.providerLabel": {
    "zh-CN": "Provider",
    "en-US": "Provider",
  },
  "settings.models.credential.nameRequired": {
    "zh-CN": "请填写凭据名称",
    "en-US": "Enter a credential name",
  },
  "settings.models.credential.apiKeyRequired": {
    "zh-CN": "新增凭据必须填写 API Key",
    "en-US": "New credentials need an API key",
  },
  "settings.models.credential.baseUrlRequired": {
    "zh-CN": "New API 必须填写自定义 Base URL",
    "en-US": "New API requires a custom Base URL",
  },
  "settings.models.credential.empty": {
    "zh-CN": "暂无凭据，点击「新增凭据」写入 API Key",
    "en-US": "No credentials yet. Click Add credential to enter an API key",
  },
  "settings.models.credential.editTitle": {
    "zh-CN": "编辑凭据：{name}",
    "en-US": "Edit credential: {name}",
  },
  "settings.models.credential.namePlaceholder": {
    "zh-CN": "凭据名称（如 DeepSeek 公司）",
    "en-US": "Credential name (e.g. DeepSeek work)",
  },
  "settings.models.credential.apiKeyPlaceholder": {
    "zh-CN": "粘贴 API Key",
    "en-US": "Paste API key",
  },
  "settings.models.credential.apiKeyKeepPlaceholder": {
    "zh-CN": "留空则保留原密钥",
    "en-US": "Leave blank to keep the current key",
  },
  "settings.models.credential.baseUrlPlaceholder": {
    "zh-CN": "自定义 Base URL（如 https://api.example.com）",
    "en-US": "Custom Base URL (e.g. https://api.example.com)",
  },
  "settings.models.credential.apiTypeLabel": {
    "zh-CN": "API 协议",
    "en-US": "API protocol",
  },
  "settings.models.credential.preferredModelPlaceholder": {
    "zh-CN": "偏好默认模型（可选）",
    "en-US": "Preferred default model (optional)",
  },
  "settings.models.credential.saving": {
    "zh-CN": "保存中…",
    "en-US": "Saving…",
  },
  "settings.models.credential.registry": {
    "zh-CN": "注册表：{path}",
    "en-US": "Registry: {path}",
  },

  "settings.extensions.selectiveLoadUnsupported": {
    "zh-CN": "当前 pi 版本不支持独立加载扩展设置，请升级后重试。",
    "en-US": "This pi version can't load extension settings independently. Upgrade and try again.",
  },
  "settings.extensions.connectFailed": {
    "zh-CN": "扩展设置连接失败：{error}",
    "en-US": "Failed to connect to extension settings: {error}",
  },
  "settings.extensions.connected": {
    "zh-CN": "扩展设置已连接",
    "en-US": "Extension settings connected",
  },
  "settings.extensions.connecting": {
    "zh-CN": "正在连接扩展设置…",
    "en-US": "Connecting to extension settings…",
  },
  "settings.extensions.noneRunnable": {
    "zh-CN": "暂无可独立运行的扩展设置",
    "en-US": "No extension settings can run independently",
  },
  "settings.extensions.workerFailed": {
    "zh-CN": "Worker 启动失败",
    "en-US": "Worker failed to start",
  },
  "settings.extensions.providedSettings": {
    "zh-CN": "扩展提供的设置",
    "en-US": "Settings from extensions",
  },
  "settings.extensions.opened": { "zh-CN": "已打开", "en-US": "Opened" },
  "settings.extensions.autoLoad": {
    "zh-CN": "打开设置页时自动加载",
    "en-US": "Loads automatically when settings open",
  },
  "settings.extensions.opening": { "zh-CN": "打开中…", "en-US": "Opening…" },
  "settings.extensions.diagnostics": {
    "zh-CN": "Manifest 诊断",
    "en-US": "Manifest diagnostics",
  },
  "settings.extensions.empty": {
    "zh-CN": "当前没有已连接的扩展设置。部分扩展需要先在会话中使用，才能打开其设置。",
    "en-US":
      "No connected extension settings. Some extensions need to be used in a session before their settings can open.",
  },
  "settings.extensions.entry.package": {
    "zh-CN": "（{id}）",
    "en-US": " ({id})",
  },
  "settings.extensions.entry.description": {
    "zh-CN": " — {description}",
    "en-US": " — {description}",
  },
  "settings.extensions.entry.workerSafe": {
    "zh-CN": " · Worker",
    "en-US": " · Worker",
  },
});
