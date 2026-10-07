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
  listRuntimeSnapshots,
  markRuntimeActivity,
  noteSessionSpawned,
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
