/**
 * Registration-slot lifecycle as an SDK first-class primitive.
 *
 * Resident placements (today `access-mode`) are not one-shot forms: the
 * extension must keep a registration alive across pipe drops and host
 * restarts, stop cleanly on shutdown, and soft-degrade when the host is
 * absent or too old. That contract used to be hand-rolled per extension
 * (yoki-plan supervisor). It lives here so every future slot reuses it.
 *
 * Multi-process model (multi-pi, docs/design/15):
 * - One supervisor + one process client **per pi process**.
 * - Session affinity comes from `PIDESK_VIEW_SESSION` / `client.setSessionId`.
 * - Host-side per-session isolation / mutual exclusion is unchanged.
 * - In-process **slot leases** prevent two supervisors from thrashing one
 *   Host connection (Host allows one registration per placement/connection).
 */

import type { DesktopViewClient, LiveViewSession, ViewSessionEvent } from "./client.js";
import { isProcessViewClient, releaseProcessViewClient } from "./processClient.js";
import type { ViewClosedPayload } from "./types.js";
import {
  type AccessModeHandle,
  type RegisterAccessModeOptions,
  type SlotRegisterFailure,
  type SlotRegisterOutcome,
  tryRegisterAccessMode,
} from "./view.js";

/** Default re-registration backoff (ms). Slow hosts are not mistaken for old hosts. */
export const DEFAULT_SLOT_RETRY_DELAYS_MS = [500, 2000, 8000] as const;

/** Default slow re-probe after `exhausted` / sticky `unsupported` (ms). */
export const DEFAULT_SLOT_REPROBE_MS = 30_000;

export type SlotLifecycleStatus =
  /** Created but `ensure()` has not settled yet. */
  | "idle"
  /** Attempting `register()` against the Host. */
  | "connecting"
  /** Live registration in place. */
  | "registered"
  /** Transient failure; waiting for the next backoff tick. */
  | "retrying"
  /** Permanent soft-fail: no host env, Host lacks the slot, or lease held elsewhere. */
  | "unsupported"
  /** Retryable failures exhausted the backoff schedule; slow re-probe may still run. */
  | "exhausted"
  /** Registration lost (`session` / `replaced`) and waiting for `rebindSession` / policy. */
  | "displaced"
  /** `stop()` completed; no further attempts. */
  | "stopped";

export interface SlotSupervisorSnapshot<H> {
  status: SlotLifecycleStatus;
  /** Failed registration attempts since the last success (backoff cursor). */
  attempt: number;
  /** Live handle when `status === "registered"`; otherwise `null`. */
  handle: H | null;
  /** Why the last registration attempt failed, if any. */
  lastFailure?: SlotRegisterFailure;
  /** `closed` reason from the previous live registration. */
  lastClosedReason?: string;
}

export interface SuperviseSlotOptions<H> {
  /** Reuse a connection (process client). Caller owns dispose unless `connect` creates one. */
  client?: DesktopViewClient | null;
  /** Used when `client` is null. Return `null` for "not under a host". */
  connect?: () => DesktopViewClient | null;
  /** One registration attempt. Must be soft: never throw; use outcome reasons. */
  register: (client: DesktopViewClient) => Promise<SlotRegisterOutcome<H>>;
  /** Live session used to detect loss (pipe drop / host restart / session recycle). */
  getSession: (handle: H) => LiveViewSession;
  /**
   * In-process lease key (docs/design/15 P0-2). Host allows one resident
   * registration per placement per connection; two supervisors on the same
   * key would thrash via `replaced`. Default: unset = no lease.
   * `superviseAccessMode` defaults to `"access-mode"`.
   */
  leaseKey?: string;
  /**
   * Backoff delays between retryable failures. Default
   * `DEFAULT_SLOT_RETRY_DELAYS_MS`.
   */
  retryDelaysMs?: readonly number[];
  /**
   * After `exhausted` / sticky no-host, re-probe on this interval.
   * Default `DEFAULT_SLOT_REPROBE_MS`. Set `0` to disable.
   */
  reprobeMs?: number;
  /**
   * When `closed(reason) === "replaced"`, auto re-register (dangerous if another
   * supervisor owns the lease). Default false → status `displaced`.
   */
  retryOnReplaced?: boolean;
  /**
   * When `closed(reason) === "session"`, wait for `rebindSession()` instead of
   * re-registering with the stale sessionId. Default true when the client
   * supports `setSessionId`.
   */
  holdOnSessionClose?: boolean;
  /**
   * Invoked whenever a registration becomes live — including re-registration
   * after a drop. Extensions push truth state here (`setActive`, etc.).
   */
  onRegistered?: (handle: H, supervisor: SlotSupervisor<H>) => void;
  /** Diagnostics hook; fires on every status/handle transition. */
  onStatusChange?: (snapshot: SlotSupervisorSnapshot<H>) => void;
}

export interface SlotSupervisor<H> {
  /**
   * Ensure a live registration exists.
   * - Already live → resolve immediately (and re-fire `onRegistered`).
   * - No host / unsupported / lease held → resolve `null`.
   * - Transient failure → schedule backoff; resolves when the current attempt settles.
   */
  ensure(): Promise<H | null>;
  /**
   * Process-internal session switch (docs/design/15 P1-2): update client auth
   * sessionId and re-register. Clears `displaced` from reason=`session`.
   */
  rebindSession(sessionId: string | undefined): Promise<H | null>;
  /** Current live handle, or `null`. */
  readonly handle: H | null;
  /** Immutable diagnostic snapshot. */
  readonly snapshot: SlotSupervisorSnapshot<H>;
  /** Stop retries, close the registration, release lease + owned client. */
  stop(): void;
}

/** In-process leases: one live supervisor per key (docs/design/15 P0-2). */
const slotLeases = new Map<string, symbol>();

function tryAcquireLease(key: string, owner: symbol): boolean {
  const current = slotLeases.get(key);
  if (current !== undefined && current !== owner) return false;
  slotLeases.set(key, owner);
  return true;
}

function releaseLease(key: string, owner: symbol): void {
  if (slotLeases.get(key) === owner) slotLeases.delete(key);
}

/** Test helper. */
export function __resetSlotLeasesForTests(): void {
  slotLeases.clear();
}

interface SlotSupervisorInternal<H> extends SlotSupervisor<H> {
  readonly ownsClient: boolean;
  getClient(): DesktopViewClient | null;
}

function clientSupportsSessionRebind(client: DesktopViewClient | null): boolean {
  return typeof (client as { setSessionId?: unknown } | null)?.setSessionId === "function";
}

/**
 * Supervise one resident registration slot for the current process.
 *
 * ```
 * ensure() → connecting → registered
 *              ↘ retrying (500/2s/8s) → …
 *              ↘ unsupported | exhausted (slow re-probe)
 * registered --closed--> policy by reason
 *   dispose/empty → connecting (immediate)
 *   session       → displaced (rebindSession)
 *   replaced      → displaced (unless retryOnReplaced)
 *   limit/placement/protocol → retrying via register outcomes
 * stop() → stopped
 * ```
 */
export function superviseSlot<H>(options: SuperviseSlotOptions<H>): SlotSupervisor<H> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_SLOT_RETRY_DELAYS_MS;
  const reprobeMs = options.reprobeMs ?? DEFAULT_SLOT_REPROBE_MS;
  const ownsConnectClient = options.client == null;
  const leaseKey = options.leaseKey;
  const leaseOwner = Symbol(leaseKey ?? "slot");

  let stopped = false;
  let live: H | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryWaitResolve: (() => void) | null = null;
  let reprobeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFailure: SlotSupervisorSnapshot<H>["lastFailure"];
  let lastClosedReason: string | undefined;
  let ownedClient: DesktopViewClient | null = null;
  let status: SlotLifecycleStatus = "idle";
  let ensureChain: Promise<H | null> = Promise.resolve(null);
  let leaseHeld = false;
  let pendingSessionRebind = false;

  const snapshot = (): SlotSupervisorSnapshot<H> => ({
    status,
    attempt,
    handle: live,
    lastFailure,
    lastClosedReason,
  });

  const publish = (): void => {
    options.onStatusChange?.(snapshot());
  };

  const resolveClient = (): DesktopViewClient | null => {
    if (options.client) return options.client;
    if (ownedClient) return ownedClient;
    const created = options.connect?.() ?? null;
    if (created && ownsConnectClient) ownedClient = created;
    return created;
  };

  const holdOnSession = (): boolean => {
    if (options.holdOnSessionClose !== undefined) return options.holdOnSessionClose;
    return clientSupportsSessionRebind(resolveClient());
  };

  const clearRetryTimer = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (retryWaitResolve) {
      const resolve = retryWaitResolve;
      retryWaitResolve = null;
      resolve();
    }
  };

  const clearReprobeTimer = (): void => {
    if (!reprobeTimer) return;
    clearTimeout(reprobeTimer);
    reprobeTimer = null;
  };

  const scheduleReprobe = (): void => {
    if (stopped || reprobeMs <= 0 || reprobeTimer) return;
    if (status !== "exhausted" && status !== "unsupported") return;
    reprobeTimer = setTimeout(() => {
      reprobeTimer = null;
      if (stopped) return;
      if (status !== "exhausted" && status !== "unsupported") return;
      attempt = 0;
      void runAttempt();
    }, reprobeMs);
    reprobeTimer.unref?.();
  };

  const takeLease = (): boolean => {
    if (!leaseKey) return true;
    if (leaseHeld) return true;
    if (!tryAcquireLease(leaseKey, leaseOwner)) return false;
    leaseHeld = true;
    return true;
  };

  const dropLease = (): void => {
    if (!leaseKey || !leaseHeld) return;
    releaseLease(leaseKey, leaseOwner);
    leaseHeld = false;
  };

  const closeLive = (handle: H): void => {
    try {
      options.getSession(handle).close();
    } catch {
      // handle may already be settled
    }
  };

  const onLiveClosed = (handle: H, payload: ViewClosedPayload | null): void => {
    if (stopped) return;
    // 只处理「当前这次注册」的 closed；旧 handle 的迟到事件不得改状态
    if (live !== handle) {
      lastClosedReason = payload?.reason;
      return;
    }
    live = null;
    const reason = payload?.reason;
    lastClosedReason = reason;

    if (reason === "replaced" && !options.retryOnReplaced) {
      dropLease();
      pendingSessionRebind = false;
      status = "displaced";
      publish();
      return;
    }

    if (reason === "rebind") {
      // setSessionId 主动拆线：由 rebindSession/ensure 负责下一次注册
      dropLease();
      return;
    }

    if (reason === "session" && holdOnSession()) {
      dropLease();
      pendingSessionRebind = true;
      status = "displaced";
      publish();
      return;
    }

    if (reason === "limit" || reason === "placement" || reason === "protocol") {
      dropLease();
      void runAttempt();
      return;
    }

    // Pipe drop / host restart / dispose: re-register immediately.
    dropLease();
    void runAttempt();
  };

  const runAttempt = async (): Promise<H | null> => {
    if (stopped) {
      status = "stopped";
      publish();
      return null;
    }
    if (pendingSessionRebind && holdOnSession()) {
      status = "displaced";
      publish();
      return null;
    }
    if (live) {
      status = "registered";
      publish();
      options.onRegistered?.(live, api);
      return live;
    }

    const client = resolveClient();
    if (!client) {
      status = "unsupported";
      lastFailure = "no-host";
      publish();
      scheduleReprobe();
      return null;
    }

    if (leaseKey && !takeLease()) {
      status = "unsupported";
      lastFailure = "unsupported";
      publish();
      return null;
    }

    status = "connecting";
    publish();

    let outcome: SlotRegisterOutcome<H>;
    try {
      outcome = await options.register(client);
    } catch {
      outcome = { ok: false, reason: "failed" };
    }

    if (stopped) {
      if (outcome.ok) closeLive(outcome.handle);
      dropLease();
      status = "stopped";
      publish();
      return null;
    }

    if (outcome.ok) {
      const registered = outcome.handle;
      live = registered;
      attempt = 0;
      lastFailure = undefined;
      pendingSessionRebind = false;
      leaseHeld = true;
      status = "registered";
      publish();
      options.onRegistered?.(live, api);
      // 捕获 registered 而不是闭包里的 live：旧注册的迟到 closed 不得作用到新 handle
      void options
        .getSession(registered)
        .closed.then((payload) => onLiveClosed(registered, payload));
      return live;
    }

    lastFailure = outcome.reason;
    dropLease();

    if (outcome.reason === "no-host" || outcome.reason === "unsupported") {
      status = "unsupported";
      publish();
      scheduleReprobe();
      return null;
    }

    if (attempt >= retryDelaysMs.length) {
      status = "exhausted";
      publish();
      scheduleReprobe();
      return null;
    }

    const delay = retryDelaysMs[attempt];
    attempt += 1;
    status = "retrying";
    publish();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    await new Promise<void>((resolve) => {
      retryWaitResolve = resolve;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryWaitResolve = null;
        resolve();
      }, delay);
      retryTimer.unref?.();
    });
    retryWaitResolve = null;
    return runAttempt();
  };

  const api: SlotSupervisorInternal<H> = {
    ensure() {
      ensureChain = ensureChain.then(
        () => runAttempt(),
        () => runAttempt(),
      );
      return ensureChain;
    },
    rebindSession(sessionId: string | undefined) {
      const client = resolveClient();
      if (clientSupportsSessionRebind(client)) {
        (client as DesktopViewClient).setSessionId(sessionId);
      }
      // setSessionId 可能已用 reason="rebind" 拆掉 live 注册；必须 ensure 新 auth 下重注册，
      // 不能在旧 handle 上直接返回。
      pendingSessionRebind = false;
      return api.ensure();
    },
    get handle() {
      return live;
    },
    get snapshot() {
      return snapshot();
    },
    stop() {
      stopped = true;
      clearRetryTimer();
      clearReprobeTimer();
      const handle = live;
      live = null;
      if (handle) closeLive(handle);
      dropLease();
      if (ownedClient && ownsConnectClient) {
        const client = ownedClient;
        ownedClient = null;
        // 进程级共享 client 只能按引用计数释放；强 dispose 会打断同进程其它扩展。
        if (isProcessViewClient(client)) releaseProcessViewClient();
        else client.dispose();
      }
      status = "stopped";
      publish();
    },
    get ownsClient() {
      return ownsConnectClient && ownedClient != null;
    },
    getClient() {
      return resolveClient();
    },
  };

  return api;
}

/** Options for `superviseAccessMode` — access-mode registration + built-in lifecycle. */
export interface SuperviseAccessModeOptions {
  client?: DesktopViewClient | null;
  connect?: () => DesktopViewClient | null;
  /** Static registration descriptor (id/title/…). */
  registration: Omit<RegisterAccessModeOptions, "onEvent" | "signal">;
  /** Host UI asked to activate this mode. */
  onActivate?: () => void;
  /** Host UI asked to deactivate this mode (including via the built-in baseline row). */
  onDeactivate?: () => void;
  /** Extra session events (rarely needed; activate/deactivate are pre-routed). */
  onEvent?: RegisterAccessModeOptions["onEvent"];
  /** After each successful registration — push controller truth with `handle.setActive`. */
  onRegistered?: (handle: AccessModeHandle) => void;
  retryDelaysMs?: readonly number[];
  reprobeMs?: number;
  /** Override in-process lease key. Default `"access-mode"`. */
  leaseKey?: string;
  holdOnSessionClose?: boolean;
  onStatusChange?: (snapshot: SlotSupervisorSnapshot<AccessModeHandle>) => void;
  /** Import inject for tests. Defaults to `tryRegisterAccessMode`. */
  tryRegister?: typeof tryRegisterAccessMode;
}

/**
 * Resident access-mode chip with process-level lifecycle built in.
 *
 * ```ts
 * const desktopMode = superviseAccessMode({
 *   connect: () => acquireProcessViewClient(),
 *   registration: { id: "yoki-plan", title: "计划模式", icon: "clipboard" },
 *   onActivate: () => enterPlan(),
 *   onDeactivate: () => enterEdit(),
 *   onRegistered: (handle) => handle.setActive(mode === "plan", detail),
 * });
 * void desktopMode.ensure(); // session_start
 * desktopMode.stop();        // session_shutdown → releaseProcessViewClient()
 * ```
 */
export function superviseAccessMode(
  options: SuperviseAccessModeOptions,
): SlotSupervisor<AccessModeHandle> {
  const tryRegister = options.tryRegister ?? tryRegisterAccessMode;

  return superviseSlot<AccessModeHandle>({
    client: options.client,
    connect: options.connect,
    getSession: (handle) => handle.session,
    leaseKey: options.leaseKey ?? "access-mode",
    retryDelaysMs: options.retryDelaysMs,
    reprobeMs: options.reprobeMs,
    holdOnSessionClose: options.holdOnSessionClose,
    onRegistered: options.onRegistered,
    onStatusChange: options.onStatusChange,
    register: async (client) => {
      const onEvent = (event: ViewSessionEvent, session: LiveViewSession): void => {
        if (event.type === "action") {
          if (event.actionId === "mode:activate") options.onActivate?.();
          else if (event.actionId === "mode:deactivate") options.onDeactivate?.();
        }
        options.onEvent?.(event, session);
      };
      return tryRegister(client, {
        ...options.registration,
        onEvent,
      });
    },
  });
}
