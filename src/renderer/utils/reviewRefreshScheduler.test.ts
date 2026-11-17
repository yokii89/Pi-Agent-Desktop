import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewRefreshScheduler } from "./reviewRefreshScheduler";

afterEach(() => {
  vi.useRealTimers();
});

describe("createReviewRefreshScheduler", () => {
  it("coalesces requests and an urgent request advances the deadline", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const scheduler = createReviewRefreshScheduler(run);

    scheduler.schedule(1000);
    await vi.advanceTimersByTimeAsync(400);
    scheduler.schedule(0);
    const first = scheduler.refresh();
    const second = scheduler.refresh();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs one follow-up refresh for requests received during an active read", async () => {
    vi.useFakeTimers();
    const resolvers: Array<() => void> = [];
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const scheduler = createReviewRefreshScheduler(run);

    const first = scheduler.refresh();
    await vi.advanceTimersByTimeAsync(0);
    const second = scheduler.refresh();
    const third = scheduler.refresh();
    expect(run).toHaveBeenCalledTimes(1);

    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([first, second, third]);
  });
});
