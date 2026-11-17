import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PiSessionStats } from "../../shared/ipc";
import { createContextUsageRefresh } from "./contextUsageRefresh";

function stats(tokens: number | null): PiSessionStats {
  return {
    contextUsage: {
      tokens,
      contextWindow: 100000,
      percent: tokens === null ? null : tokens / 1000,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("contextUsageRefresh", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("合并密集消息，持续来事件也不会无限推迟读取", async () => {
    const read = vi.fn(async () => stats(10000));
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    refresh.schedule("a");
    refresh.schedule("a");
    await vi.advanceTimersByTimeAsync(200);
    refresh.schedule("a");
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);

    expect(read).toHaveBeenCalledExactlyOnceWith("a");
    expect(apply).toHaveBeenCalledExactlyOnceWith("a", stats(10000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("读取期间的新消息会补读一次，同会话没有并发请求", async () => {
    const first = deferred<PiSessionStats>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(stats(20000));
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    const task = refresh.refresh("a");
    refresh.schedule("a");
    refresh.schedule("a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    first.resolve(stats(10000));
    await task;
    expect(apply).toHaveBeenLastCalledWith("a", stats(10000));
    await vi.advanceTimersByTimeAsync(250);

    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith("a", stats(20000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("收口或手动刷新跳过等待，不会留下重复计时器", async () => {
    const read = vi.fn(async () => stats(20000));
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    refresh.schedule("a");
    await refresh.refresh("a");
    await vi.advanceTimersByTimeAsync(1000);

    expect(read).toHaveBeenCalledExactlyOnceWith("a");
    expect(apply).toHaveBeenCalledExactlyOnceWith("a", stats(20000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("压缩期间的旧快照不回写，立即刷新等待新的未知量快照", async () => {
    const first = deferred<PiSessionStats>();
    const second = deferred<PiSessionStats>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    const task = refresh.refresh("a");
    const compacted = refresh.refresh("a");
    refresh.schedule("a");
    first.resolve(stats(90000));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(apply).not.toHaveBeenCalled();
    second.resolve(stats(null));
    await Promise.all([task, compacted]);

    expect(apply).toHaveBeenCalledExactlyOnceWith("a", stats(null));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("不同会话独立读取，后台结果仍归属原会话", async () => {
    const first = deferred<PiSessionStats>();
    const read = vi.fn((id: string) =>
      id === "a" ? first.promise : Promise.resolve(stats(20000)),
    );
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    const task = refresh.refresh("a");
    await refresh.refresh("b");
    expect(apply).toHaveBeenCalledExactlyOnceWith("b", stats(20000));
    first.resolve(stats(10000));
    await task;

    expect(apply).toHaveBeenLastCalledWith("a", stats(10000));
  });

  it("取消移除待执行刷新，同 id 重启后不会收到旧实例的结果", async () => {
    const old = deferred<PiSessionStats>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(stats(20000));
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    refresh.schedule("waiting");
    refresh.cancel("waiting");
    const oldTask = refresh.refresh("a");
    refresh.schedule("a");
    refresh.cancel("a");
    await refresh.refresh("a");
    old.resolve(stats(10000));
    await oldTask;
    await vi.advanceTimersByTimeAsync(1000);

    expect(read.mock.calls).toEqual([["a"], ["a"]]);
    expect(apply).toHaveBeenCalledExactlyOnceWith("a", stats(20000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("卸载清理在途和待执行任务，effect 重挂后可以重新刷新", async () => {
    const first = deferred<PiSessionStats>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(stats(20000));
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    const task = refresh.refresh("a");
    refresh.schedule("b");
    refresh.clear();
    first.resolve(stats(10000));
    await task;
    await vi.advanceTimersByTimeAsync(1000);
    expect(apply).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    await refresh.refresh("b");
    expect(apply).toHaveBeenCalledExactlyOnceWith("b", stats(20000));
  });

  it("暂时读取失败不清空已有读数，也不阻断后续刷新", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(stats(10000))
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValueOnce(stats(20000));
    const apply = vi.fn();
    const refresh = createContextUsageRefresh(read, apply);

    await refresh.refresh("a");
    await refresh.refresh("a");
    await refresh.refresh("a");
    expect(apply).toHaveBeenCalledExactlyOnceWith("a", stats(10000));
    await refresh.refresh("a");
    expect(apply).toHaveBeenLastCalledWith("a", stats(20000));
  });
});
