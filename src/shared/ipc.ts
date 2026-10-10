/**
 * 主进程与渲染进程共享的 IPC 类型与 channel 常量。
 * channel 命名遵循 AGENTS.md：`pidesk:<域>:<动作>`。
 */

import type { SessionStartReason } from "./contribution";
import type { FontMonoPreset, FontUiPreset } from "./fontPresets";
import type { LocalePreference } from "./i18n";
import type { NotificationSettings } from "./notification";
import type { RailStyle } from "./railStyles";
import type { ShortcutsMap } from "./shortcuts";

/** 请求-响应类 IPC 的统一返回信封。 */
export interface IpcResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errorDetails?:
    | import("./contribution").ActivateContributionFailure
    | import("./contribution").SessionLimitReachedError;
}

/** 窗口控制相关 channel。 */
export const WINDOW_IPC = {
  minimize: "pidesk:window:minimize",
  toggleMaximize: "pidesk:window:maximize",
  close: "pidesk:window:close",
  getState: "pidesk:window:getState",
  /** 主进程推送：窗口最大化状态变化，payload 为 boolean。 */
  stateChanged: "pidesk:window:stateChanged",
  /** 用系统默认浏览器打开外链（包市场等）。 */
  openExternal: "pidesk:window:openExternal",
} as const;

/** 检查器系统级浮窗（docs/design/38）：停靠 ⇄ 浮窗单一宿主 + 状态移交。 */
export const INSPECTOR_FLOAT_IPC = {
  /** 主窗请求打开浮窗，并暂存 handoff 快照。 */
  open: "pidesk:inspectorFloat:open",
  /** 浮窗请求停靠回主窗（带 handoff），或主窗强制收回。 */
  dock: "pidesk:inspectorFloat:dock",
  /** 主窗占位条：聚焦已打开的浮窗。 */
  focus: "pidesk:inspectorFloat:focus",
  /** 浮窗就绪后取走上次 handoff。 */
  takeHandoff: "pidesk:inspectorFloat:takeHandoff",
  /** 浮窗主动交回 handoff（关闭/停靠前）。 */
  returnHandoff: "pidesk:inspectorFloat:returnHandoff",
  /** 主进程推送：请浮窗立刻交回 handoff 后退出（点窗口 X）。 */
  requestReturn: "pidesk:inspectorFloat:requestReturn",
  /** 主进程推送：请浮窗停靠回主窗（交回 handoff 后关闭）。 */
  requestDock: "pidesk:inspectorFloat:requestDock",
  /** 浮窗「加入对话」意图 → 主窗 pickConfirm 路径。 */
  chatAdd: "pidesk:inspectorFloat:chatAdd",
  /** 主进程推送：浮窗开/关（主窗占位条）。payload = { open }。 */
  state: "pidesk:inspectorFloat:state",
} as const;

/** 检查器二级 tab（与 uiStore.BrowserPanelTab 同构，IPC 边界用独立别名）。 */
export type InspectorFloatTab = "pick" | "styles" | "boxModel" | "dom";

/** 单节点热更改草稿（移交用）。 */
export interface InspectorFloatNodePatch {
  nodeId: number;
  selector: string;
  declarations: StylePatchDeclaration[];
}

/** 停靠 ⇄ 浮窗移交快照：仅 UI 草稿；已写入 CSSOM 的热更不撤。 */
export interface InspectorFloatHandoff {
  tab: InspectorFloatTab;
  currentNodeId: number | null;
  navCleared: boolean;
  patches: InspectorFloatNodePatch[];
}

export interface InspectorFloatStateMessage {
  open: boolean;
  /** 关闭/停靠时随消息带回的草稿；打开时为 null。 */
  handoff?: InspectorFloatHandoff | null;
}

// ---------------------------------------------------------------------------
// 设置 / 项目
// ---------------------------------------------------------------------------

/** 项目 = 本地目录（docs/design/01 §1）。 */
export interface PideskProject {
  id: string;
  name: string;
  dir: string;
}

export type ThemeId = "dark" | "light";
export type TerminalShellKind = "powershell" | "cmd" | "gitbash";

/** 浏览器面板最近访问的一条 URL（docs/design/05 P0-5）。 */
export interface BrowserRecentUrl {
  url: string;
  /** 最近访问时间（Unix ms），用于排序。 */
  at: number;
}

/** PiDesk 用户设置（docs/design/03 §6），持久化在 userData/settings.json（不与 pi 的 ~/.pi 混放）。 */
export interface PideskSettings {
  projects: PideskProject[];
  /** 上次使用的项目，启动时恢复。 */
  lastProjectId: string | null;
  /** pi 可执行文件路径；null 时主进程从 PATH 解析。 */
  piExecutablePath: string | null;
  terminalShell: TerminalShellKind;
  theme: ThemeId;
  /** 界面语言；system 跟随 OS，否则固定 zh-CN / en-US。 */
  locale: LocalePreference;
  /** 侧边栏默认折叠。 */
  navCollapsed: boolean;
  /** 置顶的会话（JSONL 绝对路径，数组顺序即置顶顺序）；列表排序时置顶条目固定在各列表最前。 */
  pinnedSessions: string[];
  /**
   * 已归档的会话（JSONL 绝对路径 → 归档时间 Unix ms）；会话正文 JSONL 不动，仅 PiDesk 侧标记。
   * 归档与置顶互斥（归档动作会同时清 pinnedSessions）；侧栏主列表不展示归档条目，
   * 浏览 / 恢复 / 删除在设置 → 已归档对话分区进行。
   */
  archivedSessions: Record<string, number>;
  /** 会话自定义标题（JSONL 绝对路径 → 用户重命名后的标题）；未登记的会话回退到首条用户消息。 */
  sessionTitles: Record<string, string>;
  /** 浏览器面板最近访问 URL（localhost / 内网优先展示）。 */
  browserRecentUrls: BrowserRecentUrl[];
  /** 浏览器面板响应式视口宽度（px）；null 表示跟随面板宽度。 */
  browserViewportWidth: number | null;
  /** 添加/新建项目时文件夹选择器的默认起始目录；null 时落到用户目录下 PiDeskProjects。 */
  defaultProjectDir: string | null;
  /** 是否在系统托盘显示；开启后关闭窗口最小化到托盘，应用继续后台运行。 */
  showInTray: boolean;
  /** 是否启用内置浏览器面板；关闭后右栏不再显示 Browser Tab。 */
  browserEnabled: boolean;
  /**
   * 是否已同意「导入登录状态」用户须知（docs/design/09）。
   * 同意一次后，再次打开导入对话框不再展示须知首页。
   */
  browserLoginImportConsent: boolean;
  /**
   * 并行 pi 会话上限（docs/多会话并行架构方案 决策 #7）。
   * 超限时 start 失败并提示，不自动杀最旧会话。
   */
  maxParallelSessions: number;
  /**
   * 是否启用 speculative 会话预热（docs/design/16 Phase G，默认关闭）。
   * 仅在 active 会话稳定、有空余额度时预热；显式启动永远优先。
   */
  sessionPrefetchEnabled: boolean;
  /** 欢迎界面是否在输入栏上方显示最近会话（历史记录）快捷入口；默认关闭。 */
  welcomeRecentsEnabled: boolean;
  /** 系统提示音（docs/design/18）；场景/音色/焦点策略见 shared/notification。 */
  notification: NotificationSettings;
  /**
   * LLM 对话流正文字号（px），对应 CSS `--session-stream-font-md`。
   * 次级档 `--session-stream-font-sm` 与工具展开区随之推导，见 tokens.css。
   */
  sessionStreamFontPx: number;
  /** 界面字体预设 id，对应 CSS `--font-family-ui`；见 shared/fontPresets。 */
  fontUiPreset: FontUiPreset;
  /** 等宽字体预设 id，对应 CSS `--font-family-mono`；见 shared/fontPresets。 */
  fontMonoPreset: FontMonoPreset;
  /** 对话流问题导航分段栏的标记样式 id；见 shared/railStyles。 */
  questionRailStyle: RailStyle;
  /** 渲染层全局快捷键映射（设置 → 键盘快捷键）；见 shared/shortcuts。 */
  shortcuts: ShortcutsMap;
}

/** LLM 对话流正文字号默认值（px），与 tokens.css 的 `--session-stream-font-md` 一致。 */
export const DEFAULT_SESSION_STREAM_FONT_PX = 16;
/** 对话流字号允许范围（px）；两端各留余量，避免把会话流缩到不可读或撑破窄栏。 */
export const SESSION_STREAM_FONT_MIN_PX = 12;
export const SESSION_STREAM_FONT_MAX_PX = 28;

/** 读入/写入设置时把字号夹到合法范围；非法值回退默认。 */
export function clampSessionStreamFontPx(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SESSION_STREAM_FONT_PX;
  }
  const n = Math.round(value);
  if (n < SESSION_STREAM_FONT_MIN_PX || n > SESSION_STREAM_FONT_MAX_PX) {
    return DEFAULT_SESSION_STREAM_FONT_PX;
  }
  return n;
}

export const SETTINGS_IPC = {
  get: "pidesk:settings:get",
  set: "pidesk:settings:set",
} as const;

export const PROJECT_IPC = {
  /** 打开系统文件夹选择器，返回所选目录；取消时返回 null。 */
  pick: "pidesk:project:pick",
} as const;

// ---------------------------------------------------------------------------
// pi 信息
// ---------------------------------------------------------------------------

/** pi 侧信息（版本 + 配置的默认模型），只读展示用（docs/design/01 §2.3）。 */
export interface PiInfo {
  /** `pi --version` 输出；解析失败为 null。 */
  version: string | null;
  provider: string | null;
  model: string | null;
  thinkingLevel: string | null;
  /** 使用的 pi 可执行文件路径（供设置页校验展示）。 */
  executablePath: string | null;
}

export const PI_IPC = {
  /** 读取 pi 版本与默认模型配置；参数为可选的 pi 路径（设置页校验用）。 */
  info: "pidesk:pi:info",
  /** 探测 pi 将使用的 bash（按 pi 查找顺序），返回候选与推算结果。 */
  shellGet: "pidesk:pi:shellGet",
  /** 写入 / 清除 pi 自身的 shellPath 配置。 */
  shellSet: "pidesk:pi:shellSet",
} as const;

// ---------------------------------------------------------------------------
// pi bash（shellPath）探测 —— pi 自己的配置，不落 PiDesk settings.json
// ---------------------------------------------------------------------------

/** 候选 bash 来源。 */
export type PiShellSource = "settings" | "git-bash-default" | "path";

/** 候选 bash 的种类判定。 */
export type PiShellKind = "git-bash" | "wsl" | "cygwin" | "msys2" | "unknown";

/** 单个 bash 候选。 */
export interface PiShellCandidate {
  path: string;
  source: PiShellSource;
  kind: PiShellKind;
  /** `bash --version` 首行；探测失败为 null。 */
  version: string | null;
  /** 仅 source=path：是否是 where.exe 的第一位。 */
  firstOnPath: boolean;
}

/** pi 将使用的 bash 探测结果。 */
export interface PiShellProbe {
  /** pi settings.json 里 shellPath 的原始值（未校验）。 */
  shellPath: string | null;
  candidates: PiShellCandidate[];
  /** 按 pi 查找顺序推算出的「pi 将使用的 bash」。 */
  resolved: PiShellCandidate | null;
  /** 人类可读的警告（中文）。 */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// pi 会话（RPC 模式，废除内嵌 TUI；多实例并行见 docs/多会话并行架构方案）
// ---------------------------------------------------------------------------

/**
 * 会话运行时实例 id（非 pi 协议 id，非 SessionSummary.id / sessionFile）。
 * 每个存活 `pi --mode rpc` 子进程对应一个 SessionId。
 */
export type SessionId = string;

export const SESSION_IPC = {
  /** 启动 pi RPC 子进程（`--mode rpc`）；同 sessionFile 存活实例复用，否则新建实例。 */
  start: "pidesk:session:start",
  /** 提交用户输入（RPC `prompt`）。 */
  prompt: "pidesk:session:prompt",
  /** 中断当前执行（RPC `abort`）。 */
  stop: "pidesk:session:stop",
  /** 结束指定会话的 pi 进程（历史 JSONL 保留）。 */
  dispose: "pidesk:session:dispose",
  /** 读取指定目录的 pi 会话历史（JSONL）。 */
  list: "pidesk:session:list",
  /** 读取全部 pi 会话历史（含各会话的工作目录，供侧边栏按项目分组）。 */
  listAll: "pidesk:session:listAll",
  /** 读取指定会话消息（RPC `get_messages`，恢复历史会话用）。 */
  messages: "pidesk:session:messages",
  /** 移除历史会话（会话 JSONL 文件移入系统回收站）。 */
  remove: "pidesk:session:remove",
  /** 主进程推送：会话事件流 `{ sessionId, type, payload }`。 */
  output: "pidesk:session:output",
  /** 读取 pi 可用斜杠命令（RPC `get_commands`）。 */
  getCommands: "pidesk:session:getCommands",
  /** 设置思考档位（RPC `set_thinking_level`）。 */
  setThinkingLevel: "pidesk:session:setThinkingLevel",
  /** 读取当前模型与可用思考档位（RPC `get_state` 子集）。 */
  getModelState: "pidesk:session:getModelState",
  /** 切换模型（RPC `set_model`；同时写入 pi settings 默认模型）。 */
  setModel: "pidesk:session:setModel",
  /** 读取可用模型列表（RPC `get_available_models`；无会话或 force 时短连探测）。 */
  getModels: "pidesk:session:getModels",
  /** 仅写入 pi settings 的 defaultProvider/defaultModel（不依赖存活会话）。 */
  setDefaultModel: "pidesk:session:setDefaultModel",
  /** 读取会话 JSONL 转为消息数组（磁盘优先展示，不依赖 pi 进程）。 */
  readTranscript: "pidesk:session:readTranscript",
  /** 读取会话用量统计（RPC `get_session_stats`，上下文占用）。 */
  getStats: "pidesk:session:getStats",
} as const;

/** 磁盘优先读取的会话 transcript（openSessionFile 加速路径）。 */
export interface SessionTranscriptPayload {
  messages: PiChatMessage[];
  /** 会话头 startedAt（Unix ms）；缺失时为 null。 */
  startedAt: number | null;
  /** 因软上限截断了更早的消息。 */
  truncated: boolean;
}

/** pi 斜杠命令（RPC get_commands）。 */
export interface PiSlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
}

/** 输入栏思考档位（对齐设计图「低 / 高 / 最高」）。 */
export type ThinkingLevelId = "low" | "high" | "max";

export interface PiModelState {
  /** 当前模型展示名，如 `anthropic/claude-sonnet-4`；未启动时为 null。 */
  modelLabel: string | null;
  thinkingLevel: ThinkingLevelId;
  /** 该模型实际支持的档位（pi 返回）；空数组表示沿用默认三档。 */
  availableThinkingLevels: ThinkingLevelId[];
  /** 当前模型输入模态（`Model.input`）；null/缺失 = 未知，不拦附图。 */
  modelInput?: PiModelInputModality[] | null;
  /** 模型上下文窗口（tokens）；未知/未启动为 null。 */
  contextWindow?: number | null;
  /** pi 是否开启自动压缩（footer 的 `(auto)` 标记）。 */
  autoCompactionEnabled?: boolean;
}

/** 上下文用量（RPC `get_session_stats.contextUsage`）。 */
export interface PiContextUsage {
  /** 当前上下文 token 估算；刚压缩完、尚无有效 assistant usage 时为 null。 */
  tokens: number | null;
  contextWindow: number;
  /** 占窗口百分比；tokens 为 null 时同为 null。 */
  percent: number | null;
}

/** 上下文分类桶（相对占比，不给分项 token 数）。 */
export type PiContextBucket =
  | "user"
  | "assistant"
  | "thinking"
  | "toolResult"
  | "summary"
  | "skills"
  | "other";

export interface PiContextBreakdownSlice {
  bucket: PiContextBucket;
  /** 归一化百分比；各片之和恒为 100。 */
  ratioPercent: number;
}

/** 会话用量统计（RPC `get_session_stats` + 本地分类估算）。 */
export interface PiSessionStats {
  /** 无 model / 未选定窗口时整体缺失。 */
  contextUsage?: PiContextUsage;
  /** 消息侧分类占比（估算相对值）；残差在 other。 */
  breakdown?: PiContextBreakdownSlice[];
  /** 残差桶占比；> 40 时 UI 注明含系统提示与工具定义。 */
  otherPercent?: number;
}

/** 模型输入模态（pi `Model.input` 子集）。 */
export type PiModelInputModality = "text" | "image";

export interface PiModelOption {
  provider: string;
  modelId: string;
  label: string;
  /** 模型接受的输入模态；缺失表示未知（不拦附图）。 */
  input?: PiModelInputModality[];
  /** 是否已应用到存活会话；仅落盘默认模型或无会话时为 false。 */
  sessionApplied?: boolean;
}

// ---------------------------------------------------------------------------
// pi-ai 鉴权（~/.pi/agent/auth.json）—— 对齐 pi /login 与 pi-ai env-api-keys
// ---------------------------------------------------------------------------

/** 凭据类型：API Key 或 OAuth token（含自定义 provider 如 newapi）。 */
export type PiAuthKind = "api_key" | "oauth" | "unknown";

/**
 * 单条命名凭据（密钥只回传掩码，永不出渲染层明文）。
 * 同一 provider 可有多条（如公司/个人两把 DeepSeek key），激活时写入 auth.json 标准键。
 */
export interface PiAuthProviderStatus {
  /** 凭据唯一 id（PiDesk 注册表，非 auth.json 键名）。 */
  id: string;
  /** 自定义展示名，如「DeepSeek 公司」。 */
  name: string;
  /** 标准 provider id：deepseek / anthropic / newapi …（auth.json 键名）。 */
  provider: string;
  kind: PiAuthKind;
  /** 掩码凭据；无凭据为 null。 */
  maskedCredential: string | null;
  baseUrl: string | null;
  /** 网关协议（目前仅 newapi：openai-completions | openai-responses）。 */
  api: string | null;
  /** 偏好默认模型（激活时写入 pi defaultModel）。 */
  preferredModel: string | null;
  /** 过期时间（Unix ms）；永不过期或未知为 null。 */
  expiresAt: number | null;
  expired: boolean;
  /** 是否为全局当前激活凭据（仅 settings.defaultProvider 对应的那一条为 true）。 */
  active: boolean;
}

export interface PiAuthSnapshot {
  providers: PiAuthProviderStatus[];
  /** 当前激活凭据所属的 provider id（settings.defaultProvider）；无凭据时为 null。 */
  activeProvider: string | null;
  /** 当前激活凭据 id；无时为 null。 */
  activeCredentialId: string | null;
  /** 注册表文件绝对路径（便于用户手动打开核对）。 */
  file: string;
}

/** 常见 API Key provider（写入 auth.json 的键名 + 展示名），对齐 pi providers 文档。 */
export interface PiApiKeyProviderOption {
  id: string;
  label: string;
  /** 对应环境变量名（仅展示提示）。 */
  envVar: string;
  /** 网关类 provider：允许自定义 baseUrl / api（目前仅 newapi）。官方源为 false。 */
  gateway?: boolean;
}

/** newapi 等网关的协议类型。 */
export type PiGatewayApiType = "openai-completions" | "openai-responses";

/** 新增 / 更新凭据的请求体。密钥为 null 表示不修改原密钥。 */
export interface PiAuthUpsertRequest {
  /** 更新时必填；新增时省略（服务端生成 id）。 */
  id?: string | null;
  /** 自定义名称，如「DeepSeek 公司」。 */
  name: string;
  provider: string;
  /** API Key 明文；新增时必填，更新时 null 表示保留原密钥。 */
  apiKey?: string | null;
  baseUrl?: string | null;
  /** 网关协议；仅 newapi 使用。 */
  api?: string | null;
  preferredModel?: string | null;
}

export const AUTH_IPC = {
  /** 读取 auth.json 中已配置的 provider 列表（掩码）。 */
  list: "pidesk:pi:authList",
  /** 新增 / 更新某 provider 凭据。 */
  upsert: "pidesk:pi:authUpsert",
  /** 移除某 provider 凭据。 */
  remove: "pidesk:pi:authRemove",
  /** 激活某凭据（写入 pi defaultProvider，并按 preferredModel 更新 defaultModel）。 */
  setActive: "pidesk:pi:authSetActive",
  /** 常见 API Key provider 下拉选项（静态表）。 */
  listApiKeyProviders: "pidesk:pi:authListApiKeyProviders",
} as const;

// ---------------------------------------------------------------------------
// MCP 服务器管理（docs/design/39：pi 内置 MCP 扩展的 mcp.json 管理面板）
// ---------------------------------------------------------------------------

/**
 * pi MCP server 暴露级别（对齐 pi core/mcp-servers.ts 的 McpExposure）。
 * codemode：工具只经 codemode 脚本调用；deferred：经 tool_search 按需加载；
 * direct：直接声明给模型；hidden：注册但不可达。
 */
export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";

/**
 * 单条 server 配置的 PiDesk 视图（字段对齐 pi validateMcpServerConfig）。
 * PiDesk 未建模的原始字段（toolExposure、auth 及未知键）在主进程保存时原样保留。
 */
export interface McpServerEntry {
  type?: "stdio" | "http" | "streamable-http";
  /** stdio：可执行文件（非 shell 命令串）。 */
  command?: string;
  args?: string[];
  /** 值支持 `${VAR}` 与 `!cmd`（pi 语义，原样透传）。 */
  env?: Record<string, string>;
  cwd?: string;
  /** http：streamable HTTP 地址。 */
  url?: string;
  headers?: Record<string, string>;
  /** OAuth 配置；PiDesk 只管理基础字段，其余键原样保留。 */
  oauth?: McpOAuthEntry;
  exposure?: McpExposure;
  /** false = 保留条目但不连接；缺省 true。 */
  enabled?: boolean;
  description?: string;
  /** 每请求超时（秒）；缺省 60。 */
  timeout?: number;
}

/** OAuth 配置的基础可编辑字段（对齐 pi McpOAuthConfig 子集）。 */
export interface McpOAuthEntry {
  clientId?: string;
  clientSecret?: string;
  callbackPort?: number;
  scope?: string;
  clientName?: string;
  /** PiDesk 未编辑的其余 OAuth 键（cimd、authServerMetadataUrl 等）原样保留。 */
  [key: string]: unknown;
}

/** 用户级 mcp.json 快照（渲染层展示模型）。 */
export interface McpConfigSnapshot {
  /** mcp.json 绝对路径（~/.pi/agent 或 PI_CODING_AGENT_DIR）。 */
  file: string;
  entries: Array<{ name: string; config: McpServerEntry; invalid?: boolean }>;
  /** pi settings 的 autoEnableCodemode 不在 mcp.json，这里仅透传 mcp.json 顶层同名键（如有）。 */
  autoEnableCodemode?: boolean;
}

/** `pi mcp list --json` 的单条报告（对齐 pi extensions/mcp/cli.ts ServerReport）。 */
export interface McpServerReport {
  name: string;
  scope: string;
  /** 定义该条目的文件路径。 */
  source: string;
  /** 项目 mcp.json 覆盖同名用户级条目时为覆盖文件路径。 */
  override?: string;
  enabled: boolean;
  exposure: string;
  transport: string;
  state: string;
  tools: string[];
  toolExposure?: Record<string, string>;
  resources?: number;
  resourceTemplates?: number;
  error?: string;
}

/** probe 结果（含探测时间；渲染层据此展示「N 秒前」）。 */
export interface McpProbeResult {
  servers: McpServerReport[];
  /** mcp.json 配置级错误（非法条目等）。 */
  errors: string[];
  /** pi 附加说明（如项目未受信任）。 */
  note?: string;
  /** 探测完成时间（Unix ms）。 */
  probedAt: number;
}

/** 探测请求：cwd 传入当前项目目录时，pi 才能读到该项目的 .pi/mcp.json（受项目信任约束）。 */
export interface McpProbeRequest {
  cwd?: string | null;
}

export const MCP_IPC = {
  /** 读取用户级 mcp.json 快照。 */
  list: "pidesk:mcp:list",
  /** 运行 `pi mcp list --json` 探测真实连接状态（连接所有 server，可能较慢）。 */
  probe: "pidesk:mcp:probe",
  /** 新增 / 更新一条用户级 server（PiDesk 建模字段全量覆盖，其余原始键保留）。 */
  save: "pidesk:mcp:save",
  /** 删除一条用户级 server。 */
  remove: "pidesk:mcp:remove",
  /** 经活跃会话 RPC 执行 /mcp login|logout|reconnect。 */
  sessionCommand: "pidesk:mcp:sessionCommand",
  /** 重载活跃会话：switch_session 切回同一会话文件，保留对话并重读 mcp.json。 */
  reloadSessions: "pidesk:mcp:reloadSessions",
  /** 读取 pi 版本与内置 MCP 支持状态（旧版 pi 优雅降级，docs/design/39）。 */
  getPiSupport: "pidesk:mcp:getPiSupport",
  /** MCP 市场搜索：空 query 走内置精选清单，非空走官方注册表（docs/design/41）。 */
  marketSearch: "pidesk:mcp:marketSearch",
} as const;

/** 保存请求：previousName 存在且与 name 不同表示重命名。 */
export interface McpSaveServerRequest {
  previousName?: string | null;
  name: string;
  config: McpServerEntry;
}

/** 会话内 /mcp 子命令请求；sessionId 缺省时取第一个活跃会话。 */
export interface McpSessionCommandRequest {
  sessionId?: SessionId;
  serverName: string;
  action: "login" | "logout" | "reconnect";
}

/** 重载结果：按会话回报（部分失败不互相影响）。 */
export interface McpReloadResult {
  reloaded: SessionId[];
  failures: Array<{ sessionId: SessionId; error: string }>;
}

/**
 * 宿主 pi 对内置 MCP 的支持状态（降级判定）。
 * unsupported：版本确定低于最低要求，面板降级为只读；unknown：pi 不可用或版本无法
 * 解析——不降级，避免把「探测不到」误判成「不支持」。
 */
export interface McpPiSupport {
  /** `pi --version` 首行；探测失败为 null。 */
  version: string | null;
  status: "supported" | "unsupported" | "unknown";
}

// ---------------------------------------------------------------------------
// MCP 市场（docs/design/41：官方注册表 + 内置精选清单 → 一键预填添加）
// ---------------------------------------------------------------------------

/** 市场条目模板中的单个环境变量（值由用户填写；注册表提供的非密钥默认值可作为预填初值）。 */
export interface McpMarketEnvVar {
  name: string;
  description?: string;
  /** 密钥类（编辑对话框预填提示 / 市场列表标记）。 */
  isSecret?: boolean;
  isRequired?: boolean;
  /** 注册表声明的默认值；预填时使用（isSecret 条目仍留空）。 */
  defaultValue?: string;
}

/** 市场条目模板中的单个请求头（value 可含 `{placeholder}` 模板）。 */
export interface McpMarketHeader {
  name: string;
  description?: string;
  value?: string;
}

/** 市场条目的预填模板（→ McpServerEntry，env / headers 值留空待填）。 */
export interface McpMarketTemplate {
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: McpMarketHeader[];
  env?: McpMarketEnvVar[];
  /** 已添加判定键：stdio 为包标识符，http 为 url。 */
  matchKey: string;
}

/** 市场条目（精选清单或注册表归一化结果）。 */
export interface McpMarketEntry {
  /** 精选 id 或注册表反转 DNS 全名。 */
  id: string;
  /** 发布者提供的展示名（如有）；缺省用建议 server 名。 */
  title?: string;
  description: string;
  /** 精选条目的中文描述；注册表条目只有上游英文描述。 */
  descriptionZh?: string;
  repositoryUrl?: string;
  version?: string;
  source: "curated" | "registry";
  /** 建议 server 名（反转 DNS 尾段归一化，冲突由渲染层递增后缀）。 */
  suggestName: string;
  /** pypi 条目需要 uv 运行时（列表标注）。 */
  needsUv?: boolean;
  template: McpMarketTemplate;
}

export interface McpMarketSearchRequest {
  query: string;
  cursor?: string | null;
}

export interface McpMarketSearchResult {
  entries: McpMarketEntry[];
  nextCursor: string | null;
  source: "curated" | "registry";
}

export interface SessionStartRequest {
  /** 可选：渲染层预生成的运行时实例 id；缺省主进程生成。同 id 再 start 会替换该实例。 */
  sessionId?: SessionId;
  /** pi 工作目录（项目目录）；缺省时落到用户主目录。 */
  cwd?: string;
  /** 恢复指定会话文件（`pi --session <file>`）；同 file 存活实例复用，不双开。 */
  sessionFile?: string;
  /**
   * 启动原因（docs/design/16 §8.1）；缺省 manual。
   * 供 runtime coordinator 日志、调度与 speculative 回收策略使用。
   */
  reason?: SessionStartReason;
}

/** 进程绑定型会话请求：必须带 sessionId（多实例路由）。 */
export interface SessionProcessRequest {
  sessionId: SessionId;
}

/**
 * pi ImageContent（rpc.md）：base64 无 `data:` 前缀。
 * 用户附件发送与历史回读共用；与工具结果 image 块同形。
 */
export interface PiImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface SessionPromptRequest extends SessionProcessRequest {
  text: string;
  /** 可选图片附件（RPC `prompt.images`）；缺省或空表示纯文本。 */
  images?: PiImageContent[];
}

export interface SessionSetThinkingLevelRequest extends SessionProcessRequest {
  level: string;
}

export interface SessionSetModelRequest extends SessionProcessRequest {
  provider: string;
  modelId: string;
}

export interface SessionGetModelsRequest {
  /** 目标实例；force 时忽略存活会话、一律短连探测。 */
  sessionId?: SessionId;
  force?: boolean;
}

// -- pi RPC 事件类型（渲染层渲染所需的子集，字段名与 pi docs/rpc.md 对齐） --

/** assistant 消息内容块。 */
export type PiAssistantBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments?: unknown };

/**
 * pi 消息。role 为 "user" | "assistant" | "toolResult" 等；
 * 各角色 content 块结构不同，渲染层按 type 收窄（assistant 块见 PiAssistantBlock）。
 */
export interface PiChatMessage {
  role: string;
  content: unknown[];
  /** assistant 专用：pi stopReason（error / aborted / length / stop / toolUse 等）。 */
  stopReason?: string;
  /** assistant 专用：失败原文（stopReason 为 error/aborted 时由 pi 填入）。 */
  errorMessage?: string;
  /** assistant 专用：本次调用的 token 用量与成本（磁盘 JSONL 与 message_end 均携带）。 */
  usage?: PiUsage;
  /** assistant 专用：模型供应商标识（如 anthropic / newapi）。 */
  provider?: string;
  /** assistant 专用：模型 id（如 claude-sonnet-4）。 */
  model?: string;
  /** toolResult 专用：对应 assistant toolCall 的 id（磁盘 JSONL 写在 message 上）。 */
  toolCallId?: string;
  /** toolResult 专用：工具名（如 bash / read）。 */
  toolName?: string;
  /** toolResult 专用：是否失败。 */
  isError?: boolean;
  /** 磁盘 JSONL 解析出的 unix ms 时间戳（历史装载合成 run 边界用）。 */
  timestamp?: number;
}

/** message_update 携带的流式 delta（pi assistantMessageEvent 子集）。 */
export type PiStreamDelta =
  | { type: "text_start"; contentIndex?: number }
  | { type: "text_delta"; delta: string; contentIndex?: number }
  | { type: "text_end"; content?: string; contentIndex?: number }
  | { type: "thinking_start"; contentIndex?: number }
  | { type: "thinking_delta"; delta: string; contentIndex?: number }
  | { type: "thinking_end"; content?: string; contentIndex?: number }
  | {
      type: "toolcall_start";
      id: string;
      toolName: string;
      contentIndex?: number;
    }
  | { type: "toolcall_delta"; delta: string; contentIndex?: number }
  | {
      type: "toolcall_end";
      id?: string;
      toolName?: string;
      contentIndex?: number;
    };

/** message_update / compaction 携带的 usage（字段名与 pi rpc.md 对齐）。 */
export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

/** pi RPC 事件（主进程白名单转发的子集；未列出的事件丢弃）。 */
export type PiAgentEvent =
  | { type: "agent_start" }
  /** willRetry=true 表示还有自动重试/压缩续跑，run 不应视为终态。 */
  | { type: "agent_end"; willRetry?: boolean }
  | { type: "agent_settled" }
  | { type: "message_start"; message: PiChatMessage }
  | {
      type: "message_update";
      /** 流式 partial 的 assistant 消息（usage 随 chunk 更新，嵌在 message 内而非事件顶层）。 */
      message?: PiChatMessage;
      assistantMessageEvent: PiStreamDelta;
    }
  | { type: "message_end"; message: PiChatMessage }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args?: unknown;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      partialResult?: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName?: string;
      result?: unknown;
      isError?: boolean;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      errorMessage?: string;
    }
  /** success=false 时 finalError 为最终失败原因（重试次数耗尽）。 */
  | {
      type: "auto_retry_end";
      success?: boolean;
      attempt?: number;
      finalError?: string;
    }
  | { type: "compaction_start"; reason?: string }
  | {
      type: "compaction_end";
      reason?: string;
      aborted?: boolean;
      willRetry?: boolean;
      errorMessage?: string;
      result?: {
        summary?: string;
        tokensBefore?: number;
        estimatedTokensAfter?: number;
        usage?: PiUsage;
      };
    };

/**
 * 会话推送消息格式（AGENTS.md 固定 + 实例 id；对齐终端多 Tab）。
 * eventBatch 为高频流式事件合批；渲染层按 sessionId 路由到对应桶。
 */
export type SessionPushMessage =
  | { sessionId: SessionId; type: "event"; payload: PiAgentEvent }
  | { sessionId: SessionId; type: "eventBatch"; payload: PiAgentEvent[] }
  | { sessionId: SessionId; type: "exit"; payload: number }
  | { sessionId: SessionId; type: "error"; payload: string };

/** 会话历史条目（pi JSONL 会话文件的摘要）。 */
export interface SessionSummary {
  /** 会话 JSONL 文件绝对路径（恢复会话用）。 */
  file: string;
  /**
   * pi JSONL 头部 id（历史命名域）。
   * 与运行时 `SessionId` 不同：主进程 sessions Map 一律用 SessionId，禁止用本字段查 Map。
   */
  id: string;
  /** 会话开始时间（Unix ms）。 */
  startedAt: number;
  /** 会话最后活动时间（Unix ms，取 JSONL 文件的最后写入时间）；侧栏相对时间与悬浮卡"更新于"用。 */
  updatedAt: number;
  /** 首条用户消息文本（渲染层自行截断）；尚无消息为 null。 */
  firstUserMessage: string | null;
  /** 会话工作目录（pi JSONL 头部 `cwd` 字段）；旧格式缺失时为 null。 */
  cwd: string | null;
}

// ---------------------------------------------------------------------------
// 会话后台进程监控与回收（docs/design/37）
// ---------------------------------------------------------------------------

/** 登记项状态：alive 可停止；ignored 本 session 不再展示。 */
export type ManagedProcessStatus = "alive" | "exited" | "killed" | "ignored";

/** 会话启动后仍存活的后台项目进程登记项（主进程内存态，不持久化）。 */
export interface ManagedProcess {
  /** 登记主键：`${sessionId}:${pid}:${startMs}`。 */
  id: string;
  /** 归属会话运行时实例 id。 */
  sessionId: SessionId;
  pid: number;
  /** 登记时的父 PID（展示/调试用）。 */
  ppid: number;
  /** 完整命令行（kill 前比对防 PID 复用）。 */
  commandLine: string;
  /** 镜像名，如 node.exe。 */
  name: string;
  /** 进程 CreationDate → Unix ms。 */
  startedAt: number;
  /** 首次登记时间（Unix ms）。 */
  registeredAt: number;
  /** 触发登记的 bash toolCallId（追溯用）。 */
  sourceToolCallId?: string;
  status: ManagedProcessStatus;
}

/** 停止单个登记项的结果。 */
export interface ProcStopResult {
  /** kill 后是否仍存活（含 PID 复用拒绝 kill 的情况）。 */
  stillAlive: boolean;
  /** 人类可读提示（如「进程已变化，未终止」）；无则省略。 */
  message?: string;
}

export const PROC_IPC = {
  /** 列出该会话登记项（含 status；主进程先 lazy 复核存活）。 */
  list: "pidesk:proc:list",
  /** 停止单个（taskkill /T）。 */
  stop: "pidesk:proc:stop",
  /** 标记忽略，本 session 不再展示。 */
  ignore: "pidesk:proc:ignore",
  /** 批量停止（dispose 确认后的「一并结束」）。 */
  stopAll: "pidesk:proc:stopAll",
  /** 主进程推送：登记/状态变化合批（约 200ms）。 */
  changed: "pidesk:proc:changed",
  /** 上次非正常退出的残留提示（§5.4 P0）；消费一次即 false。 */
  residualNotice: "pidesk:proc:residualNotice",
} as const;

export interface ProcListRequest {
  sessionId: SessionId;
}

export interface ProcIdRequest {
  id: string;
}

export interface ProcStopAllRequest {
  sessionId: SessionId;
}

export interface ProcStopAllResult {
  stopped: number;
}

/** 后台进程变化推送（独立域，不改 SessionPushMessage 固定结构）。 */
export interface ProcPushMessage {
  sessionId: SessionId;
  processes: ManagedProcess[];
}

// ---------------------------------------------------------------------------
// 独立终端（node-pty）
// ---------------------------------------------------------------------------

export const TERMINAL_IPC = {
  create: "pidesk:terminal:create",
  input: "pidesk:terminal:input",
  resize: "pidesk:terminal:resize",
  dispose: "pidesk:terminal:dispose",
  /** 主进程推送：终端流式输出；多实例附加 id 区分（AGENTS.md）。 */
  output: "pidesk:terminal:output",
} as const;

export interface TerminalCreateRequest {
  /** 终端工作目录；缺省时落到用户主目录。 */
  cwd?: string;
}

/** 终端流式输出消息格式（AGENTS.md 固定 + 实例 id）。 */
export interface TerminalPushMessage {
  id: string;
  type: "data" | "exit" | "error";
  payload: string | number;
}

// ---------------------------------------------------------------------------
// 扩展 / pi packages（docs/design/07）
// ---------------------------------------------------------------------------

export type PiPackageSourceKind = "npm" | "git" | "local";
export type PiPackageScope = "user" | "project";

export type PiPackageResourceKind = "extensions" | "skills" | "prompts" | "themes";

/** 包内资源计数（读 package.json 的 pi 清单 + 约定目录粗扫）。 */
export interface PiPackageResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

/** 包内单条资源（磁盘上实际存在的扩展文件 / 技能目录 / 提示模板 / 主题）。 */
export interface PiPackageResourceItem {
  /** 展示名（index 文件取父目录名，其余去掉资源后缀）。 */
  name: string;
  /** 绝对路径。 */
  path: string;
  /** 相对包根的路径（`/` 分隔），同名资源消歧用。 */
  relativePath: string;
  /** 是否被 settings 过滤启用（包整体停用时全部为 false）。 */
  enabled: boolean;
}

/** 与 PiPackageResourceCounts 对应的明细列表。 */
export type PiPackageResourceItems = Record<PiPackageResourceKind, PiPackageResourceItem[]>;

/** settings.packages 中的一项（字符串或对象形式归一后的展示模型）。 */
export interface PiPackageEntry {
  /** settings 原始 source 字符串。 */
  source: string;
  kind: PiPackageSourceKind;
  /** 展示名（npm 包名 / repo 路径 / 本地 basename）。 */
  name: string;
  /** 是否以「加载全部资源」形式启用；停用项在 settings 里写成空过滤对象。 */
  enabled: boolean;
  /** 安装路径是否存在于磁盘。 */
  installed: boolean;
  /** 推导的安装目录；无法推导为 null。 */
  installPath: string | null;
  version: string | null;
  description: string | null;
  resources: PiPackageResourceCounts;
  /** 与 resources 计数对应的明细（仅磁盘上存在的项）。 */
  resourceItems: PiPackageResourceItems;
}

/** 用户本地资源目录（settings.extensions/skills/prompts/themes 指向的路径）。 */
export interface PiLocalResourceDir {
  kind: "extensions" | "skills" | "prompts" | "themes";
  path: string;
  exists: boolean;
}

export interface PiPackagesSnapshot {
  user: PiPackageEntry[];
  project: PiPackageEntry[];
  localResources: PiLocalResourceDir[];
  /** ~/.pi/agent（或 PI_CODING_AGENT_DIR）。 */
  agentDir: string;
}

export interface PiPackageInstallRequest {
  source: string;
  /** true = `pi install -l`，写入项目 .pi/settings.json。 */
  local?: boolean;
  /** 项目作用域时的工作目录。 */
  cwd?: string | null;
}

export interface PiPackageRemoveRequest {
  source: string;
  local?: boolean;
  cwd?: string | null;
}

export interface PiPackageSetEnabledRequest {
  source: string;
  scope: PiPackageScope;
  enabled: boolean;
  /** scope=project 时必填。 */
  cwd?: string | null;
}

/** 包内单资源启停（写 settings.packages 对象过滤）。 */
export interface PiPackageSetResourceEnabledRequest {
  source: string;
  scope: PiPackageScope;
  kind: PiPackageResourceKind;
  /** 相对包根的路径（`/` 分隔）。 */
  relativePath: string;
  enabled: boolean;
  cwd?: string | null;
}

/** 安装/卸载子进程推送：日志行 + 退出。 */
export type ExtensionPushMessage =
  | { type: "log"; payload: string }
  | { type: "exit"; payload: { code: number | null; ok: boolean } }
  | { type: "error"; payload: string };

export const EXTENSION_IPC = {
  /** 读取已安装包快照（user + project + 本地资源目录）。 */
  list: "pidesk:extension:list",
  /** 安装 package（spawn `pi install`）。 */
  install: "pidesk:extension:install",
  /** 卸载 package（spawn `pi remove`）。 */
  remove: "pidesk:extension:remove",
  /** 启停 package（写 settings.packages）。 */
  setEnabled: "pidesk:extension:setEnabled",
  /** 包内单资源启停（对象过滤）。 */
  setResourceEnabled: "pidesk:extension:setResourceEnabled",
  /** 主进程推送：安装/卸载子进程日志。 */
  output: "pidesk:extension:output",
} as const;

// ---------------------------------------------------------------------------
// 文件系统
// ---------------------------------------------------------------------------

export type FsEntryKind = "dir" | "file";

export interface FsEntry {
  name: string;
  kind: FsEntryKind;
}

export interface FsListResult {
  entries: FsEntry[];
  /** 目录项超过单次上限时为 true，提示渲染层折叠展示。 */
  truncated: boolean;
}

/** 文本预览（代码高亮）。 */
export interface FsReadTextResult {
  kind: "text";
  content: string;
  truncated: boolean;
  /** 原始文件字节数（用于标题栏展示）。 */
  byteLength: number;
}

/** 图片预览（data URL，CSP img-src 已放行 data:）。 */
export interface FsReadImageResult {
  kind: "image";
  dataUrl: string;
  mime: string;
  byteLength: number;
}

/** 二进制/不可预览：仅元信息，渲染层给占位与「系统打开」。 */
export interface FsReadBinaryResult {
  kind: "binary";
  byteLength: number;
  mime?: string;
}

export type FsReadResult = FsReadTextResult | FsReadImageResult | FsReadBinaryResult;

/** 搜索结果：绝对路径 + 相对根目录的显示路径（/ 分隔）。 */
export interface FsSearchHit {
  path: string;
  displayPath: string;
  /** 文件或文件夹（@ 引用两者都要）。 */
  kind: FsEntryKind;
}

export const FS_IPC = {
  /** 列出目录（文件夹在前、字母序）。 */
  list: "pidesk:fs:list",
  /** 只读读取文本文件（有大小上限）。 */
  read: "pidesk:fs:read",
  /** 递归按文件名模糊搜索（跳过 node_modules/.git 等）。 */
  search: "pidesk:fs:search",
  /** 打开系统文件选择器（pi 可执行路径等场景）。 */
  pickFile: "pidesk:fs:pickFile",
  /** 用系统默认应用打开路径（目录/文件均可；会话 FileLink 与侧栏共用）。 */
  openPath: "pidesk:fs:openPath",
  /** 把 data URL 图片落盘到系统「下载」目录（lightbox 右键「保存图片」）。 */
  saveImageToDownloads: "pidesk:fs:saveImageToDownloads",
  /** 订阅目录变动：开始监听某个已展开目录（主进程引用计数）。 */
  watch: "pidesk:fs:watch",
  /** 取消监听某目录（引用计数归零时关闭 watcher）。 */
  unwatch: "pidesk:fs:unwatch",
  /** 主进程推送：受影响的目录绝对路径集合（150ms 合批，已过滤忽略目录）。 */
  changed: "pidesk:fs:changed",
} as const;

/** 目录监听订阅/退订请求。 */
export interface FsWatchRequest {
  /** 要监听/退订的目录绝对路径。 */
  dir: string;
}

/** 目录变动推送：受影响目录的绝对路径集合（渲染层据此局部失效文件树缓存）。 */
export interface FsWatchPushMessage {
  dirs: string[];
}

/** 保存图片请求：`dataUrl` 必须是 `data:image/...;base64,`；`name` 为用户可见文件名，属不可信输入，由主进程净化。 */
export interface FsSaveImageRequest {
  dataUrl: string;
  name?: string;
}

/** 保存图片结果：落盘绝对路径、实际写入的文件名、所在目录（供「在文件夹中显示」直接喂 openPath）。 */
export interface FsSaveImageResult {
  path: string;
  name: string;
  dir: string;
}

// ---------------------------------------------------------------------------
// Git 审查（基于工作区变更的 Review，docs/design/04）
// ---------------------------------------------------------------------------

export const GIT_IPC = {
  /** 读取仓库状态与变更列表（staged / unstaged / untracked 三层）。 */
  status: "pidesk:git:status",
  /** 读取单个文件的 diff（按 layer 决定 diff 基线）。 */
  diff: "pidesk:git:diff",
  /** 拍摄当前工作区完整快照（含未跟踪），返回 tree OID，供「上一轮更改」回滚。 */
  snapshot: "pidesk:git:snapshot",
  /** 将指定路径还原到快照时刻；快照中不存在的路径会被删除。 */
  rollback: "pidesk:git:rollback",
  /** 对比工作区路径与指定快照（撤销冲突检测 / 还原-删除分类）。 */
  compareSnapshot: "pidesk:git:compareSnapshot",
  /** 列出本地分支 + 当前分支 + 未提交变更文件数（输入栏 Git 芯片）。 */
  branches: "pidesk:git:branches",
  /** 检出分支；`create` 为 true 时先创建。 */
  checkout: "pidesk:git:checkout",
  /** 读取提交图（只读 log，含父节点用于泳道布局）。 */
  log: "pidesk:git:log",
  /** 暂存指定路径（git add）。 */
  stage: "pidesk:git:stage",
  /** 取消暂存指定路径。 */
  unstage: "pidesk:git:unstage",
  /** 丢弃指定路径的本地改动（还原到 HEAD / 删除未跟踪）。 */
  discard: "pidesk:git:discard",
  /** 提交已暂存改动（手写提交信息，不做 AI 生成）。 */
  commit: "pidesk:git:commit",
  /** 读取推送计划（remote / branch / 领先提交数），供二次确认复述。 */
  pushPlan: "pidesk:git:pushPlan",
  /** 推送当前分支到远程。 */
  push: "pidesk:git:push",
} as const;

export interface GitBranchInfo {
  name: string;
  current: boolean;
}

export interface GitBranchesResult {
  /** 仓库根目录；cwd 不是 git 仓库时为 null。 */
  repoRoot: string | null;
  current: string | null;
  branches: GitBranchInfo[];
  /** 未提交变更文件数（staged + unstaged + untracked 去重路径）。 */
  dirtyCount: number;
}

export interface GitCheckoutRequest {
  cwd: string;
  branch: string;
  /** 为 true 时 `git checkout -b`。 */
  create?: boolean;
}

/** 变更所属的 diff 层：staged=HEAD→Index，unstaged=Index→工作区，untracked=未跟踪。 */
export type GitChangeLayer = "staged" | "unstaged" | "untracked";

export type GitChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "conflicted"
  | "untracked";

/**
 * 单个文件的变更条目。
 * 同一文件可同时具有 staged 与 unstaged 变更，会各生成一条（不合并，避免丢层）。
 */
export interface GitChange {
  /** 仓库相对路径（/ 分隔）；rename/copy 为新路径。 */
  path: string;
  /** rename/copy 的原路径；其余为 null。 */
  oldPath: string | null;
  status: GitChangeStatus;
  layer: GitChangeLayer;
  /** 新增行数；二进制或无法统计时为 null。 */
  additions: number | null;
  deletions: number | null;
}

export interface GitStatusResult {
  /** 仓库根目录（绝对路径）；cwd 不是 git 仓库时为 null 且 changes 为空。 */
  repoRoot: string | null;
  changes: GitChange[];
  /** 当前 HEAD commit OID；空仓库或非仓库为 null。用于识别提交后作废回滚快照。 */
  headOid: string | null;
}

export interface GitDiffRequest {
  /** 会话工作目录（用于定位仓库根）。 */
  cwd: string;
  /** 变更后的仓库相对路径（/ 分隔）。 */
  path: string;
  /** rename/copy 的原路径；rename diff 需要同时传入新旧路径才能配对。 */
  oldPath?: string | null;
  layer: GitChangeLayer;
}

export interface GitDiffLine {
  kind: "context" | "add" | "del";
  /** 行内容（不含 +/- 前缀与行尾换行）。 */
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface GitDiffHunk {
  /** "@@ -a,b +c,d @@" 原文。 */
  header: string;
  lines: GitDiffLine[];
}

export interface GitFileDiff {
  path: string;
  oldPath: string | null;
  /** git 判定为二进制文件（不提供 hunks）。 */
  binary: boolean;
  /** 合并冲突文件（combined diff，不做 hunk 解析）。 */
  conflicted: boolean;
  /** 输出超过上限被截断。 */
  truncated: boolean;
  /** hunks 为空且非 binary/conflicted 时表示内容无差异（如纯重命名）。 */
  hunks: GitDiffHunk[];
}

/** 工作区完整快照（含未跟踪文件）；tree OID 可用于后续还原。 */
export interface GitSnapshotResult {
  /** git tree OID；cwd 不是仓库时为 null。 */
  treeOid: string | null;
  /** 拍摄快照时的 HEAD OID；空仓库为 null。HEAD 变化（已提交）后应作废该快照。 */
  headOid: string | null;
}

export interface GitRollbackRequest {
  cwd: string;
  /** snapshot 返回的 tree OID。 */
  treeOid: string;
  /** 需要还原的仓库相对路径（rename 应同时包含新旧路径）。 */
  paths: string[];
}

export interface GitRollbackResult {
  /** 从快照写回内容的文件数。 */
  restored: number;
  /** 快照中不存在、被删除的文件数（agent 本轮新建）。 */
  deleted: number;
}

export interface GitCompareSnapshotRequest {
  /** 会话工作目录（用于定位仓库根）。 */
  cwd: string;
  /** 对照的 snapshot tree OID。 */
  treeOid: string;
  /** 仓库相对路径（/ 分隔）。 */
  paths: string[];
}

export interface GitCompareItem {
  path: string;
  /** 快照中是否存在该路径（文件）。 */
  inSnapshot: boolean;
  /** 工作区当前是否存在该文件。 */
  inWorktree: boolean;
  /** 工作区与快照在存在性或内容上是否不同。 */
  differs: boolean;
}

export interface GitCompareSnapshotResult {
  items: GitCompareItem[];
}

/** 图谱中的单条提交。 */
export interface GitCommit {
  /** 完整 OID。 */
  oid: string;
  /** 短 OID（展示用）。 */
  shortOid: string;
  /** 提交标题（单行 subject）。 */
  subject: string;
  authorName: string;
  /** 作者邮箱（git log %ae；主进程用它对齐 GitHub commits 的作者头像）。 */
  authorEmail: string;
  /**
   * 作者头像 data URL（登录 + GitHub remote 时由主进程解析下载）。
   * null = 未登录 / 非 GitHub remote / 解析失败 → 渲染层「用户名首字母」色块。
   */
  avatarDataUrl: string | null;
  /** Unix 秒。 */
  authorTime: number;
  /** 父提交 OID 列表（root 为空；merge ≥2）。 */
  parentOids: string[];
  /** 指向该提交的本地分支 / 当前 HEAD 标记（装饰名，不含 remotes/）。 */
  refs: string[];
  /** 是否为 HEAD。 */
  isHead: boolean;
  /** 是否为当前分支 tip（HEAD 所在分支的 tip）。 */
  isCurrentBranchTip: boolean;
}

export interface GitLogRequest {
  cwd: string;
  /** 最多返回的提交数；默认 200。 */
  maxCount?: number;
}

export interface GitLogResult {
  /** 仓库根目录；cwd 不是 git 仓库时为 null。 */
  repoRoot: string | null;
  /** 空仓库（无 HEAD）时为空数组。 */
  commits: GitCommit[];
  /** 输出被 maxCount 截断。 */
  truncated: boolean;
  currentBranch: string | null;
}

// ---------------------------------------------------------------------------
// Git 写操作（docs/design 30 §2.1）：暂存 / 取消暂存 / 丢弃 / 提交 / 推送
// ---------------------------------------------------------------------------

/** 暂存 / 取消暂存请求：paths 为仓库相对路径（/ 分隔）。 */
export interface GitStageRequest {
  cwd: string;
  paths: string[];
}

/** 暂存 / 取消暂存结果：受影响路径数。 */
export interface GitWriteResult {
  affected: number;
}

/** 丢弃本地改动请求：paths 为仓库相对路径（/ 分隔）。 */
export interface GitDiscardRequest {
  cwd: string;
  paths: string[];
}

/** 丢弃结果：还原到 HEAD 的文件数 + 删除的未跟踪文件数。 */
export interface GitDiscardResult {
  restored: number;
  removed: number;
}

/** 提交请求：message 为手写提交信息（多行以 \n 分隔）。 */
export interface GitCommitRequest {
  cwd: string;
  message: string;
}

/** 提交结果：新 HEAD 的 OID 与标题。 */
export interface GitCommitResult {
  oid: string;
  shortOid: string;
  subject: string;
}

/**
 * 推送计划（用于二次确认复述影响范围）。
 * remote / branch 均由主进程从仓库配置解析；存在歧义（多 remote 且无 upstream）时直接报错，不猜。
 */
export interface GitPushPlan {
  remote: string;
  /** 本地当前分支。 */
  branch: string;
  /** 远程分支名（通常与 branch 相同；upstream 可能不同名）。 */
  remoteBranch: string;
  /** 本地领先远程的提交数；无 upstream 时为 0。 */
  ahead: number;
  /** 当前分支是否已配置 upstream。 */
  hasUpstream: boolean;
}

/** 推送请求：remote / branch 必须显式给出（来自 pushPlan，不猜）。 */
export interface GitPushRequest {
  cwd: string;
  remote: string;
  branch: string;
  /** 无 upstream 时首推是否 `--set-upstream`。 */
  setUpstream?: boolean;
}

/** 推送结果：实际推送的 remote / branch。 */
export interface GitPushResult {
  remote: string;
  branch: string;
}

// ---------------------------------------------------------------------------
// 浏览器面板（docs/design/05：内嵌开发预览浏览器 + 元素拾取）
// ---------------------------------------------------------------------------

export const BROWSER_IPC = {
  /** 地址导航（自动补全 scheme）。 */
  navigate: "pidesk:browser:navigate",
  /** 在侧栏浏览器中打开本地 HTML 文件（file:// 专用通道；地址栏导航仍限 http(s)）。 */
  openLocalFile: "pidesk:browser:openLocalFile",
  reload: "pidesk:browser:reload",
  back: "pidesk:browser:back",
  forward: "pidesk:browser:forward",
  stop: "pidesk:browser:stop",
  /** 用系统默认浏览器打开当前 URL。 */
  openExternal: "pidesk:browser:openExternal",
  /** 视口截图（返回 PNG base64 + 落盘路径）。 */
  screenshot: "pidesk:browser:screenshot",
  /** 进入 / 退出元素拾取会话。 */
  pickStart: "pidesk:browser:pickStart",
  pickStop: "pidesk:browser:pickStop",
  /** 拾取会话内切换子模式（圈选 / 浏览，docs/design/06 §3.1）。 */
  setPickMode: "pidesk:browser:setPickMode",
  /** 只读检查器查询（docs/design/06 §4.4）：入参统一为 nodeId。 */
  inspectStyles: "pidesk:browser:inspectStyles",
  inspectBoxModel: "pidesk:browser:inspectBoxModel",
  inspectDomTree: "pidesk:browser:inspectDomTree",
  /** 样式热更改（docs/design/22）：写 PiDesk 调整样式表。 */
  stylePatch: "pidesk:browser:stylePatch",
  stylePatchClear: "pidesk:browser:stylePatchClear",
  stylePatchExport: "pidesk:browser:stylePatchExport",
  /** 渲染层同步面板宿主区域 bounds 与可见性（WebContentsView 需主进程手动定位）。 */
  setBounds: "pidesk:browser:setBounds",
  /** 响应式视口：width 为 null 表示清除模拟、跟随面板宽度。 */
  setViewport: "pidesk:browser:setViewport",
  /** 忽略缓存强制刷新。 */
  forceReload: "pidesk:browser:forceReload",
  /** 打开页面 DevTools（独立窗口）。 */
  openDevTools: "pidesk:browser:openDevTools",
  /** 页面缩放（1 = 100%）。 */
  setZoom: "pidesk:browser:setZoom",
  /** 清除 persist:browser 分区 Cookie。 */
  clearCookies: "pidesk:browser:clearCookies",
  /** 清除 persist:browser 分区 HTTP 缓存。 */
  clearCache: "pidesk:browser:clearCache",
  /** 手动粘贴 Cookie 导入 persist:browser（docs/design/09 M1）。 */
  applyPastedCookies: "pidesk:browser:applyPastedCookies",
  /** 列出本机 Chromium 浏览器 Profile（docs/design/09 M2）。 */
  listLoginSources: "pidesk:browser:listLoginSources",
  /** 预览某来源下匹配 host 的 Cookie 名称（不含 value）。 */
  previewLoginCookies: "pidesk:browser:previewLoginCookies",
  /** 从本机浏览器读取并写入 persist:browser。 */
  applyLoginCookies: "pidesk:browser:applyLoginCookies",
  /** 全量导入本机浏览器数据（Cookie + 可选 LocalStorage，docs/design/42 §6.6）。 */
  importLoginData: "pidesk:browser:importLoginData",
  /** 仅截取当前页冻结帧（不隐藏视图）；供浮层先垫底再抑制，避免闪黑。 */
  captureOverlayFreeze: "pidesk:browser:captureOverlayFreeze",
  /** 临时隐藏页面视图（区域截图选区 / 设置浮窗等与宿主区重叠的渲染层浮层）。 */
  setOverlaySuppressed: "pidesk:browser:setOverlaySuppressed",
  /** 将渲染层裁剪好的 PNG base64 落盘，返回路径。 */
  saveScreenshot: "pidesk:browser:saveScreenshot",
  /** 新建浏览器页面实例，返回实例 id。 */
  createInstance: "pidesk:browser:createInstance",
  /** 关闭指定浏览器页面实例。 */
  closeInstance: "pidesk:browser:closeInstance",
  /** 切换当前活跃的浏览器页面实例。 */
  setActiveInstance: "pidesk:browser:setActiveInstance",
  /** 列出全部浏览器页面实例。 */
  listInstances: "pidesk:browser:listInstances",
  /** 主进程推送：导航 / 拾取 / 控制台 / 错误 / 加载 / 拾取状态 / 检查器失效。 */
  output: "pidesk:browser:output",
} as const;

/** 导航请求；无 scheme 时主进程按 localhost / 域名规则补全。 */
export interface BrowserNavigateRequest {
  url: string;
}

/** 在侧栏浏览器打开本地 HTML（file:// 专用通道）请求：传本地绝对路径，主进程校验。 */
export interface BrowserOpenLocalFileRequest {
  path: string;
}

/** 浏览器页面实例摘要（侧栏页签展示用）。 */
export interface BrowserInstanceInfo {
  id: string;
  url: string;
  title: string;
  started: boolean;
}

export interface BrowserSetActiveInstanceRequest {
  id: string;
}

export interface BrowserCloseInstanceRequest {
  id: string;
}

/** 面板宿主区域相对窗口内容区的 bounds（CSS px == DIP）。 */
export interface BrowserBoundsRequest {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface BrowserViewportRequest {
  width: number | null;
}

export interface BrowserZoomRequest {
  /** 1 = 100%；主进程侧再夹到可用区间。 */
  factor: number;
}

export interface BrowserOverlaySuppressedRequest {
  suppressed: boolean;
  /**
   * 抑制来源（如 "regionCapture" / "settings" / "moreMenu"）。
   * 多来源可叠加：任一来源仍抑制则隐藏视图；缺省视为单一来源。
   */
  reason?: string;
}

/** 抑制结果：开始抑制时带回页面冻结帧，避免宿主区露黑底。 */
export interface BrowserOverlaySuppressedResult {
  /** PNG/JPEG dataURL；未创建页面或截图失败时为 null。 */
  freeze: string | null;
}

/** 仅截帧（视图仍可见）。 */
export interface BrowserCaptureOverlayFreezeResult {
  freeze: string | null;
}

export interface BrowserSaveScreenshotRequest {
  /** PNG base64（不含 data: 前缀）。 */
  base64: string;
}

/** 手动粘贴 Cookie 导入（docs/design/09 M1；表格格式见 docs/design/42 §6.7）。 */
export interface BrowserApplyPastedCookiesRequest {
  /**
   * 目标站点 host 或 URL（主进程会收成 hostname）。
   *
   * 粘贴 DevTools Cookie 表格时可留空：表格自带 Domain，每条按自己的域写回；
   * 仅当粘贴的是 `name=value`（无域信息）时才必填。
   */
  host: string;
  /** 粘贴文本：DevTools Cookie 表格（TSV）或 `name=value; name2=value2`（允许换行）。 */
  raw: string;
  /** 强制 https；缺省时本地 host 用 http、其余 https（仅影响 `name=value` 粘贴）。 */
  secure?: boolean;
}

export interface BrowserApplyPastedCookiesResult {
  applied: number;
  /** 写入成功的 Cookie 名称（不含 value）。 */
  names: string[];
  /** 部分写入失败时的可读告警（中文文案，由主进程给出）。 */
  warnings?: string[];
}

/** 本机 Chromium 浏览器 Profile 来源（docs/design/09 M2）。 */
export interface BrowserLoginSource {
  /** 稳定 id，如 `chrome:Default`。 */
  id: string;
  browserId: string;
  browserLabel: string;
  profileDir: string;
  profileLabel: string;
  userDataDir: string;
  cookieDbPath: string;
  /** 是否为系统 https 默认浏览器。 */
  isDefaultBrowser: boolean;
}

export interface BrowserPreviewLoginCookiesRequest {
  sourceId: string;
  host: string;
}

export interface BrowserPreviewLoginCookiesResult {
  /** 匹配到的 Cookie 名称（不含 value）。 */
  names: string[];
  failed: number;
  warnings: string[];
}

export interface BrowserApplyLoginCookiesRequest {
  sourceId: string;
  host: string;
}

export interface BrowserApplyLoginCookiesResult {
  applied: number;
  names: string[];
  warnings: string[];
}

/**
 * 全量导入请求（docs/design/42 §6.6）：把本机 Chrome / Edge 的**完整**登录态搬进面板分区。
 *
 * 与按站点导入（`applyLoginCookies`）的区别：Cookie 不做 host 过滤，域 Cookie 按 `domain`
 * 属性写回（否则 `google.com` 的域 Cookie 不会发给 `accounts.google.com`）。
 */
export interface BrowserImportLoginDataRequest {
  sourceId: string;
  /** 同时导入站点存储（LocalStorage）：源侧要逐个 origin 导航，明显更慢，默认关。 */
  includeLocalStorage?: boolean;
  /** 面板当前地址：把当前站点排到 LocalStorage 导入队列最前。 */
  currentUrl?: string;
}

/** 全量导入结果（只回传计数与告警，Cookie 值不出主进程）。 */
export interface BrowserImportLoginDataResult {
  cookies: number;
  skippedCookies: number;
  failedCookies: number;
  localStorageOrigins: number;
  localStorageEntries: number;
  warnings: string[];
}

/** 关键 computed styles（docs/design/05 §6"样式"行的固定子集）。 */
export type BrowserStyleKey =
  | "display"
  | "position"
  | "zIndex"
  | "margin"
  | "padding"
  | "color"
  | "backgroundColor"
  | "fontSize"
  | "fontWeight"
  | "fontFamily"
  | "lineHeight"
  | "borderRadius"
  | "border"
  | "boxShadow"
  | "overflow"
  | "gap"
  | "width"
  | "height";

/** 元素截图（PNG base64 + 落盘路径，路径供 pi 读取，docs/design/05 §6 降级路径）。 */
export interface BrowserScreenshot {
  base64: string;
  path: string;
}

/** 选中元素的结构化上下文（docs/design/05 §6 payload）。 */
export interface BrowserPickedElement {
  id: string;
  /** CDP nodeId（docs/design/06 §4.3）：检查器按它拉三件套；解析失败为 null。 */
  nodeId: number | null;
  url: string;
  /** 采集时间（Unix ms）。 */
  at: number;
  tag: string;
  id_attr: string | null;
  class_attr: string | null;
  /** 无障碍信息（Element.computedRole / computedName）。 */
  a11yRole: string | null;
  a11yName: string | null;
  /** 唯一 CSS selector。 */
  selector: string;
  /** 截断后的 outerHTML。 */
  outerHTML: string;
  /** 文本摘要。 */
  textSummary: string;
  /** 视口内 bbox（CSS px）。 */
  rect: { x: number; y: number; width: number; height: number };
  /** 视口尺寸（采集时）。 */
  viewport: { width: number; height: number };
  /** 关键 computed styles。 */
  styles: Partial<Record<BrowserStyleKey, string>>;
  /** 元素截图（bbox + 少量余量裁剪）。 */
  screenshot: BrowserScreenshot | null;
  /** 采集时的最近控制台错误（最多 5 条）。 */
  consoleErrors: string[];
}

/** 控制台错误条目（P1-2）。 */
export interface BrowserConsoleError {
  id: string;
  message: string;
  source: string | null;
  line: number | null;
  at: number;
}

// ---------------------------------------------------------------------------
// 元素检查器（docs/design/06：只读三件套，DTO 已在主进程裁剪）
// ---------------------------------------------------------------------------

/**
 * 拾取会话的两个子模式（docs/design/06 §3.1）：
 * - `select` 圈选：inspect overlay 开启，页面鼠标事件被 overlay 吞掉，用于连续点选元素；
 * - `browse` 浏览：overlay 关闭，页面可正常滚动/点击，检查器保留上一个选中元素的数据。
 */
export type BrowserPickMode = "select" | "browse";

export interface BrowserPickModeRequest {
  mode: BrowserPickMode;
}

/** 检查器只读查询的统一入参（节点必须来自本会话的拾取结果）。 */
export interface InspectorNodeRequest {
  nodeId: number;
}

/** 单条样式声明（computed 与 matched 共用）。 */
export interface InspectorStyleProperty {
  name: string;
  value: string;
  /** 声明带 !important。 */
  important: boolean;
  /** 来源样式表（取 URL 末段文件名）；inline / 未知为 null。 */
  source: string | null;
  /** 来源行号（1 起）；未知为 null。 */
  line: number | null;
}

export interface InspectorStyleRule {
  selector: string;
  origin: "user-agent" | "user" | "inspected";
  /** 继承来源元素的 selector；非继承规则为 null。 */
  inheritedFrom: string | null;
  properties: InspectorStyleProperty[];
}

/**
 * 样式快照。
 * ⚠️ `computed` 是**最终生效值**（唯一真值）；`matched` 只是匹配到的规则集合，
 * 不做层叠胜出判定（docs/design/06 §5.3）。
 */
export interface InspectorStyleData {
  nodeId: number;
  /** 形如 "button.btn-primary"。 */
  label: string;
  /** 白名单裁剪后的 computed 属性。 */
  computed: Array<{ name: string; value: string }>;
  matched: InspectorStyleRule[];
}

// ---------------------------------------------------------------------------
// 样式热更改（docs/design/22：PiDesk 调整样式表）
// ---------------------------------------------------------------------------

/** 单条热更改声明（渲染层调整区一行）。 */
export interface StylePatchDeclaration {
  name: string;
  value: string;
  important: boolean;
  /** false = UI 上临时关掉（不写入规则），用于「没有它会怎样」。 */
  enabled: boolean;
}

/** 全量替换某 selector 的调整声明。 */
export interface StylePatchRequest {
  nodeId: number;
  /** 写入规则的 selector；主进程在空串时按 nodeId 重算唯一 selector。 */
  selector: string;
  declarations: StylePatchDeclaration[];
}

export interface StylePatchResult {
  /** 实际写入规则后的声明（仅 enabled）。 */
  applied: StylePatchDeclaration[];
  /** 主进程最终采用的 selector（入参为空时回填）。 */
  selector: string;
}

export interface StylePatchClearRequest {
  /** null = 清空全部调整。 */
  selector: string | null;
}

export interface StylePatchExportRequest {
  /** 来源站点（写入导出注释）。 */
  host: string;
}

export interface StylePatchExportResult {
  css: string;
}

/** 盒模型四区（每边数值，单位 CSS px；顺序 top / right / bottom / left）。 */
export interface InspectorBoxModel {
  nodeId: number;
  margin: [number, number, number, number];
  border: [number, number, number, number];
  padding: [number, number, number, number];
  /** 内容区尺寸。 */
  content: { width: number; height: number };
}

export interface InspectorDomNode {
  /** nodeId 仅在本次检查器会话内有效；祖先链走页面侧回退时为 null（不可点击切换）。 */
  nodeId: number | null;
  nodeType: number;
  /** 大写的 DOM 节点名，如 "BUTTON" / "#text"。 */
  nodeName: string;
  id: string | null;
  classes: string[];
  childCount: number;
  /** 仅 self 携带直接子元素一层（避免整棵树经 IPC）。 */
  children?: InspectorDomNode[];
}

export interface InspectorDomTree {
  nodeId: number;
  /** 根 → 当前（不含当前）。 */
  ancestors: InspectorDomNode[];
  /** 当前节点 + 直接子元素一层。 */
  self: InspectorDomNode;
}

/** 检查器数据失效原因（docs/design/06 §5.1）。 */
export type InspectorInvalidationReason = "navigated" | "detached";

/**
 * 主进程推送消息体（AGENTS.md 固定 `{ type, payload }`）。
 *
 * 说明（docs/design/06 §4.4）：检查器沿用**单推送通道 + `type` 判别**，
 * 不新开 channel；原页内悬浮卡动作 `pickAction` 已随注入卡一起删除。
 */
export type BrowserPushBody =
  | {
      type: "navigated";
      payload: {
        url: string;
        title: string;
        canGoBack: boolean;
        canGoForward: boolean;
        /** commit=真实导航/刷新（托盘元素据此标记过期），inpage=页内导航。 */
        kind: "commit" | "inpage";
      };
    }
  | { type: "picked"; payload: BrowserPickedElement }
  | { type: "console"; payload: BrowserConsoleError }
  | { type: "error"; payload: string }
  | { type: "loading"; payload: boolean }
  | { type: "pick"; payload: { active: boolean; mode: BrowserPickMode } }
  /** 圈选中按 Enter：渲染层把 lastPicked 写入中央对话框芯片。 */
  | { type: "pickConfirm" }
  | {
      type: "inspectInvalidated";
      payload: { reason: InspectorInvalidationReason };
    }
  /** 热应用回执（docs/design/22）。 */
  | {
      type: "styleApplied";
      payload: {
        nodeId: number;
        selector: string;
        applied: StylePatchDeclaration[];
      };
    }
  | { type: "styleApplyFailed"; payload: { message: string } };

/** 多页面后每条推送携带实例 id，渲染层只更新当前活跃页的状态。 */
export type BrowserPushMessage = { id: string } & BrowserPushBody;

/** 视口截图结果。 */
export interface BrowserScreenshotResult extends BrowserScreenshot {
  url: string;
  width: number;
  height: number;
}
