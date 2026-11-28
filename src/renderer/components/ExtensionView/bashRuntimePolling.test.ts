import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BashJobRuntime } from "../../../shared/bashWorkspace";
import { createRuntimeSampler } from "./bashRuntimePolling";

function runtime(overrides: Partial<BashJobRuntime> = {}): BashJobRuntime {
  return {
    at: 1_000,
    alive: true,
    root: null,
    descendants: [],
    ports: [],
    memoryBytes: 1_024,
    processCount: 1,
    portsReadable: true,
    cpuPercent: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("runtime sampler", () => {
  it("waits for visibility, refreshes three seconds after completion, and never overlaps", async () => {
    const first = deferred<BashJobRuntime>();
    const inspect = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(runtime());
    const sampler = createRuntimeSampler(inspect);
    sampler.select("view", "job");
    await vi.advanceTimersByTimeAsync(9_000);
    expect(inspect).not.toHaveBeenCalled();
    sampler.setActive(true);
    sampler.refresh();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(inspect).toHaveBeenCalledTimes(1);
    first.resolve(runtime());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(inspect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(inspect).toHaveBeenCalledTimes(2);
    sampler.setActive(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("serializes retargeting and discards late success and failure from another job/view", async () => {
    const oldJob = deferred<BashJobRuntime>();
    const nextJob = deferred<BashJobRuntime>();
    const newestJob = deferred<BashJobRuntime>();
    const inspect = vi
      .fn()
      .mockReturnValueOnce(oldJob.promise)
      .mockReturnValueOnce(nextJob.promise)
      .mockReturnValueOnce(newestJob.promise);
    const sampler = createRuntimeSampler(inspect);
    sampler.select("a", "job");
    sampler.setActive(true);
    sampler.select("b", "job");
    expect(inspect).toHaveBeenCalledTimes(1);
    oldJob.resolve(runtime({ memoryBytes: 999 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(inspect).toHaveBeenLastCalledWith("b", "job");
    expect(sampler.getState().value).toBeNull();
    sampler.select("b", "other");
    nextJob.reject(new Error("old view failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(inspect).toHaveBeenLastCalledWith("b", "other");
    expect(sampler.getState().error).toBeNull();
    newestJob.resolve(runtime({ memoryBytes: 2_048 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sampler.getState().memory).toEqual([2_048]);
    sampler.setActive(false);
  });

  it("pauses in-flight samples, ignores late responses after cleanup, and survives effect replay", async () => {
    const first = deferred<BashJobRuntime>();
    const inspect = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(runtime());
    const listener = vi.fn();
    const sampler = createRuntimeSampler(inspect);
    sampler.subscribe(listener);
    sampler.select("view", "job");
    sampler.setActive(true);
    sampler.subscribe(null);
    sampler.setActive(false);
    const calls = listener.mock.calls.length;
    sampler.subscribe(listener);
    sampler.setActive(true);
    expect(inspect).toHaveBeenCalledTimes(1);
    first.resolve(runtime({ memoryBytes: 999 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(sampler.getState().memory).toEqual([1_024]);
    expect(listener.mock.calls.length).toBeGreaterThan(calls);
    sampler.subscribe(null);
    sampler.setActive(false);
    const stoppedCalls = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(listener).toHaveBeenCalledTimes(stoppedCalls);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("preserves failed-query semantics and the previous snapshot until an explicit retry succeeds", async () => {
    const inspect = vi
      .fn()
      .mockRejectedValueOnce(new Error("access denied"))
      .mockResolvedValueOnce(runtime())
      .mockRejectedValueOnce(new Error("snapshot unavailable"));
    const sampler = createRuntimeSampler(inspect);
    sampler.select("view", "job");
    sampler.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sampler.getState()).toMatchObject({ value: null, error: "access denied", memory: [] });
    sampler.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(sampler.getState()).toMatchObject({ error: null, value: { cpuPercent: null } });
    sampler.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(sampler.getState()).toMatchObject({
      error: "snapshot unavailable",
      value: { memoryBytes: 1_024 },
      memory: [1_024],
    });
    sampler.setActive(false);
  });

  it("stops after a dead sample, including on re-show, while allowing a manual refresh", async () => {
    const inspect = vi.fn().mockResolvedValue(runtime({ alive: false }));
    const sampler = createRuntimeSampler(inspect);
    sampler.select("view", "job");
    sampler.setActive(true);
    await vi.advanceTimersByTimeAsync(20_000);
    sampler.setActive(false);
    sampler.setActive(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(inspect).toHaveBeenCalledTimes(1);
    sampler.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(inspect).toHaveBeenCalledTimes(2);
    sampler.setActive(false);
  });

  it("keeps a bounded memory history and resets it with the selection", async () => {
    const inspect = vi.fn().mockResolvedValue(runtime());
    const sampler = createRuntimeSampler(inspect);
    sampler.select("view", "job");
    sampler.setActive(true);
    await vi.advanceTimersByTimeAsync(63_000);
    expect(sampler.getState().memory).toHaveLength(20);
    sampler.select("view", "other");
    expect(sampler.getState().memory).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sampler.getState().memory).toEqual([1_024]);
    sampler.setActive(false);
  });
});
