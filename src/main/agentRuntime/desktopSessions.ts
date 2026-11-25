import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import { shell } from "electron";
import type { DurableCommand, RuntimeSessionUpdate } from "../../shared/durableProtocol";
import { record, validEntries } from "../../shared/durableProtocol";
import type {
  PiAgentEvent,
  PiChatMessage,
  PiModelState,
  PiQueuedMessages,
  SessionId,
  SessionPushMessage,
  SessionStartRequest,
} from "../../shared/ipc";
import { SESSION_IPC } from "../../shared/ipc";
import { DURABLE_SESSION_ID, sessionRefFromKey, sessionRefKey } from "../../shared/sessionRef";
import {
  markRuntimeActivity,
  markRuntimeExit,
  markRuntimeReady,
  markRuntimeUsedByUser,
  noteSessionSpawned,
} from "../session/runtimeCoordinator";
import { clearSessionCwd, noteSessionCwd } from "../session/sessionCwdRegistry";
import { publishSessionEvent } from "../session/sessionEvents";
import {
  durableCatalog,
  durableStorageRoot,
  readDurableModel,
  removeDurableSummary,
  saveDurableSummary,
} from "../settings/durableStore";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";
import { agentRuntimeManager } from "./agentRuntimeManager";
import { DurableProjection } from "./durableProjection";

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
      const operation = agentRuntimeManager
        .request({ op: "initialize", storageRoot: durableStorageRoot(), model: readDurableModel() })
        .then(() => undefined);
      this.initialized = operation;
      void operation.catch(() => {
        if (this.initialized === operation) this.initialized = undefined;
      });
    }
    return this.initialized;
  }

  start(request: SessionStartRequest): Promise<SessionId> {
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

  private async open(request: SessionStartRequest): Promise<SessionId> {
    const ref =
      request.ref ?? (request.sessionFile ? sessionRefFromKey(request.sessionFile) : undefined);
    if (ref?.kind === "legacy-jsonl")
      throw new Error(
        "Legacy JSONL sessions are read-only. Create a new Durable session to send messages.",
      );
    if (ref && !DURABLE_SESSION_ID.test(ref.id))
      throw new Error("Invalid Durable session reference.");
    const storedId =
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
        return this.open(request);
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
    await this.initialize();
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
      await agentRuntimeManager.request({ op: "open", sessionId: storedId, cwd, create: !known });
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
    attachment.pending++;
    if (working) {
      attachment.epoch++;
      attachment.settled = false;
      markRuntimeUsedByUser(id);
      markRuntimeActivity(id, "busy");
    }
    try {
      return await agentRuntimeManager.request(command);
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
  ): Promise<"started" | "queued"> {
    const attachment = this.require(id);
    if (!readDurableModel())
      throw new Error("Configure a model in Settings → Models before sending.");
    const result = await this.command(id, {
      op: "submit",
      sessionId: attachment.storedId,
      requestId,
      text,
      mode,
    });
    if (!record(result) || !["started", "queued"].includes(String(result.disposition)))
      throw new Error("Invalid Durable admission response.");
    return result.disposition as "started" | "queued";
  }

  async clearQueue(id: string): Promise<PiQueuedMessages> {
    const attachment = this.require(id);
    const items = attachment.view?.docs["pi.inbox"]?.items;
    const removed: PiQueuedMessages = { steering: [], followUp: [] };
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
      if (status === "aborted")
        removed[item.mode === "steer" ? "steering" : "followUp"].push(inputText(item.content));
    }
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
    return {
      modelLabel: model ?? "Durable",
      modelProvider: config ? "pidesk-openai" : null,
      modelId: model ?? null,
      thinkingLevel:
        typeof agent?.thinkingLevel === "string"
          ? (agent.thinkingLevel as PiModelState["thinkingLevel"])
          : "off",
      availableThinkingLevels: config?.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh"]
        : ["off"],
      modelInput: ["text"],
      contextWindow: config?.contextWindow ?? null,
      autoCompactionEnabled: true,
    };
  }

  /** Avoid rebinding an open conversation's provider to another endpoint or credential. */
  assertModelEditable(): void {
    if (this.attachments.size || this.opening.size)
      throw new Error("Close open sessions before changing the desktop model configuration.");
  }

  async updateModel(): Promise<void> {
    await this.initialize();
    const model = readDurableModel();
    if (model) await agentRuntimeManager.request({ op: "model", model });
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
        .flatMap((entry) => entry.model ?? [])
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
