import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  ActivateContributionRequest,
  ActivateContributionResult,
  ContributionCatalogSnapshot,
  ExtensionWorkerStatus,
  PrefetchMetrics,
  PrefetchNotifyRequest,
  SessionRuntimeSnapshot,
  WorkerAcquireResult,
} from "../shared/contribution";
import { CATALOG_IPC, PREFETCH_IPC, RUNTIME_IPC, WORKER_IPC } from "../shared/contribution";
import type {
  GitHubAuthState,
  GitHubDeviceStart,
  GitHubDeviceStatus,
  GitHubSyncPreview,
  GitHubSyncResult,
} from "../shared/github";
import { GITHUB_IPC } from "../shared/github";
import type {
  BrowserApplyLoginCookiesRequest,
  BrowserApplyLoginCookiesResult,
  BrowserApplyPastedCookiesRequest,
  BrowserApplyPastedCookiesResult,
  BrowserBoundsRequest,
  BrowserCloseInstanceRequest,
  BrowserImportLoginDataRequest,
  BrowserImportLoginDataResult,
  BrowserInstanceInfo,
  BrowserLoginSource,
  BrowserNavigateRequest,
  BrowserOpenLocalFileRequest,
  BrowserOverlaySuppressedRequest,
  BrowserPickModeRequest,
  BrowserPreviewLoginCookiesRequest,
  BrowserPreviewLoginCookiesResult,
  BrowserPushMessage,
  BrowserSaveScreenshotRequest,
  BrowserScreenshotResult,
  BrowserSetActiveInstanceRequest,
  BrowserViewportRequest,
  BrowserZoomRequest,
  ExtensionPushMessage,
  FsListResult,
  FsReadResult,
  FsSaveImageRequest,
  FsSaveImageResult,
  FsSearchHit,
  FsWatchPushMessage,
  GitBranchesResult,
  GitCheckoutRequest,
  GitCommitRequest,
  GitCommitResult,
  GitCompareSnapshotRequest,
  GitCompareSnapshotResult,
  GitDiffRequest,
  GitDiscardRequest,
  GitDiscardResult,
  GitFileDiff,
  GitLogRequest,
  GitLogResult,
  GitPushPlan,
  GitPushRequest,
  GitPushResult,
  GitRollbackRequest,
  GitRollbackResult,
  GitSnapshotResult,
  GitStageRequest,
  GitStatusResult,
  GitWriteResult,
  InspectorBoxModel,
  InspectorDomTree,
  InspectorFloatHandoff,
  InspectorFloatStateMessage,
  InspectorNodeRequest,
  InspectorStyleData,
  IpcResult,
  ManagedProcess,
  McpConfigSnapshot,
  McpMarketSearchRequest,
  McpMarketSearchResult,
  McpPiSupport,
  McpProbeRequest,
  McpProbeResult,
  McpReloadResult,
  McpSaveServerRequest,
  McpSessionCommandRequest,
  PiApiKeyProviderOption,
  PiAuthSnapshot,
  PiChatMessage,
  PideskSettings,
  PiInfo,
  PiModelOption,
  PiModelState,
  PiPackageInstallRequest,
  PiPackageRemoveRequest,
  PiPackageSetEnabledRequest,
  PiPackageSetResourceEnabledRequest,
  PiPackagesSnapshot,
  PiSessionStats,
  PiShellProbe,
  PiSlashCommand,
  ProcPushMessage,
  ProcStopAllResult,
  ProcStopResult,
  SessionGetModelsRequest,
  SessionId,
  SessionPromptRequest,
  SessionPushMessage,
  SessionSetModelRequest,
  SessionSetThinkingLevelRequest,
  SessionStartRequest,
  SessionSummary,
  SessionTranscriptPayload,
  StylePatchClearRequest,
  StylePatchExportRequest,
  StylePatchExportResult,
  StylePatchRequest,
  StylePatchResult,
  TerminalCreateRequest,
  TerminalPushMessage,
} from "../shared/ipc";
import {
  AUTH_IPC,
  BROWSER_IPC,
  EXTENSION_IPC,
  FS_IPC,
  GIT_IPC,
  INSPECTOR_FLOAT_IPC,
  MCP_IPC,
  PI_IPC,
  PROC_IPC,
  PROJECT_IPC,
  SESSION_IPC,
  SETTINGS_IPC,
  TERMINAL_IPC,
  WINDOW_IPC,
} from "../shared/ipc";
import type {
  NotificationPushMessage,
  SystemToastActivated,
  SystemToastRequest,
} from "../shared/notification";
import { NOTIFICATION_IPC } from "../shared/notification";
import type {
  RunNowOutcome,
  ScheduledTask,
  SchedulerSnapshot,
  SchedulerTaskInput,
} from "../shared/scheduler";
import { SCHEDULER_IPC } from "../shared/scheduler";
import type { UpdateStatus } from "../shared/update";
import { UPDATE_IPC } from "../shared/update";
import type { UsageQuery, UsageReport } from "../shared/usage";
import { USAGE_IPC } from "../shared/usage";
import type { ExtensionViewPush, ViewEvent } from "../shared/view";
import { VIEW_IPC } from "../shared/view";

/**
 * 预加载白名单 API，命名空间 window.pidesk。
 * 渲染层可用接口必须在此定义并同步到 src/renderer/global.d.ts。
 */

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld("pidesk", {
  window: {
    /** 最小化窗口。 */
    minimize: (): Promise<IpcResult<null>> => ipcRenderer.invoke(WINDOW_IPC.minimize),
    /** 切换最大化/还原，返回切换后的最大化状态。 */
    toggleMaximize: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(WINDOW_IPC.toggleMaximize),
    /** 关闭窗口。 */
    close: (): Promise<IpcResult<null>> => ipcRenderer.invoke(WINDOW_IPC.close),
    /** 查询当前是否最大化。 */
    isMaximized: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(WINDOW_IPC.getState),
    /** 订阅最大化状态变化（含双击拖拽区等系统触发的场景）。 */
    onWindowStateChange: (callback: (isMaximized: boolean) => void): (() => void) =>
      subscribe<boolean>(WINDOW_IPC.stateChanged, callback),
    /** 用系统默认浏览器打开 http(s) 外链。 */
    openExternal: (url: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(WINDOW_IPC.openExternal, { url }),
  },

  inspectorFloat: {
    /** 打开检查器浮窗（可选携带 handoff 草稿）。 */
    open: (handoff?: InspectorFloatHandoff | null): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.open, { handoff: handoff ?? null }),
    /** 停靠回主窗（可选交回 handoff）。 */
    dock: (handoff?: InspectorFloatHandoff | null): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.dock, { handoff: handoff ?? null }),
    /** 聚焦已打开的浮窗。 */
    focus: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.focus),
    /** 浮窗就绪后取走 handoff。 */
    takeHandoff: (): Promise<IpcResult<InspectorFloatHandoff | null>> =>
      ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.takeHandoff),
    /** 浮窗主动交回 handoff（关闭/停靠前）。 */
    returnHandoff: (handoff: InspectorFloatHandoff | null): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.returnHandoff, { handoff }),
    /** 订阅「请立刻交回 handoff」（点窗口 X）。 */
    onRequestReturn: (callback: () => void): (() => void) =>
      subscribe<void>(INSPECTOR_FLOAT_IPC.requestReturn, () => callback()),
    /** 订阅「请停靠回主窗」。 */
    onRequestDock: (callback: () => void): (() => void) =>
      subscribe<void>(INSPECTOR_FLOAT_IPC.requestDock, () => callback()),
    /** 请求浮窗自行停靠（主窗占位条）。 */
    requestDock: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.dock, { handoff: null, fromHost: true }),
    /** 浮窗「加入对话」：主窗走 pickConfirm 写入会话芯片。 */
    chatAdd: (): Promise<IpcResult<null>> => ipcRenderer.invoke(INSPECTOR_FLOAT_IPC.chatAdd),
    /** 订阅浮窗开/关（主窗占位条）。 */
    onState: (callback: (message: InspectorFloatStateMessage) => void): (() => void) =>
      subscribe<InspectorFloatStateMessage>(INSPECTOR_FLOAT_IPC.state, callback),
  },

  settings: {
    get: (): Promise<IpcResult<PideskSettings>> => ipcRenderer.invoke(SETTINGS_IPC.get),
    /** 合并更新设置，返回更新后的完整设置。 */
    set: (patch: Partial<PideskSettings>): Promise<IpcResult<PideskSettings>> =>
      ipcRenderer.invoke(SETTINGS_IPC.set, patch),
  },

  notification: {
    /** 订阅主进程推送的提示音播放请求（扩展 SDK notify，docs/design/18）。 */
    onPlay: (callback: (message: NotificationPushMessage) => void): (() => void) =>
      subscribe<NotificationPushMessage>(NOTIFICATION_IPC.output, callback),
    /** 请求展示系统桌面 toast；返回是否实际弹出（docs/design/24）。 */
    showToast: (req: SystemToastRequest): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(NOTIFICATION_IPC.showToast, req),
    /** 订阅 toast 点击（主进程已聚焦窗口，渲染层负责切会话）。 */
    onActivated: (callback: (payload: SystemToastActivated) => void): (() => void) =>
      subscribe<SystemToastActivated>(NOTIFICATION_IPC.activated, callback),
  },

  project: {
    /** 打开系统文件夹选择器；取消返回 null。defaultPath 为空时落到 PiDeskProjects。 */
    pick: (defaultPath?: string | null): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke(PROJECT_IPC.pick, {
        defaultPath: defaultPath ?? null,
      }),
  },

  pi: {
    /** 读取 pi 版本与默认模型配置；path 用于设置页校验候选路径。 */
    info: (path?: string | null): Promise<IpcResult<PiInfo>> =>
      ipcRenderer.invoke(PI_IPC.info, { path: path ?? null }),
    shell: {
      /** 探测 pi 将使用的 bash（按 pi 查找顺序）。 */
      get: (): Promise<IpcResult<PiShellProbe>> => ipcRenderer.invoke(PI_IPC.shellGet),
      /** 写入 / 清除 pi 自身的 shellPath 配置；path 为 null 表示清除。 */
      set: (path: string | null): Promise<IpcResult<PiShellProbe>> =>
        ipcRenderer.invoke(PI_IPC.shellSet, { path }),
    },
    auth: {
      /** 读取命名凭据列表（密钥掩码；同 provider 可多条）。 */
      list: (): Promise<IpcResult<PiAuthSnapshot>> => ipcRenderer.invoke(AUTH_IPC.list),
      /** 常见 API Key provider 选项。 */
      listApiKeyProviders: (): Promise<IpcResult<PiApiKeyProviderOption[]>> =>
        ipcRenderer.invoke(AUTH_IPC.listApiKeyProviders),
      /** 新增 / 更新命名凭据。 */
      upsert: (req: {
        id?: string | null;
        name: string;
        provider: string;
        apiKey?: string | null;
        baseUrl?: string | null;
        api?: string | null;
        preferredModel?: string | null;
      }): Promise<IpcResult<PiAuthSnapshot>> => ipcRenderer.invoke(AUTH_IPC.upsert, req),
      /** 激活凭据（写入 auth.json 标准键 + pi defaultProvider）。 */
      setActive: (id: string): Promise<IpcResult<PiAuthSnapshot>> =>
        ipcRenderer.invoke(AUTH_IPC.setActive, { id }),
      /** 移除命名凭据。 */
      remove: (id: string): Promise<IpcResult<PiAuthSnapshot>> =>
        ipcRenderer.invoke(AUTH_IPC.remove, { id }),
    },
  },

  mcp: {
    /** 读取用户级 mcp.json 快照（~/.pi/agent/mcp.json）。 */
    list: (): Promise<IpcResult<McpConfigSnapshot>> => ipcRenderer.invoke(MCP_IPC.list),
    /** 探测真实连接状态（`pi mcp list --json`，连接所有 server，可能较慢）；cwd 供读取项目级配置。 */
    probe: (req?: McpProbeRequest): Promise<IpcResult<McpProbeResult>> =>
      ipcRenderer.invoke(MCP_IPC.probe, req ?? {}),
    /** 新增 / 更新一条用户级 server（previousName 存在且与 name 不同 = 重命名）。 */
    save: (req: McpSaveServerRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(MCP_IPC.save, req),
    /** 删除一条用户级 server。 */
    remove: (name: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(MCP_IPC.remove, { name }),
    /** 经活跃会话 RPC 执行 /mcp login|logout|reconnect。 */
    sessionCommand: (req: McpSessionCommandRequest): Promise<IpcResult<{ sessionId: SessionId }>> =>
      ipcRenderer.invoke(MCP_IPC.sessionCommand, req),
    /** 重载活跃会话（switch_session 切回同一会话文件，保留对话）。 */
    reloadSessions: (sessionIds?: SessionId[]): Promise<IpcResult<McpReloadResult>> =>
      ipcRenderer.invoke(MCP_IPC.reloadSessions, { sessionIds }),
    /** 读取 pi 版本与内置 MCP 支持状态（旧版 pi 优雅降级）。 */
    getPiSupport: (): Promise<IpcResult<McpPiSupport>> => ipcRenderer.invoke(MCP_IPC.getPiSupport),
    /** MCP 市场搜索：空 query 走内置精选清单，非空走官方注册表（docs/design/41）。 */
    marketSearch: (req: McpMarketSearchRequest): Promise<IpcResult<McpMarketSearchResult>> =>
      ipcRenderer.invoke(MCP_IPC.marketSearch, req),
  },

  session: {
    /**
     * 启动 pi RPC 进程。
     * 同 sessionFile 存活实例复用（返回既有 SessionId）；否则新建实例。
     * 常驻到手动 dispose / 应用退出，切换视图不杀进程。
     */
    start: (req: SessionStartRequest): Promise<IpcResult<SessionId>> =>
      ipcRenderer.invoke(SESSION_IPC.start, req),
    /** 提交用户输入（RPC prompt）。 */
    prompt: (req: SessionPromptRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SESSION_IPC.prompt, req),
    /** 中断指定会话（RPC abort）。 */
    stop: (sessionId: SessionId): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SESSION_IPC.stop, { sessionId }),
    /** 结束指定会话的 pi 进程（历史 JSONL 保留）。 */
    dispose: (sessionId: SessionId): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SESSION_IPC.dispose, { sessionId }),
    /** 读取项目目录的 pi 会话历史。 */
    list: (cwd: string): Promise<IpcResult<SessionSummary[]>> =>
      ipcRenderer.invoke(SESSION_IPC.list, { cwd }),
    /** 读取全部 pi 会话历史（含各会话工作目录）。 */
    listAll: (): Promise<IpcResult<SessionSummary[]>> => ipcRenderer.invoke(SESSION_IPC.listAll),
    /** 读取指定会话消息（RPC get_messages）。 */
    messages: (sessionId: SessionId): Promise<IpcResult<PiChatMessage[]>> =>
      ipcRenderer.invoke(SESSION_IPC.messages, { sessionId }),
    /** 移除历史会话（会话 JSONL 文件移入系统回收站）。 */
    remove: (file: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SESSION_IPC.remove, { file }),
    /** 读取会话 JSONL 转为消息数组（磁盘优先展示，不依赖 pi 进程）。 */
    readTranscript: (file: string): Promise<IpcResult<SessionTranscriptPayload>> =>
      ipcRenderer.invoke(SESSION_IPC.readTranscript, { file }),
    /** 读取 pi 可用斜杠命令（按 sessionId 路由；未启动返回空）。 */
    getCommands: (sessionId: SessionId): Promise<IpcResult<PiSlashCommand[]>> =>
      ipcRenderer.invoke(SESSION_IPC.getCommands, { sessionId }),
    /** 设置思考档位（仅作用于目标 sessionId）。 */
    setThinkingLevel: (req: SessionSetThinkingLevelRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SESSION_IPC.setThinkingLevel, req),
    /** 读取目标会话的模型与思考档位（未启动时回退 pi 配置，不读其它实例）。 */
    getModelState: (sessionId: SessionId): Promise<IpcResult<PiModelState>> =>
      ipcRenderer.invoke(SESSION_IPC.getModelState, { sessionId }),
    /** 切换模型（目标会话存活时 RPC set_model，并写入 pi settings 默认模型）。 */
    setModel: (req: SessionSetModelRequest): Promise<IpcResult<PiModelOption>> =>
      ipcRenderer.invoke(SESSION_IPC.setModel, req),
    /** 读取可用模型列表（force 时短连；否则钉死 sessionId）。 */
    getModels: (req?: SessionGetModelsRequest): Promise<IpcResult<PiModelOption[]>> =>
      ipcRenderer.invoke(SESSION_IPC.getModels, req),
    /** 仅写入 pi settings 默认模型。 */
    setDefaultModel: (req: { provider: string; modelId: string }): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SESSION_IPC.setDefaultModel, req),
    /** 读取会话用量统计（RPC get_session_stats，上下文占用）。 */
    getStats: (sessionId: SessionId): Promise<IpcResult<PiSessionStats>> =>
      ipcRenderer.invoke(SESSION_IPC.getStats, { sessionId }),
    /** 订阅会话事件流 `{ sessionId, type: "event" | "eventBatch" | "exit" | "error", payload }`。 */
    onOutput: (callback: (message: SessionPushMessage) => void): (() => void) =>
      subscribe<SessionPushMessage>(SESSION_IPC.output, callback),
  },

  proc: {
    /** 列出该会话后台进程登记项。 */
    list: (sessionId: SessionId): Promise<IpcResult<ManagedProcess[]>> =>
      ipcRenderer.invoke(PROC_IPC.list, { sessionId }),
    /** 停止单个登记项。 */
    stop: (id: string): Promise<IpcResult<ProcStopResult>> =>
      ipcRenderer.invoke(PROC_IPC.stop, { id }),
    /** 标记忽略，本 session 不再展示。 */
    ignore: (id: string): Promise<IpcResult<ManagedProcess | null>> =>
      ipcRenderer.invoke(PROC_IPC.ignore, { id }),
    /** 批量停止该会话全部存活登记项。 */
    stopAll: (sessionId: SessionId): Promise<IpcResult<ProcStopAllResult>> =>
      ipcRenderer.invoke(PROC_IPC.stopAll, { sessionId }),
    /** 订阅登记/状态变化（约 200ms 合批）。 */
    onChanged: (callback: (message: ProcPushMessage) => void): (() => void) =>
      subscribe<ProcPushMessage>(PROC_IPC.changed, callback),
    /** 消费上次非正常退出的残留提示（一次即 false）。 */
    residualNotice: (): Promise<IpcResult<boolean>> => ipcRenderer.invoke(PROC_IPC.residualNotice),
  },

  terminal: {
    create: (req: TerminalCreateRequest): Promise<IpcResult<string>> =>
      ipcRenderer.invoke(TERMINAL_IPC.create, req),
    input: (id: string, data: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(TERMINAL_IPC.input, { id, data }),
    resize: (id: string, cols: number, rows: number): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(TERMINAL_IPC.resize, { id, cols, rows }),
    dispose: (id: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(TERMINAL_IPC.dispose, { id }),
    /** 订阅终端流式输出（含实例 id）。 */
    onOutput: (callback: (message: TerminalPushMessage) => void): (() => void) =>
      subscribe<TerminalPushMessage>(TERMINAL_IPC.output, callback),
  },

  fs: {
    list: (dir: string): Promise<IpcResult<FsListResult>> =>
      ipcRenderer.invoke(FS_IPC.list, { dir }),
    read: (path: string): Promise<IpcResult<FsReadResult>> =>
      ipcRenderer.invoke(FS_IPC.read, { path }),
    search: (dir: string, query: string): Promise<IpcResult<FsSearchHit[]>> =>
      ipcRenderer.invoke(FS_IPC.search, { dir, query }),
    /** 系统文件选择器；取消返回 null。 */
    pickFile: (): Promise<IpcResult<string | null>> => ipcRenderer.invoke(FS_IPC.pickFile),
    /** 在系统文件管理器中打开目录（项目目录 / 会话工作目录）。 */
    openPath: (dir: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(FS_IPC.openPath, { dir }),
    /** 把 data URL 图片存到系统「下载」目录（lightbox 右键「保存图片」）。 */
    saveImageToDownloads: (req: FsSaveImageRequest): Promise<IpcResult<FsSaveImageResult>> =>
      ipcRenderer.invoke(FS_IPC.saveImageToDownloads, req),
    /** 订阅目录变动（引用计数 +1）；仅监听文件树中已展开的目录。 */
    watch: (dir: string): Promise<IpcResult<null>> => ipcRenderer.invoke(FS_IPC.watch, { dir }),
    /** 退订目录变动（引用计数 -1）。 */
    unwatch: (dir: string): Promise<IpcResult<null>> => ipcRenderer.invoke(FS_IPC.unwatch, { dir }),
    /** 订阅目录变动推送（受影响目录集合，已合批）。 */
    onChanged: (callback: (message: FsWatchPushMessage) => void): (() => void) =>
      subscribe<FsWatchPushMessage>(FS_IPC.changed, callback),
    /**
     * File → 本地绝对路径（docs/design/25）。
     * Electron 32+ 已移除 `File.path`，必须走 `webUtils.getPathForFile`；
     * 无本地路径时返回空串（如纯内存 Blob）。
     */
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  git: {
    /** 读取仓库状态与变更列表（staged / unstaged / untracked）。 */
    status: (cwd: string): Promise<IpcResult<GitStatusResult>> =>
      ipcRenderer.invoke(GIT_IPC.status, { cwd }),
    /** 读取单个文件 diff（按 layer 决定基线）。 */
    diff: (req: GitDiffRequest): Promise<IpcResult<GitFileDiff>> =>
      ipcRenderer.invoke(GIT_IPC.diff, req),
    /** 拍摄工作区完整快照（含未跟踪），返回 tree OID。 */
    snapshot: (cwd: string): Promise<IpcResult<GitSnapshotResult>> =>
      ipcRenderer.invoke(GIT_IPC.snapshot, { cwd }),
    /** 将指定路径还原到快照时刻。 */
    rollback: (req: GitRollbackRequest): Promise<IpcResult<GitRollbackResult>> =>
      ipcRenderer.invoke(GIT_IPC.rollback, req),
    /** 对比工作区路径与指定快照。 */
    compareSnapshot: (
      req: GitCompareSnapshotRequest,
    ): Promise<IpcResult<GitCompareSnapshotResult>> =>
      ipcRenderer.invoke(GIT_IPC.compareSnapshot, req),
    /** 列出本地分支 + 当前分支 + 未提交变更数。 */
    branches: (cwd: string): Promise<IpcResult<GitBranchesResult>> =>
      ipcRenderer.invoke(GIT_IPC.branches, { cwd }),
    /** 检出分支（可选先创建）。 */
    checkout: (req: GitCheckoutRequest): Promise<IpcResult<GitBranchesResult>> =>
      ipcRenderer.invoke(GIT_IPC.checkout, req),
    /** 读取提交图（只读 log）。 */
    log: (req: GitLogRequest): Promise<IpcResult<GitLogResult>> =>
      ipcRenderer.invoke(GIT_IPC.log, req),
    /** 暂存指定路径。 */
    stage: (req: GitStageRequest): Promise<IpcResult<GitWriteResult>> =>
      ipcRenderer.invoke(GIT_IPC.stage, req),
    /** 取消暂存指定路径。 */
    unstage: (req: GitStageRequest): Promise<IpcResult<GitWriteResult>> =>
      ipcRenderer.invoke(GIT_IPC.unstage, req),
    /** 丢弃指定路径的本地改动（破坏性）。 */
    discard: (req: GitDiscardRequest): Promise<IpcResult<GitDiscardResult>> =>
      ipcRenderer.invoke(GIT_IPC.discard, req),
    /** 提交已暂存改动。 */
    commit: (req: GitCommitRequest): Promise<IpcResult<GitCommitResult>> =>
      ipcRenderer.invoke(GIT_IPC.commit, req),
    /** 读取推送计划（remote / branch / 领先提交数）。 */
    pushPlan: (cwd: string): Promise<IpcResult<GitPushPlan>> =>
      ipcRenderer.invoke(GIT_IPC.pushPlan, { cwd }),
    /** 推送当前分支到远程。 */
    push: (req: GitPushRequest): Promise<IpcResult<GitPushResult>> =>
      ipcRenderer.invoke(GIT_IPC.push, req),
  },

  browser: {
    /** 地址导航（自动补全 scheme）。 */
    navigate: (req: BrowserNavigateRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.navigate, req),
    /** 在侧栏浏览器中打开本地 HTML 文件（file:// 专用通道，主进程校验）。 */
    openLocalFile: (req: BrowserOpenLocalFileRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.openLocalFile, req),
    reload: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.reload),
    back: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.back),
    forward: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.forward),
    stop: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.stop),
    /** 用系统默认浏览器打开当前 URL。 */
    openExternal: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.openExternal),
    /** 视口截图（PNG base64 + 落盘路径）。 */
    screenshot: (): Promise<IpcResult<BrowserScreenshotResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.screenshot),
    /** 进入 / 退出元素拾取会话。 */
    pickStart: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.pickStart),
    pickStop: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.pickStop),
    /** 拾取会话内切换子模式（圈选 / 浏览）。 */
    setPickMode: (req: BrowserPickModeRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.setPickMode, req),
    /** 检查器只读三件套（入参为该元素采集时的 nodeId）。 */
    inspectStyles: (req: InspectorNodeRequest): Promise<IpcResult<InspectorStyleData>> =>
      ipcRenderer.invoke(BROWSER_IPC.inspectStyles, req),
    inspectBoxModel: (req: InspectorNodeRequest): Promise<IpcResult<InspectorBoxModel>> =>
      ipcRenderer.invoke(BROWSER_IPC.inspectBoxModel, req),
    inspectDomTree: (req: InspectorNodeRequest): Promise<IpcResult<InspectorDomTree>> =>
      ipcRenderer.invoke(BROWSER_IPC.inspectDomTree, req),
    /** 样式热更改：全量替换某 selector 的调整声明。 */
    stylePatch: (req: StylePatchRequest): Promise<IpcResult<StylePatchResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.stylePatch, req),
    /** 清除调整（selector=null 清空全部）。 */
    stylePatchClear: (req: StylePatchClearRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.stylePatchClear, req),
    /** 导出调整为 CSS 文本。 */
    stylePatchExport: (req: StylePatchExportRequest): Promise<IpcResult<StylePatchExportResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.stylePatchExport, req),
    /** 同步面板宿主区域 bounds 与可见性（WebContentsView 主进程定位）。 */
    setBounds: (req: BrowserBoundsRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.setBounds, req),
    /** 响应式视口宽度（null=跟随面板宽度）。 */
    setViewport: (req: BrowserViewportRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.setViewport, req),
    /** 忽略缓存强制刷新。 */
    forceReload: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.forceReload),
    /** 打开页面 DevTools（独立窗口）。 */
    openDevTools: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.openDevTools),
    /** 页面缩放（1 = 100%）。 */
    setZoom: (req: BrowserZoomRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.setZoom, req),
    /** 清除 persist:browser 分区 Cookie。 */
    clearCookies: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.clearCookies),
    /** 清除 persist:browser 分区 HTTP 缓存。 */
    clearCache: (): Promise<IpcResult<null>> => ipcRenderer.invoke(BROWSER_IPC.clearCache),
    /** 手动粘贴 Cookie 导入 persist:browser（docs/design/09 M1）。 */
    applyPastedCookies: (
      req: BrowserApplyPastedCookiesRequest,
    ): Promise<IpcResult<BrowserApplyPastedCookiesResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.applyPastedCookies, req),
    /** 列出本机 Chromium Profile（docs/design/09 M2）。 */
    listLoginSources: (): Promise<IpcResult<BrowserLoginSource[]>> =>
      ipcRenderer.invoke(BROWSER_IPC.listLoginSources),
    /** 预览将导入的 Cookie 名称（不含 value）。 */
    previewLoginCookies: (
      req: BrowserPreviewLoginCookiesRequest,
    ): Promise<IpcResult<BrowserPreviewLoginCookiesResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.previewLoginCookies, req),
    /** 从本机浏览器读取并写入 persist:browser。 */
    applyLoginCookies: (
      req: BrowserApplyLoginCookiesRequest,
    ): Promise<IpcResult<BrowserApplyLoginCookiesResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.applyLoginCookies, req),
    /** 全量导入本机浏览器数据（Cookie + 可选 LocalStorage，docs/design/42 §6.6）。 */
    importLoginData: (
      req: BrowserImportLoginDataRequest,
    ): Promise<IpcResult<BrowserImportLoginDataResult>> =>
      ipcRenderer.invoke(BROWSER_IPC.importLoginData, req),
    /** 仅截取当前页冻结帧（视图仍可见）。 */
    captureOverlayFreeze: (): Promise<IpcResult<{ freeze: string | null }>> =>
      ipcRenderer.invoke(BROWSER_IPC.captureOverlayFreeze),
    /** 临时隐藏页面视图（区域截图 / 设置浮窗 / 更多菜单等）。 */
    setOverlaySuppressed: (req: BrowserOverlaySuppressedRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.setOverlaySuppressed, req),
    /** 将渲染层裁剪好的 PNG base64 落盘。 */
    saveScreenshot: (req: BrowserSaveScreenshotRequest): Promise<IpcResult<{ path: string }>> =>
      ipcRenderer.invoke(BROWSER_IPC.saveScreenshot, req),
    /** 新建浏览器页面实例，返回实例 id。 */
    createInstance: (): Promise<IpcResult<{ id: string }>> =>
      ipcRenderer.invoke(BROWSER_IPC.createInstance),
    /** 关闭指定浏览器页面实例。 */
    closeInstance: (req: BrowserCloseInstanceRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.closeInstance, req),
    /** 切换当前活跃的浏览器页面实例。 */
    setActiveInstance: (req: BrowserSetActiveInstanceRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(BROWSER_IPC.setActiveInstance, req),
    /** 列出全部浏览器页面实例。 */
    listInstances: (): Promise<IpcResult<BrowserInstanceInfo[]>> =>
      ipcRenderer.invoke(BROWSER_IPC.listInstances),
    /** 订阅浏览器推送（navigated / picked / console / error / loading / pick / inspectInvalidated）。 */
    onOutput: (callback: (message: BrowserPushMessage) => void): (() => void) =>
      subscribe<BrowserPushMessage>(BROWSER_IPC.output, callback),
  },

  extension: {
    /** 读取 pi packages 快照（全局 + 项目 + 本地资源目录）。 */
    list: (projectDir?: string | null): Promise<IpcResult<PiPackagesSnapshot>> =>
      ipcRenderer.invoke(EXTENSION_IPC.list, {
        projectDir: projectDir ?? null,
      }),
    /** 安装 package（spawn `pi install`）。 */
    install: (req: PiPackageInstallRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(EXTENSION_IPC.install, req),
    /** 卸载 package（spawn `pi remove`）。 */
    remove: (req: PiPackageRemoveRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(EXTENSION_IPC.remove, req),
    /** 启停 package（写 settings.packages）。 */
    setEnabled: (req: PiPackageSetEnabledRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(EXTENSION_IPC.setEnabled, req),
    /** 包内单资源启停。 */
    setResourceEnabled: (req: PiPackageSetResourceEnabledRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(EXTENSION_IPC.setResourceEnabled, req),
    /** 订阅安装/卸载子进程日志。 */
    onOutput: (callback: (message: ExtensionPushMessage) => void): (() => void) =>
      subscribe<ExtensionPushMessage>(EXTENSION_IPC.output, callback),
  },

  catalog: {
    /** 读取 Contribution Catalog 快照（冷态能力发现，不 spawn pi）。 */
    list: (projectDir?: string | null): Promise<IpcResult<ContributionCatalogSnapshot>> =>
      ipcRenderer.invoke(CATALOG_IPC.list, { projectDir: projectDir ?? null }),
    /** 强制重扫 Catalog。 */
    refresh: (projectDir?: string | null): Promise<IpcResult<ContributionCatalogSnapshot>> =>
      ipcRenderer.invoke(CATALOG_IPC.refresh, {
        projectDir: projectDir ?? null,
      }),
    /** 订阅 Catalog 变化推送。 */
    onChanged: (callback: (snapshot: ContributionCatalogSnapshot) => void): (() => void) =>
      subscribe<ContributionCatalogSnapshot>(CATALOG_IPC.changed, callback),
  },

  runtime: {
    /** 读取主进程权威 runtime 快照（Renderer reload 对账）。 */
    snapshot: (): Promise<IpcResult<SessionRuntimeSnapshot[]>> =>
      ipcRenderer.invoke(RUNTIME_IPC.snapshot),
    /** 订阅 runtime 变化推送。 */
    onChanged: (callback: (snapshot: SessionRuntimeSnapshot) => void): (() => void) =>
      subscribe<SessionRuntimeSnapshot>(RUNTIME_IPC.changed, callback),
  },

  worker: {
    /** 设置「来自扩展」打开时获取 Worker lease。 */
    acquire: (): Promise<IpcResult<WorkerAcquireResult>> => ipcRenderer.invoke(WORKER_IPC.acquire),
    /** 关闭设置后释放 lease。 */
    release: (): Promise<IpcResult<ExtensionWorkerStatus>> =>
      ipcRenderer.invoke(WORKER_IPC.release),
    status: (): Promise<IpcResult<ExtensionWorkerStatus>> => ipcRenderer.invoke(WORKER_IPC.status),
  },

  scheduler: {
    /** 读取全量快照（任务 + 运行台账）。 */
    list: (): Promise<IpcResult<SchedulerSnapshot>> => ipcRenderer.invoke(SCHEDULER_IPC.list),
    /** 新建任务（主进程校验并推导下次触发时刻）。 */
    create: (input: SchedulerTaskInput): Promise<IpcResult<ScheduledTask>> =>
      ipcRenderer.invoke(SCHEDULER_IPC.create, input),
    /** 更新任务（按 id 覆盖输入字段）。 */
    update: (id: string, patch: SchedulerTaskInput): Promise<IpcResult<ScheduledTask>> =>
      ipcRenderer.invoke(SCHEDULER_IPC.update, { id, patch }),
    /** 删除任务及其运行台账。 */
    remove: (id: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(SCHEDULER_IPC.remove, { id }),
    /** 启停任务；重新启用不做错过补跑，从现在起算下一轮。 */
    setEnabled: (id: string, enabled: boolean): Promise<IpcResult<ScheduledTask>> =>
      ipcRenderer.invoke(SCHEDULER_IPC.setEnabled, { id, enabled }),
    /** 立即运行一次；派发结果异步回到台账（onChanged）。 */
    runNow: (id: string): Promise<IpcResult<RunNowOutcome>> =>
      ipcRenderer.invoke(SCHEDULER_IPC.runNow, { id }),
    /** 订阅快照变化推送（任务增删改、触发、补跑、台账更新）。 */
    onChanged: (callback: (snapshot: SchedulerSnapshot) => void): (() => void) =>
      subscribe<SchedulerSnapshot>(SCHEDULER_IPC.changed, callback),
  },

  prefetch: {
    metrics: (): Promise<IpcResult<PrefetchMetrics>> => ipcRenderer.invoke(PREFETCH_IPC.metrics),
    notifyActive: (req: PrefetchNotifyRequest): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(PREFETCH_IPC.notifyActive, req),
  },

  usage: {
    /** 查询用量报表（扫描 pi 会话 JSONL 聚合；since/project 过滤，granularity 覆盖分桶粒度）。 */
    query: (req: UsageQuery): Promise<IpcResult<UsageReport>> =>
      ipcRenderer.invoke(USAGE_IPC.query, req),
  },

  update: {
    /** `app.getVersion()`（与安装包 package.json version 一致）。 */
    getVersion: (): Promise<IpcResult<string>> => ipcRenderer.invoke(UPDATE_IPC.getVersion),
    /** 手动检查更新（开发模式走 GitHub API）。 */
    check: (): Promise<IpcResult<UpdateStatus>> => ipcRenderer.invoke(UPDATE_IPC.check),
    /** 下载更新安装包（仅打包环境）。 */
    download: (): Promise<IpcResult<UpdateStatus>> => ipcRenderer.invoke(UPDATE_IPC.download),
    /** 退出并安装（需已下载）。 */
    install: (): Promise<IpcResult<null>> => ipcRenderer.invoke(UPDATE_IPC.install),
    /** 当前状态快照。 */
    getStatus: (): Promise<IpcResult<UpdateStatus>> => ipcRenderer.invoke(UPDATE_IPC.getStatus),
    /** 订阅状态迁移与下载进度。 */
    onStatus: (callback: (status: UpdateStatus) => void): (() => void) =>
      subscribe<UpdateStatus>(UPDATE_IPC.status, callback),
  },

  github: {
    /** 启动 Device Flow，返回验证码信息（docs/design/36）。 */
    deviceStart: (): Promise<IpcResult<GitHubDeviceStart>> =>
      ipcRenderer.invoke(GITHUB_IPC.deviceStart),
    deviceCancel: (): Promise<IpcResult<null>> => ipcRenderer.invoke(GITHUB_IPC.deviceCancel),
    /** 订阅 Device Flow 状态（pending / authorized / failed…）。 */
    onDeviceStatus: (callback: (status: GitHubDeviceStatus) => void): (() => void) =>
      subscribe<GitHubDeviceStatus>(GITHUB_IPC.deviceStatus, callback),
    getAuth: (): Promise<IpcResult<GitHubAuthState>> => ipcRenderer.invoke(GITHUB_IPC.getAuth),
    logout: (): Promise<IpcResult<GitHubAuthState>> => ipcRenderer.invoke(GITHUB_IPC.logout),
    syncPush: (): Promise<IpcResult<GitHubSyncResult>> => ipcRenderer.invoke(GITHUB_IPC.syncPush),
    syncPull: (options?: { force?: boolean }): Promise<IpcResult<GitHubSyncResult>> =>
      ipcRenderer.invoke(GITHUB_IPC.syncPull, options ?? {}),
    /** 下载前差异预览（不写本地）。 */
    syncPreview: (): Promise<IpcResult<GitHubSyncPreview>> =>
      ipcRenderer.invoke(GITHUB_IPC.syncPreview),
  },

  view: {
    /** 订阅扩展视图 open / update / closed 推送。 */
    onOutput: (callback: (message: ExtensionViewPush) => void): (() => void) =>
      subscribe<ExtensionViewPush>(VIEW_IPC.output, callback),
    /** 回写用户事件（change / action / dismiss）到对应 Client。 */
    sendEvent: (req: { id: string; event: ViewEvent }): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(VIEW_IPC.sendEvent, req),
    /** 原子激活 Catalog Contribution（冷态入口 → live → 确认）。 */
    activateContribution: (
      req: ActivateContributionRequest,
    ): Promise<IpcResult<ActivateContributionResult>> =>
      ipcRenderer.invoke(VIEW_IPC.activateContribution, req),
  },
});
