import {
  allowsProject,
  authorize,
  byteLength,
  ControlError,
  exact,
  fail,
  type Grant,
  type HistoryNotice,
  type HistoryTail,
  id,
  parseHistoryQuery,
  RELAY_TIMING,
  type RemoteToolKind,
  type RoutingContext,
  record,
} from "../../shared/remote";
import {
  COMMANDS,
  MAX_FRAME_BYTES,
  MAX_PROMPT_LENGTH,
  PROJECT_PAGE_SIZE,
  type RemoteSessionConfiguration,
  type RequestFrame,
} from "../../shared/remote/business";
import { type HistoryView, historyPage, historyRevision } from "./historySync";
import { RemoteOperationLedger, type WriteCommand } from "./operationLedger";

export interface RemoteProject {
  id: string;
  name: string;
  description: { "zh-CN": string; "en-US": string };
}
export interface RemoteSession extends RemoteSessionConfiguration {
  id: string;
  projectId: string;
  title: string;
  status: "running" | "waiting" | "idle";
  updatedAt: number;
  preview: string;
}
export interface RemoteMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  /** Finite presentation category; tool names and invocation arguments stay local. */
  toolKind?: RemoteToolKind;
  state?: "running" | "done";
  isError?: boolean;
}
export interface RemoteInteraction {
  id: string;
  sessionId: string;
  projectId: string;
  kind: "select" | "confirm" | "input" | "editor";
  title: string;
  description: string;
  options?: string[];
  initialValue?: string;
  placeholder?: string;
}
export interface ReadOnlySource {
  projects(): RemoteProject[];
  sessions(projects: string[]): Promise<RemoteSession[]>;
  messages(session: RemoteSession): Promise<RemoteMessage[]>;
  history?(session: RemoteSession): Promise<{ view: HistoryView; tail: HistoryTail }>;
  interactions(projects: string[]): Promise<RemoteInteraction[]>;
  send(session: RemoteSession, message: string): Promise<{ disposition: string }>;
  stop(session: RemoteSession): Promise<{ requested: boolean }>;
  create(projectId: string, title: string, creationKey: string): Promise<RemoteSession>;
  answer(
    session: RemoteSession,
    interactionId: string,
    value: string | boolean,
  ): { settled: boolean };
}
interface Lease {
  context: RoutingContext;
  session: RemoteSession;
  expires: number;
  previous: string;
}
interface DeviceWatch {
  context: RoutingContext;
  expires: number;
  previous: string;
  projects: string;
  summary: string;
  summaryAt: number;
}
function offset(v: unknown): number {
  if (v === null) return 0;
  if (typeof v !== "string" || !/^(?:0|[1-9]\d{0,6})$/.test(v)) return fail("INVALID_CURSOR");
  return Number(v);
}
function limit(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 50)
    return fail("INVALID_FRAME");
  return v;
}
function requestFrame(requestId: string, data: unknown): unknown {
  const response = { version: 1, type: "response", id: requestId, status: "completed", data };
  if (byteLength(JSON.stringify(response)) > MAX_FRAME_BYTES - 1024) fail("FRAME_TOO_LARGE");
  return response;
}
function failedFrame(requestId: string, code: string): unknown {
  return {
    version: 1,
    type: "response",
    id: requestId,
    status: "failed",
    error: { code, message: code },
  };
}
/** Desktop authorization and data boundary; phone payloads never supply file paths or local identities. */
export class ReadOnlyBridge {
  private leases = new Map<string, Lease>();
  private devices = new Map<string, DeviceWatch>();
  private generations = new Map<string, number>();
  private sequences = new Map<string, number>();
  private pendingTick: Promise<void> | null = null;
  private generation = 0;
  constructor(
    private readonly grant: () => Grant | null,
    private readonly source: ReadOnlySource,
    private readonly epoch: string,
    private readonly now = Date.now,
    private readonly operations = new RemoteOperationLedger({
      load: () => [],
      save: () => {},
    }),
  ) {}
  clear(): void {
    this.generation++;
    this.pendingTick = null;
    this.leases.clear();
    this.devices.clear();
    this.generations.clear();
    this.sequences.clear();
  }
  isViewing(sessionId: string): boolean {
    for (const lease of this.leases.values()) {
      if (lease.session.id === sessionId && this.now() < lease.expires) {
        try {
          this.check(lease.context, "sessions.subscribe", lease.session.projectId);
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }
  private check(context: RoutingContext, command: string, projectId?: string): void {
    const generation = this.generations.get(context.deviceId) ?? 0;
    if (context.connectionGeneration < generation) fail("AUTH_EXPIRED");
    this.generations.set(context.deviceId, context.connectionGeneration);
    authorize(
      this.grant(),
      context,
      command,
      this.source.projects().map((project) => project.id),
      this.now(),
      projectId,
    );
  }
  private observe(context: RoutingContext): void {
    const previous = this.devices.get(context.deviceId);
    this.devices.set(context.deviceId, {
      context,
      expires: Math.min(
        this.now() + RELAY_TIMING.overviewLeaseMs,
        Date.parse(context.accessExpiresAt),
      ),
      previous: previous?.previous ?? "",
      projects: previous?.projects ?? "",
      summary: previous?.summary ?? "",
      summaryAt: previous?.summaryAt ?? 0,
    });
  }
  private visibleProjects(): RemoteProject[] {
    const grant = this.grant();
    return grant
      ? this.source.projects().filter((project) => allowsProject(grant.projectIds, project.id))
      : [];
  }
  private allowedProjects(): string[] {
    return this.visibleProjects().map((project) => project.id);
  }
  private async session(
    context: RoutingContext,
    command: string,
    sessionId: unknown,
  ): Promise<RemoteSession> {
    const key = id(sessionId);
    const projects = this.allowedProjects();
    const session =
      (await this.source.sessions(projects)).find((candidate) => candidate.id === key) ??
      fail("RESOURCE_UNAVAILABLE");
    this.check(context, command, session.projectId);
    return session;
  }
  private nextSequence(deviceId: string): number {
    const next = (this.sequences.get(deviceId) ?? 0) + 1;
    this.sequences.set(deviceId, next);
    return next;
  }
  private emit(
    context: RoutingContext,
    sessionId: string,
    send: (context: RoutingContext, frame: unknown) => void,
    payload: HistoryNotice,
  ): void {
    this.check(context, "sessions.subscribe");
    send(context, {
      version: 1,
      type: "event",
      sessionId,
      epoch: this.epoch,
      sequence: this.nextSequence(context.deviceId),
      payload,
    });
  }
  async request(context: RoutingContext, raw: unknown): Promise<unknown> {
    const input = record(raw);
    this.check(context, String(input.command));
    this.observe(context);
    const r = exact(raw, ["version", "type", "id", "command", "payload"]);
    if (
      r.version !== 1 ||
      r.type !== "request" ||
      !(COMMANDS as readonly string[]).includes(String(r.command))
    )
      fail("INVALID_FRAME");
    if (byteLength(JSON.stringify(raw)) > MAX_FRAME_BYTES) fail("FRAME_TOO_LARGE");
    const requestId = id(r.id);
    const command = r.command as RequestFrame["command"];
    if (command === "requests.lookup") {
      const p = exact(r.payload, ["operationId"]);
      this.check(context, command);
      const operation = this.operations.lookup(context.deviceId, id(p.operationId));
      return requestFrame(requestId, {
        state: operation?.state ?? "not_found",
        command: operation?.command ?? null,
        result: operation?.state === "completed" ? operation.result : null,
        errorCode: operation?.errorCode ?? null,
      });
    }
    if (command === "projects.list") {
      if (this.grant()?.projectIds !== "all") {
        exact(r.payload, []);
        return requestFrame(requestId, { projects: this.visibleProjects() });
      }
      const p = exact(r.payload, ["cursor"]);
      const projects = this.visibleProjects();
      const start = offset(p.cursor);
      const end = start + PROJECT_PAGE_SIZE;
      return requestFrame(requestId, {
        projects: projects.slice(start, end),
        nextCursor: end < projects.length ? String(end) : null,
      });
    }
    if (command === "sessions.list") {
      const p = exact(r.payload, ["projectId", "cursor", "limit"]);
      const projectId = p.projectId === null ? null : id(p.projectId);
      if (projectId) this.check(context, command, projectId);
      const projects = this.allowedProjects().filter(
        (allowed) => !projectId || allowed === projectId,
      );
      const allowed = new Set(projects);
      const sessions = (await this.source.sessions(projects))
        .filter((session) => allowed.has(session.projectId))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      const start = offset(p.cursor);
      const end = start + limit(p.limit);
      this.check(context, command);
      return requestFrame(requestId, {
        sessions: sessions.slice(start, end),
        nextCursor: end < sessions.length ? String(end) : null,
      });
    }
    if (command === "sessions.history.sync") {
      const query = parseHistoryQuery(r.payload);
      const target = await this.session(context, command, query.sessionId);
      if (!this.source.history) return fail("INVALID_COMMAND");
      const { view, tail } = await this.source.history(target);
      this.check(context, command, target.projectId);
      return requestFrame(requestId, historyPage(view, context, query, tail));
    }
    if (command === "sessions.history") {
      const p = exact(r.payload, ["sessionId", "cursor", "limit"]);
      const target = await this.session(context, command, p.sessionId);
      const messages = await this.source.messages(target);
      const start = offset(p.cursor);
      const end = start + limit(p.limit);
      const items: RemoteMessage[] = [];
      let position = start;
      while (position < Math.min(end, messages.length)) {
        const candidate = [...items, messages[position]];
        if (byteLength(JSON.stringify(candidate)) > MAX_FRAME_BYTES - 2_048) break;
        items.push(messages[position++]);
      }
      if (position === start && position < messages.length) fail("FRAME_TOO_LARGE");
      this.check(context, command, target.projectId);
      return requestFrame(requestId, {
        messages: items,
        nextCursor: position < messages.length ? String(position) : null,
      });
    }
    if (command === "interactions.list") {
      exact(r.payload, []);
      const interactions = await this.source.interactions(this.allowedProjects());
      const allowed = new Set(this.allowedProjects());
      const visible = interactions
        .filter((interaction) => allowed.has(interaction.projectId))
        .slice(0, 100)
        .map(({ projectId: _projectId, ...interaction }) => interaction);
      this.check(context, command);
      return requestFrame(requestId, { interactions: visible });
    }
    if (command === "sessions.subscribe") {
      const p = exact(r.payload, ["sessionId"]);
      const target = await this.session(context, command, p.sessionId);
      const previous = this.leases.get(context.deviceId);
      this.leases.set(context.deviceId, {
        context,
        session: target,
        expires: this.now() + 30_000,
        previous: previous?.session.id === target.id ? previous.previous : "",
      });
      return requestFrame(requestId, {
        epoch: this.epoch,
        sequence: this.sequences.get(context.deviceId) ?? 0,
        expiresAt: new Date(this.now() + 30_000).toISOString(),
      });
    }
    if (
      command === "sessions.send" ||
      command === "sessions.stop" ||
      command === "sessions.create" ||
      command === "interactions.answer"
    ) {
      return this.writeRequest(context, requestId, command, r.payload);
    }
    return fail("FORBIDDEN");
  }
  private async writeRequest(
    context: RoutingContext,
    requestId: string,
    command: WriteCommand,
    rawPayload: unknown,
  ): Promise<unknown> {
    let projectId: string | undefined;
    const payload = record(rawPayload);
    const operationId = id(payload.operationId);
    let action: () => Promise<unknown>;
    if (command === "sessions.send") {
      const p = exact(rawPayload, ["operationId", "sessionId", "text"]);
      if (typeof p.text !== "string" || !p.text.trim() || p.text.length > MAX_PROMPT_LENGTH)
        fail("INVALID_FRAME");
      const target = await this.session(context, command, p.sessionId);
      projectId = target.projectId;
      action = () => this.source.send(target, p.text as string);
    } else if (command === "sessions.stop") {
      const p = exact(rawPayload, ["operationId", "sessionId"]);
      const target = await this.session(context, command, p.sessionId);
      projectId = target.projectId;
      action = () => this.source.stop(target);
    } else if (command === "sessions.create") {
      const p = exact(rawPayload, ["operationId", "projectId", "title"]);
      projectId = id(p.projectId);
      this.check(context, command, projectId);
      if (typeof p.title !== "string" || !p.title.trim() || p.title.length > 120)
        fail("INVALID_FRAME");
      // Operation ids are device-local; session identities must also isolate devices and projects.
      const creationKey = JSON.stringify([context.deviceId, projectId, operationId]);
      action = async () => ({
        id: (await this.source.create(projectId as string, p.title as string, creationKey)).id,
      });
    } else {
      const p = exact(rawPayload, ["operationId", "sessionId", "interactionId", "value"]);
      const target = await this.session(context, command, p.sessionId);
      projectId = target.projectId;
      const interactionId = id(p.interactionId);
      if (typeof p.value !== "string" && typeof p.value !== "boolean") fail("INVALID_FRAME");
      action = async () => {
        const result = this.source.answer(target, interactionId, p.value as string | boolean);
        if (!result.settled) fail("INTERACTION_SETTLED");
        return result;
      };
    }
    this.check(context, command, projectId);
    const result = await this.operations.execute(
      context.deviceId,
      operationId,
      command,
      payload,
      action,
    );
    // Record the actual outcome even if access was revoked while the operation was running.
    this.check(context, command, projectId);
    if (result.state === "completed") return requestFrame(requestId, result.result);
    return failedFrame(requestId, result.errorCode ?? "RESULT_UNCERTAIN");
  }
  /** Events tell clients to check their cursor against the authoritative history. */
  tick(send: (context: RoutingContext, frame: unknown) => void): Promise<void> {
    if (this.pendingTick) return this.pendingTick;
    // Event notifications and periodic reconciliation can arrive during the same disk read.
    const pending = this.sync(send, this.generation).finally(() => {
      if (this.pendingTick === pending) this.pendingTick = null;
    });
    this.pendingTick = pending;
    return pending;
  }
  private async sync(
    send: (context: RoutingContext, frame: unknown) => void,
    generation: number,
  ): Promise<void> {
    for (const [deviceId, watch] of this.devices) {
      if (this.now() >= watch.expires) {
        this.devices.delete(deviceId);
        continue;
      }
      try {
        this.check(watch.context, "sessions.list");
        const projects = this.allowedProjects();
        const [sessions, interactions] = await Promise.all([
          this.source.sessions(projects),
          this.grant()?.scopes.includes("interactions.read")
            ? this.source.interactions(projects)
            : Promise.resolve([]),
        ]);
        if (generation !== this.generation) return;
        if (this.devices.get(deviceId) !== watch) continue;
        const projectFingerprint = JSON.stringify(this.visibleProjects());
        const fingerprint = JSON.stringify([
          projectFingerprint,
          sessions.map(({ updatedAt: _updatedAt, ...session }) => session),
          interactions,
        ]);
        const summary = JSON.stringify(sessions.map(({ id, updatedAt }) => [id, updatedAt]));
        if (
          watch.previous !== fingerprint ||
          (summary !== watch.summary && this.now() - watch.summaryAt >= 5_000)
        ) {
          const projectsChanged = watch.projects !== projectFingerprint;
          watch.summary = summary;
          watch.summaryAt = this.now();
          watch.previous = fingerprint;
          watch.projects = projectFingerprint;
          this.check(watch.context, "sessions.list");
          this.emit(watch.context, "overview", send, {
            kind: "status_changed",
            changes: projectsChanged ? ["projects", "sessions"] : ["sessions"],
          });
        }
      } catch {
        if (generation !== this.generation) return;
        if (this.devices.get(deviceId) === watch) {
          this.devices.delete(deviceId);
          this.leases.delete(deviceId);
        }
      }
    }
    for (const [deviceId, lease] of this.leases) {
      if (this.now() >= lease.expires) {
        this.leases.delete(deviceId);
        continue;
      }
      try {
        this.check(lease.context, "sessions.subscribe", lease.session.projectId);
        const fingerprint = this.source.history
          ? await this.source.history(lease.session).then(({ view }) => historyRevision(view))
          : JSON.stringify(await this.source.messages(lease.session));
        if (generation !== this.generation) return;
        if (this.leases.get(deviceId) !== lease) continue;
        if (lease.previous !== fingerprint) {
          lease.previous = fingerprint;
          this.check(lease.context, "sessions.subscribe", lease.session.projectId);
          this.emit(lease.context, lease.session.id, send, {
            kind: "history_committed",
            revision: fingerprint,
          });
        }
      } catch (cause) {
        if (generation !== this.generation) return;
        if (
          this.leases.get(deviceId) === lease &&
          !(cause instanceof ControlError && cause.code === "STATE_UNAVAILABLE")
        )
          this.leases.delete(deviceId);
      }
    }
  }
}

export type { WriteCommand };
