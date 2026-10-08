/**
 * Registration-slot branch coverage (docs/design/20 O7).
 *
 * `slot.test.ts` covers the happy path and the common drop/re-register cycle. The
 * branches below are the ones §1.3 counted as untested: the opt-in re-registration
 * policies, the diagnostic snapshot fields, and whether `stop()` really closes a
 * *live* handle instead of only cancelling timers. Each encodes a decision the
 * supervisor makes on behalf of every future resident slot, so each must fail
 * loudly when that decision changes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopViewClient, LiveViewSession } from "./client.js";
import { __resetSlotLeasesForTests, superviseSlot } from "./slot.js";
import type { SlotRegisterOutcome } from "./view.js";

interface FakeHandle {
  session: LiveViewSession;
  label: string;
}

interface Recorded {
  session: LiveViewSession;
  close: ReturnType<typeof vi.fn>;
  settle: (reason?: string) => void;
}

function makeRecorded(): Recorded {
  let settle!: (reason?: string) => void;
  const closed = new Promise<{ reason?: string } | null>((resolve) => {
    settle = (reason) => resolve(reason === undefined ? null : { reason });
  });
  const close = vi.fn(() => settle("client"));
  const session = {
    id: `view-${Math.random().toString(36).slice(2, 8)}`,
    close,
    onEvent: () => () => undefined,
    update: vi.fn(),
    closed,
  } as unknown as LiveViewSession;
  return { session, close, settle };
}

const stubClient = { dispose: vi.fn() } as unknown as DesktopViewClient;

/**
 * Supervisor + a registry of every session it ever registered, so a test can
 * deliver `closed(reason)` exactly as the client would.
 */
function harness(
  overrides: Partial<Parameters<typeof superviseSlot<FakeHandle>>[0]> = {},
  failWith?: (attempt: number) => SlotRegisterOutcome<FakeHandle>,
) {
  const registered: Recorded[] = [];
  let calls = 0;
  const register = vi.fn(async (): Promise<SlotRegisterOutcome<FakeHandle>> => {
    calls += 1;
    if (failWith) return failWith(calls);
    const record = makeRecorded();
    registered.push(record);
    return { ok: true, handle: { session: record.session, label: `#${registered.length}` } };
  });

  const supervisor = superviseSlot<FakeHandle>({
    client: stubClient,
    register,
    getSession: (handle) => handle.session,
    reprobeMs: 0,
    retryDelaysMs: [1, 1, 1],
    ...overrides,
  });
  return { supervisor, register, registered };
}

/** Let the queued `closed().then(...)` handlers run. */
async function drain(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("closed(reason) re-registration policies", () => {
  afterEach(() => {
    __resetSlotLeasesForTests();
  });

  for (const reason of ["limit", "placement", "protocol"] as const) {
    it(`re-registers after closed(${reason})`, async () => {
      const { supervisor, register, registered } = harness({ leaseKey: `lease-${reason}` });
      await supervisor.ensure();
      expect(register).toHaveBeenCalledTimes(1);

      registered[0].settle(reason);
      await drain();

      expect(register.mock.calls.length).toBeGreaterThan(1);
      expect(supervisor.snapshot.lastClosedReason).toBe(reason);
      supervisor.stop();
    });
  }

  it("holds displaced on closed(replaced) by default — another owner has the slot", async () => {
    const { supervisor, register, registered } = harness({ leaseKey: "lease-replaced" });
    await supervisor.ensure();
    registered[0].settle("replaced");
    await drain();
    expect(supervisor.snapshot.status).toBe("displaced");
    expect(register).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });

  it("re-registers on closed(replaced) only when retryOnReplaced is opted in", async () => {
    const { supervisor, register, registered } = harness({
      leaseKey: "lease-retry-replaced",
      retryOnReplaced: true,
    });
    await supervisor.ensure();
    registered[0].settle("replaced");
    await drain();
    expect(register.mock.calls.length).toBeGreaterThan(1);
    expect(supervisor.snapshot.status).toBe("registered");
    supervisor.stop();
  });

  it("holdOnSessionClose:false re-registers immediately instead of waiting for rebind", async () => {
    const { supervisor, register, registered } = harness({ holdOnSessionClose: false });
    await supervisor.ensure();
    registered[0].settle("session");
    await drain();
    expect(register.mock.calls.length).toBeGreaterThan(1);
    supervisor.stop();
  });

  it("re-probes from unsupported once the reprobe window elapses", async () => {
    const { supervisor, register } = harness({ reprobeMs: 5 }, () => ({
      ok: false,
      reason: "unsupported",
    }));
    await supervisor.ensure();
    expect(supervisor.snapshot.status).toBe("unsupported");
    expect(register).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(register.mock.calls.length).toBeGreaterThan(1);
    supervisor.stop();
  });
});

describe("snapshot diagnostics", () => {
  afterEach(() => {
    __resetSlotLeasesForTests();
  });

  it("clears lastFailure once a retry lands", async () => {
    const { supervisor, registered } = harness({}, (attempt) => {
      if (attempt === 1) return { ok: false, reason: "transport" };
      const record = makeRecorded();
      registered.push(record);
      return { ok: true, handle: { session: record.session, label: `#${attempt}` } };
    });

    await supervisor.ensure();
    expect(supervisor.snapshot.status).toBe("registered");
    expect(supervisor.snapshot.lastFailure).toBeUndefined();
    expect(supervisor.snapshot.attempt).toBe(0);
    supervisor.stop();
  });

  it("reports the failing reason verbatim while retrying", async () => {
    const { supervisor } = harness({}, () => ({ ok: false, reason: "timeout" }));
    await supervisor.ensure();
    expect(supervisor.snapshot.lastFailure).toBe("timeout");
    supervisor.stop();
  });
});

describe("stop() teardown hygiene", () => {
  afterEach(() => {
    __resetSlotLeasesForTests();
  });

  it("closes a live handle, not just its timers", async () => {
    const { supervisor, registered } = harness();
    await supervisor.ensure();
    const handle = registered[0];
    expect(supervisor.handle).not.toBeNull();

    supervisor.stop();
    expect(handle.close).toHaveBeenCalled();
    expect(supervisor.handle).toBeNull();
    expect(supervisor.snapshot.status).toBe("stopped");
  });

  it("leaves no timer behind", async () => {
    vi.useFakeTimers();
    const { supervisor } = harness({ reprobeMs: 60_000 });
    await supervisor.ensure();
    supervisor.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("releases the in-process lease so a replacement supervisor can take over", async () => {
    const first = harness({ leaseKey: "shared-lease" });
    await first.supervisor.ensure();
    const second = harness({ leaseKey: "shared-lease" });
    await second.supervisor.ensure();
    // Denied: the lease is held, so `second` never even attempts a registration.
    expect(second.supervisor.snapshot.status).toBe("unsupported");
    expect(second.register).toHaveBeenCalledTimes(0);

    first.supervisor.stop();
    await second.supervisor.ensure();
    expect(second.register).toHaveBeenCalledTimes(1);
    expect(second.supervisor.snapshot.status).toBe("registered");
    second.supervisor.stop();
  });
});
