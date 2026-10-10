import type {
  PiChatMessage,
  PiImageContent,
  PiModelOption,
  PiModelState,
  PiSessionStats,
  PiSlashCommand,
  SessionId,
  SessionPushMessage,
  SessionStartRequest,
  SessionSummary,
  SessionTranscriptPayload,
  ThinkingLevelId,
} from "../../shared/ipc";
import { isModeTransitioning } from "../stores/modeTransitionBarrier";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

let pushListenersBound = false;
const pushListeners = new Set<(message: SessionPushMessage) => void>();

/**
 * 渲染层「当前」会话实例 id（Phase A 单桶兼容）。
 * Phase B 多桶后由 store 按 bucket 传入显式 sessionId。
 */
let currentSessionId: SessionId | null = null;

function requireCurrentId(): SessionId {
  if (!currentSessionId) throw new Error("会话未启动");
  return currentSessionId;
}

function ensureBound(): void {
  const api = pideskApi();
  if (pushListenersBound || !api) return;
  pushListenersBound = true;
  api.session.onOutput((message) => {
    for (const listener of pushListeners) listener(message);
  });
}

/**
 * pi RPC 会话服务：渲染层自研 UI 的唯一数据源。
 * 请求-响应直通主进程；pi 事件经主进程白名单转发后在此分发。
 * 进程绑定型 API 一律带 SessionId（多实例路由）。
 */
export const sessionService = {
  /** 当前绑定的会话实例 id（由 sessionStore 在 setActive 时绑定）。 */
  getCurrentSessionId(): SessionId | null {
    return currentSessionId;
  },

  /** 将渲染层「当前」会话绑定到指定实例（多桶 active 切换时调用）。 */
  bindActiveSession(sessionId: SessionId | null): void {
    currentSessionId = sessionId;
  },

  /**
   * 启动 pi RPC 进程。
   * 同 sessionFile 存活实例复用并返回既有 SessionId；否则新建。
   * 常驻到显式 dispose —— 切换 active 不会杀后台进程。
   * 不自动 bindActiveSession：由 store 在 setActive 时绑定。
   */
  async start(req: SessionStartRequest): Promise<SessionId> {
    const api = pideskApi();
    if (!api) return req.sessionId ?? `sess_local_${Date.now()}`;
    return unwrap(api.session.start(req));
  },

  /**
   * 提交用户输入；必须显式传 sessionId，避免与 setActive 竞态串会话。
   * `images` 为 pi ImageContent（base64 无 data: 前缀），随 prompt 进入模型上下文。
   */
  async prompt(text: string, sessionId?: SessionId, images?: PiImageContent[]): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    const id = sessionId ?? requireCurrentId();
    if (isModeTransitioning(id)) throw new Error("正在切换访问模式");
    await unwrap(
      api.session.prompt({
        sessionId: id,
        text,
        ...(images && images.length > 0 ? { images } : {}),
      }),
    );
  },

  /** 中断指定会话（RPC abort）；缺省当前实例。 */
  stop(sessionId?: SessionId): void {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return;
    api.session.stop(id).catch(() => {});
  },

  /** 结束指定会话的 pi 进程（历史 JSONL 保留）。 */
  dispose(sessionId?: SessionId): void {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return;
    if (id === currentSessionId) currentSessionId = null;
    api.session.dispose(id).catch(() => {});
  },

  list(cwd: string): Promise<SessionSummary[]> {
    const api = pideskApi();
    if (!api) return Promise.resolve([]);
    return unwrap(api.session.list(cwd)).catch(() => []);
  },

  /** 读取全部 pi 会话历史（含各会话工作目录，侧边栏按项目分组用）。 */
  listAll(): Promise<SessionSummary[]> {
    const api = pideskApi();
    if (!api) return Promise.resolve([]);
    return unwrap(api.session.listAll()).catch(() => []);
  },

  /** 读取当前会话消息（恢复历史会话时渲染）。 */
  async messages(sessionId?: SessionId): Promise<PiChatMessage[]> {
    const api = pideskApi();
    if (!api) return [];
    const id = sessionId ?? currentSessionId;
    if (!id) return [];
    return unwrap(api.session.messages(id)).catch(() => []);
  },

  /** 移除历史会话（会话 JSONL 移入系统回收站）。 */
  async remove(file: string): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    await unwrap(api.session.remove(file));
  },

  /** 读取会话 JSONL 转为消息数组（磁盘优先展示，不依赖 pi 进程）。 */
  readTranscript(file: string): Promise<SessionTranscriptPayload> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.session.readTranscript(file));
  },

  /** 导出会话记录为 Markdown 文件（系统保存对话框；取消返回 null）。 */
  exportMarkdown(file: string, title?: string): Promise<{ path: string } | null> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.session.exportMarkdown({ file, title }));
  },

  /** 读取 pi 可用斜杠命令（目标会话未启动时返回空列表）。 */
  getCommands(sessionId?: SessionId): Promise<PiSlashCommand[]> {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return Promise.resolve([]);
    return unwrap(api.session.getCommands(id)).catch(() => []);
  },

  /** 设置思考档位；目标会话未启动时抛错。 */
  setThinkingLevel(level: ThinkingLevelId, sessionId?: SessionId): Promise<void> {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return Promise.reject(new Error("会话未启动"));
    return unwrap(api.session.setThinkingLevel({ sessionId: id, level })).then(() => undefined);
  },

  /** 读取目标会话的模型与思考档位（未启动时回退 pi 配置）。 */
  getModelState(sessionId?: SessionId): Promise<PiModelState | null> {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return Promise.resolve(null);
    return unwrap(api.session.getModelState(id)).catch(() => null);
  },

  /** 切换模型；目标会话未启动时仅写入 pi settings 默认模型。 */
  setModel(provider: string, modelId: string, sessionId?: SessionId): Promise<PiModelOption> {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return Promise.reject(new Error("会话未启动"));
    return unwrap(api.session.setModel({ sessionId: id, provider, modelId }));
  },

  /** 读取可用模型列表（force 时短连；否则钉死目标 sessionId）。 */
  getModels(options?: { force?: boolean; sessionId?: SessionId }): Promise<PiModelOption[]> {
    const api = pideskApi();
    if (!api) return Promise.resolve([]);
    return unwrap(
      api.session.getModels({
        force: options?.force,
        sessionId: options?.sessionId ?? currentSessionId ?? undefined,
      }),
    ).catch(() => []);
  },

  /** 仅写入 pi settings 默认模型。 */
  setDefaultModel(provider: string, modelId: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.session.setDefaultModel({ provider, modelId })).then(() => undefined);
  },

  /** 读取会话用量统计（contextUsage；目标未启动返回 null）。 */
  getStats(sessionId?: SessionId): Promise<PiSessionStats | null> {
    const api = pideskApi();
    const id = sessionId ?? currentSessionId;
    if (!api || !id) return Promise.resolve(null);
    return unwrap(api.session.getStats(id)).catch(() => null);
  },

  /** 订阅会话推送（event / exit / error；状态机与消息组装在 store）。 */
  subscribe(callback: (message: SessionPushMessage) => void): () => void {
    ensureBound();
    pushListeners.add(callback);
    return () => pushListeners.delete(callback);
  },
};
