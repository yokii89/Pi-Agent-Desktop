import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ spawn: vi.fn(), paths: vi.fn(), close: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: fake.spawn }));
vi.mock("../session/piLauncher", () => ({ resolvePiCommand: () => ({ file: "pi", args: [] }) }));
vi.mock("../settings/settings", () => ({ getSettings: () => ({}) }));
vi.mock("../view/viewHost", () => ({
  ensureViewHost: async () => ({}),
  getViewHostRendezvousPath: () => "fake",
  closeSessionViews: fake.close,
}));
vi.mock("./workerSafe", () => ({ listWorkerSafeExtensionPaths: fake.paths }));
vi.mock("./contributionCatalog", () => ({ getCatalogSnapshot: () => ({ entries: [] }) }));

import {
  __resetWorkerForTests,
  acquireWorkerLease,
  getWorkerStatus,
  releaseWorkerLease,
} from "./extensionWorkerManager";

function child(answer: boolean) {
  const process = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null,
    stdin: new Writable(),
    kill: vi.fn(),
  });
  const close = () => {
    process.exitCode = 0;
    process.emit("exit", 0);
    process.emit("close", 0);
  };
  process.kill.mockImplementation(close);
  process.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk)) as { id: number };
      if (answer)
        queueMicrotask(() =>
          process.stdout.write(
            `${JSON.stringify({ type: "response", id: request.id, success: true, data: {} })}\n`,
          ),
        );
      callback();
    },
    final(callback) {
      close();
      callback();
    },
  });
  return process;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.paths.mockReturnValue(["safe.ts"]);
});
afterEach(async () => {
  __resetWorkerForTests();
  await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
});
describe("Extension Worker lifecycle", () => {
  it("does not spawn until leased, probes before ready, shares leases and exits after grace", async () => {
    fake.spawn.mockReturnValue(child(true));
    expect(fake.spawn).not.toHaveBeenCalled();
    const results = await Promise.all([acquireWorkerLease(), acquireWorkerLease()]);
    expect(fake.spawn).toHaveBeenCalledTimes(1);
    expect(results[0]?.status).toMatchObject({ ready: true, leases: 2 });
    releaseWorkerLease();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(getWorkerStatus().running).toBe(true);
    releaseWorkerLease();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(getWorkerStatus().running).toBe(false);
  });
  it("does not spawn an empty worker", async () => {
    fake.paths.mockReturnValue([]);
    expect((await acquireWorkerLease()).status.running).toBe(false);
    expect(fake.spawn).not.toHaveBeenCalled();
  });
  it("unanswered RPC fails within the deadline", async () => {
    fake.spawn.mockReturnValue(child(false));
    const acquired = acquireWorkerLease();
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await acquired).status).toMatchObject({ ready: false, running: false });
    expect(getWorkerStatus().errorMessage).toContain("超时");
  });
});
