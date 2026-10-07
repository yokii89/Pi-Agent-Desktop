import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopViewClient, LiveViewSession, ViewSessionEvent } from "./client.js";
import {
  __resetProcessViewClientForTests,
  acquireProcessViewClient,
  processViewClientRefCount,
} from "./processClient.js";
import {
  __resetSlotLeasesForTests,
  DEFAULT_SLOT_RETRY_DELAYS_MS,
  superviseAccessMode,
  superviseSlot,
} from "./slot.js";
import type { SlotRegisterOutcome } from "./view.js";

interface FakeHandle {
  session: LiveViewSession;
  setActive: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  resolveClosed: (p: { reason?: string } | null) => void;
}

function makeSession(): FakeHandle {
  let resolveClosed!: (payload: { reason?: string } | null) => void;
  const close = vi.fn(() => {
    resolveClosed({ reason: "client" });
  });
  const closed = new Promise<{ reason?: string } | null>((resolve) => {
    resolveClosed = resolve;
  });
  const session = {
    id: `view-slot-${Math.random().toString(36).slice(2, 8)}`,
    close,
    onEvent() {
      return () => undefined;
    },
    closed,
  } as unknown as LiveViewSession;
  return { session, setActive: vi.fn(), close, resolveClosed };
}

function fakeClient(extra?: Partial<DesktopViewClient>) {
  return {
    dispose: vi.fn(),
    setSessionId: vi.fn(),
    refreshEnv: vi.fn(() => false),
    ...extra,
  } as unknown as DesktopViewClient;
}

describe("superviseSlot", () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetProcessViewClientForTests();
    __resetSlotLeasesForTests();
  });

  it("registers once and re-fires onRegistered on ensure() while live", async () => {
    const handle = makeSession();
    const register = vi.fn(
      async (): Promise<SlotRegisterOutcome<FakeHandle>> => ({ ok: true, handle }),
    );
    const onRegistered = vi.fn();
    const sup = superviseSlot<FakeHandle>({
      client: fakeClient(),
      register,
      getSession: (h) => h.session,
      onRegistered,
    });

    await expect(sup.ensure()).resolves.toBe(handle);
    expect(register).toHaveBeenCalledTimes(1);
    expect(sup.snapshot.status).toBe("registered");

    await sup.ensure();
    expect(register).toHaveBeenCalledTimes(1);
    expect(onRegistered).toHaveBeenCalledTimes(2);
  });

  it("soft-stops on no-host without retrying", async () => {
    const register = vi.fn(
      async (): Promise<SlotRegisterOutcome<FakeHandle>> => ({
        ok: false,
        reason: "no-host",
      }),
    );
    const sup = superviseSlot<FakeHandle>({
      client: null,
      connect: () => null,
      register,
      getSession: () => makeSession().session,
      reprobeMs: 0,
    });
    await expect(sup.ensure()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
    expect(sup.snapshot.status).toBe("unsupported");
  });

  it("second supervisor with the same leaseKey does not thrash", async () => {
    const firstHandle = makeSession();
    const secondHandle = makeSession();
    const registerA = vi.fn(
      async (): Promise<SlotRegisterOutcome<FakeHandle>> => ({ ok: true, handle: firstHandle }),
    );
    const registerB = vi.fn(
      async (): Promise<SlotRegisterOutcome<FakeHandle>> => ({ ok: true, handle: secondHandle }),
    );
    const client = fakeClient();

    const a = superviseSlot<FakeHandle>({
      client,
      leaseKey: "access-mode",
      register: registerA,
      getSession: (h) => h.session,
    });
    await a.ensure();
    expect(a.snapshot.status).toBe("registered");

    const b = superviseSlot<FakeHandle>({
      client,
      leaseKey: "access-mode",
      register: registerB,
      getSession: (h) => h.session,
    });
    await b.ensure();
    expect(registerB).not.toHaveBeenCalled();
    expect(b.snapshot.status).toBe("unsupported");
    expect(b.handle).toBeNull();

    a.stop();
    // lease released — B can now take it
    await b.ensure();
    expect(registerB).toHaveBeenCalledTimes(1);
    expect(b.snapshot.status).toBe("registered");
  });

  it("does not auto re-register on reason=replaced (displaced)", async () => {
    const first = makeSession();
    const second = makeSession();
    let call = 0;
    const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
      call += 1;
      return { ok: true, handle: call === 1 ? first : second };
    });
    const sup = superviseSlot<FakeHandle>({
      client: fakeClient(),
      leaseKey: "access-mode-x",
      register,
      getSession: (h) => h.session,
    });
    await sup.ensure();
    expect(sup.handle).toBe(first);

    first.resolveClosed({ reason: "replaced" });
    await Promise.resolve();
    await Promise.resolve();
    expect(sup.snapshot.status).toBe("displaced");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("holds on reason=session until rebindSession", async () => {
    const first = makeSession();
    const second = makeSession();
    let call = 0;
    const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
      call += 1;
      return { ok: true, handle: call === 1 ? first : second };
    });
    const client = fakeClient();
    const sup = superviseSlot<FakeHandle>({
      client,
      register,
      getSession: (h) => h.session,
    });
    await sup.ensure();

    first.resolveClosed({ reason: "session" });
    await vi.waitFor(() => {
      expect(sup.snapshot.status).toBe("displaced");
    });
    expect(register).toHaveBeenCalledTimes(1);

    await sup.rebindSession("session-B");
    expect(client.setSessionId).toHaveBeenCalledWith("session-B");
    expect(sup.handle).toBe(second);
    expect(sup.snapshot.status).toBe("registered");
  });

  it("rebindSession re-registers even when setSessionId tears down the live view", async () => {
    const first = makeSession();
    const second = makeSession();
    let call = 0;
    const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
      call += 1;
      return { ok: true, handle: call === 1 ? first : second };
    });
    // 模拟真实 client：setSessionId 会 settle 旧注册（reason=rebind）
    const client = fakeClient({
      setSessionId: vi.fn(() => {
        first.resolveClosed({ reason: "rebind" });
      }),
    } as Partial<DesktopViewClient>);
    const sup = superviseSlot<FakeHandle>({
      client,
      register,
      getSession: (h) => h.session,
    });
    await sup.ensure();
    expect(sup.handle).toBe(first);

    const rebound = await sup.rebindSession("sess-B");
    expect(rebound).toBe(second);
    expect(sup.snapshot.status).toBe("registered");
    expect(sup.handle).toBe(second);
  });

  it("ignores late closed from a superseded registration", async () => {
    const first = makeSession();
    const second = makeSession();
    let call = 0;
    const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
      call += 1;
      return { ok: true, handle: call === 1 ? first : second };
    });
    const sup = superviseSlot<FakeHandle>({
      client: fakeClient(),
      register,
      getSession: (h) => h.session,
    });
    await sup.ensure();
    first.resolveClosed({ reason: "dispose" });
    await vi.waitFor(() => {
      expect(sup.handle).toBe(second);
    });

    // first 的 closed 已消费；再 resolve 不应改动 second
    // （Promise 只 settle 一次；这里用 status 断言 second 仍 registered）
    expect(sup.snapshot.status).toBe("registered");
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("re-registers immediately after pipe dispose and resets attempt", async () => {
    const first = makeSession();
    const second = makeSession();
    let call = 0;
    const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
      call += 1;
      return { ok: true, handle: call === 1 ? first : second };
    });
    const sup = superviseSlot<FakeHandle>({
      client: fakeClient(),
      register,
      getSession: (h) => h.session,
      retryDelaysMs: DEFAULT_SLOT_RETRY_DELAYS_MS,
    });

    await sup.ensure();
    first.resolveClosed({ reason: "dispose" });
    await vi.waitFor(() => {
      expect(sup.handle).toBe(second);
    });
    expect(sup.snapshot.status).toBe("registered");
  });

  it("retries transient failures with backoff then exhausts; reprobe can revive", async () => {
    vi.useFakeTimers();
    const handle = makeSession();
    let fail = true;
    const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
      if (fail) return { ok: false, reason: "failed" };
      return { ok: true, handle };
    });
    const sup = superviseSlot<FakeHandle>({
      client: fakeClient(),
      register,
      getSession: (h) => h.session,
      retryDelaysMs: [50, 100],
      reprobeMs: 1000,
    });

    const ensured = sup.ensure();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(100);
    await expect(ensured).resolves.toBeNull();
    expect(sup.snapshot.status).toBe("exhausted");
    expect(register).toHaveBeenCalledTimes(3);

    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => {
      expect(sup.snapshot.status).toBe("registered");
    });
  });

  it("stop() unblocks ensure and releases lease", async () => {
    vi.useFakeTimers();
    const register = vi.fn(
      async (): Promise<SlotRegisterOutcome<FakeHandle>> => ({
        ok: false,
        reason: "failed",
      }),
    );
    const owned = { dispose: vi.fn(), setSessionId: vi.fn() } as unknown as DesktopViewClient;
    const sup = superviseSlot<FakeHandle>({
      connect: () => owned,
      leaseKey: "stop-lease",
      register,
      getSession: () => makeSession().session,
      retryDelaysMs: [50],
      reprobeMs: 0,
    });

    const ensured = sup.ensure();
    await vi.advanceTimersByTimeAsync(0);
    expect(sup.snapshot.status).toBe("retrying");
    sup.stop();
    await expect(ensured).resolves.toBeNull();
    expect(sup.snapshot.status).toBe("stopped");
  });

  it("stop() releases a shared process client instead of disposing it", async () => {
    const env = { PIDESK_VIEW_ENDPOINT: "http://127.0.0.1:9", PIDESK_VIEW_TOKEN: "t" };
    // Another extension already holds the shared pipe.
    const shared = acquireProcessViewClient({ env });
    expect(shared).not.toBeNull();
    expect(processViewClientRefCount()).toBe(1);
    const disposeSpy = vi.spyOn(shared as DesktopViewClient, "dispose");

    const sup = superviseSlot<FakeHandle>({
      connect: () => acquireProcessViewClient({ env }),
      leaseKey: "shared-process-client",
      register: async () => ({ ok: false, reason: "failed" }),
      getSession: () => makeSession().session,
      retryDelaysMs: [10],
      reprobeMs: 0,
    });
    await sup.ensure();
    expect(processViewClientRefCount()).toBe(2);

    sup.stop();

    // The supervisor only borrowed one refcount; peers keep the pipe alive.
    expect(disposeSpy).not.toHaveBeenCalled();
    expect(processViewClientRefCount()).toBe(1);
  });

  it("caches and releases the connect() client when client is explicitly null", async () => {
    const env = { PIDESK_VIEW_ENDPOINT: "http://127.0.0.1:10", PIDESK_VIEW_TOKEN: "t" };
    let connects = 0;
    const sup = superviseSlot<FakeHandle>({
      client: null,
      connect: () => {
        connects += 1;
        return acquireProcessViewClient({ env });
      },
      leaseKey: "null-client",
      register: async () => ({ ok: false, reason: "failed" }),
      getSession: () => makeSession().session,
      retryDelaysMs: [10],
      reprobeMs: 0,
    });
    await sup.ensure();

    expect(connects).toBe(1);
    sup.stop();
    expect(processViewClientRefCount()).toBe(0);
  });
});

describe("superviseAccessMode", () => {
  afterEach(() => {
    __resetProcessViewClientForTests();
    __resetSlotLeasesForTests();
  });

  it("routes activate/deactivate and uses access-mode lease by default", async () => {
    const session = makeSession();
    const setActive = vi.fn();
    let capturedOnEvent: ((e: ViewSessionEvent, s: LiveViewSession) => void) | undefined;

    const tryRegister = vi.fn(
      async (
        _client: unknown,
        options: { onEvent?: (e: ViewSessionEvent, s: LiveViewSession) => void },
      ) => {
        capturedOnEvent = options.onEvent;
        return {
          ok: true as const,
          handle: { viewId: "view-1", session: session.session, setActive },
        };
      },
    );

    const onActivate = vi.fn();
    const onDeactivate = vi.fn();
    const client = fakeClient();
    const sup = superviseAccessMode({
      client,
      registration: { id: "yoki-plan", title: "计划模式" },
      onActivate,
      onDeactivate,
      tryRegister: tryRegister as never,
    });

    await sup.ensure();
    const other = superviseAccessMode({
      client,
      registration: { id: "other", title: "Other" },
      tryRegister: vi.fn(async () => {
        throw new Error("should not register");
      }) as never,
    });
    await other.ensure();
    expect(other.snapshot.status).toBe("unsupported");

    capturedOnEvent?.({ type: "action", actionId: "mode:activate" }, session.session);
    capturedOnEvent?.({ type: "action", actionId: "mode:deactivate" }, session.session);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("exports the lockstep access-mode action ids", async () => {
    const mod = await import("./types.js");
    expect(mod.ACCESS_MODE_ACTIONS).toEqual({
      activate: "mode:activate",
      deactivate: "mode:deactivate",
    });
  });
});
