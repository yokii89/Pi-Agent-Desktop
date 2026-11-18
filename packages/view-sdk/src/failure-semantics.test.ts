/**
 * Failure-semantics regressions (docs/design/20 O2).
 *
 * These started life as characterization tests against the 2026-09-22 baseline,
 * where `openPanel` folded `limit`/`placement`/transport into one `null`,
 * `tryRegisterAccessMode` called every non-ack "refused", and `playNotification`
 * called every throw "disconnected". Five of them flipped red when O2 landed and
 * were rewritten below to assert the widened outcome; the baseline they replaced
 * is quoted in each test's name so the before/after pair stays auditable.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopViewClient, LiveViewSession, ViewSessionEvent } from "./client.js";
import { ViewHostError } from "./client.js";
import { playNotification } from "./notification.js";
import type { ViewHelloPayload, ViewNode, ViewSpec } from "./types.js";
import {
  openHeader,
  openPanel,
  openPanelResult,
  openSettingsView,
  openSidebar,
  openSidebarResult,
  registerAccessMode,
  tryRegisterAccessMode,
} from "./view.js";

const ALL_SLOTS: ViewHelloPayload = {
  protocol: "view/v1",
  placements: ["modal", "widget", "panel", "sidebar", "settings", "header", "access-mode"],
};

function textNode(): ViewNode {
  return { type: "text", content: "x" };
}

interface FakeSession extends LiveViewSession {
  /** Events replayed at subscribe time — keeps the opened/error ack race deterministic. */
  queued: ViewSessionEvent[];
  listeners: Set<(event: ViewSessionEvent) => void>;
  emit: (event: ViewSessionEvent) => void;
  settleClosed: (payload: { reason?: string } | null) => void;
}

function fakeSession(): FakeSession {
  const queued: ViewSessionEvent[] = [{ type: "opened", placement: "panel" }];
  const listeners = new Set<(event: ViewSessionEvent) => void>();
  let resolveClosed!: (payload: { reason?: string } | null) => void;
  const closed = new Promise<{ reason?: string } | null>((resolve) => {
    resolveClosed = resolve;
  });
  return {
    id: "view-failure-1",
    placement: null,
    panelId: null,
    headerSide: null,
    hello: ALL_SLOTS,
    limits: { maxNodes: 512 },
    queued,
    listeners,
    emit: (event: ViewSessionEvent) => {
      for (const handler of listeners) handler(event);
    },
    update: vi.fn(),
    patch: vi.fn(() => false),
    close: vi.fn(),
    onEvent: (handler: (event: ViewSessionEvent) => void) => {
      listeners.add(handler);
      const pending = [...queued];
      if (pending.length > 0) {
        queueMicrotask(() => {
          for (const event of pending) {
            if (listeners.has(handler)) handler(event);
          }
        });
      }
      return () => listeners.delete(handler);
    },
    closed,
    settleClosed: (payload: { reason?: string } | null) => {
      queued.length = 0;
      resolveClosed(payload);
    },
  } as unknown as FakeSession;
}

function sessionClient(
  session: FakeSession,
  hello: ViewHelloPayload | null = ALL_SLOTS,
): DesktopViewClient {
  const openLive = vi.fn(async (_spec: ViewSpec) => session as unknown as LiveViewSession);
  return {
    ensureConnected: async () => hello,
    hello,
    openLive,
  } as unknown as DesktopViewClient;
}

function rejectingClient(error: unknown, hello: ViewHelloPayload | null = ALL_SLOTS) {
  return {
    ensureConnected: async () => hello,
    hello,
    openLive: vi.fn(async () => {
      throw error;
    }),
  } as unknown as DesktopViewClient;
}

function transportClient(message: string): DesktopViewClient {
  return {
    ensureConnected: async () => {
      throw new Error(message);
    },
    hello: null,
    openLive: vi.fn(),
  } as unknown as DesktopViewClient;
}

const panelOptions = { panelId: "telegram-bridge", root: textNode() };

describe("openPanelResult: the failure classes stay separate", () => {
  afterEach(() => vi.useRealTimers());
  it("no-host: absent client is permanent and tells you to fall back", async () => {
    const result = await openPanelResult(null, panelOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("no-host");
      expect(result.retryable).toBe(false);
    }
  });

  it("aborted: the caller's own signal is not reported as a host problem", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = { client: sessionClient(fakeSession()) };
    const result = await openPanelResult(client, { ...panelOptions, signal: controller.signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("aborted");
  });

  it("handshake-timeout: hello never arriving is retryable, unlike an old host", async () => {
    const result = await openPanelResult(sessionClient(fakeSession(), null), panelOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("handshake-timeout");
      expect(result.retryable).toBe(true);
    }
  });

  it("placement: a host that does not advertise the slot is permanent", async () => {
    const old = { protocol: "view/v1", placements: ["modal", "widget"] } as ViewHelloPayload;
    const result = await openPanelResult(sessionClient(fakeSession(), old), panelOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("placement");
      expect(result.retryable).toBe(false);
    }
  });

  it("invalid: a blank panelId is refused locally instead of drifting to ext-<viewId>", async () => {
    const blank = await openPanelResult(sessionClient(fakeSession()), {
      panelId: "   ",
      root: textNode(),
    });
    expect(blank.ok).toBe(false);
    if (!blank.ok) {
      expect(blank.code).toBe("invalid");
      expect(blank.retryable).toBe(false);
    }
    const missing = await openPanelResult(sessionClient(fakeSession()), {
      root: textNode(),
    } as unknown as typeof panelOptions);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("invalid");
  });

  it("sidebar still tolerates an omitted panelId (documented optional)", async () => {
    const result = await openSidebarResult(sessionClient(fakeSession()), { root: textNode() });
    expect(result.ok).toBe(true);
  });

  it("limit: the Host's own error code survives, and is retryable", async () => {
    const client = rejectingClient(
      new ViewHostError("打开中视图数超过上限 8", {
        code: "limit",
        payload: { code: "limit", message: "打开中视图数超过上限 8" },
      }),
    );
    const result = await openPanelResult(client, panelOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("limit");
      expect(result.retryable).toBe(true);
      expect(result.error?.code).toBe("limit");
    }
  });

  it("transport: a dead pipe is its own class, not a host refusal", async () => {
    const result = await openPanelResult(
      transportClient("View Host connect timeout (5000ms)"),
      panelOptions,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("transport");
      expect(result.retryable).toBe(true);
    }
  });

  it.each(["dispose", "rebind", "session"])(
    "classifies a local write failure during dispatch as transport: %s",
    async (closedReason) => {
      const client = rejectingClient(
        new ViewHostError("transport unavailable", { code: "closed", closedReason }),
      );
      expect(await openPanelResult(client, panelOptions)).toMatchObject({
        ok: false,
        code: "transport",
        retryable: true,
      });
    },
  );

  it("waits for confirmation and removes only its own listener on success", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    session.queued.length = 0;
    const consumer = vi.fn();
    session.onEvent(consumer);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const resolved = vi.fn();
    const pending = openPanelResult(sessionClient(session), {
      ...panelOptions,
      signal: controller.signal,
    }).then((result) => {
      resolved(result);
      return result;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(resolved).not.toHaveBeenCalled();
    session.emit({ type: "opened", placement: "panel" });
    expect(await pending).toEqual({ ok: true, session });
    expect(session.listeners.size).toBe(1);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(session.close).not.toHaveBeenCalled();
    session.emit({ type: "action", actionId: "refresh" });
    expect(consumer).toHaveBeenLastCalledWith({ type: "action", actionId: "refresh" });
  });

  it.each(["limit", "placement", "protocol", "internal"] as const)(
    "preserves asynchronous Host error %s and cleans up the failed view",
    async (code) => {
      vi.useFakeTimers();
      const session = fakeSession();
      const error = { code, message: "Host refusal" };
      session.queued.length = 0;
      const pending = openPanelResult(sessionClient(session), panelOptions);
      await vi.advanceTimersByTimeAsync(0);
      session.emit({ type: "error", error });
      expect(await pending).toEqual({
        ok: false,
        code,
        message: error.message,
        retryable: code === "limit" || code === "internal",
        error,
      });
      expect(session.close).toHaveBeenCalledOnce();
      expect(session.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("handles synchronous acknowledgement replay without leaking a subscription or timer", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    const off = vi.fn();
    session.onEvent = (handler) => {
      handler({ type: "opened", placement: "panel" });
      return off;
    };
    expect(await openPanelResult(sessionClient(session), panelOptions)).toEqual({
      ok: true,
      session,
    });
    expect(off).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a Host that advertises the slot but never confirms it", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    session.queued.length = 0;
    const pending = openPanelResult(sessionClient(session), panelOptions);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ ok: false, code: "handshake-timeout", retryable: true });
    expect(session.close).toHaveBeenCalledOnce();
    expect(session.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts an opened acknowledgement already recorded on the session", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    session.queued.length = 0;
    Object.defineProperty(session, "placement", { value: "panel" });
    expect(await openPanelResult(sessionClient(session), panelOptions)).toEqual({
      ok: true,
      session,
    });
    expect(session.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts while waiting for confirmation and releases the waiter", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    session.queued.length = 0;
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = openPanelResult(sessionClient(session), {
      ...panelOptions,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "aborted", retryable: false });
    expect(session.close).toHaveBeenCalledOnce();
    expect(session.listeners.size).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not dispatch after cancellation during hello", async () => {
    const controller = new AbortController();
    const client = sessionClient(fakeSession());
    vi.spyOn(client, "ensureConnected").mockImplementation(async () => {
      controller.abort();
      return ALL_SLOTS;
    });
    expect(
      await openPanelResult(client, { ...panelOptions, signal: controller.signal }),
    ).toMatchObject({ ok: false, code: "aborted", retryable: false });
    expect(client.openLive).not.toHaveBeenCalled();
  });

  it("maps openLive's abort rejection to caller cancellation", async () => {
    const client = rejectingClient(
      new ViewHostError("aborted", { code: "closed", closedReason: "abort" }),
    );
    expect(await openPanelResult(client, panelOptions)).toMatchObject({
      ok: false,
      code: "aborted",
      retryable: false,
    });
  });

  it.each([
    ["dispose", "transport", true],
    ["rebind", "transport", true],
    ["session", "transport", true],
    ["abort", "aborted", false],
    ["limit", "limit", true],
    ["placement", "placement", false],
    ["protocol", "protocol", false],
    ["user", "closed", false],
    ["replaced", "closed", false],
    ["future-reason", "closed", false],
  ])("classifies close before opened: %s", async (reason, code, retryable) => {
    const session = fakeSession();
    session.settleClosed({ reason: String(reason) });
    expect(await openPanelResult(sessionClient(session), panelOptions)).toMatchObject({
      ok: false,
      code,
      retryable,
    });
    expect(session.close).toHaveBeenCalledOnce();
    expect(session.listeners.size).toBe(0);
  });

  it.each([openPanel, openSidebar, openSettingsView])(
    "soft wrapper returns null for an asynchronous Host refusal",
    async (open) => {
      const session = fakeSession();
      session.queued.splice(0, 1, {
        type: "error",
        error: { code: "placement", message: "unavailable" },
      });
      expect(await open(sessionClient(session), panelOptions)).toBeNull();
      expect(session.close).toHaveBeenCalledOnce();
      expect(session.listeners.size).toBe(0);
    },
  );

  it("handles cancellation while openLive is returning a session", async () => {
    const controller = new AbortController();
    const session = fakeSession();
    const client = sessionClient(session);
    vi.spyOn(client, "openLive").mockImplementation(async () => {
      controller.abort();
      return session;
    });
    expect(
      await openPanelResult(client, { ...panelOptions, signal: controller.signal }),
    ).toMatchObject({ ok: false, code: "aborted", retryable: false });
    expect(session.close).toHaveBeenCalledOnce();
    expect(session.listeners.size).toBe(0);
  });

  it("success carries the live session", async () => {
    const result = await openPanelResult(sessionClient(fakeSession()), panelOptions);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.id).toBe("view-failure-1");
  });

  it("openPanel keeps its soft null contract for every one of the above", async () => {
    expect(await openPanel(null, panelOptions)).toBeNull();
    expect(await openPanel(sessionClient(fakeSession(), null), panelOptions)).toBeNull();
    expect(
      await openPanel(rejectingClient(new ViewHostError("limit", { code: "limit" })), panelOptions),
    ).toBeNull();
    expect(await openPanel(sessionClient(fakeSession()), panelOptions)).not.toBeNull();
  });
});

describe("assertPlacementSupported error wrapping", () => {
  it("passes a Host-side ViewHostError through with its own code", async () => {
    const client = rejectingClient(new ViewHostError("over budget", { code: "limit" }));
    const err = (await openHeader(client, {
      root: textNode(),
    }).catch((e: unknown) => e)) as ViewHostError;
    expect(err.code).toBe("limit");
  });

  it("names the client contract when a caller passes a non-conforming object", async () => {
    const broken = { ensureConnected: undefined } as unknown as DesktopViewClient;
    const err = (await openHeader(broken, {
      root: textNode(),
    }).catch((e: unknown) => e)) as ViewHostError;
    expect(err).toBeInstanceOf(ViewHostError);
    expect(err.code).toBe("internal");
    expect(err.message).toContain("client.ensureConnected()");
  });
});

describe("tryRegisterAccessMode: refused is reserved for an explicit Host no", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no-host when the client is absent, invalid when id/title are blank", async () => {
    expect(await tryRegisterAccessMode(null, { id: "m", title: "模式" })).toMatchObject({
      ok: false,
      reason: "no-host",
    });
    expect(
      await tryRegisterAccessMode(sessionClient(fakeSession()), { id: "  ", title: "模式" }),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("unsupported when hello has no access-mode slot (permanent)", async () => {
    const old = { protocol: "view/v1", placements: ["modal"] } as ViewHelloPayload;
    expect(
      await tryRegisterAccessMode(sessionClient(fakeSession(), old), { id: "m", title: "模式" }),
    ).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("timeout, not refused, when hello never arrives (baseline said 'failed')", async () => {
    expect(
      await tryRegisterAccessMode(sessionClient(fakeSession(), null), { id: "m", title: "模式" }),
    ).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("timeout, not refused, when the Host never acks (baseline said 'refused')", async () => {
    vi.useFakeTimers();
    const session = fakeSession();
    session.queued.length = 0;
    const pending = tryRegisterAccessMode(sessionClient(session), {
      id: "m",
      title: "模式",
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("refused keeps the Host's error code (baseline dropped it)", async () => {
    const session = fakeSession();
    session.queued.length = 0;
    session.queued.push({ type: "error", error: { code: "limit", message: "too many views" } });
    const outcome = await tryRegisterAccessMode(sessionClient(session), { id: "m", title: "模式" });
    expect(outcome).toMatchObject({ ok: false, reason: "refused" });
    if (!outcome.ok) expect(outcome.error?.code).toBe("limit");
  });

  it("refused for a non-transport closed reason", async () => {
    const session = fakeSession();
    session.settleClosed({ reason: "limit" });
    expect(
      await tryRegisterAccessMode(sessionClient(session), { id: "m", title: "模式" }),
    ).toMatchObject({ ok: false, reason: "refused" });
  });

  it("transport for a pipe-level close (baseline said 'refused')", async () => {
    const session = fakeSession();
    session.settleClosed({ reason: "dispose" });
    expect(
      await tryRegisterAccessMode(sessionClient(session), { id: "m", title: "模式" }),
    ).toMatchObject({ ok: false, reason: "transport" });
  });

  it("transport, not 'failed', when the connection throws (baseline said 'failed')", async () => {
    expect(
      await tryRegisterAccessMode(transportClient("socket hang up"), { id: "m", title: "模式" }),
    ).toMatchObject({ ok: false, reason: "transport" });
  });

  it("registerAccessMode still projects every failure to null", async () => {
    expect(
      await registerAccessMode(transportClient("boom"), { id: "m", title: "模式" }),
    ).toBeNull();
  });
});

describe("playNotification: caller faults and host refusals no longer share a reason", () => {
  it("internal + detail for a client that does not satisfy its contract (baseline said 'disconnected')", async () => {
    const client = {
      notify: async () => {
        throw new TypeError("ensureConnected is not a function");
      },
    } as unknown as DesktopViewClient;
    expect(await playNotification(client, { scenario: "completed" })).toEqual({
      ok: false,
      reason: "internal",
      detail: "ensureConnected is not a function",
    });
  });

  it("disconnected stays for a real transport failure", async () => {
    const client = {
      notify: async () => {
        throw new Error("EPIPE");
      },
    } as unknown as DesktopViewClient;
    expect(await playNotification(client, { scenario: "completed" })).toEqual({
      ok: false,
      reason: "disconnected",
    });
  });

  it("keeps the Host's own reason string when folding an unlisted value", async () => {
    const client = {
      notify: async () => ({ ok: false, reason: "volume-muted" }),
    } as unknown as DesktopViewClient;
    expect(await playNotification(client, { scenario: "completed" })).toEqual({
      ok: false,
      reason: "rejected",
      detail: "volume-muted",
    });
  });

  it("no client means no host, reported as unsupported", async () => {
    expect(await playNotification(null, { scenario: "completed" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("rejects toast with an empty title before touching the client", async () => {
    const notify = vi.fn();
    const client = { notify } as unknown as DesktopViewClient;
    expect(
      await playNotification(client, { scenario: "completed", toast: { title: "  " } }),
    ).toMatchObject({ ok: false, reason: "rejected" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("forwards toast payload when the client accepts it", async () => {
    const notify = vi.fn(async () => ({ ok: true as const }));
    const client = { notify } as unknown as DesktopViewClient;
    expect(
      await playNotification(client, {
        scenario: "needsAttention",
        toast: { title: "PiDesk · deploy", body: "Needs attention" },
      }),
    ).toEqual({ ok: true });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "needsAttention",
        toast: { title: "PiDesk · deploy", body: "Needs attention" },
      }),
      expect.anything(),
    );
  });
});
