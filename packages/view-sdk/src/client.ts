import fs from "node:fs";
import net from "node:net";
import {
  describeBudgetViolations,
  frameBudgetViolations,
  hasRejectableViolation,
} from "./limits.js";
import type { CoalescedFrameMeta, CoalescedViewWriter } from "./scheduler.js";
import { createViewFrameScheduler } from "./scheduler.js";
import type {
  ViewClosedPayload,
  ViewEnvelope,
  ViewErrorCode,
  ViewErrorPayload,
  ViewEvent,
  ViewHelloPayload,
  ViewHostCapability,
  ViewLimits,
  ViewNode,
  ViewNotifiedPayload,
  ViewNotifyPayload,
  ViewOpenedPayload,
  ViewPatchOp,
  ViewPatchPayload,
  ViewResult,
  ViewSpec,
  ViewUpdatePayload,
} from "./types.js";
import { VIEW_LIMITS, VIEW_PROTOCOL_VERSION } from "./types.js";

/** Handshake env (docs/design/08 §3.1). PIDESK_VIEW_* wins over PI_VIEW_*. */
export interface ViewHostEnv {
  endpoint: string;
  token: string;
  protocol: string;
  /** 多会话并行：归属 pi 会话 SessionId（PIDESK_VIEW_SESSION）。可选。 */
  sessionId?: string;
  /**
   * 连接角色（docs/design/16 Phase F）。
   * Extension Worker 注入 `PIDESK_VIEW_ROLE=worker`；Host 拒绝其 access-mode / session widget。
   */
  role?: "session" | "worker";
  /** Host 稳定 rendezvous 文件路径（PIDESK_VIEW_RENDEZVOUS）。 */
  rendezvousPath?: string;
}

/**
 * Process environment shape.
 *
 * Declared locally instead of using `NodeJS.ProcessEnv`: the SDK's shipped
 * `.d.ts` must not force `@types/node` onto extension authors, who otherwise get
 * `TS2503: Cannot find namespace 'NodeJS'` just for importing the package
 * (caught by `pnpm check:sdk-consumer`, docs/design/20 O6). `process.env`
 * structurally satisfies it.
 */
export type ViewProcessEnv = Record<string, string | undefined>;

export interface ConnectDesktopViewOptions {
  /** Extra env overrides (tests). Defaults to `process.env`. */
  env?: ViewProcessEnv;
  /** How long to wait for Host `hello` after auth. Default 2000ms. */
  helloTimeoutMs?: number;
  /** Connect timeout. Default 5000ms. */
  connectTimeoutMs?: number;
}

interface RendezvousPayload {
  endpoint: string;
  token: string;
  protocol?: string;
}

function readRendezvousFile(file: string): RendezvousPayload | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const data = JSON.parse(raw) as Partial<RendezvousPayload>;
    if (typeof data.endpoint === "string" && typeof data.token === "string" && data.endpoint) {
      return {
        endpoint: data.endpoint,
        token: data.token,
        protocol: typeof data.protocol === "string" ? data.protocol : VIEW_PROTOCOL_VERSION,
      };
    }
  } catch {
    // missing / unreadable / malformed — fall back to baked env
  }
  return null;
}

/**
 * Resolve Host env from process env + optional rendezvous file.
 * Rendezvous wins when present so surviving pi processes pick up a restarted Host
 * (pipe name includes Electron pid — docs/design/15 P0-1).
 */
function readRole(env: ViewProcessEnv): "session" | "worker" | undefined {
  const raw = env.PIDESK_VIEW_ROLE || env.PI_VIEW_ROLE;
  return raw === "worker" ? "worker" : raw === "session" ? "session" : undefined;
}

export function readEnv(env: ViewProcessEnv): ViewHostEnv | null {
  const sessionId = env.PIDESK_VIEW_SESSION || env.PI_VIEW_SESSION || undefined;
  const role = readRole(env);
  const rendezvousPath = env.PIDESK_VIEW_RENDEZVOUS || env.PI_VIEW_RENDEZVOUS;
  if (rendezvousPath) {
    const live = readRendezvousFile(rendezvousPath);
    if (live) {
      return {
        endpoint: live.endpoint,
        token: live.token,
        protocol: live.protocol || VIEW_PROTOCOL_VERSION,
        sessionId: sessionId || undefined,
        role,
        rendezvousPath,
      };
    }
  }

  const endpoint = env.PIDESK_VIEW_ENDPOINT || env.PI_VIEW_ENDPOINT;
  const token = env.PIDESK_VIEW_TOKEN || env.PI_VIEW_TOKEN;
  const protocol = env.PIDESK_VIEW_PROTOCOL || env.PI_VIEW_PROTOCOL || VIEW_PROTOCOL_VERSION;
  if (!endpoint || !token) return null;
  return {
    endpoint,
    token,
    protocol,
    sessionId: sessionId || undefined,
    role,
    rendezvousPath: rendezvousPath || undefined,
  };
}

/**
 * Parse Host endpoint into a `net.connect` target.
 * - Windows named pipe: `\\.\pipe\pidesk-view-<pid>`
 * - Unix socket path: `/tmp/pidesk-view-<pid>.sock`
 * - TCP fallback advertised as `http://127.0.0.1:<port>`
 */
export function parseEndpoint(endpoint: string): { path: string } | { port: number; host: string } {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    const url = new URL(endpoint);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return { host: url.hostname || "127.0.0.1", port };
  }
  return { path: endpoint };
}

export type ViewSessionEvent =
  | ViewEvent
  | { type: "error"; error: ViewErrorPayload }
  | {
      type: "opened";
      placement: ViewOpenedPayload["placement"];
      panelId?: string;
      headerSide?: ViewOpenedPayload["headerSide"];
    };

/**
 * Host refused the open (placement/limit/protocol) or closed with a fatal reason.
 * Callers should fall back (e.g. TUI) instead of treating this as a user cancel.
 */
export class ViewHostError extends Error {
  readonly code: ViewErrorCode | "closed";
  readonly closedReason?: string;
  readonly payload?: ViewErrorPayload;

  constructor(
    message: string,
    options: { code: ViewErrorCode | "closed"; closedReason?: string; payload?: ViewErrorPayload },
  ) {
    super(message);
    this.name = "ViewHostError";
    this.code = options.code;
    this.closedReason = options.closedReason;
    this.payload = options.payload;
  }
}

function isFatalClosedReason(reason: string | undefined): boolean {
  return reason === "placement" || reason === "limit" || reason === "protocol";
}

export interface LiveViewSession {
  readonly id: string;
  /** Final placement once Host acks (`opened`); null before ack / on old hosts. */
  readonly placement: ViewOpenedPayload["placement"] | null;
  readonly panelId: string | null;
  /** Final header side once Host acks; null unless placement is header. */
  readonly headerSide: ViewOpenedPayload["headerSide"] | null;
  readonly hello: ViewHelloPayload | null;
  /** Effective protocol budget (Host-advertised when available). */
  readonly limits: ViewLimits;
  /**
   * Replace the whole tree (or the non-tree parts of the spec).
   *
   * **Fire-and-forget: returning normally means the frame was written, not that
   * the Host accepted it.** Host-side rejection arrives asynchronously as an
   * `error` event — subscribe with {@link onError} (or `onEvent`) if you need to
   * know. Throws `ViewHostError(code:"limit")` only when the frame is locally
   * guaranteed to fail: over `maxMessageBytes`, where the alternative is the
   * Host dropping the socket and taking every other view on the connection down
   * with it (docs/design/20 O3/O4).
   */
  update(update: ViewUpdatePayload | ViewNode): void;
  /**
   * Partial update (docs/design/19 §10.3). Requires Host capability
   * `view-patch`. Returns `false` (soft, never throws) when the Host is too
   * old, the view is already closed, or the pipe is down — callers should
   * fall back to `update()` with the full tree.
   *
   * `true` means **sent**, not accepted: a `patch.ops` count above
   * `limits.maxPatchOps` is still rejected by the Host, asynchronously, as an
   * `error` frame. Use {@link onError} to catch that.
   */
  patch(payload: ViewPatchPayload): boolean;
  close(result?: ViewResult): void;
  onEvent(handler: (event: ViewSessionEvent) => void): () => void;
  /**
   * Subscribe to Host `error` frames only — the reachable version of "why was
   * my update/patch rejected" for callers that don't want the full event stream
   * (docs/design/20 O2).
   */
  onError(handler: (error: ViewErrorPayload) => void): () => void;
  /**
   * Coalesced writer for live, frequently-changing views (docs/design/20 O4).
   * Prefer this over calling `update()` from a timer: deliveries merge to ≤4/s,
   * an in-flight frame never loses the newest state, and `patch` vs. whole-tree
   * is decided from the Host's advertised capability. Lazily creates one
   * scheduler; its timer is cancelled when the view settles.
   *
   * `set()` also accepts frame meta (`actions` / `title` / `placementHint`) so
   * action-bar state rides the same coalesced frame as the tree — see
   * {@link CoalescedViewWriter.set}.
   */
  coalesced(options?: { intervalMs?: number }): CoalescedViewWriter;
  /** Resolves when the view is closed (either side). */
  closed: Promise<ViewClosedPayload | null>;
}

interface PendingView {
  id: string;
  eventHandlers: Set<(event: ViewSessionEvent) => void>;
  resolveClosed: (payload: ViewClosedPayload | null) => void;
  closed: Promise<ViewClosedPayload | null>;
  placement: ViewOpenedPayload["placement"] | null;
  panelId: string | null;
  headerSide: ViewOpenedPayload["headerSide"] | null;
  settled: boolean;
  /** Runs once when the view settles: listeners, timers, anything else owed teardown. */
  cleanups: Array<() => void>;
}

/**
 * Outcome of `#beginOpen`. `aborted` is a caller cancellation and must stay
 * distinguishable from `disposed` (client already torn down).
 */
type BeginOpenResult =
  | {
      kind: "ok";
      session: LiveViewSession;
      closed: Promise<ViewClosedPayload | null>;
      result: () => ViewResult | null;
      lastError: () => ViewErrorPayload | null;
    }
  | { kind: "aborted" }
  | { kind: "disposed" };

/**
 * Process-wide desktop view client. One named-pipe/socket connection,
 * multiplexed by view id (docs/design/08 §3.2).
 *
 * Multi-process notes (docs/design/15):
 * - `env` may be refreshed from the Host rendezvous file after a Host restart.
 * - `setSessionId()` rebinds auth on the next reconnect (in-process session switch).
 */
export class DesktopViewClient {
  #env: ViewHostEnv;
  readonly #optionsEnv: ViewProcessEnv | undefined;
  readonly #helloTimeoutMs: number;
  readonly #connectTimeoutMs: number;
  #socket: net.Socket | null = null;
  #connecting: Promise<void> | null = null;
  #hello: ViewHelloPayload | null = null;
  #helloResolvers: Array<() => void> = [];
  #lineBuffer = "";
  #views = new Map<string, PendingView>();
  #notifyWaiters = new Map<
    string,
    { resolve: (payload: ViewNotifiedPayload) => void; timer: ReturnType<typeof setTimeout> }
  >();
  #nextViewId = 0;
  #nextNotifyId = 0;
  #disposed = false;
  #ready = false;
  #forceReconnect = false;

  constructor(env: ViewHostEnv, options?: ConnectDesktopViewOptions) {
    this.#env = { ...env };
    this.#optionsEnv = options?.env;
    this.#helloTimeoutMs = options?.helloTimeoutMs ?? 2000;
    this.#connectTimeoutMs = options?.connectTimeoutMs ?? 5000;
  }

  get env(): ViewHostEnv {
    return this.#env;
  }

  get hello(): ViewHelloPayload | null {
    return this.#hello;
  }

  /**
   * Host 是否广告了指定 capability（hello 缺失时按不支持处理）。
   * 需要容忍 `null` client（TUI 回落路径）时用 `capabilities.ts` 的
   * `supportsCapability` / `supportsTable` / `supportsPatch`。
   */
  hasCapability(capability: ViewHostCapability): boolean {
    return this.#hello?.capabilities?.includes(capability) === true;
  }

  /**
   * 当前生效的协议预算：`hello.limits` 优先（真机值），旧 Host 省略时回落
   * 到本 SDK 的编译期 `VIEW_LIMITS`（docs/design/20 O3）。
   */
  get limits(): ViewLimits {
    return this.#hello?.limits ?? VIEW_LIMITS;
  }

  /**
   * 请求宿主播放系统提示音（docs/design/18），可选同时弹桌面 toast（docs/design/24）。
   * - 旧 Host 未广告 `notification` → `{ ok:false, reason:"unsupported" }`
   * - 请求了 `toast` 但未广告 `system-toast` → 同样 unsupported（不静默降级成仅声音）
   */
  async notify(
    payload: ViewNotifyPayload,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ViewNotifiedPayload> {
    const timeoutMs = options?.timeoutMs ?? 2000;
    if (options?.signal?.aborted) return { ok: false, reason: "aborted" };
    try {
      const hello = await this.ensureConnected();
      const capabilities = hello?.capabilities ?? this.#hello?.capabilities ?? [];
      if (!capabilities.includes("notification")) {
        return { ok: false, reason: "unsupported" };
      }
      if (payload.toast !== undefined && !capabilities.includes("system-toast")) {
        return { ok: false, reason: "unsupported" };
      }
    } catch {
      return { ok: false, reason: "disconnected" };
    }
    if (this.#disposed) return { ok: false, reason: "disconnected" };

    const sid = this.#env.sessionId;
    const rand = Math.random().toString(36).slice(2, 10);
    const id = `notify-${sid ?? "nos"}-${++this.#nextNotifyId}-${Date.now().toString(36)}-${rand}`;
    const body: ViewNotifyPayload = { ...payload };
    if (!body.sessionId && sid) body.sessionId = sid;

    return new Promise<ViewNotifiedPayload>((resolve) => {
      const settle = (result: ViewNotifiedPayload): void => {
        const waiter = this.#notifyWaiters.get(id);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        this.#notifyWaiters.delete(id);
        options?.signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = (): void => settle({ ok: false, reason: "aborted" });
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      const timer = setTimeout(() => {
        settle({ ok: false, reason: "timeout" });
      }, timeoutMs);
      timer.unref?.();
      this.#notifyWaiters.set(id, { resolve: settle, timer });
      try {
        this.#send({ id, type: "notify", payload: body });
      } catch {
        settle({ ok: false, reason: "disconnected" });
      }
    });
  }

  /**
   * Re-read Host endpoint/token (rendezvous file first).
   * Keeps the **in-memory** sessionId (including values set via `setSessionId`);
   * spawn env is only a fallback when none is set yet.
   * Returns true when endpoint/token/sessionId changed.
   */
  refreshEnv(source?: ViewProcessEnv): boolean {
    const next = readEnv(source ?? this.#optionsEnv ?? process.env);
    if (!next) return false;
    const merged: ViewHostEnv = {
      endpoint: next.endpoint,
      token: next.token,
      protocol: next.protocol,
      // setSessionId 优先：process.env 仍是 spawn 时的旧 sessionId
      sessionId: this.#env.sessionId ?? next.sessionId,
      // 角色只存在于内存/连接上下文；丢失会让 Worker 重连后被当成 session 角色
      role: this.#env.role ?? next.role,
      rendezvousPath: next.rendezvousPath ?? this.#env.rendezvousPath,
    };
    const changed =
      merged.endpoint !== this.#env.endpoint ||
      merged.token !== this.#env.token ||
      merged.sessionId !== this.#env.sessionId;
    this.#env = merged;
    return changed;
  }

  /**
   * Rebind the pi session this connection authenticates as (docs/design/15 P1-2).
   * Forces reconnect so Host auth / open.sessionId pick up the new id.
   * Live views are settled with reason `"rebind"` (not `"session"`) so slot
   * supervisors do not treat this as a Host session recycle.
   */
  setSessionId(sessionId: string | undefined): void {
    if (this.#env.sessionId === sessionId) return;
    this.#env = { ...this.#env, sessionId };
    this.#forceReconnect = true;
    if (this.#ready) this.#teardownSocket({ reason: "rebind" });
  }

  #teardownSocket(closed?: { reason?: string }): void {
    for (const view of [...this.#views.values()]) {
      this.#settleView(view, closed ?? { reason: "dispose" });
    }
    for (const [, waiter] of this.#notifyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ ok: false, reason: "disconnected" });
    }
    this.#notifyWaiters.clear();
    try {
      this.#socket?.destroy();
    } catch {
      // ignore
    }
    this.#socket = null;
    this.#hello = null;
    this.#ready = false;
    this.#lineBuffer = "";
  }

  async ensureConnected(): Promise<ViewHelloPayload | null> {
    if (this.#disposed) throw new Error("DesktopViewClient already disposed");
    if (this.#forceReconnect && this.#ready) {
      this.#forceReconnect = false;
      this.#teardownSocket({ reason: "rebind" });
    }
    if (this.#ready) return this.#hello;
    if (!this.#connecting) {
      this.#connecting = this.#connectWithRefresh().finally(() => {
        this.#connecting = null;
      });
    }
    await this.#connecting;
    return this.#hello;
  }

  async #connectWithRefresh(): Promise<void> {
    const staleEndpoint = this.#env.endpoint;
    try {
      await this.#connectOnce();
      return;
    } catch (err) {
      // Host restart: rendezvous file should carry the new pipe/port.
      const changed = this.refreshEnv();
      if (!changed || this.#env.endpoint === staleEndpoint) throw err;
      await this.#connectOnce();
    }
  }

  async #connectOnce(): Promise<void> {
    const target = parseEndpoint(this.#env.endpoint);
    const socket = net.connect(target);
    this.#socket = socket;
    // Attach before anything else can fail: a socket created here may be
    // destroyed by `#teardownSocket` / `dispose()` while the connect promise is
    // still pending, and an 'error' with no listener becomes an uncaught
    // ECONNRESET that can take down the host pi process.
    socket.on("error", () => {
      // close handler owns cleanup
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(new Error(`View Host connect timeout (${this.#connectTimeoutMs}ms)`));
      }, this.#connectTimeoutMs);

      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onError = (err: Error): void => {
        cleanup();
        reject(err);
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off("connect", onConnect);
        socket.off("error", onError);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    });

    socket.on("data", (chunk: Buffer | string) => {
      this.#onData(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });
    socket.on("close", () => {
      // 只让当前 socket 的关闭触发清理；teardown 已置空 #socket，避免重复结算
      if (this.#socket === socket) this.#onSocketClosed();
    });

    // Auth handshake: first line is `{ token, sessionId?, role? }`, not an envelope.
    this.#rawWrite(
      JSON.stringify({
        token: this.#env.token,
        ...(this.#env.sessionId ? { sessionId: this.#env.sessionId } : {}),
        ...(this.#env.role ? { role: this.#env.role } : {}),
      }),
    );

    // Wait for hello; old hosts without hello still allow open().
    if (!this.#hello) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.#helloResolvers.push(resolve);
        }),
        sleep(this.#helloTimeoutMs),
      ]);
    }

    this.#ready = true;
  }

  #rawWrite(line: string): void {
    const socket = this.#socket;
    if (!socket || socket.destroyed) return;
    try {
      socket.write(`${line}\n`);
    } catch {
      // peer gone; close path cleans up
    }
  }

  #serialize(envelope: Omit<ViewEnvelope, "v">): string {
    return JSON.stringify({ v: VIEW_PROTOCOL_VERSION, ...envelope });
  }

  #send(envelope: Omit<ViewEnvelope, "v">): void {
    this.#rawWrite(this.#serialize(envelope));
  }

  /**
   * Write a frame after a local budget pre-flight (docs/design/20 O3).
   *
   * Throws `ViewHostError(code:"limit")` only for frames the Host is
   * *guaranteed* to reject or disconnect over — the alternative is a silently
   * stale panel or a socket teardown that settles every view on this
   * connection. Truncation-class limits are left alone: the Host clips those
   * and keeps rendering, which is not the SDK's call to make.
   */
  #guardedSend(root: ViewNode | undefined, line: string): void {
    const limits = this.limits;
    const violations = frameBudgetViolations({
      line,
      root,
      limits,
      maxMessageBytes: limits.maxMessageBytes,
    });
    if (hasRejectableViolation(violations)) {
      const message = `View frame over budget before send: ${describeBudgetViolations(violations)}`;
      throw new ViewHostError(message, { code: "limit", payload: { message, code: "limit" } });
    }
    this.#rawWrite(line);
  }

  #onData(chunk: string): void {
    this.#lineBuffer += chunk;
    let nl = this.#lineBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = this.#lineBuffer.slice(0, nl).replace(/\r$/, "");
      this.#lineBuffer = this.#lineBuffer.slice(nl + 1);
      this.#handleLine(line);
      nl = this.#lineBuffer.indexOf("\n");
    }
  }

  #handleLine(line: string): void {
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;
    const env = parsed as Partial<ViewEnvelope> & { payload?: unknown };

    if (env.type === "hello") {
      const payload = env.payload as ViewHelloPayload | undefined;
      if (payload && typeof payload.protocol === "string") {
        this.#hello = payload;
        const resolvers = this.#helloResolvers.splice(0);
        for (const resolve of resolvers) resolve();
      }
      return;
    }

    const id = typeof env.id === "string" ? env.id : "";

    if (env.type === "notified" && id) {
      const waiter = this.#notifyWaiters.get(id);
      if (waiter) {
        const payload = (env.payload ?? {}) as ViewNotifiedPayload;
        waiter.resolve({
          ok: payload.ok === true,
          reason: typeof payload.reason === "string" ? payload.reason : undefined,
        });
      }
      return;
    }

    // 旧 Host 对未知 notify 类型回 protocol error；映射为 unsupported
    if (env.type === "error" && id && this.#notifyWaiters.has(id)) {
      const payload = env.payload as ViewErrorPayload | undefined;
      const waiter = this.#notifyWaiters.get(id);
      if (waiter) {
        waiter.resolve({
          ok: false,
          reason: payload?.code === "protocol" ? "unsupported" : "rejected",
        });
      }
      return;
    }

    const view = id ? this.#views.get(id) : undefined;
    if (!view) return;

    switch (env.type) {
      case "opened": {
        const payload = env.payload as ViewOpenedPayload | undefined;
        if (payload?.placement) {
          view.placement = payload.placement;
          view.panelId = payload.panelId ?? null;
          view.headerSide = payload.headerSide ?? null;
          this.#emit(view, {
            type: "opened",
            placement: payload.placement,
            panelId: payload.panelId,
            headerSide: payload.headerSide,
          });
        }
        return;
      }
      case "event": {
        const payload = env.payload as ViewEvent | undefined;
        if (payload && typeof payload.type === "string") this.#emit(view, payload);
        return;
      }
      case "closed": {
        const payload = (env.payload as ViewClosedPayload | undefined) ?? {};
        this.#settleView(view, payload);
        return;
      }
      case "error": {
        const payload = env.payload as ViewErrorPayload | undefined;
        if (payload) this.#emit(view, { type: "error", error: payload });
        return;
      }
      default:
        return;
    }
  }

  #emit(view: PendingView, event: ViewSessionEvent): void {
    for (const handler of view.eventHandlers) {
      try {
        handler(event);
      } catch {
        // listener errors must not tear down the pipe
      }
    }
  }

  #settleView(view: PendingView, payload: ViewClosedPayload | null): void {
    if (view.settled) return;
    view.settled = true;
    this.#views.delete(view.id);
    const cleanups = view.cleanups.splice(0);
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // one failing teardown must not strand the rest
      }
    }
    view.resolveClosed(payload);
  }

  #onSocketClosed(): void {
    for (const view of [...this.#views.values()]) {
      this.#settleView(view, { reason: "dispose" });
    }
    for (const [, waiter] of this.#notifyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ ok: false, reason: "disconnected" });
    }
    this.#notifyWaiters.clear();
    this.#socket = null;
    this.#hello = null;
    this.#ready = false;
    // 帧缓冲必须清空：残留半行会与重连后的 hello 拼成非法 JSON，
    // 导致 hello 被丢弃、整条连接的能力/槽位预检降级为“不支持”。
    this.#lineBuffer = "";
    this.#helloResolvers.length = 0;
  }

  /**
   * Open a view and resolve when it closes.
   * - Client `close(result)` → that result
   * - Host dismiss / force-close → `null` (cancelled)
   * - Host refused open (placement/limit) or fatal protocol error → throws `ViewHostError`
   */
  async open(
    spec: ViewSpec,
    handlers?: {
      onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
      signal?: AbortSignal;
    },
  ): Promise<ViewResult | null> {
    const started = await this.#beginOpen(spec, handlers);
    if (started.kind !== "ok") return null;
    const closedPayload = await started.closed;
    const lastError = started.lastError();
    if (lastError) {
      throw new ViewHostError(lastError.message, {
        code: lastError.code,
        closedReason: closedPayload?.reason,
        payload: lastError,
      });
    }
    if (isFatalClosedReason(closedPayload?.reason)) {
      throw new ViewHostError(`View closed (${closedPayload?.reason})`, {
        code: "closed",
        closedReason: closedPayload?.reason,
      });
    }
    return started.result();
  }

  /**
   * Open a view and resolve with the live session immediately (header/panel
   * strips stay open until `session.close()` or Host dismiss).
   */
  async openLive(
    spec: ViewSpec,
    handlers?: {
      onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
      signal?: AbortSignal;
    },
  ): Promise<LiveViewSession> {
    const started = await this.#beginOpen(spec, handlers);
    if (started.kind === "aborted") {
      throw new ViewHostError("View open aborted", { code: "closed", closedReason: "abort" });
    }
    if (started.kind === "disposed") throw new Error("DesktopViewClient disposed");
    return started.session;
  }

  async #beginOpen(
    spec: ViewSpec,
    handlers?: {
      onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
      signal?: AbortSignal;
    },
  ): Promise<BeginOpenResult> {
    await this.ensureConnected();
    if (this.#disposed) return { kind: "disposed" };

    // 全局唯一：多 pi 并行时各自 nextViewId 都从 1 起。不用 node:crypto，
    // 避免扩展运行时对 SDK 的模块解析差异导致 desktop 路径整体失败。
    const sid = this.#env.sessionId ?? "nos";
    const rand = Math.random().toString(36).slice(2, 10);
    const id = `view-${sid}-${++this.#nextViewId}-${Date.now().toString(36)}-${rand}`;
    let resolveClosed!: (payload: ViewClosedPayload | null) => void;
    const closed = new Promise<ViewClosedPayload | null>((resolve) => {
      resolveClosed = resolve;
    });
    const pending: PendingView = {
      id,
      eventHandlers: new Set(),
      resolveClosed,
      closed,
      placement: null,
      panelId: null,
      headerSide: null,
      settled: false,
      cleanups: [],
    };
    this.#views.set(id, pending);

    let lastValues: Record<string, unknown> = {};
    let settledResult: ViewResult | null = null;
    let lastErrorPayload: ViewErrorPayload | null = null;
    /** Latest state handed to `coalesced()` — the scheduler never buffers a tree itself. */
    let pendingRoot: ViewNode | null = null;
    let pendingOps: ViewPatchOp[] | null = null;
    let pendingMeta: CoalescedFrameMeta = {};
    let coalescer: CoalescedViewWriter | null = null;
    const client = this;

    const session: LiveViewSession = {
      id,
      get placement() {
        return pending.placement;
      },
      get panelId() {
        return pending.panelId;
      },
      get headerSide() {
        return pending.headerSide;
      },
      get hello() {
        return client.hello;
      },
      get limits() {
        return client.limits;
      },
      update: (update) => {
        if (pending.settled) return;
        const isNode =
          update != null &&
          typeof update === "object" &&
          "type" in update &&
          typeof (update as ViewNode).type === "string";
        const payload: ViewUpdatePayload = isNode
          ? { root: update as ViewNode }
          : (update as ViewUpdatePayload);
        const envelope: Omit<ViewEnvelope, "v"> = { id, type: "update", payload };
        this.#guardedSend(payload.root, this.#serialize(envelope));
      },
      patch: (payload) => {
        if (pending.settled) return false;
        if (!client.hasCapability("view-patch")) return false;
        if (!Array.isArray(payload?.ops) || payload.ops.length === 0) return false;
        // 超过 Host 的 patch 预算时软失败，让调用方按既有约定回落到整树 update，
        // 而不是发一帧注定被 error 拒绝的 patch（docs/design/20 O3）。
        if (payload.ops.length > client.limits.maxPatchOps) return false;
        try {
          const envelope: Omit<ViewEnvelope, "v"> = { id, type: "patch", payload };
          this.#guardedSend(undefined, this.#serialize(envelope));
          return true;
        } catch {
          return false;
        }
      },
      close: (result) => {
        if (pending.settled) return;
        settledResult = result ?? { values: lastValues };
        this.#send({ id, type: "close", payload: { result: settledResult } });
        this.#settleView(pending, null);
      },
      onEvent: (handler) => {
        pending.eventHandlers.add(handler);
        return () => pending.eventHandlers.delete(handler);
      },
      onError: (handler) =>
        session.onEvent((event) => {
          if (event.type === "error") handler(event.error);
        }),
      coalesced: (coalesceOptions) => {
        if (coalescer) return coalescer;
        const scheduler = createViewFrameScheduler({
          intervalMs: coalesceOptions?.intervalMs,
          send: () => {
            // meta rides the same frame as the tree/patch so action-bar state
            // (e.g. `disabled`) coalesces with content instead of needing a
            // second write path (docs/design/20 §9).
            const meta = pendingMeta;
            if (pendingOps && session.patch({ ops: pendingOps, ...meta })) return;
            if (pendingRoot) session.update({ root: pendingRoot, ...meta });
          },
        });
        pending.cleanups.push(() => scheduler.stop());
        coalescer = {
          set(root, ops, meta) {
            pendingRoot = root;
            pendingOps = ops && ops.length > 0 ? ops : null;
            pendingMeta = meta ? { ...meta } : {};
            scheduler.markDirty();
          },
          flush: () => scheduler.flush(),
          flushNow: () => scheduler.flushNow(),
          stop: () => scheduler.stop(),
        };
        return coalescer;
      },
      closed,
    };

    // Shadow last-values so action events without `values` still work.
    session.onEvent((event) => {
      if (event.type === "change") {
        lastValues = { ...lastValues, [event.nodeId]: event.value };
      } else if (event.type === "action" && event.values) {
        lastValues = { ...lastValues, ...event.values };
      } else if (event.type === "error") {
        lastErrorPayload = event.error;
      }
    });

    if (handlers?.onEvent) {
      const userHandler = handlers.onEvent;
      session.onEvent((event) => {
        try {
          userHandler(event, session);
        } catch {
          // user handler errors must not kill the view
        }
      });
    }

    const onAbort = (): void => {
      if (!pending.settled) {
        this.#send({ id, type: "close", payload: { result: { values: lastValues } } });
        this.#settleView(pending, { reason: "abort" });
      }
    };
    if (handlers?.signal) {
      if (handlers.signal.aborted) {
        this.#views.delete(id);
        return { kind: "aborted" };
      }
      handlers.signal.addEventListener("abort", onAbort, { once: true });
      pending.cleanups.push(() => handlers.signal?.removeEventListener("abort", onAbort));
    }

    const openEnvelope: Omit<ViewEnvelope, "v"> = {
      id,
      type: "open",
      payload: {
        title: spec.title,
        root: spec.root,
        actions: spec.actions,
        placement: spec.placement,
        placementRequired: spec.placementRequired,
        placementHint: spec.placementHint,
        timeoutMs: spec.timeoutMs,
        sessionId: this.#env.sessionId,
        contributionKey: spec.contributionKey,
      },
    };
    // 预算预检放在登记 pending view 之后、写线之前：抛错时立即结算，
    // 不把一个从未发出的视图留在 #views 表里（docs/design/20 O3）。
    try {
      this.#guardedSend(spec.root, this.#serialize(openEnvelope));
    } catch (err) {
      this.#settleView(pending, null);
      throw err;
    }

    return {
      kind: "ok",
      session,
      closed,
      result: () => settledResult,
      lastError: () => lastErrorPayload,
    };
  }

  dispose(): void {
    this.#disposed = true;
    for (const view of [...this.#views.values()]) {
      this.#settleView(view, { reason: "dispose" });
    }
    for (const [, waiter] of this.#notifyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ ok: false, reason: "disconnected" });
    }
    this.#notifyWaiters.clear();
    try {
      this.#socket?.destroy();
    } catch {
      // ignore
    }
    this.#socket = null;
    this.#ready = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

/**
 * Detect a PiDesk (or compatible) View Host via env.
 * Returns `null` when not running under a desktop host — callers fall back to TUI.
 *
 * Synchronous by design: only reads env. The socket connects lazily on the
 * first `open()` / `ensureConnected()`.
 */
export function connectDesktopView(options?: ConnectDesktopViewOptions): DesktopViewClient | null {
  const env = readEnv(options?.env ?? process.env);
  if (!env) return null;
  if (env.protocol && !env.protocol.startsWith("view/")) return null;
  return new DesktopViewClient(env, options);
}
