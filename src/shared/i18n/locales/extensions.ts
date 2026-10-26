import { defineMessages } from "../types";

export const extensionMessages = defineMessages({
  "extensions.title": { "zh-CN": "扩展", "en-US": "Extensions" },
  "extensions.subtitle": {
    "zh-CN": "管理 pi 包与本地资源 · 安装、启停与目录入口",
    "en-US": "Manage pi packages and local resources",
  },
  "extensions.marketplace": { "zh-CN": "扩展市场", "en-US": "Marketplace" },
  "extensions.gallery": { "zh-CN": "包市场", "en-US": "Gallery" },
  "extensions.installed": { "zh-CN": "已安装", "en-US": "Installed" },
  "extensions.install": { "zh-CN": "安装扩展", "en-US": "Install extension" },
  "extensions.installLocal": { "zh-CN": "本地安装", "en-US": "Install from disk" },
  "extensions.installDialog.title": {
    "zh-CN": "安装扩展包",
    "en-US": "Install extension package",
  },
  "extensions.installDialog.pathLabel": {
    "zh-CN": "包路径（.tgz / 目录）",
    "en-US": "Package path (.tgz / folder)",
  },
  "extensions.installDialog.browse": { "zh-CN": "浏览…", "en-US": "Browse…" },
  "extensions.installDialog.confirm": { "zh-CN": "安装", "en-US": "Install" },
  "extensions.installDialog.sourceLabel": { "zh-CN": "包来源", "en-US": "Package source" },
  "extensions.installDialog.sourcePlaceholder": {
    "zh-CN": "npm:@scope/pkg 或 git:github.com/user/repo 或本地路径",
    "en-US": "npm:@scope/pkg, git:github.com/user/repo, or a local path",
  },
  "extensions.installDialog.installTo": { "zh-CN": "安装到", "en-US": "Install to" },
  "extensions.installDialog.needProject": {
    "zh-CN": "请先选择项目",
    "en-US": "Select a project first",
  },
  "extensions.installDialog.warning": {
    "zh-CN": "第三方包会以你的系统权限运行扩展代码。请确认来源可信后再安装。",
    "en-US":
      "Third-party packages run code with your system permissions. Only install from sources you trust.",
  },
  "extensions.installDialog.installing": {
    "zh-CN": "安装中…",
    "en-US": "Installing…",
  },
  "extensions.install.failed": { "zh-CN": "安装失败", "en-US": "Install failed" },
  "extensions.install.success": { "zh-CN": "安装成功", "en-US": "Installed" },
  "extensions.install.exitFailed": {
    "zh-CN": "失败（退出码 {code}）",
    "en-US": "Failed (exit code {code})",
  },
  "extensions.uninstall": { "zh-CN": "卸载", "en-US": "Uninstall" },
  "extensions.uninstallConfirm.title": {
    "zh-CN": "卸载扩展？",
    "en-US": "Uninstall extension?",
  },
  "extensions.uninstallConfirm.message": {
    "zh-CN": "将移除该扩展及其本地资源，操作不可撤销。",
    "en-US": "This removes the extension and its local resources and cannot be undone.",
  },
  "extensions.reload": { "zh-CN": "重新加载", "en-US": "Reload" },
  "extensions.empty": { "zh-CN": "暂无扩展", "en-US": "No extensions" },
  "extensions.emptyProjectTitle": {
    "zh-CN": "当前项目还没有安装包",
    "en-US": "No packages in this project yet",
  },
  "extensions.emptyUserTitle": {
    "zh-CN": "尚未安装任何包",
    "en-US": "No packages installed yet",
  },
  "extensions.emptyProject": {
    "zh-CN": "安装到当前项目后会出现在这里。本地资源为全局目录，仍可在下方管理。",
    "en-US":
      "Packages installed into this project appear here. Local resources are global and remain below.",
  },
  "extensions.emptyUser": {
    "zh-CN": "从 npm、git 或本地路径安装，或先去包市场挑一个。",
    "en-US": "Install from npm, git, or a local path — or browse the gallery.",
  },
  "extensions.loadingList": {
    "zh-CN": "正在读取已安装扩展…",
    "en-US": "Loading installed extensions…",
  },
  "extensions.scopeLabel": { "zh-CN": "作用域", "en-US": "Scope" },
  "extensions.scope.user": { "zh-CN": "全局", "en-US": "Global" },
  "extensions.scope.project": { "zh-CN": "当前项目", "en-US": "Current project" },
  "extensions.enabled": { "zh-CN": "已启用", "en-US": "Enabled" },
  "extensions.disabled": { "zh-CN": "已停用", "en-US": "Disabled" },
  "extensions.enabledResource": { "zh-CN": "已启用「{name}」", "en-US": "Enabled “{name}”" },
  "extensions.disabledResource": { "zh-CN": "已停用「{name}」", "en-US": "Disabled “{name}”" },
  "extensions.uninstalled": { "zh-CN": "已卸载", "en-US": "Uninstalled" },
  "extensions.removeDialog.title": {
    "zh-CN": "卸载扩展包",
    "en-US": "Remove package",
  },
  "extensions.removeDialog.message": {
    "zh-CN": "确定卸载「{name}」？\n\n将执行 pi remove，并从设置中移除。",
    "en-US": "Remove “{name}”?\n\nThis runs pi remove and removes it from settings.",
  },
  "extensions.kind.local": { "zh-CN": "本地", "en-US": "Local" },
  "extensions.dirMissing": { "zh-CN": "目录缺失", "en-US": "Folder missing" },
  "extensions.expandDetails": { "zh-CN": "展开资源明细", "en-US": "Expand resources" },
  "extensions.collapseDetails": { "zh-CN": "收起资源明细", "en-US": "Collapse resources" },
  "extensions.expandKind": { "zh-CN": "展开「{kind}」", "en-US": "Expand “{kind}”" },
  "extensions.collapseKind": { "zh-CN": "收起「{kind}」", "en-US": "Collapse “{kind}”" },
  "extensions.openInstallDir": {
    "zh-CN": "打开安装目录",
    "en-US": "Open install folder",
  },
  "extensions.enablePackage": { "zh-CN": "启用 {name}", "en-US": "Enable {name}" },
  "extensions.disablePackage": { "zh-CN": "停用 {name}", "en-US": "Disable {name}" },
  "extensions.enableResource": {
    "zh-CN": "启用 {kind} {name}",
    "en-US": "Enable {kind} {name}",
  },
  "extensions.disableResource": {
    "zh-CN": "停用 {kind} {name}",
    "en-US": "Disable {kind} {name}",
  },
  "extensions.resourceKind.extensions": { "zh-CN": "扩展", "en-US": "Extensions" },
  "extensions.resourceKind.skills": { "zh-CN": "技能", "en-US": "Skills" },
  "extensions.resourceKind.prompts": { "zh-CN": "提示", "en-US": "Prompts" },
  "extensions.resourceKind.themes": { "zh-CN": "主题", "en-US": "Themes" },
  "extensions.localKind.extensions": { "zh-CN": "扩展", "en-US": "Extensions" },
  "extensions.localKind.skills": { "zh-CN": "技能", "en-US": "Skills" },
  "extensions.localKind.sharedSkills": { "zh-CN": "共享技能", "en-US": "Shared skills" },
  "extensions.localKind.prompts": { "zh-CN": "提示模板", "en-US": "Prompt templates" },
  "extensions.localKind.themes": { "zh-CN": "主题", "en-US": "Themes" },
  "extensions.openFolder": { "zh-CN": "打开文件夹", "en-US": "Open folder" },
  "extensions.missing": { "zh-CN": "不存在", "en-US": "Missing" },
  "extensions.resources": { "zh-CN": "资源", "en-US": "Resources" },
  "extensions.localResources": { "zh-CN": "本地资源", "en-US": "Local resources" },
  "extensions.localEmpty": {
    "zh-CN": "目录为空。把技能、提示模板或主题放进这里后即可在此管理。",
    "en-US": "This folder is empty. Add skills, prompts, or themes here to manage them.",
  },
  "extensions.localEmptyState": { "zh-CN": "空目录", "en-US": "Empty folder" },
  "extensions.localState": {
    "zh-CN": "{enabled} / {total} 启用",
    "en-US": "{enabled} / {total} on",
  },
  "extensions.localNone": {
    "zh-CN": "还没有已创建的本地资源目录。",
    "en-US": "No local resource folders yet.",
  },
  "extensions.localMissing.title": {
    "zh-CN": "未创建的目录",
    "en-US": "Folders not created",
  },
  "extensions.localMissing.note": {
    "zh-CN": "创建后 pi 会自动发现",
    "en-US": "pi discovers them once created",
  },
  "extensions.localMissing.badge": { "zh-CN": "未创建", "en-US": "Not created" },
  "extensions.showMore": { "zh-CN": "显示其余 {count} 项", "en-US": "Show {count} more" },
  "extensions.showLess": { "zh-CN": "收起", "en-US": "Show less" },
  "extensions.overview.packages": { "zh-CN": "已安装包", "en-US": "Packages" },
  "extensions.overview.extensions": { "zh-CN": "已启用扩展", "en-US": "Extensions on" },
  "extensions.overview.skills": { "zh-CN": "技能", "en-US": "Skills" },
  "extensions.overview.localDirs": { "zh-CN": "本地目录可用", "en-US": "Local folders" },
  "extensions.overview.statusOk": { "zh-CN": "无诊断问题", "en-US": "No diagnostics" },
  "extensions.overview.statusCount": {
    "zh-CN": "{count} 条诊断",
    "en-US": "{count} diagnostics",
  },
  "extensions.toolbar.localNote": {
    "zh-CN": "本地资源为全局目录，切换项目不影响",
    "en-US": "Local resources are global; project scope does not affect them",
  },
  "extensions.section.packagesNote": {
    "zh-CN": "包来源与启停由 pi 管理",
    "en-US": "Sources and toggles are managed by pi",
  },
  "extensions.section.localNote": {
    "zh-CN": "pi 自动发现 · 改动对新建会话生效",
    "en-US": "Discovered by pi · changes apply to new sessions",
  },
  "extensions.package.detailHint": {
    "zh-CN": "关闭后不会加载",
    "en-US": "Disabled resources are not loaded",
  },
  "extensions.package.emptyKind": {
    "zh-CN": "这个包没有{kind}。",
    "en-US": "This package has no {kind}.",
  },
  "extensions.diagnostics": { "zh-CN": "诊断", "en-US": "Diagnostics" },
  "extensions.diagnostics.title": {
    "zh-CN": "桌面能力诊断",
    "en-US": "Desktop contribution diagnostics",
  },
  "extensions.version": { "zh-CN": "版本", "en-US": "Version" },
  "extensions.publisher": { "zh-CN": "发布者", "en-US": "Publisher" },
  "extensions.openExternal": { "zh-CN": "在浏览器打开", "en-US": "Open in browser" },

  "extensions.settings.title": { "zh-CN": "来自扩展", "en-US": "From extensions" },
  "extensions.settings.hint": {
    "zh-CN": "扩展提供的设置",
    "en-US": "Settings provided by extensions",
  },
  "extensions.settings.autoLoad": {
    "zh-CN": "打开设置页时自动加载",
    "en-US": "Load automatically when settings open",
  },
  "extensions.settings.empty": {
    "zh-CN": "当前没有已连接的扩展设置。部分扩展需要先在会话中使用，才能打开其设置。",
    "en-US":
      "No connected extension settings. Some extensions must be used in a session before their settings appear.",
  },
  "extensions.settings.connecting": {
    "zh-CN": "正在连接扩展设置…",
    "en-US": "Connecting extension settings…",
  },
  "extensions.settings.connected": {
    "zh-CN": "扩展设置已连接",
    "en-US": "Extension settings connected",
  },
  "extensions.settings.none": {
    "zh-CN": "暂无可独立运行的扩展设置",
    "en-US": "No standalone extension settings yet",
  },
  "extensions.settings.connectFailed": {
    "zh-CN": "扩展设置连接失败：{message}",
    "en-US": "Failed to connect extension settings: {message}",
  },
  "extensions.settings.unsupported": {
    "zh-CN": "当前 pi 版本不支持独立加载扩展设置，请升级后重试。",
    "en-US": "This pi version cannot load standalone extension settings. Upgrade and try again.",
  },
});
