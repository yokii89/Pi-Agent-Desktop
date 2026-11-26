import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import { app, shell } from "electron";
import { durableDisplayMessages } from "../../shared/durableExtension";
import type { DurableCommand, RuntimeSessionUpdate } from "../../shared/durableProtocol";
import { record, validEntries } from "../../shared/durableProtocol";
import {
  DURABLE_COMMAND_CATALOG_LIMIT,
  isDurableCommandMetadata,
} from "../../shared/durableResources";
import { parseImageInputContents } from "../../shared/imageInput";
import type {
  PiAgentEvent,
  PiChatMessage,
  PiImageContent,
  PiModelState,
  PiQueuedMessages,
  PiSlashCommand,
  SessionId,
  SessionPushMessage,
  SessionStartRequest,
} from "../../shared/ipc";
import { SESSION_IPC } from "../../shared/ipc";
import { NATIVE_IPC } from "../../shared/nativeBuiltins";
import {
  type GatewayCatalog,
  type GatewayModelInfo,
  isGatewayModelInfo,
  NEWAPI_MODEL_LIMIT,
} from "../../shared/newApi";
import { DURABLE_SESSION_ID, sessionRefFromKey, sessionRefKey } from "../../shared/sessionRef";
import { discoverDurableExtensions } from "../extension/durableExtensions";
import { discoverDurableResources } from "../extension/durableResources";
import { resolveBashForTerminal } from "../session/piShell";
import {
  markRuntimeActivity,
  markRuntimeExit,
  markRuntimeReady,
  markRuntimeUsedByUser,
  noteSessionSpawned,
} from "../session/runtimeCoordinator";
import { clearSessionCwd, noteSessionCwd } from "../session/sessionCwdRegistry";
import { publishSessionEvent } from "../session/sessionEvents";
import { readBuiltinTools } from "../settings/builtinToolsStore";
import {
  durableCatalog,
  durableStorageRoot,
  readDurableModel,
  removeDurableSummary,
  saveDurableModel,
  saveDurableSummary,
} from "../settings/durableStore";
import { loadGatewayCatalog } from "../settings/newApiStore";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";
import { agentRuntimeManager } from "./agentRuntimeManager";
import { DurableProjection } from "./durableProjection";
import { localizeRuntimeError } from "./runtimeError";

interface Attachment {
  id: SessionId;
  storedId: string;
  projection: DurableProjection;
  view?: ConversationView;
  closing?: Promise<void>;
  events: PiAgentEvent[];
  settled: boolean;
  pending: number;
  epoch: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** App-owned session router; the UI instance ID is never used to resolve a database path. */
class DesktopSessions {
  private readonly attachments = new Map<SessionId, Attachment>();
  private readonly byStoredId = new Map<string, SessionId>();
  private readonly opening = new Map<string, Promise<SessionId>>();
  private initialized?: Promise<void>;
  private changingModel = false;
  private models: GatewayModelInfo[] = [];
  private catalogStatus: GatewayCatalog = {
    models: [],
    fetchedAt: null,
    stale: false,
    error: null,
  };
  private catalogStamp = "";

  constructor() {
    agentRuntimeManager.subscribe(
      (update) => this.update(update),
      (error) => {
        this.initialized = undefined;
        for (const attachment of this.attachments.values()) {
          markRuntimeExit(attachment.id);
          clearSessionCwd(attachment.id);
          this.flush(attachment);
          this.push(attachment.id, {
            sessionId: attachment.id,
            type: "error",
            payload: error.message,
          });
          this.push(attachment.id, { sessionId: attachment.id, type: "exit", payload: 1 });
        }
        this.attachments.clear();
        this.byStoredId.clear();
      },
    );
  }

  async initialize(): Promise<void> {
    if (!this.initialized) {
      const operation = (async () => {
        const model = readDurableModel();
        this.catalogStatus = await loadGatewayCatalog();
        const runtimeModel = model ? { ...model, models: this.catalogStatus.models } : undefined;
        await agentRuntimeManager.request({
          op: "initialize",
          storageRoot: durableStorageRoot(),
          model: runtimeModel,
          builtins: readBuiltinTools(),
          execution: {
            shell:
              resolveBashForTerminal() ??
              (process.platform === "win32"
                ? "C:\\Program Files\\Git\\bin\\bash.exe"
                : "/bin/bash"),
            env: Object.fromEntries(
              [
                "PATH",
                "Path",
                "SystemRoot",
                "WINDIR",
                "TEMP",
                "TMP",
                "USERPROFILE",
                "APPDATA",
                "LOCALAPPDATA",
                "HOMEDRIVE",
                "HOMEPATH",
                "COMSPEC",
                "PATHEXT",
                "LANG",
              ].flatMap((key) =>
                process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
              ),
            ),
          },
        });
        this.catalogStamp = JSON.stringify(runtimeModel);
        await this.readModels();
      })();
      this.initialized = operation;
      void operation.catch(() => {
        if (this.initialized === operation) this.initialized = undefined;
      });
    }
    return this.initialized;
  }

  start(request: SessionStartRequest): Promise<SessionId> {
    if (this.changingModel)
      return Promise.reject(new Error("Wait for the gateway configuration to finish saving."));
    const key = request.ref
      ? sessionRefKey(request.ref)
      : (request.sessionFile ?? request.sessionId ?? randomUUID());
    const opening = this.opening.get(key);
    if (opening) return opening;
    const operation = this.open(request).finally(() => {
      if (this.opening.get(key) === operation) this.opening.delete(key);
    });
    this.opening.set(key, operation);
    return operation;
  }

  async executePlanInNewSession(
    sourceId: string,
    taskId: number,
    text: string,
    artifact: string,
  ): Promise<{ sessionId: string; file: string }> {
    const source = this.require(sourceId);
    const cwd = durableCatalog().find((item) => item.id === source.storedId)?.cwd;
    if (!cwd) throw new Error("Unknown plan workspace.");
    const hex = createHash("sha256").update(`plan:${source.storedId}:${taskId}`).digest("hex");
    const storedId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    let opening = this.opening.get(`plan:${storedId}`);
    if (!opening) {
      opening = this.open({ cwd, sessionId: `sess_${storedId}` }, storedId).finally(() =>
        this.opening.delete(`plan:${storedId}`),
      );
      this.opening.set(`plan:${storedId}`, opening);
    }
    const id = await opening;
    await this.submit(
      id,
      `Implement the approved plan saved at ${artifact}.\n\n${text}`,
      "followUp",
      `plan:${storedId}`,
    );
    return { sessionId: id, file: sessionRefKey({ kind: "durable", id: storedId }) };
  }

  private async open(request: SessionStartRequest, fixedStoredId?: string): Promise<SessionId> {
    const ref =
      request.ref ?? (request.sessionFile ? sessionRefFromKey(request.sessionFile) : undefined);
    if (ref?.kind === "legacy-jsonl")
      throw new Error(
        "Legacy JSONL sessions are read-only. Create a new Durable session to send messages.",
      );
    if (ref && !DURABLE_SESSION_ID.test(ref.id))
      throw new Error("Invalid Durable session reference.");
    const storedId =
      fixedStoredId ??
      ref?.id.toLowerCase() ??
      this.attachments.get(request.sessionId ?? "")?.storedId ??
      randomUUID();
    const known = durableCatalog().find((item) => item.id === storedId);
    if (ref && !known) throw new Error("Durable session does not exist.");
    const cwd = path.resolve(known?.cwd ?? request.cwd ?? homedir());
    if (known && request.cwd && path.resolve(request.cwd) !== cwd)
      throw new Error("Session belongs to another project.");
    const existingId = this.byStoredId.get(storedId);
    if (existingId) {
      const existing = this.attachments.get(existingId);
      if (existing?.closing) {
        await existing.closing;
        return this.open(request, fixedStoredId);
      }
      // Reattach after renderer reload with replacement, never replay completion events.
      await this.command(existingId, { op: "snapshot", sessionId: storedId });
      return existingId;
    }
    const id = request.sessionId ?? `sess_${randomUUID()}`;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || this.attachments.has(id))
      throw new Error("UI session ID is already attached.");
    if (this.attachments.size >= getSettings().maxParallelSessions)
      throw new Error(`并行会话已达上限（${getSettings().maxParallelSessions}）`);
    await this.refreshModels();
    if (this.attachments.size >= getSettings().maxParallelSessions)
      throw new Error(`并行会话已达上限（${getSettings().maxParallelSessions}）`);
    const attachment: Attachment = {
      id,
      storedId,
      projection: new DurableProjection(storedId),
      events: [],
      settled: false,
      pending: 0,
      epoch: 0,
    };
    this.attachments.set(id, attachment);
    this.byStoredId.set(storedId, id);
    noteSessionCwd(id, cwd);
    noteSessionSpawned({
      sessionId: id,
      sessionFile: sessionRefKey({ kind: "durable", id: storedId }),
      cwd,
      reason: request.reason,
    });
    try {
      // Persist the index before the first snapshot so fast runs can update their preview.
      if (!known) {
        const now = Date.now();
        saveDurableSummary({
          ref: { kind: "durable", id: storedId },
          file: sessionRefKey({ kind: "durable", id: storedId }),
          id: storedId,
          cwd,
          startedAt: now,
          updatedAt: now,
          firstUserMessage: null,
          sessionName: null,
        });
      }
      const extensions = discoverDurableExtensions(cwd);
      await agentRuntimeManager.request({
        op: "open",
        sessionId: storedId,
        cwd,
        create: !known,
        extensions,
        resources: discoverDurableResources(cwd, app.getPath("home")),
      });
      await this.readModels();
      markRuntimeReady(id);
      if (!attachment.settled) markRuntimeActivity(id, "busy");
      return id;
    } catch (error) {
      markRuntimeExit(id);
      clearSessionCwd(id);
      if (!known) removeDurableSummary(storedId);
      if (this.attachments.get(id) === attachment) {
        this.attachments.delete(id);
        this.byStoredId.delete(storedId);
      }
      if (error instanceof Error) {
        const message = localizeRuntimeError(error.message);
        if (message !== error.message) throw new Error(message);
      }
      throw error;
    }
  }

  require(id: string): Attachment {
    const attachment = this.attachments.get(id);
    if (!attachment || attachment.closing)
      throw new Error("Durable session is not open. Reopen it to recover saved history.");
    return attachment;
  }

  async command(id: string, command: DurableCommand): Promise<unknown> {
    const attachment = this.require(id);
    if (!("sessionId" in command) || command.sessionId !== attachment.storedId)
      throw new Error("Session identity mismatch.");
    const working = ["submit", "continue", "compact", "abort", "write"].includes(command.op);
    const wasSettled = attachment.settled;
    attachment.pending++;
    if (working) {
      attachment.epoch++;
      attachment.settled = false;
      markRuntimeUsedByUser(id);
      markRuntimeActivity(id, "busy");
    }
    const epoch = attachment.epoch;
    try {
      return await agentRuntimeManager.request(command);
    } catch (error) {
      // A rejected command expansion admitted no work and will not produce a settled update.
      if (
        working &&
        wasSettled &&
        attachment.epoch === epoch &&
        !attachment.view?.docs["pi.live"]?.run
      )
        attachment.settled = true;
      throw error;
    } finally {
      attachment.pending--;
      if (working && attachment.settled) markRuntimeActivity(id, "idle");
    }
  }

  async submit(
    id: string,
    text: string,
    mode: "steer" | "followUp" | "reject" = "followUp",
    requestId: string = randomUUID(),
    images?: readonly PiImageContent[],
  ): Promise<"started" | "queued" | "handled"> {
    const attachment = this.require(id);
    if (!readDurableModel())
      throw new Error("Configure a model in Settings → Models before sending.");
    const result = await this.command(id, {
      op: "submit",
      sessionId: attachment.storedId,
      requestId,
      text,
      mode,
      ...(images?.length ? { images } : {}),
    });
    if (!record(result) || !["started", "queued", "handled"].includes(String(result.disposition)))
      throw new Error("Invalid Durable admission response.");
    return result.disposition as "started" | "queued" | "handled";
  }

  async commands(id: string): Promise<PiSlashCommand[]> {
    const attachment = this.require(id);
    const value = await this.command(id, { op: "commands", sessionId: attachment.storedId });
    if (
      !Array.isArray(value) ||
      value.length > DURABLE_COMMAND_CATALOG_LIMIT ||
      !value.every(isDurableCommandMetadata)
    )
      throw new Error("Invalid native command catalog.");
    return value as PiSlashCommand[];
  }

  async clearQueue(id: string): Promise<PiQueuedMessages> {
    const attachment = this.require(id);
    const items = attachment.view?.docs["pi.inbox"]?.items;
    const removed: PiQueuedMessages = { steering: [], followUp: [] };
    const imageAttachments: NonNullable<PiQueuedMessages["imageAttachments"]> = {
      steering: [],
      followUp: [],
    };
    if (!Array.isArray(items)) return removed;
    // Exact submission IDs are withdrawn. Items already placed are not returned as withdrawn text.
    for (const item of items) {
      if (
        !record(item) ||
        typeof item.id !== "number" ||
        !["steer", "followUp"].includes(String(item.mode))
      )
        continue;
      const status = await this.command(id, {
        op: "withdraw",
        sessionId: attachment.storedId,
        submissionId: item.id,
      });
      if (status === "aborted") {
        const kind = item.mode === "steer" ? "steering" : "followUp";
        removed[kind].push(inputText(item.content));
        imageAttachments[kind].push(
          Array.isArray(item.content)
            ? (parseImageInputContents(
                item.content.filter((block) => record(block) && block.type === "image"),
              ) ?? [])
            : [],
        );
      }
    }
    if (
      [...imageAttachments.steering, ...imageAttachments.followUp].some((images) => images.length)
    )
      removed.imageAttachments = imageAttachments;
    return removed;
  }

  async close(id: string): Promise<void> {
    const attachment = this.attachments.get(id);
    if (!attachment) return;
    if (attachment.closing) return attachment.closing;
    const operation = agentRuntimeManager
      .request({ op: "close", sessionId: attachment.storedId })
      .then(() => {
        this.flush(attachment);
        this.attachments.delete(id);
        this.byStoredId.delete(attachment.storedId);
        clearSessionCwd(id);
        markRuntimeExit(id);
        this.push(id, { sessionId: id, type: "exit", payload: 0 });
      })
      .finally(() => {
        attachment.closing = undefined;
      });
    attachment.closing = operation;
    return operation;
  }

  has(id: string): boolean {
    return this.attachments.has(id);
  }

  liveId(key: string): string | null {
    const ref = sessionRefFromKey(key);
    return ref.kind === "durable" ? (this.byStoredId.get(ref.id) ?? null) : null;
  }

  token(id: string): object | null {
    return this.attachments.get(id) ?? null;
  }

  pending(id: string): boolean {
    return (this.attachments.get(id)?.pending ?? 0) > 0;
  }

  busy(id: string): boolean {
    const attachment = this.require(id);
    return !attachment.settled || attachment.pending > 0;
  }

  /** Reserve this attachment synchronously; the utility verifies settlement before releasing the writer. */
  closeIdle(id: string): Promise<"ended" | "busy" | "not-running"> {
    const attachment = this.attachments.get(id);
    if (!attachment) return Promise.resolve("not-running");
    if (attachment.closing || this.busy(id)) return Promise.resolve("busy");
    let ended = false;
    const operation = agentRuntimeManager
      .request({ op: "closeIdle", sessionId: attachment.storedId })
      .then((closed) => {
        if (closed !== true) return;
        ended = true;
        this.flush(attachment);
        this.attachments.delete(id);
        this.byStoredId.delete(attachment.storedId);
        clearSessionCwd(id);
        markRuntimeExit(id);
        this.push(id, { sessionId: id, type: "exit", payload: 0 });
      })
      .finally(() => {
        attachment.closing = undefined;
      });
    attachment.closing = operation;
    return operation.then(() => (ended ? "ended" : "busy"));
  }

  async readEntries(
    storedId: string,
    before?: number,
    limit = 100,
  ): Promise<readonly EntryRecord[]> {
    await this.initialize();
    const value = await agentRuntimeManager.request({
      op: "readHistory",
      sessionId: storedId,
      before,
      limit,
    });
    if (!validEntries(value)) throw new Error("Invalid Durable history page.");
    return value;
  }

  async entries(id: string, before?: number, limit = 100): Promise<readonly EntryRecord[]> {
    const value = await this.command(id, {
      op: "history",
      sessionId: this.require(id).storedId,
      before,
      limit,
    });
    if (!validEntries(value)) throw new Error("Invalid Durable history page.");
    return value;
  }

  async messages(id: string): Promise<PiChatMessage[]> {
    // Compatibility export/read adapter. The live UI uses the paged hydrate contract.
    const entries: EntryRecord[] = [];
    let before: number | undefined;
    for (;;) {
      const page = await this.entries(id, before);
      if (!page.length) break;
      entries.unshift(...[...page].reverse());
      before = page.at(-1)?.id;
      if (page.length < 100) break;
      if (entries.length > 100_000) throw new Error("Use paged history for this large session.");
    }
    return entries.flatMap((entry) => [...(entry.model ?? [])] as PiChatMessage[]);
  }

  settlementError(id: string): string | null {
    const failure = this.require(id).view?.docs["pi.live"]?.runFailure;
    return record(failure) ? String(failure.detail ?? failure.reason ?? "Run failed.") : null;
  }

  modelState(id?: string): PiModelState {
    const config = readDurableModel();
    const agent = id ? this.attachments.get(id)?.view?.docs["pi.agent"] : undefined;
    const model =
      record(agent?.model) && typeof agent.model.modelId === "string"
        ? agent.model.modelId
        : config?.modelId;
    const current = this.models.find((row) => row.id === model);
    return {
      modelLabel: current?.name ?? model ?? "Durable",
      modelProvider: config ? "pidesk-openai" : null,
      modelId: model ?? null,
      thinkingLevel:
        current?.reasoning === false
          ? "off"
          : typeof agent?.thinkingLevel === "string"
            ? (agent.thinkingLevel as PiModelState["thinkingLevel"])
            : (config?.preferredThinking ?? "off"),
      availableThinkingLevels: current?.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh"]
        : ["off"],
      modelInput: current?.input ?? config?.input ?? ["text", "image"],
      contextWindow: current?.contextWindow ?? config?.contextWindow ?? null,
      autoCompactionEnabled: true,
    };
  }

  /** Avoid rebinding an open conversation's provider to another endpoint or credential. */
  assertModelEditable(): void {
    if (this.changingModel || this.attachments.size || this.opening.size)
      throw new Error("Close open sessions before changing the desktop model configuration.");
  }

  /** Hold admission closed through discovery, encrypted persistence and runtime rebinding. */
  async changeModel<T>(operation: () => Promise<T>): Promise<T> {
    this.assertModelEditable();
    this.changingModel = true;
    try {
      const result = await operation();
      await this.updateModel();
      return result;
    } finally {
      this.changingModel = false;
    }
  }

  async updateBuiltinTools(): Promise<void> {
    await this.initialize();
    await agentRuntimeManager.request({ op: "builtins", config: readBuiltinTools() });
  }

  async updateModel(): Promise<void> {
    await this.refreshModels();
  }

  private async readModels(): Promise<void> {
    const rows = await agentRuntimeManager.request({ op: "models" });
    if (
      !Array.isArray(rows) ||
      rows.length > NEWAPI_MODEL_LIMIT + 1 ||
      !rows.every(isGatewayModelInfo)
    )
      throw new Error("Invalid runtime model catalog.");
    this.models = rows;
  }

  /** Refresh catalog metadata without changing any conversation's selected model. */
  async refreshModels(force = false): Promise<GatewayCatalog<GatewayModelInfo>> {
    await this.initialize();
    const config = readDurableModel();
    if (config) {
      const status = await loadGatewayCatalog(force);
      const model = { ...config, models: status.models };
      const stamp = JSON.stringify(model);
      if (stamp !== this.catalogStamp) {
        await agentRuntimeManager.request({ op: "model", model });
        await this.readModels();
        this.catalogStamp = stamp;
      }
      this.catalogStatus = status;
    }
    return { ...this.catalogStatus, models: this.models };
  }

  /** Persist defaults separately from a conversation's durable model choice. */
  async selectModel(modelId: string, sessionId?: string, persist = true) {
    if (this.changingModel) throw new Error("Wait for the gateway configuration to finish saving.");
    await this.refreshModels();
    if (this.changingModel) throw new Error("Wait for the gateway configuration to finish saving.");
    const model = this.models.find((row) => row.id === modelId);
    const config = readDurableModel();
    if (!model || !config) throw new Error("Model is not in the desktop catalog.");
    if (sessionId) {
      const attachment = this.require(sessionId);
      await this.command(sessionId, {
        op: "configure",
        sessionId: attachment.storedId,
        modelId,
        ...(!model.reasoning ? { thinkingLevel: "off" } : {}),
      });
    }
    if (persist) {
      const saved = saveDurableModel({
        ...config,
        modelId,
        input: model.input,
        reasoning: model.reasoning,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        capabilityMode: "manual",
        preferredThinking: undefined,
      });
      await agentRuntimeManager.request({ op: "modelPreference", modelId: saved.modelId });
      this.catalogStamp = JSON.stringify({
        ...readDurableModel(),
        models: this.catalogStatus.models,
      });
    }
    return { provider: "pidesk-openai", modelId, label: model.name, sessionApplied: !!sessionId };
  }

  async remove(key: string): Promise<void> {
    const ref = sessionRefFromKey(key);
    if (ref.kind !== "durable") throw new Error("Legacy source history is read-only.");
    const summary = durableCatalog().find((item) => item.id === ref.id);
    if (!summary) throw new Error("Unknown session.");
    const live = this.byStoredId.get(ref.id);
    if (live) await this.close(live);
    await shell.trashItem(path.join(durableStorageRoot(), ref.id));
    removeDurableSummary(ref.id);
  }

  rename(key: string, name: string): string | null {
    const ref = sessionRefFromKey(key);
    if (ref.kind !== "durable") throw new Error("Legacy source history is read-only.");
    const summary = durableCatalog().find((item) => item.id === ref.id);
    if (!summary) throw new Error("Unknown session.");
    const normalized = name.trim().slice(0, 256) || null;
    saveDurableSummary({ ...summary, sessionName: normalized });
    return normalized;
  }

  private update(update: RuntimeSessionUpdate): void {
    const id = this.byStoredId.get(update.sessionId);
    const attachment = id ? this.attachments.get(id) : undefined;
    if (!attachment) return;
    if (update.type === "nativeState") {
      const window = getMainWindow();
      if (window && !window.isDestroyed())
        window.webContents.send(NATIVE_IPC.output, {
          sessionId: attachment.id,
          state: update.state,
        });
      return;
    }
    if ("view" in update) attachment.view = update.view;
    if (update.type === "settled") {
      attachment.settled = true;
      markRuntimeActivity(attachment.id, "idle");
    } else if ("view" in update && update.view.docs["pi.live"]?.run) {
      attachment.settled = false;
      markRuntimeActivity(attachment.id, "busy");
    }
    if (update.type === "entries" || update.type === "snapshot") {
      const entries = update.type === "entries" ? update.entries : update.view.entries;
      const summary = durableCatalog().find((item) => item.id === update.sessionId);
      const users = entries
        .flatMap((entry) => [...durableDisplayMessages(entry)])
        .filter((message) => message.role === "user");
      if (summary && (users.length || update.type === "entries"))
        saveDurableSummary({
          ...summary,
          firstUserMessage:
            summary.firstUserMessage ??
            (users[0] ? inputText(users[0].content).slice(0, 256) : null),
          latestUserMessage: users.length
            ? inputText(users.at(-1)?.content).slice(0, 256)
            : summary.latestUserMessage,
          updatedAt: update.type === "entries" ? Date.now() : summary.updatedAt,
        });
    }
    for (const action of attachment.projection.apply(update)) {
      if (action.type === "events") {
        for (const event of action.events) this.event(attachment, event);
      } else
        this.event(attachment, {
          type: "durable_projection",
          ref: { kind: "durable", id: update.sessionId },
          action,
        });
    }
    if (update.type === "error") {
      // A failed watch can no longer drive settlement. Retire this attachment and let reopen hydrate SQLite.
      this.flush(attachment);
      this.push(attachment.id, { sessionId: attachment.id, type: "exit", payload: 1 });
      void this.close(attachment.id).catch(() => undefined);
    }
  }

  private event(attachment: Attachment, event: PiAgentEvent): void {
    if (event.type === "message_update" || event.type === "tool_execution_update") {
      attachment.events.push(event);
      if (!attachment.timer) attachment.timer = setTimeout(() => this.flush(attachment), 32);
      return;
    }
    this.flush(attachment);
    this.push(attachment.id, { sessionId: attachment.id, type: "event", payload: event });
  }

  private flush(attachment: Attachment): void {
    clearTimeout(attachment.timer);
    attachment.timer = undefined;
    if (!attachment.events.length) return;
    const events = attachment.events.splice(0);
    this.push(attachment.id, { sessionId: attachment.id, type: "eventBatch", payload: events });
  }

  private push(_id: string, message: SessionPushMessage): void {
    publishSessionEvent(message);
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.webContents.send(SESSION_IPC.output, message);
  }
}

function inputText(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .flatMap((block) =>
          record(block) && block.type === "text" && typeof block.text === "string"
            ? [block.text]
            : [],
        )
        .join("\n")
    : "";
}

export const desktopSessions = new DesktopSessions();
