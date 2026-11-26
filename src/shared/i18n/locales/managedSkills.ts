import { defineMessages } from "../types";

export const managedSkillsMessages = defineMessages({
  "skills.title": { "zh-CN": "托管技能", "en-US": "Managed skills" },
  "skills.global": { "zh-CN": "全局资源", "en-US": "Global resources" },
  "skills.subtitle": {
    "zh-CN":
      "安装与维护随应用提供的技能。当前项目用于检查同名覆盖；现有会话保留启动时的资源快照，变更后请结束并重新打开会话。",
    "en-US":
      "Install and maintain bundled skills. The current project is checked for name overrides. Existing sessions retain their resource snapshot; close and reopen them after changes.",
  },
  "skills.tab.manage": { "zh-CN": "安装与维护", "en-US": "Manage" },
  "skills.tab.doctor": { "zh-CN": "Doctor 检查", "en-US": "Doctor" },
  "skills.tab.manifest": { "zh-CN": "托管清单", "en-US": "Manifest" },
  "skills.operation.install": { "zh-CN": "安装", "en-US": "Install" },
  "skills.operation.update": { "zh-CN": "更新", "en-US": "Update" },
  "skills.operation.repair": { "zh-CN": "修复", "en-US": "Repair" },
  "skills.operation.uninstall": { "zh-CN": "卸载", "en-US": "Uninstall" },
  "skills.installed": { "zh-CN": "已托管", "en-US": "Managed" },
  "skills.notInstalled": { "zh-CN": "未托管", "en-US": "Not managed" },
  "skills.orphaned": { "zh-CN": "已保留用户修改", "en-US": "User changes retained" },
  "skills.updateAvailable": { "zh-CN": "有内置更新", "en-US": "Bundle update available" },
  "skills.available": {
    "zh-CN": "已通过资源发现；重新打开会话后可用",
    "en-US": "Discovered; available when a session is reopened",
  },
  "skills.unavailable": {
    "zh-CN": "未在启用的资源中发现，请查看 Doctor",
    "en-US": "Not discovered among enabled resources; check Doctor",
  },
  "skills.openFolder": { "zh-CN": "打开目录", "en-US": "Open folder" },
  "skills.loading": {
    "zh-CN": "正在读取技能与托管记录…",
    "en-US": "Reading skills and ownership records…",
  },
  "skills.working": { "zh-CN": "正在处理…", "en-US": "Working…" },
  "skills.plan.title": { "zh-CN": "确认技能文件计划", "en-US": "Review skill file changes" },
  "skills.plan.note": {
    "zh-CN": "确认后才写入。执行前会重新核对文件、来源和清单；计划过期或文件发生变化时需重新预览。",
    "en-US":
      "Files change only after confirmation. Sources, files and ownership are checked again before applying. Expired or changed plans require a new preview.",
  },
  "skills.plan.blocked": {
    "zh-CN": "存在阻止写入的问题，请先按诊断处理后重新预览。",
    "en-US": "Resolve the blocking diagnostics, then preview again.",
  },
  "skills.change.add": { "zh-CN": "新增", "en-US": "Add" },
  "skills.change.replace": { "zh-CN": "替换", "en-US": "Replace" },
  "skills.change.remove": { "zh-CN": "移除", "en-US": "Remove" },
  "skills.change.keep": { "zh-CN": "保留", "en-US": "Keep" },
  "skills.preserve": {
    "zh-CN":
      "目录含有修改、额外文件或链接。此操作只将清单标记为保留用户修改，文件与所有权记录均保留。请自行备份并处理差异。",
    "en-US":
      "This directory contains changes, extra files or links. This operation only marks the ownership record as retaining user changes. Files and ownership are kept; back up and resolve the differences manually.",
  },
  "skills.preserved": {
    "zh-CN": "已保留用户修改，目录与托管记录均未移除。",
    "en-US": "User changes retained. The directory and ownership record were kept.",
  },
  "skills.completed": {
    "zh-CN": "技能操作已完成。请结束并重新打开需要使用新资源的会话。",
    "en-US": "Skill changes applied. Close and reopen sessions that need the new resources.",
  },
  "skills.doctorNote": {
    "zh-CN":
      "只读检查元数据、同名冲突、启用状态、文件哈希、缺失与额外文件及中断恢复记录；资源发现不代表存活会话已重新加载。",
    "en-US":
      "Read-only checks cover metadata, name collisions, enablement, hashes, missing and extra files, and recovery records. Discovery does not mean existing sessions have reloaded.",
  },
  "skills.healthy": {
    "zh-CN": "检查通过，未发现问题。",
    "en-US": "Checks passed. No issues found.",
  },
  "skills.manifestNote": {
    "zh-CN":
      "沿用原托管清单与部署目录，记录来源哈希、安装哈希、所有权及恢复状态。尚未安装时展示默认清单，读取不会创建文件。",
    "en-US":
      "The original manifest and deployment paths are retained, including source and installed hashes, ownership and recovery state. Before installation this shows a default manifest; reading creates no files.",
  },
  "skills.manifestInvalid": {
    "zh-CN": "清单无法安全读取，请查看 Doctor。",
    "en-US": "The manifest cannot be read safely. Check Doctor.",
  },
  "skills.issue.manifest": {
    "zh-CN": "托管清单或目录边界无效；请备份并核对清单及目录链接，修正前不会写入。",
    "en-US":
      "Invalid ownership manifest or directory boundary. Back up and inspect the manifest and directory links; writes are blocked until resolved.",
  },
  "skills.issue.recovery": {
    "zh-CN": "发现中断记录或暂存备份；请核对目录和清单后手动保留或清理备份。",
    "en-US":
      "A recovery record or transaction backup remains. Inspect the directory and manifest before retaining or removing the backup manually.",
  },
  "skills.issue.unsafe": {
    "zh-CN": "存在链接、特殊文件或无法安全检查的目录；请先移出并检查，避免覆盖或删除目标外文件。",
    "en-US":
      "A link, special file or unreadable directory prevents safe inspection. Move it aside and inspect it before replacing or removing files.",
  },
  "skills.issue.missing": {
    "zh-CN": "托管文件或目录缺失；可用“修复”恢复缺失内容。",
    "en-US": "A managed file or directory is missing. Use Repair to restore missing content.",
  },
  "skills.issue.modified": {
    "zh-CN": "文件已被修改，更新与修复不会覆盖；请备份修改并恢复原文件后重试。",
    "en-US":
      "This file was modified. Update and Repair will not overwrite it. Back up changes and restore the original before retrying.",
  },
  "skills.issue.extra": {
    "zh-CN": "存在清单外文件或目录；请先备份并移出，更新与修复才可继续。",
    "en-US":
      "An extra file or directory is not owned by the manifest. Back it up and move it aside before updating or repairing.",
  },
  "skills.issue.source": {
    "zh-CN": "当前应用中缺少有效的内置来源；可保留现有技能，或预览卸载。",
    "en-US":
      "A valid bundled source is unavailable in this app. Keep the existing skill or preview its removal.",
  },
  "skills.issue.invalid": {
    "zh-CN": "技能元数据或资源发现无效；请按原生技能格式修正，或停用有问题的资源后重试。",
    "en-US":
      "Invalid skill metadata or resource discovery. Correct the native skill format or disable the affected resource, then retry.",
  },
  "skills.issue.collision": {
    "zh-CN":
      "存在同名技能；同作用域冲突会阻止写入，项目技能会覆盖全局技能。请重命名或调整启用状态。",
    "en-US":
      "A skill has the same name. Same-scope collisions block writes; project skills override global skills. Rename or adjust enablement.",
  },
  "skills.issue.disabled": {
    "zh-CN": "托管技能未被发现或已停用；请检查本地资源开关与配置路径后重新打开会话。",
    "en-US":
      "The managed skill was not discovered or is disabled. Check resource toggles and configured paths, then reopen the session.",
  },
  "skills.issue.notManaged": {
    "zh-CN":
      "目标目录不受托管或缺少所有权记录；不会接管现有文件。请先移出同名目录，或选择已托管技能。",
    "en-US":
      "The target has no ownership record. Existing files will not be adopted. Move the directory aside or choose a managed skill.",
  },
  "skills.issue.alreadyManaged": {
    "zh-CN": "技能已托管，请改用更新或修复。",
    "en-US": "This skill is already managed. Use Update or Repair.",
  },
  "skills.error.stale": {
    "zh-CN": "计划已过期、已使用或文件已变化，请刷新并重新预览。",
    "en-US": "The plan expired, was already used, or files changed. Refresh and preview again.",
  },
  "skills.error.invalid": { "zh-CN": "技能操作参数无效。", "en-US": "Invalid skill operation." },
  "skills.error.source": {
    "zh-CN": "内置来源验证失败，未完成写入。请刷新后重试。",
    "en-US": "Bundled source verification failed. Refresh and retry.",
  },
  "skills.error.recovery": {
    "zh-CN": "操作未能完整回滚，请先在 Doctor 中核对恢复记录与备份。",
    "en-US":
      "Rollback could not finish. Inspect recovery records and backups in Doctor before continuing.",
  },
  "skills.error.unavailable": {
    "zh-CN": "技能管理接口不可用，请重新启动应用。",
    "en-US": "Skill management is unavailable. Restart the app.",
  },
  "skills.error.failed": {
    "zh-CN": "操作未完成，请刷新并查看 Doctor，核对文件权限与托管清单。",
    "en-US":
      "The operation did not finish. Refresh and check Doctor, file permissions and the ownership manifest.",
  },
  "skills.commandDescription": {
    "zh-CN": "打开托管技能：安装、更新、修复、卸载与 Doctor",
    "en-US": "Manage skills: install, update, repair, uninstall and Doctor",
  },
  "skills.commandUsage": {
    "zh-CN":
      "请单独输入 /skills、/skills doctor、/skills manifest 或 /skills install|update|repair|uninstall [技能名]，不附加附件。",
    "en-US":
      "Use /skills, /skills doctor, /skills manifest, or /skills install|update|repair|uninstall [name] without attachments.",
  },
});
