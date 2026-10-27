import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  alive: new Set<string>(),
  start: vi.fn(),
  probe: vi.fn(),
  dispose: vi.fn(),
  fingerprint: new Map<string, string>(),
}));
vi.mock("./piSession", () => ({
  hasSession: (id: string) => fake.alive.has(id),
  startSession: fake.start,
  fetchSessionState: fake.probe,
  disposeSession: fake.dispose,
  waitForSessionDisposal: async () => {},
}));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: (cwd: string | null) => ({
    fingerprint: fake.fingerprint.get(cwd ?? "user") ?? cwd ?? "user",
  }),
}));

import {
  __resetRuntimeCoordinatorForTests,
  assertNoModeTransition,
  ensureSessionReady,
  getRuntimeState,
  listRuntimeSnapshots,
  markRuntimeActivity,
  noteSessionSpawned,
  onRuntimeActivity,
  reclaimSpeculativeSessions,
  waitRuntimeReady,
  withActivationLock,
} from "./runtimeCoordinator";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.alive.clear();
  fake.fingerprint.clear();
  __resetRuntimeCoordinatorForTests();
  fake.probe.mockResolvedValue({ isStreaming: false });
  fake.start.mockImplementation(
    async (req: {
      sessionId: string;
      cwd?: string;
      reason?: "send" | "view-action" | "speculative-prefetch";
    }) => {
      fake.alive.add(req.sessionId);
      noteSessionSpawned({
        sessionId: req.sessionId,
        cwd: req.cwd ?? "project",
        sessionFile: null,
        reason: req.reason,
      });
      return req.sessionId;
    },
  );
  fake.dispose.mockImplementation((id: string) => fake.alive.delete(id));
});
afterEach(() => vi.useRealTimers());

describe("runtime lifecycle", () => {
  it("reuses the same id without restarting, preserves actual cwd and ownership", async () => {
    await ensureSessionReady({ sessionId: "a", cwd: "project", reason: "speculative-prefetch" });
    await ensureSessionReady({ sessionId: "a", reason: "view-action" });
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(listRuntimeSnapshots()[0]).toMatchObject({
      cwd: "project",
      createdBy: "view-action",
      staleExtension: false,
    });
    expect(reclaimSpeculativeSessions()).toEqual([]);
    expect(fake.dispose).not.toHaveBeenCalled();
  });

  it("waits for RPC and merges concurrent ready probes", async () => {
    fake.alive.add("a");
    noteSessionSpawned({ sessionId: "a", cwd: "A", sessionFile: null });
    let resolve!: (value: object) => void;
    fake.probe.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const first = waitRuntimeReady("a");
    const second = waitRuntimeReady("a");
    expect(listRuntimeSnapshots()[0]?.state).toBe("starting");
    expect(fake.probe).toHaveBeenCalledTimes(1);
    markRuntimeActivity("a", "busy");
    resolve({ isStreaming: true });
    await Promise.all([first, second]);
    expect(listRuntimeSnapshots()[0]?.state).toBe("busy");
  });

  it("idle 只由会话级收口点发出：监听器收到 busy→idle，退订后不再回调", () => {
    fake.alive.add("a");
    noteSessionSpawned({ sessionId: "a", cwd: "A", sessionFile: null });
    const seen: string[] = [];
    const off = onRuntimeActivity((sessionId, activity) => {
      seen.push(`${sessionId}:${activity}`);
    });
    markRuntimeActivity("a", "busy");
    markRuntimeActivity("a", "idle");
    off();
    markRuntimeActivity("a", "busy");
    // docs/design/76 §6.4：piSession 只在 agent_settled 上发 idle，
    // 所以回填 finishedAt 的一方不再需要 willRetry 例外就能拿到真正的收口时刻
    expect(seen).toEqual(["a:busy", "a:idle"]);
    expect(getRuntimeState("a")).toBe("busy");
  });

  it("classifies an unanswered probe and disposes only its new process", async () => {
    fake.probe.mockImplementation(
      (_id: string, timeout: number) =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
    );
    const start = ensureSessionReady({ sessionId: "a" });
    const check = expect(start).rejects.toMatchObject({ code: "runtime-ready-timeout" });
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
    expect(fake.dispose).toHaveBeenCalledWith("a");
    expect(listRuntimeSnapshots()[0]?.state).toBe("failed");
  });

  it("stale compares each project's own fingerprint and resets after restart", async () => {
    await ensureSessionReady({ sessionId: "a", cwd: "A" });
    await ensureSessionReady({ sessionId: "b", cwd: "B" });
    fake.fingerprint.set("A", "A2");
    expect(listRuntimeSnapshots().map((r) => r.staleExtension)).toEqual([true, false]);
    fake.alive.delete("a");
    await ensureSessionReady({ sessionId: "a", cwd: "A" });
    expect(listRuntimeSnapshots().find((r) => r.sessionId === "a")?.staleExtension).toBe(false);
  });

  it("activation locks merge duplicate work and block only their session", async () => {
    let finish!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = withActivationLock("a", "plan", work);
    const second = withActivationLock("a", "plan", work);
    expect(first).toBe(second);
    expect(work).toHaveBeenCalledTimes(1);
    expect(() => assertNoModeTransition("a")).toThrow();
    expect(() => assertNoModeTransition("b")).not.toThrow();
    finish();
    await first;
    expect(() => assertNoModeTransition("a")).not.toThrow();
  });
});
