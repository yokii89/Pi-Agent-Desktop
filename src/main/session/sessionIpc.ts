import { ipcMain } from "electron";
import type {
  IpcResult,
  PiAuthSnapshot,
  PiInfo,
  PiModelOption,
  PiModelState,
  PiSessionStats,
  PiShellProbe,
  PiSlashCommand,
  SessionGetModelsRequest,
  SessionId,
  SessionPromptRequest,
  SessionSetModelRequest,
  SessionSetThinkingLevelRequest,
  SessionStartRequest,
  SessionSummary,
  SessionTranscriptPayload,
  ThinkingLevelId,
} from "../../shared/ipc";
import { AUTH_IPC, PI_IPC, SESSION_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { getSettings } from "../settings/settings";
import { buildContextBreakdown } from "./contextBreakdown";
import { invalidateGatewayModelCache, listApiKeyProviders } from "./piAuth";
import {
  activateCredential,
  listCredentials,
  reassertActiveCredential,
  removeCredential,
  syncPreferredModelForActive,
  upsertCredential,
} from "./piCredentials";
import { getPiInfo } from "./piInfo";
import { fetchAvailableModelsOnce } from "./piModelList";
import {
  applyDefaultModelToSession,
  disposeSession,
  fetchAvailableModels,
  fetchSessionMessages,
  fetchSessionState,
  fetchSessionStats,
  fetchSlashCommands,
  hasSession,
  interruptSession,
  promptSession,
  setSessionModel,
  setThinkingLevel,
} from "./piSession";
import { readDefaultModel, setDefaultModel } from "./piSettings";
import { getCachedPiShellProbe, setPiShellPath } from "./piShell";
import { assertNoModeTransition, ensureSessionReady } from "./runtimeCoordinator";
import { listAllSessions, listSessions, removeSession } from "./sessionHistory";
import { readSessionTranscript } from "./sessionTranscriptRead";

const THINKING_LEVELS = new Set<string>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/** 输入栏展示的三档（对齐设计图）；pi 其余档位原样透出但 UI 默认只给这三档。 */
const DISPLAY_THINKING: ThinkingLevelId[] = ["low", "high", "max"];

function requireSessionId(raw: unknown): SessionId {
  if (typeof raw === "string" && raw.length > 0) return raw;
  throw new Error("缺少 sessionId");
}

function normalizeThinkingLevel(raw: unknown): ThinkingLevelId {
  if (raw === "low" || raw === "high" || raw === "max") return raw;
  if (raw === "minimal" || raw === "off") return "low";
  if (raw === "medium" || raw === "xhigh") return "high";
  return "high";
}

function mapSlashCommands(data: unknown): PiSlashCommand[] {
  const raw =
    data && typeof data === "object" && Array.isArray((data as { commands?: unknown }).commands)
      ? (data as { commands: unknown[] }).commands
      : [];
  const out: PiSlashCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { name?: unknown; description?: unknown; source?: unknown };
    if (typeof record.name !== "string" || !record.name) continue;
    const source =
      record.source === "extension" || record.source === "prompt" || record.source === "skill"
        ? record.source
        : "extension";
    out.push({
      name: record.name,
      description: typeof record.description === "string" ? record.description : undefined,
      source,
    });
  }
  return out;
}

function mapModelInput(raw: unknown): PiModelOption["input"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<PiModelOption["input"]> = [];
  for (const item of raw) {
    if (item === "text" || item === "image") out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

function mapModels(data: unknown): PiModelOption[] {
  const raw =
    data && typeof data === "object" && Array.isArray((data as { models?: unknown }).models)
      ? (data as { models: unknown[] }).models
      : [];
  const out: PiModelOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as { provider?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (typeof record.provider !== "string" || typeof record.id !== "string") continue;
    const label =
      typeof record.name === "string" && record.name
        ? record.name
        : `${record.provider}/${record.id}`;
    const input = mapModelInput(record.input);
    out.push({
      provider: record.provider,
      modelId: record.id,
      label,
      ...(input ? { input } : {}),
    });
  }
  return out;
}

function mapModelState(state: unknown, fallbackLabel: string | null): PiModelState {
  const record =
    state && typeof state === "object"
      ? (state as {
          model?: {
            provider?: unknown;
            id?: unknown;
            name?: unknown;
            input?: unknown;
            contextWindow?: unknown;
          };
          thinkingLevel?: unknown;
          autoCompactionEnabled?: unknown;
        })
      : {};
  const model = record.model;
  let modelLabel = fallbackLabel;
  let modelInput: PiModelState["modelInput"] = null;
  let contextWindow: number | null = null;
  if (model && typeof model === "object") {
    if (typeof model.name === "string" && model.name) modelLabel = model.name;
    else if (typeof model.provider === "string" && typeof model.id === "string") {
      modelLabel = `${model.provider}/${model.id}`;
    }
    modelInput = mapModelInput(model.input) ?? null;
    if (typeof model.contextWindow === "number" && model.contextWindow > 0) {
      contextWindow = model.contextWindow;
    }
  }
  return {
    modelLabel,
    thinkingLevel: normalizeThinkingLevel(record.thinkingLevel),
    availableThinkingLevels: DISPLAY_THINKING,
    modelInput,
    contextWindow,
    autoCompactionEnabled: record.autoCompactionEnabled === true,
  };
}

function mapSessionStats(data: unknown): PiSessionStats {
  const record = data && typeof data === "object" ? (data as { contextUsage?: unknown }) : {};
  const raw = record.contextUsage;
  if (!raw || typeof raw !== "object") return {};
  const usage = raw as {
    tokens?: unknown;
    contextWindow?: unknown;
    percent?: unknown;
  };
  if (typeof usage.contextWindow !== "number" || usage.contextWindow <= 0) return {};
  return {
    contextUsage: {
      tokens: typeof usage.tokens === "number" ? usage.tokens : null,
      contextWindow: usage.contextWindow,
      percent: typeof usage.percent === "number" ? usage.percent : null,
    },
  };
}

function extractSessionModelProvider(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const model = (state as { model?: { provider?: unknown } }).model;
  if (model && typeof model === "object" && typeof model.provider === "string") {
    return model.provider;
  }
  return null;
}

function piInfoFallbackLabel(info: PiInfo): string | null {
  if (info.model == null) return null;
  return info.provider != null ? `${info.provider}/${info.model}` : info.model;
}

/** 注册 pi RPC 会话 IPC（多实例：进程绑定 handler 必须带 sessionId）。 */
export function registerSessionIpc(): void {
  ipcMain.handle(
    SESSION_IPC.start,
    (_event, req: SessionStartRequest): Promise<IpcResult<SessionId>> =>
      envelopeAsync(async () => {
        const { sessionId: id } = await ensureSessionReady(req ?? {});
        // 等默认模型真正落到目标会话（含 --session 恢复竞态的重试），再让渲染层刷 modelLabel
        await applyDefaultModelToSession(id, { retries: 4, delayMs: 300 });
        // 会话恢复可能改写 settings；用注册表激活项再钉一次（同步写，Node 单线程内无交错）
        reassertActiveCredential();
        // RPC 已可用：runtime 状态推进到 ready/idle（访问模式三态依赖）
        return id;
      }),
  );

  ipcMain.handle(
    SESSION_IPC.prompt,
    (_event, req: SessionPromptRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        const sessionId = requireSessionId(req?.sessionId);
        assertNoModeTransition(sessionId);
        const text = typeof req?.text === "string" ? req.text : "";
        // 与渲染层 MAX_ATTACH_IMAGES 对齐的纵深防御：坏客户端也灌不进无限图
        const MAX_PROMPT_IMAGES = 8;
        const images = Array.isArray(req?.images)
          ? req.images
              .filter(
                (img): img is NonNullable<typeof img> =>
                  !!img &&
                  typeof img === "object" &&
                  (img as { type?: unknown }).type === "image" &&
                  typeof (img as { data?: unknown }).data === "string" &&
                  typeof (img as { mimeType?: unknown }).mimeType === "string",
              )
              .slice(0, MAX_PROMPT_IMAGES)
          : [];
        if (text.trim().length === 0 && images.length === 0) {
          throw new Error("输入不能为空");
        }
        // 只等待 pi 接受 prompt 请求；执行中的失败以事件形式推送
        await promptSession(sessionId, text, images.length > 0 ? images : undefined);
        return null;
      }),
  );

  ipcMain.handle(
    SESSION_IPC.stop,
    (_event, req: { sessionId?: unknown }): IpcResult<null> =>
      envelope(() => {
        interruptSession(requireSessionId(req?.sessionId));
        return null;
      }),
  );

  ipcMain.handle(
    SESSION_IPC.dispose,
    (_event, req: { sessionId?: unknown }): IpcResult<null> =>
      envelope(() => {
        disposeSession(requireSessionId(req?.sessionId));
        return null;
      }),
  );

  ipcMain.handle(
    SESSION_IPC.list,
    (_event, req: { cwd: string }): Promise<IpcResult<SessionSummary[]>> =>
      envelopeAsync(() => listSessions(req.cwd)),
  );

  ipcMain.handle(
    SESSION_IPC.listAll,
    (): Promise<IpcResult<SessionSummary[]>> => envelopeAsync(() => listAllSessions()),
  );

  ipcMain.handle(
    SESSION_IPC.messages,
    (_event, req: { sessionId?: unknown }): Promise<IpcResult<unknown[]>> =>
      envelopeAsync(() => fetchSessionMessages(requireSessionId(req?.sessionId))),
  );

  ipcMain.handle(
    SESSION_IPC.remove,
    (_event, req: { file: string }): Promise<IpcResult<null>> =>
      envelopeAsync(() => removeSession(req?.file)),
  );

  ipcMain.handle(
    SESSION_IPC.readTranscript,
    (_event, req: { file: string }): Promise<IpcResult<SessionTranscriptPayload>> =>
      envelopeAsync(() => readSessionTranscript(req?.file)),
  );

  ipcMain.handle(
    SESSION_IPC.getCommands,
    (_event, req: { sessionId?: unknown }): Promise<IpcResult<PiSlashCommand[]>> =>
      envelopeAsync(async () => {
        // 按 sessionId 判活：目标未启动不得读到其它会话状态（A5）
        const sessionId = requireSessionId(req?.sessionId);
        if (!hasSession(sessionId)) return [];
        return mapSlashCommands(await fetchSlashCommands(sessionId));
      }),
  );

  ipcMain.handle(
    SESSION_IPC.setThinkingLevel,
    (_event, req: SessionSetThinkingLevelRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        const sessionId = requireSessionId(req?.sessionId);
        const level = req?.level;
        if (typeof level !== "string" || !THINKING_LEVELS.has(level)) {
          throw new Error("无效的思考档位");
        }
        if (!hasSession(sessionId)) throw new Error("会话未启动");
        await setThinkingLevel(sessionId, level);
        return null;
      }),
  );

  ipcMain.handle(
    SESSION_IPC.getModelState,
    (_event, req: { sessionId?: unknown }): Promise<IpcResult<PiModelState>> =>
      envelopeAsync(async () => {
        const sessionId = requireSessionId(req?.sessionId);
        const info = getPiInfo(getSettings().piExecutablePath);
        const fallback = piInfoFallbackLabel(info);
        if (!hasSession(sessionId)) {
          // 目标未启动：回退 pi 配置，不得误读其它存活实例（A5）
          return {
            modelLabel: fallback,
            thinkingLevel: normalizeThinkingLevel(info.thinkingLevel),
            availableThinkingLevels: DISPLAY_THINKING,
            modelInput: null,
            contextWindow: null,
            autoCompactionEnabled: false,
          };
        }
        const state = await fetchSessionState(sessionId);
        const sessionProvider = extractSessionModelProvider(state);
        const { provider: defaultProvider } = readDefaultModel();
        // 自愈：会话仍挂在旧凭据 provider（切换竞态 / --session 恢复写回）时重新对齐
        if (defaultProvider && sessionProvider && sessionProvider !== defaultProvider) {
          await applyDefaultModelToSession(sessionId, { retries: 2, delayMs: 200 });
          reassertActiveCredential();
          return mapModelState(await fetchSessionState(sessionId), fallback);
        }
        return mapModelState(state, fallback);
      }),
  );

  ipcMain.handle(
    SESSION_IPC.getStats,
    (_event, req: { sessionId?: unknown }): Promise<IpcResult<PiSessionStats>> =>
      envelopeAsync(async () => {
        const sessionId = requireSessionId(req?.sessionId);
        if (!hasSession(sessionId)) throw new Error("会话未启动");
        const stats = mapSessionStats(await fetchSessionStats(sessionId));
        // 分类明细：get_messages + get_commands 本地估算（相对占比）；失败则只返回总量
        try {
          const [messages, commandsRaw] = await Promise.all([
            fetchSessionMessages(sessionId),
            fetchSlashCommands(sessionId),
          ]);
          const breakdown = buildContextBreakdown({
            messages,
            commands: mapSlashCommands(commandsRaw),
            realTokens: stats.contextUsage?.tokens ?? null,
          });
          return {
            ...stats,
            breakdown: breakdown.slices,
            otherPercent: breakdown.otherPercent,
          };
        } catch {
          return stats;
        }
      }),
  );

  ipcMain.handle(
    SESSION_IPC.getModels,
    (_event, req?: SessionGetModelsRequest): Promise<IpcResult<PiModelOption[]>> =>
      envelopeAsync(async () => {
        const force = req?.force === true;
        const sessionId = typeof req?.sessionId === "string" ? req.sessionId : null;
        if (force) {
          // 先把 auth.json 钉回激活凭据，再清网关缓存；否则历史双键会让短连吐出 A+B 全量
          reassertActiveCredential();
          invalidateGatewayModelCache();
        }
        // force 时一律短连；非 force 仅当目标 sessionId 存活才走会话 RPC（钉死目标，防串会话）
        const useLive = !force && sessionId !== null && hasSession(sessionId);
        const data = useLive
          ? await fetchAvailableModels(sessionId as SessionId)
          : await fetchAvailableModelsOnce();
        return mapModels(data);
      }),
  );

  ipcMain.handle(
    SESSION_IPC.setModel,
    (_event, req: SessionSetModelRequest): Promise<IpcResult<PiModelOption>> =>
      envelopeAsync(async () => {
        const sessionId = requireSessionId(req?.sessionId);
        if (typeof req?.provider !== "string" || typeof req?.modelId !== "string") {
          throw new Error("参数不完整");
        }
        const provider = req.provider.trim();
        const modelId = req.modelId.trim();
        if (!provider || !modelId) throw new Error("参数不完整");
        // 模型必须属于当前激活凭据的 provider，避免把 defaultProvider 写飞、与 activeCredentialId 分叉
        const snap = listCredentials();
        if (snap.activeProvider && provider !== snap.activeProvider) {
          throw new Error(`当前激活凭据是「${snap.activeProvider}」，请先切换到对应厂商的凭据`);
        }
        // 无论会话是否存活，都把默认模型写入 pi settings，下次启动沿用
        setDefaultModel(provider, modelId);
        syncPreferredModelForActive(provider, modelId);
        const fallback: PiModelOption = {
          provider,
          modelId,
          label: `${provider}/${modelId}`,
          sessionApplied: false,
        };
        // C2：改默认模型时广播到所有存活实例；目标会话未启动也广播其它实例
        let targetApplied = false;
        if (hasSession(sessionId)) {
          try {
            const data = await setSessionModel(sessionId, provider, modelId);
            const models = mapModels({ models: data ? [data] : [] });
            const mapped = models[0];
            if (mapped) {
              targetApplied = true;
              // 其余存活实例对齐同一模型（失败不回滚磁盘默认，toast 由渲染层看 sessionApplied）
              await applyDefaultModelToSession("all", { retries: 1, delayMs: 150 });
              return { ...mapped, sessionApplied: true };
            }
          } catch {
            // Model not found 等：回落
          }
        }
        await applyDefaultModelToSession("all", { retries: 1, delayMs: 150 });
        return targetApplied ? fallback : { ...fallback, sessionApplied: false };
      }),
  );

  ipcMain.handle(
    SESSION_IPC.setDefaultModel,
    (_event, req: { provider: string; modelId: string }): IpcResult<null> =>
      envelope(() => {
        if (typeof req?.provider !== "string" || typeof req?.modelId !== "string") {
          throw new Error("参数不完整");
        }
        const provider = req.provider.trim();
        const modelId = req.modelId.trim();
        if (!provider || !modelId) throw new Error("参数不完整");
        setDefaultModel(provider, modelId);
        return null;
      }),
  );

  ipcMain.handle(AUTH_IPC.list, (): IpcResult<PiAuthSnapshot> => envelope(() => listCredentials()));

  ipcMain.handle(
    AUTH_IPC.listApiKeyProviders,
    (): IpcResult<ReturnType<typeof listApiKeyProviders>> => envelope(() => listApiKeyProviders()),
  );

  ipcMain.handle(
    AUTH_IPC.upsert,
    (
      _event,
      req: {
        id?: string | null;
        name: string;
        provider: string;
        apiKey?: string | null;
        baseUrl?: string | null;
        api?: string | null;
        preferredModel?: string | null;
      },
    ): Promise<IpcResult<PiAuthSnapshot>> =>
      envelopeAsync(async () => {
        if (typeof req?.provider !== "string") throw new Error("参数不完整");
        if (typeof req?.name !== "string" || !req.name.trim()) throw new Error("请填写凭据名称");
        const snapshot = upsertCredential(req);
        await applyDefaultModelToSession("all", { retries: 2, delayMs: 200 });
        reassertActiveCredential();
        return snapshot;
      }),
  );

  ipcMain.handle(
    AUTH_IPC.setActive,
    (_event, req: { id?: string; provider?: string }): Promise<IpcResult<PiAuthSnapshot>> =>
      envelopeAsync(async () => {
        const id = typeof req?.id === "string" ? req.id.trim() : "";
        if (!id) throw new Error("参数不完整");
        const snapshot = activateCredential(id);
        // 等 set_model 真正成功再返回，避免渲染层刷 modelLabel 时仍是旧凭据
        await applyDefaultModelToSession("all", { retries: 3, delayMs: 250 });
        reassertActiveCredential();
        return snapshot;
      }),
  );

  ipcMain.handle(
    AUTH_IPC.remove,
    (_event, req: { id?: string; provider?: string }): Promise<IpcResult<PiAuthSnapshot>> =>
      envelopeAsync(async () => {
        const id = typeof req?.id === "string" ? req.id.trim() : "";
        if (!id) throw new Error("参数不完整");
        const snapshot = removeCredential(id);
        await applyDefaultModelToSession("all", { retries: 2, delayMs: 200 });
        reassertActiveCredential();
        return snapshot;
      }),
  );

  ipcMain.handle(
    PI_IPC.info,
    (_event, req: { path?: string | null }): IpcResult<PiInfo> =>
      envelope(() => getPiInfo(req?.path ?? getSettings().piExecutablePath)),
  );

  ipcMain.handle(
    PI_IPC.shellGet,
    (): IpcResult<PiShellProbe> => envelope(() => getCachedPiShellProbe()),
  );

  ipcMain.handle(
    PI_IPC.shellSet,
    (_event, req: { path?: string | null } | undefined): IpcResult<PiShellProbe> =>
      envelope(() => {
        const value = req?.path;
        if (typeof value === "string") {
          if (value.trim().length === 0) throw new Error("shellPath 不能为空字符串");
          return setPiShellPath(value);
        }
        if (value === null) return setPiShellPath(null);
        throw new Error("shellPath 必须是非空字符串或 null");
      }),
  );
}
