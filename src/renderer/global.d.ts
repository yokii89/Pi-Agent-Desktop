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
import type {
  GitHubAuthState,
  GitHubDeviceStart,
  GitHubDeviceStatus,
  GitHubSyncPreview,
  GitHubSyncResult,
} from "../shared/github";
import type {
  BrowserApplyLoginCookiesRequest,
  BrowserApplyLoginCookiesResult,
  BrowserApplyPastedCookiesRequest,
  BrowserApplyPastedCookiesResult,
  BrowserBoundsRequest,
  BrowserCloseInstanceRequest,
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
import type {
  NotificationPushMessage,
  SystemToastActivated,
  SystemToastRequest,
} from "../shared/notification";
import type {
  RunNowOutcome,
  ScheduledTask,
  SchedulerSnapshot,
  SchedulerTaskInput,
} from "../shared/scheduler";
import type { UpdateStatus } from "../shared/update";
import type { UsageQuery, UsageReport } from "../shared/usage";
import type { ExtensionViewPush, ViewEvent } from "../shared/view";

/** 渲染层可用的预加载白名单 API（与 src/preload/index.ts 保持同步）。 */
export interface PideskGlobalApi {
  window: {
    minimize(): Promise<IpcResult<null>>;
    toggleMaximize(): Promise<IpcResult<boolean>>;
    close(): Promise<IpcResult<null>>;
    isMaximized(): Promise<IpcResult<boolean>>;
    onWindowStateChange(callback: (isMaximized: boolean) => void): () => void;
    openExternal(url: string): Promise<IpcResult<null>>;
  };
  inspectorFloat: {
    open(handoff?: InspectorFloatHandoff | null): Promise<IpcResult<boolean>>;
    dock(handoff?: InspectorFloatHandoff | null): Promise<IpcResult<null>>;
    /** 主窗占位条：请求浮窗自行停靠（交回草稿后关闭）。 */
    requestDock(): Promise<IpcResult<boolean>>;
    focus(): Promise<IpcResult<boolean>>;
    takeHandoff(): Promise<IpcResult<InspectorFloatHandoff | null>>;
    returnHandoff(handoff: InspectorFloatHandoff | null): Promise<IpcResult<null>>;
    onRequestReturn(callback: () => void): () => void;
    onRequestDock(callback: () => void): () => void;
    chatAdd(): Promise<IpcResult<null>>;
    onState(callback: (message: InspectorFloatStateMessage) => void): () => void;
  };
  settings: {
    get(): Promise<IpcResult<PideskSettings>>;
    set(patch: Partial<PideskSettings>): Promise<IpcResult<PideskSettings>>;
  };
  notification: {
    /** 订阅主进程提示音播放推送（扩展 SDK）。 */
    onPlay(callback: (message: NotificationPushMessage) => void): () => void;
    /** 请求展示系统桌面 toast；返回是否实际弹出。 */
    showToast(req: SystemToastRequest): Promise<IpcResult<boolean>>;
    /** 订阅 toast 点击（主进程已聚焦窗口）。 */
    onActivated(callback: (payload: SystemToastActivated) => void): () => void;
  };
  project: {
    pick(defaultPath?: string | null): Promise<IpcResult<string | null>>;
  };
  pi: {
    info(path?: string | null): Promise<IpcResult<PiInfo>>;
    shell: {
      get(): Promise<IpcResult<PiShellProbe>>;
      set(path: string | null): Promise<IpcResult<PiShellProbe>>;
    };
    auth: {
      list(): Promise<IpcResult<PiAuthSnapshot>>;
      listApiKeyProviders(): Promise<IpcResult<PiApiKeyProviderOption[]>>;
      upsert(req: {
        id?: string | null;
        name: string;
        provider: string;
        apiKey?: string | null;
        baseUrl?: string | null;
        api?: string | null;
        preferredModel?: string | null;
      }): Promise<IpcResult<PiAuthSnapshot>>;
      setActive(id: string): Promise<IpcResult<PiAuthSnapshot>>;
      remove(id: string): Promise<IpcResult<PiAuthSnapshot>>;
    };
  };
  mcp: {
    /** 读取用户级 mcp.json 快照（~/.pi/agent/mcp.json）。 */
    list(): Promise<IpcResult<McpConfigSnapshot>>;
    /** 探测真实连接状态（`pi mcp list --json`，连接所有 server，可能较慢）；cwd 供读取项目级配置。 */
    probe(req?: McpProbeRequest): Promise<IpcResult<McpProbeResult>>;
    /** 新增 / 更新一条用户级 server（previousName 存在且与 name 不同 = 重命名）。 */
    save(req: McpSaveServerRequest): Promise<IpcResult<null>>;
    /** 删除一条用户级 server。 */
    remove(name: string): Promise<IpcResult<null>>;
    /** 经活跃会话 RPC 执行 /mcp login|logout|reconnect。 */
    sessionCommand(req: McpSessionCommandRequest): Promise<IpcResult<{ sessionId: SessionId }>>;
    /** 重载活跃会话（switch_session 切回同一会话文件，保留对话）。 */
    reloadSessions(sessionIds?: SessionId[]): Promise<IpcResult<McpReloadResult>>;
    /** 读取 pi 版本与内置 MCP 支持状态（旧版 pi 优雅降级）。 */
    getPiSupport(): Promise<IpcResult<McpPiSupport>>;
    /** MCP 市场搜索：空 query 走内置精选清单，非空走官方注册表（docs/design/41）。 */
    marketSearch(req: McpMarketSearchRequest): Promise<IpcResult<McpMarketSearchResult>>;
  };
  session: {
    start(req: SessionStartRequest): Promise<IpcResult<SessionId>>;
    prompt(req: SessionPromptRequest): Promise<IpcResult<null>>;
    stop(sessionId: SessionId): Promise<IpcResult<null>>;
    dispose(sessionId: SessionId): Promise<IpcResult<null>>;
    list(cwd: string): Promise<IpcResult<SessionSummary[]>>;
    listAll(): Promise<IpcResult<SessionSummary[]>>;
    messages(sessionId: SessionId): Promise<IpcResult<PiChatMessage[]>>;
    remove(file: string): Promise<IpcResult<null>>;
    /** 读取会话 JSONL 转为消息数组（磁盘优先展示，不依赖 pi 进程）。 */
    readTranscript(file: string): Promise<IpcResult<SessionTranscriptPayload>>;
    getCommands(sessionId: SessionId): Promise<IpcResult<PiSlashCommand[]>>;
    setThinkingLevel(req: SessionSetThinkingLevelRequest): Promise<IpcResult<null>>;
    getModelState(sessionId: SessionId): Promise<IpcResult<PiModelState>>;
    setModel(req: SessionSetModelRequest): Promise<IpcResult<PiModelOption>>;
    getModels(req?: SessionGetModelsRequest): Promise<IpcResult<PiModelOption[]>>;
    setDefaultModel(req: { provider: string; modelId: string }): Promise<IpcResult<null>>;
    /** 读取会话用量统计（RPC get_session_stats，上下文占用）。 */
    getStats(sessionId: SessionId): Promise<IpcResult<PiSessionStats>>;
    onOutput(callback: (message: SessionPushMessage) => void): () => void;
  };
  proc: {
    list(sessionId: SessionId): Promise<IpcResult<ManagedProcess[]>>;
    stop(id: string): Promise<IpcResult<ProcStopResult>>;
    ignore(id: string): Promise<IpcResult<ManagedProcess | null>>;
    stopAll(sessionId: SessionId): Promise<IpcResult<ProcStopAllResult>>;
    onChanged(callback: (message: ProcPushMessage) => void): () => void;
    residualNotice(): Promise<IpcResult<boolean>>;
  };
  terminal: {
    create(req: TerminalCreateRequest): Promise<IpcResult<string>>;
    input(id: string, data: string): Promise<IpcResult<null>>;
    resize(id: string, cols: number, rows: number): Promise<IpcResult<null>>;
    dispose(id: string): Promise<IpcResult<null>>;
    onOutput(callback: (message: TerminalPushMessage) => void): () => void;
  };
  fs: {
    list(dir: string): Promise<IpcResult<FsListResult>>;
    read(path: string): Promise<IpcResult<FsReadResult>>;
    search(dir: string, query: string): Promise<IpcResult<FsSearchHit[]>>;
    pickFile(): Promise<IpcResult<string | null>>;
    openPath(dir: string): Promise<IpcResult<null>>;
    /** 订阅目录变动（引用计数 +1）；仅监听已展开目录。 */
    watch(dir: string): Promise<IpcResult<null>>;
    /** 退订目录变动（引用计数 -1）。 */
    unwatch(dir: string): Promise<IpcResult<null>>;
    /** 订阅目录变动推送（受影响目录集合）。 */
    onChanged(callback: (message: FsWatchPushMessage) => void): () => void;
    /** File → 本地绝对路径；无路径返回空串（Electron 32+ 弃用 File.path）。 */
    pathForFile(file: File): string;
  };
  git: {
    status(cwd: string): Promise<IpcResult<GitStatusResult>>;
    diff(req: GitDiffRequest): Promise<IpcResult<GitFileDiff>>;
    snapshot(cwd: string): Promise<IpcResult<GitSnapshotResult>>;
    rollback(req: GitRollbackRequest): Promise<IpcResult<GitRollbackResult>>;
    compareSnapshot(req: GitCompareSnapshotRequest): Promise<IpcResult<GitCompareSnapshotResult>>;
    branches(cwd: string): Promise<IpcResult<GitBranchesResult>>;
    checkout(req: GitCheckoutRequest): Promise<IpcResult<GitBranchesResult>>;
    log(req: GitLogRequest): Promise<IpcResult<GitLogResult>>;
    stage(req: GitStageRequest): Promise<IpcResult<GitWriteResult>>;
    unstage(req: GitStageRequest): Promise<IpcResult<GitWriteResult>>;
    discard(req: GitDiscardRequest): Promise<IpcResult<GitDiscardResult>>;
    commit(req: GitCommitRequest): Promise<IpcResult<GitCommitResult>>;
    pushPlan(cwd: string): Promise<IpcResult<GitPushPlan>>;
    push(req: GitPushRequest): Promise<IpcResult<GitPushResult>>;
  };
  browser: {
    navigate(req: BrowserNavigateRequest): Promise<IpcResult<null>>;
    openLocalFile(req: BrowserOpenLocalFileRequest): Promise<IpcResult<null>>;
    reload(): Promise<IpcResult<null>>;
    back(): Promise<IpcResult<null>>;
    forward(): Promise<IpcResult<null>>;
    stop(): Promise<IpcResult<null>>;
    openExternal(): Promise<IpcResult<null>>;
    screenshot(): Promise<IpcResult<BrowserScreenshotResult>>;
    pickStart(): Promise<IpcResult<null>>;
    pickStop(): Promise<IpcResult<null>>;
    setPickMode(req: BrowserPickModeRequest): Promise<IpcResult<null>>;
    inspectStyles(req: InspectorNodeRequest): Promise<IpcResult<InspectorStyleData>>;
    inspectBoxModel(req: InspectorNodeRequest): Promise<IpcResult<InspectorBoxModel>>;
    inspectDomTree(req: InspectorNodeRequest): Promise<IpcResult<InspectorDomTree>>;
    stylePatch(req: StylePatchRequest): Promise<IpcResult<StylePatchResult>>;
    stylePatchClear(req: StylePatchClearRequest): Promise<IpcResult<null>>;
    stylePatchExport(req: StylePatchExportRequest): Promise<IpcResult<StylePatchExportResult>>;
    setBounds(req: BrowserBoundsRequest): Promise<IpcResult<null>>;
    setViewport(req: BrowserViewportRequest): Promise<IpcResult<null>>;
    forceReload(): Promise<IpcResult<null>>;
    openDevTools(): Promise<IpcResult<null>>;
    setZoom(req: BrowserZoomRequest): Promise<IpcResult<null>>;
    clearCookies(): Promise<IpcResult<null>>;
    clearCache(): Promise<IpcResult<null>>;
    applyPastedCookies(
      req: BrowserApplyPastedCookiesRequest,
    ): Promise<IpcResult<BrowserApplyPastedCookiesResult>>;
    listLoginSources(): Promise<IpcResult<BrowserLoginSource[]>>;
    previewLoginCookies(
      req: BrowserPreviewLoginCookiesRequest,
    ): Promise<IpcResult<BrowserPreviewLoginCookiesResult>>;
    applyLoginCookies(
      req: BrowserApplyLoginCookiesRequest,
    ): Promise<IpcResult<BrowserApplyLoginCookiesResult>>;
    captureOverlayFreeze(): Promise<IpcResult<{ freeze: string | null }>>;
    setOverlaySuppressed(req: BrowserOverlaySuppressedRequest): Promise<IpcResult<null>>;
    saveScreenshot(req: BrowserSaveScreenshotRequest): Promise<IpcResult<{ path: string }>>;
    createInstance(): Promise<IpcResult<{ id: string }>>;
    closeInstance(req: BrowserCloseInstanceRequest): Promise<IpcResult<null>>;
    setActiveInstance(req: BrowserSetActiveInstanceRequest): Promise<IpcResult<null>>;
    listInstances(): Promise<IpcResult<BrowserInstanceInfo[]>>;
    onOutput(callback: (message: BrowserPushMessage) => void): () => void;
  };
  extension: {
    list(projectDir?: string | null): Promise<IpcResult<PiPackagesSnapshot>>;
    install(req: PiPackageInstallRequest): Promise<IpcResult<null>>;
    remove(req: PiPackageRemoveRequest): Promise<IpcResult<null>>;
    setEnabled(req: PiPackageSetEnabledRequest): Promise<IpcResult<null>>;
    setResourceEnabled(req: PiPackageSetResourceEnabledRequest): Promise<IpcResult<null>>;
    onOutput(callback: (message: ExtensionPushMessage) => void): () => void;
  };
  catalog: {
    list(projectDir?: string | null): Promise<IpcResult<ContributionCatalogSnapshot>>;
    refresh(projectDir?: string | null): Promise<IpcResult<ContributionCatalogSnapshot>>;
    onChanged(callback: (snapshot: ContributionCatalogSnapshot) => void): () => void;
  };
  runtime: {
    snapshot(): Promise<IpcResult<SessionRuntimeSnapshot[]>>;
    onChanged(callback: (snapshot: SessionRuntimeSnapshot) => void): () => void;
  };
  worker: {
    acquire(): Promise<IpcResult<WorkerAcquireResult>>;
    release(): Promise<IpcResult<ExtensionWorkerStatus>>;
    status(): Promise<IpcResult<ExtensionWorkerStatus>>;
  };
  scheduler: {
    list(): Promise<IpcResult<SchedulerSnapshot>>;
    create(input: SchedulerTaskInput): Promise<IpcResult<ScheduledTask>>;
    update(id: string, patch: SchedulerTaskInput): Promise<IpcResult<ScheduledTask>>;
    remove(id: string): Promise<IpcResult<null>>;
    setEnabled(id: string, enabled: boolean): Promise<IpcResult<ScheduledTask>>;
    runNow(id: string): Promise<IpcResult<RunNowOutcome>>;
    onChanged(callback: (snapshot: SchedulerSnapshot) => void): () => void;
  };
  prefetch: {
    metrics(): Promise<IpcResult<PrefetchMetrics>>;
    notifyActive(req: PrefetchNotifyRequest): Promise<IpcResult<null>>;
  };
  usage: {
    /** 查询用量报表（扫描 pi 会话 JSONL 聚合；since 为 null 时统计全部历史）。 */
    query(req: UsageQuery): Promise<IpcResult<UsageReport>>;
  };
  update: {
    getVersion(): Promise<IpcResult<string>>;
    check(): Promise<IpcResult<UpdateStatus>>;
    download(): Promise<IpcResult<UpdateStatus>>;
    install(): Promise<IpcResult<null>>;
    getStatus(): Promise<IpcResult<UpdateStatus>>;
    onStatus(callback: (status: UpdateStatus) => void): () => void;
  };
  github: {
    deviceStart(): Promise<IpcResult<GitHubDeviceStart>>;
    deviceCancel(): Promise<IpcResult<null>>;
    onDeviceStatus(callback: (status: GitHubDeviceStatus) => void): () => void;
    getAuth(): Promise<IpcResult<GitHubAuthState>>;
    logout(): Promise<IpcResult<GitHubAuthState>>;
    syncPush(): Promise<IpcResult<GitHubSyncResult>>;
    syncPull(options?: { force?: boolean }): Promise<IpcResult<GitHubSyncResult>>;
    syncPreview(): Promise<IpcResult<GitHubSyncPreview>>;
  };
  view: {
    onOutput(callback: (message: ExtensionViewPush) => void): () => void;
    sendEvent(req: { id: string; event: ViewEvent }): Promise<IpcResult<null>>;
    activateContribution(
      req: ActivateContributionRequest,
    ): Promise<IpcResult<ActivateContributionResult>>;
  };
}

declare global {
  interface Window {
    /** contextBridge 注入的 API；preload 加载失败时为 undefined，调用方需兜底。 */
    pidesk?: PideskGlobalApi;
  }
}
