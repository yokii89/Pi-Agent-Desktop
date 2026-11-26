import type { EntryRecord } from "@earendil-works/pi-durable";
import {
  type BuiltinToolsConfig,
  parseBuiltinToolsConfig,
  type RuntimeBuiltinToolsConfig,
  type SaveBuiltinToolsConfig,
} from "./builtinTools";
import {
  DURABLE_EXTENSION_LIMIT,
  type DurableExtensionSpec,
  isDurableExtensionSpec,
} from "./durableExtension";
import {
  DURABLE_RESOURCE_LIMIT,
  type DurableResourceSpec,
  isDurableResourceSpec,
} from "./durableResources";
import { parseImageInputContents } from "./imageInput";
import type { IpcResult, PiImageContent } from "./ipc";
import type { NativeExecutionConfig as ExecutionConfig } from "./nativeBuiltins";
import {
  isNativeSessionState,
  type NativeJob,
  type NativeJobOutput,
  type NativeSessionState,
  type NativeStatePush,
  PLAN_ACTIONS,
  type PlanAction,
  type QuestionnaireReply,
} from "./nativeBuiltins";
import {
  type GatewayCatalog,
  type GatewayInput,
  type GatewayModel,
  type GatewayModelInfo,
  type GatewayThinking,
  gatewayModelRows,
} from "./newApi";

export const DURABLE_RUNTIME_MESSAGE_MAX_BYTES = 66 * 1024 * 1024;

export interface DurableDesktopApi {
  nativeState(sessionId: string): Promise<IpcResult<NativeSessionState>>;
  onNativeState(callback: (push: NativeStatePush) => void): () => void;
  nativeMode(sessionId: string, mode: "edit" | "plan"): Promise<IpcResult<null>>;
  answerQuestionnaire(
    sessionId: string,
    taskId: number,
    version: number,
    reply: QuestionnaireReply,
  ): Promise<IpcResult<string>>;
  answerPlan(
    sessionId: string,
    taskId: number,
    action: PlanAction,
  ): Promise<IpcResult<{ status: string; sessionId?: string; file?: string }>>;
  jobs(sessionId: string): Promise<IpcResult<NativeJob[]>>;
  inspectJob(sessionId: string, job: string): Promise<IpcResult<NativeJobOutput>>;
  stopJob(sessionId: string, job: string): Promise<IpcResult<NativeJobOutput>>;
  model(): Promise<IpcResult<DurableModelConfig | null>>;
  modelCatalog(force?: boolean): Promise<IpcResult<GatewayCatalog<GatewayModelInfo>>>;
  clearModelCache(): Promise<IpcResult<null>>;
  testModelConnection(): Promise<IpcResult<{ count: number; latencyMs: number }>>;
  importCodexModel(): Promise<IpcResult<DurableModelConfig>>;
  builtinTools(): Promise<IpcResult<BuiltinToolsConfig>>;
  saveBuiltinTools(config: SaveBuiltinToolsConfig): Promise<IpcResult<BuiltinToolsConfig>>;
  saveModel(
    config: Omit<DurableModelConfig, "hasKey"> & { apiKey: string },
  ): Promise<IpcResult<DurableModelConfig>>;
  history(sessionId: string, before?: number): Promise<IpcResult<DurableHistoryPage>>;
  continue(sessionId: string, requestId: string): Promise<IpcResult<unknown>>;
  compact(sessionId: string, instructions?: string): Promise<IpcResult<unknown>>;
  withdraw(sessionId: string, submissionId: number): Promise<IpcResult<unknown>>;
}

import type { DurableSessionUpdate } from "./durableSession";
import { DURABLE_SESSION_ID } from "./sessionRef";

export const DESKTOP_RETRY_ATTEMPTS = 3;

export const DURABLE_IPC = {
  model: "pidesk:durable:model",
  builtinTools: "pidesk:durable:builtinTools",
  saveBuiltinTools: "pidesk:durable:saveBuiltinTools",
  saveModel: "pidesk:durable:saveModel",
  modelCatalog: "pidesk:durable:modelCatalog",
  clearModelCache: "pidesk:durable:clearModelCache",
  testModelConnection: "pidesk:durable:testModelConnection",
  importCodexModel: "pidesk:durable:importCodexModel",
  history: "pidesk:durable:history",
  continue: "pidesk:durable:continue",
  compact: "pidesk:durable:compact",
  withdraw: "pidesk:durable:withdraw",
} as const;

/** Public metadata returned to React. A saved key is never returned. */
export interface DurableModelConfig {
  baseUrl: string;
  modelId: string;
  api: "openai-completions" | "openai-responses";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input?: GatewayInput[];
  capabilityMode?: "auto" | "manual";
  preferredThinking?: GatewayThinking;
  hasKey: boolean;
}

/** Only the trusted main process sends the decrypted key to its private utility port. */
export type RuntimeModelConfig = Omit<DurableModelConfig, "hasKey"> & {
  apiKey: string;
  models?: GatewayModel[];
};

export type DurableCommand =
  | {
      op: "initialize";
      storageRoot: string;
      model?: RuntimeModelConfig;
      builtins?: RuntimeBuiltinToolsConfig;
      execution?: ExecutionConfig;
    }
  | { op: "models" }
  | { op: "modelPreference"; modelId: string; thinkingLevel?: GatewayThinking }
  | { op: "model"; model: RuntimeModelConfig }
  | { op: "builtins"; config: RuntimeBuiltinToolsConfig }
  | { op: "executionShell"; shell: string }
  | {
      op: "openExtensionHost";
      hostId: string;
      hostScope: "app" | "settings";
      cwd: string;
      extensions: readonly DurableExtensionSpec[];
    }
  | { op: "closeExtensionHost"; hostId: string }
  | {
      op: "open";
      sessionId: string;
      cwd: string;
      create: boolean;
      extensions?: readonly DurableExtensionSpec[];
      resources?: readonly DurableResourceSpec[];
    }
  | { op: "commands" | "nativeState" | "jobs"; sessionId: string }
  | { op: "nativeMode"; sessionId: string; mode: "edit" | "plan" }
  | {
      op: "answerQuestionnaire";
      sessionId: string;
      taskId: number;
      version: number;
      reply: unknown;
    }
  | { op: "answerPlan"; sessionId: string; taskId: number; action: PlanAction }
  | { op: "inspectJob" | "stopJob"; sessionId: string; job: string }
  | {
      op: "submit";
      sessionId: string;
      requestId: string;
      text: string;
      mode: "steer" | "followUp" | "reject";
      images?: readonly PiImageContent[];
    }
  | { op: "continue"; sessionId: string; requestId: string }
  | { op: "write"; sessionId: string; requestId: string; kind: string; data: string }
  | { op: "withdraw"; sessionId: string; submissionId: number }
  | { op: "abort" | "close" | "closeIdle" | "snapshot"; sessionId: string }
  | {
      op: "configure";
      sessionId: string;
      modelId?: string;
      thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    }
  | { op: "compact"; sessionId: string; instructions?: string }
  | { op: "history" | "readHistory"; sessionId: string; before?: number; limit: number };

export type RuntimeSessionUpdate =
  | DurableSessionUpdate
  | ({ type: "nativeState" } & NativeStatePush);
export type DurableHistoryPage = readonly EntryRecord[];

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function boundedText(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === "string" &&
    (empty || value.length > 0) &&
    value.length <= max &&
    !value.includes("\0")
  );
}

export function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** JSON-only DTO limits apply in both directions, before projection or service admission. */
export function boundedJson(value: unknown, maxBytes = 8 * 1024 * 1024): boolean {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 150_000 || depth > 40) return false;
    if (item === null || typeof item === "boolean" || typeof item === "string") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every((child) => visit(child, depth + 1));
    if (!record(item) || Object.getPrototypeOf(item) !== Object.prototype) return false;
    return Object.entries(item).every(
      ([key, child]) =>
        !["__proto__", "prototype", "constructor"].includes(key) && visit(child, depth + 1),
    );
  };
  try {
    return (
      visit(value, 0) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes
    );
  } catch {
    return false;
  }
}

export function parseRuntimeModel(value: unknown): RuntimeModelConfig | null {
  if (
    !record(value) ||
    !boundedText(value.baseUrl, 4096) ||
    !boundedText(value.modelId, 256) ||
    !boundedText(value.apiKey, 16_384)
  )
    return null;
  if (value.api !== "openai-completions" && value.api !== "openai-responses") return null;
  if (
    !positiveId(value.contextWindow) ||
    value.contextWindow > 10_000_000 ||
    !positiveId(value.maxTokens) ||
    value.maxTokens > value.contextWindow ||
    typeof value.reasoning !== "boolean"
  )
    return null;
  try {
    const url = new URL(value.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
      return null;
  } catch {
    return null;
  }
  if (
    (value.input !== undefined &&
      (!Array.isArray(value.input) ||
        !value.input.length ||
        value.input.length > 2 ||
        value.input.some((item) => item !== "text" && item !== "image"))) ||
    (value.capabilityMode !== undefined &&
      value.capabilityMode !== "auto" &&
      value.capabilityMode !== "manual") ||
    (value.preferredThinking !== undefined &&
      !["off", "minimal", "low", "medium", "high", "xhigh"].includes(
        String(value.preferredThinking),
      ))
  )
    return null;
  let models: GatewayModel[] | undefined;
  if (value.models !== undefined) {
    try {
      models = gatewayModelRows(value.models, true);
    } catch {
      return null;
    }
    if (models.length !== (value.models as unknown[]).length) return null;
  }
  return {
    baseUrl: value.baseUrl,
    modelId: value.modelId,
    apiKey: value.apiKey,
    api: value.api,
    contextWindow: value.contextWindow,
    maxTokens: value.maxTokens,
    reasoning: value.reasoning,
    ...(value.input === undefined ? {} : { input: value.input as GatewayInput[] }),
    ...(value.capabilityMode === undefined ? {} : { capabilityMode: value.capabilityMode }),
    ...(value.preferredThinking === undefined
      ? {}
      : { preferredThinking: value.preferredThinking as GatewayThinking }),
    ...(models === undefined ? {} : { models }),
  };
}

export function parseDurableCommand(value: unknown): DurableCommand | null {
  if (!record(value)) return null;
  const maxBytes =
    value.op === "submit"
      ? DURABLE_RUNTIME_MESSAGE_MAX_BYTES
      : ["initialize", "model"].includes(String(value.op))
        ? 4 * 1024 * 1024
        : 512 * 1024;
  if (!boundedJson(value, maxBytes)) return null;
  if (value.op === "models") return { op: "models" };
  if (value.op === "modelPreference")
    return boundedText(value.modelId, 256) &&
      (value.thinkingLevel === undefined ||
        ["off", "minimal", "low", "medium", "high", "xhigh"].includes(String(value.thinkingLevel)))
      ? {
          op: "modelPreference",
          modelId: value.modelId,
          ...(value.thinkingLevel === undefined
            ? {}
            : { thinkingLevel: value.thinkingLevel as GatewayThinking }),
        }
      : null;
  if (value.op === "initialize") {
    const model = value.model === undefined ? undefined : parseRuntimeModel(value.model);
    const builtins =
      value.builtins === undefined ? undefined : parseBuiltinToolsConfig(value.builtins);
    if (
      value.execution !== undefined &&
      (!record(value.execution) ||
        !boundedText(value.execution.shell, 32768) ||
        !record(value.execution.env) ||
        Object.entries(value.execution.env).some(
          ([key, item]) =>
            !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || !boundedText(item, 32768, true),
        ))
    )
      return null;
    return boundedText(value.storageRoot, 32_768) && model !== null && builtins !== null
      ? {
          op: "initialize",
          storageRoot: value.storageRoot,
          ...(model ? { model } : {}),
          ...(builtins ? { builtins } : {}),
          ...(value.execution ? { execution: value.execution as ExecutionConfig } : {}),
        }
      : null;
  }
  if (value.op === "model") {
    const model = parseRuntimeModel(value.model);
    return model ? { op: "model", model } : null;
  }
  if (value.op === "executionShell")
    return boundedText(value.shell, 32768) ? { op: "executionShell", shell: value.shell } : null;
  if (value.op === "builtins") {
    const config = parseBuiltinToolsConfig(value.config);
    return config ? { op: "builtins", config } : null;
  }
  if (value.op === "openExtensionHost" || value.op === "closeExtensionHost") {
    if (!/^desktop-(?:app|settings)-[a-f0-9-]{36}$/.test(String(value.hostId))) return null;
    if (value.op === "closeExtensionHost") return { op: value.op, hostId: value.hostId as string };
    if (
      (value.hostScope !== "app" && value.hostScope !== "settings") ||
      !String(value.hostId).startsWith(`desktop-${value.hostScope}-`) ||
      !boundedText(value.cwd, 32768) ||
      !Array.isArray(value.extensions) ||
      value.extensions.length > DURABLE_EXTENSION_LIMIT ||
      !value.extensions.every(isDurableExtensionSpec)
    )
      return null;
    return {
      op: value.op,
      hostId: value.hostId as string,
      hostScope: value.hostScope,
      cwd: value.cwd,
      extensions: value.extensions,
    };
  }
  if (typeof value.sessionId !== "string" || !DURABLE_SESSION_ID.test(value.sessionId)) return null;
  const sessionId = value.sessionId.toLowerCase();
  switch (value.op) {
    case "open": {
      if (
        value.extensions !== undefined &&
        (!Array.isArray(value.extensions) ||
          value.extensions.length > DURABLE_EXTENSION_LIMIT ||
          !value.extensions.every(isDurableExtensionSpec))
      )
        return null;
      if (
        value.resources !== undefined &&
        (!Array.isArray(value.resources) ||
          value.resources.length > DURABLE_RESOURCE_LIMIT ||
          !value.resources.every(isDurableResourceSpec))
      )
        return null;
      return boundedText(value.cwd, 32_768) && typeof value.create === "boolean"
        ? {
            op: "open",
            sessionId,
            cwd: value.cwd,
            create: value.create,
            ...(value.extensions === undefined
              ? {}
              : { extensions: value.extensions as DurableExtensionSpec[] }),
            ...(value.resources === undefined
              ? {}
              : { resources: value.resources as DurableResourceSpec[] }),
          }
        : null;
    }
    case "commands":
    case "nativeState":
    case "jobs":
      return { op: value.op, sessionId };
    case "nativeMode":
      return value.mode === "edit" || value.mode === "plan"
        ? { op: "nativeMode", sessionId, mode: value.mode }
        : null;
    case "answerQuestionnaire":
      return positiveId(value.taskId) && value.version === 1 && record(value.reply)
        ? {
            op: "answerQuestionnaire",
            sessionId,
            taskId: value.taskId,
            version: 1,
            reply: value.reply,
          }
        : null;
    case "answerPlan":
      return positiveId(value.taskId) && PLAN_ACTIONS.includes(value.action as PlanAction)
        ? { op: "answerPlan", sessionId, taskId: value.taskId, action: value.action as PlanAction }
        : null;
    case "inspectJob":
    case "stopJob":
      return boundedText(value.job, 64) ? { op: value.op, sessionId, job: value.job } : null;
    case "abort":
    case "close":
    case "closeIdle":
    case "snapshot":
      return { op: value.op, sessionId };
    case "submit": {
      const images = value.images === undefined ? [] : parseImageInputContents(value.images);
      if (
        !boundedText(value.requestId, 128) ||
        !boundedText(value.text, 256_000, true) ||
        !["steer", "followUp", "reject"].includes(String(value.mode)) ||
        images === null ||
        (!value.text.trim() && images.length === 0)
      )
        return null;
      return {
        op: "submit",
        sessionId,
        requestId: value.requestId,
        text: value.text,
        mode: value.mode as "steer" | "followUp" | "reject",
        ...(images.length ? { images } : {}),
      };
    }
    case "continue":
      return boundedText(value.requestId, 128)
        ? { op: "continue", sessionId, requestId: value.requestId }
        : null;
    case "write":
      return boundedText(value.requestId, 128) &&
        boundedText(value.kind, 128) &&
        !value.kind.startsWith("pi.") &&
        boundedText(value.data, 256_000, true)
        ? { op: "write", sessionId, requestId: value.requestId, kind: value.kind, data: value.data }
        : null;
    case "withdraw":
      return positiveId(value.submissionId)
        ? { op: "withdraw", sessionId, submissionId: value.submissionId }
        : null;
    case "history":
    case "readHistory":
      return positiveId(value.limit) &&
        value.limit <= 100 &&
        (value.before === undefined || positiveId(value.before))
        ? {
            op: value.op,
            sessionId,
            limit: value.limit,
            ...(value.before === undefined ? {} : { before: value.before as number }),
          }
        : null;
    case "compact":
      return value.instructions === undefined || boundedText(value.instructions, 32_000, true)
        ? {
            op: "compact",
            sessionId,
            ...(value.instructions === undefined
              ? {}
              : { instructions: value.instructions as string }),
          }
        : null;
    case "configure": {
      if (
        Object.keys(value).some(
          (key) => !["op", "sessionId", "modelId", "thinkingLevel"].includes(key),
        )
      )
        return null;
      if (value.modelId !== undefined && !boundedText(value.modelId, 256)) return null;
      if (
        value.thinkingLevel !== undefined &&
        !["off", "minimal", "low", "medium", "high", "xhigh"].includes(String(value.thinkingLevel))
      )
        return null;
      return {
        op: "configure",
        sessionId,
        ...(value.modelId === undefined ? {} : { modelId: value.modelId as string }),
        ...(value.thinkingLevel === undefined
          ? {}
          : { thinkingLevel: value.thinkingLevel as "off" }),
      };
    }
    default:
      return null;
  }
}

function validMessage(value: unknown): boolean {
  if (!record(value) || !["system", "user", "assistant", "toolResult"].includes(String(value.role)))
    return false;
  if (typeof value.content === "string") return value.role === "system" || value.role === "user";
  if (!Array.isArray(value.content)) return false;
  if (
    !value.content.every((block) => {
      if (!record(block)) return false;
      if (block.type === "text") return typeof block.text === "string";
      if (block.type === "thinking") return typeof block.thinking === "string";
      if (block.type === "toolCall")
        return (
          boundedText(block.id, 512) && boundedText(block.name, 512) && record(block.arguments)
        );
      if (block.type === "image")
        return typeof block.data === "string" && boundedText(block.mimeType, 128);
      return false;
    })
  )
    return false;
  if (
    value.role === "toolResult" &&
    (!boundedText(value.toolCallId, 512) || !boundedText(value.toolName, 512))
  )
    return false;
  if (value.usage !== undefined) {
    if (
      !record(value.usage) ||
      !["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
        (key) =>
          typeof (value.usage as Record<string, unknown>)[key] === "number" &&
          Number.isFinite((value.usage as Record<string, unknown>)[key]),
      )
    )
      return false;
  }
  return true;
}

export function validEntries(value: unknown): value is EntryRecord[] {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every(
      (entry) =>
        record(entry) &&
        positiveId(entry.id) &&
        positiveId(entry.conversationId) &&
        boundedText(entry.kind, 256) &&
        (entry.byTaskId === undefined || positiveId(entry.byTaskId)) &&
        (entry.model === undefined ||
          (Array.isArray(entry.model) && entry.model.every(validMessage))),
    )
  );
}

function validLive(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  if (
    value.run !== undefined &&
    (!record(value.run) || !positiveId(value.run.taskId) || !Array.isArray(value.run.inputs))
  )
    return false;
  if (
    value.generation !== undefined &&
    (!record(value.generation) ||
      !positiveId(value.generation.attempt) ||
      (value.generation.message !== undefined && !validMessage(value.generation.message)))
  )
    return false;
  for (const key of ["tools", "nestedTools"] as const) {
    const tools = value[key];
    if (
      tools !== undefined &&
      (!Array.isArray(tools) ||
        !tools.every(
          (tool) =>
            record(tool) &&
            boundedText(tool.callId, 512) &&
            boundedText(tool.name, 512) &&
            ["pending", "running", "sleeping", "waiting", "done"].includes(String(tool.status)) &&
            (tool.output === undefined || typeof tool.output === "string") &&
            (key !== "nestedTools" || boundedText(tool.parentCallId, 512)),
        ))
    )
      return false;
  }
  if (
    value.compactions !== undefined &&
    (!Array.isArray(value.compactions) ||
      !value.compactions.every(
        (item) =>
          record(item) &&
          positiveId(item.taskId) &&
          ["manual", "threshold", "overflow"].includes(String(item.trigger)),
      ))
  )
    return false;
  if (
    value.runFailure !== undefined &&
    (!record(value.runFailure) ||
      !positiveId(value.runFailure.taskId) ||
      !boundedText(value.runFailure.reason, 128) ||
      (value.runFailure.detail !== undefined && typeof value.runFailure.detail !== "string"))
  )
    return false;
  return true;
}

export function parseRuntimeUpdate(value: unknown): RuntimeSessionUpdate | null {
  if (
    !record(value) ||
    !boundedJson(value, DURABLE_RUNTIME_MESSAGE_MAX_BYTES) ||
    typeof value.sessionId !== "string" ||
    !DURABLE_SESSION_ID.test(value.sessionId)
  )
    return null;
  if (value.type === "nativeState")
    return isNativeSessionState(value.state) ? (value as RuntimeSessionUpdate) : null;
  if (value.type === "error")
    return boundedText(value.error, 2000, true) ? (value as RuntimeSessionUpdate) : null;
  if (value.type === "entries")
    return validEntries(value.entries) ? (value as RuntimeSessionUpdate) : null;
  if (!["snapshot", "live", "settled"].includes(String(value.type))) return null;
  const view = value.view;
  if (
    !record(view) ||
    !record(view.conversation) ||
    !positiveId(view.conversation.id) ||
    !validEntries(view.entries) ||
    !record(view.docs) ||
    !validLive(view.docs["pi.live"])
  )
    return null;
  const conversationId = view.conversation.id;
  if (view.entries.some((entry) => entry.conversationId !== conversationId)) return null;
  const inbox = view.docs["pi.inbox"];
  if (
    inbox !== undefined &&
    (!record(inbox) ||
      !Array.isArray(inbox.items) ||
      !inbox.items.every(
        (item) =>
          record(item) &&
          positiveId(item.id) &&
          ["steer", "followUp", "write"].includes(String(item.mode)),
      ))
  )
    return null;
  return value as RuntimeSessionUpdate;
}
