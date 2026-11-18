/**
 * Frame-scheduling semantics (docs/design/20 O4).
 *
 * Ported from `pi-telegram-main/tests/desktop-view.test.ts` 「frame budget」 block,
 * where the behaviour was proven against the extension's own scheduler.准则 §9
 * forbids every extension hand-rolling its own throttle loop, so the primitive
 * moves here — and its contract moves with it, test by test.
 *
 * The Telegram projection/lifecycle tests that shared that suite stay
 * extension-side: they assert what the bridge renders, not when it is allowed to
 * send. Only the *scheduling* invariants are SDK concerns.
 */

import { describe, expect, it, vi } from "vitest";
import { createViewFrameScheduler, DEFAULT_VIEW_FRAME_INTERVAL_MS } from "./index.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("until() timed out");
    await delay(2);
  }
}

describe("merge window", () => {
  it("defaults to the ≤4 updates/second budget", () => {
    expect(DEFAULT_VIEW_FRAME_INTERVAL_MS).toBe(250);
    expect(1000 / DEFAULT_VIEW_FRAME_INTERVAL_MS).toBe(4);
  });

  it("collapses a burst inside one window into a single frame", async () => {
    let sends = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        sends += 1;
      },
      intervalMs: 20,
    });

    for (let i = 0; i < 20; i += 1) scheduler.markDirty();
    expect(sends).toBe(0);
    await until(() => sends === 1);
    expect(scheduler.stats.requested).toBe(20);
    expect(scheduler.stats.coalesced).toBe(19);
    scheduler.stop();
  });

  it("holds at ≤4 frames/second with the default window", async () => {
    let sends = 0;
    const gaps: number[] = [];
    let previous = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        const now = Date.now();
        if (previous !== 0) gaps.push(now - previous);
        previous = now;
        sends += 1;
      },
    });

    const start = Date.now();
    while (Date.now() < start + 1200) {
      scheduler.markDirty();
      await delay(10);
    }
    const elapsed = Date.now() - start;
    scheduler.stop();

    expect(sends / (elapsed / 1000)).toBeLessThanOrEqual(4.2);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(200);
    expect(scheduler.stats.coalesced).toBeGreaterThan(0);
  });
});

describe("backpressure", () => {
  it("serializes concurrent flushes without leaving a duplicate timer", async () => {
    vi.useFakeTimers();
    const releases: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          releases.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );
    const scheduler = createViewFrameScheduler({ send, intervalMs: 10 });
    try {
      scheduler.markDirty();
      const first = scheduler.flush();
      scheduler.markDirty();
      const second = scheduler.flush();
      const thirdDone = vi.fn();
      const third = scheduler.flush().then(thirdDone);
      releases[0]();
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);
      expect(thirdDone).not.toHaveBeenCalled();
      releases[1]();
      await Promise.all([first, second, third]);
      await vi.advanceTimersByTimeAsync(50);
      expect(send).toHaveBeenCalledTimes(2);
      expect(maximumActive).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it("never drops a change that arrives while a frame is in flight", async () => {
    let sends = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = createViewFrameScheduler({
      send: async () => {
        sends += 1;
        if (sends === 1) await gate;
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => sends === 1);

    scheduler.markDirty();
    scheduler.markDirty();
    scheduler.markDirty();
    release();
    await until(() => sends === 2);
    expect(scheduler.stats.coalesced).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it("settles flush() during an in-flight send once the wire clears (no deadlock)", async () => {
    let sends = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduler = createViewFrameScheduler({
      send: async () => {
        sends += 1;
        if (sends === 1) await gate;
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => sends === 1);
    scheduler.markDirty();
    const flushing = scheduler.flush();
    release();
    await flushing;
    expect(sends).toBe(2);
    scheduler.stop();
  });
});

describe("action boundaries", () => {
  it("flush() delivers immediately without waiting for the window", async () => {
    let sends = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        sends += 1;
      },
      intervalMs: 5000,
    });

    scheduler.markDirty();
    expect(sends).toBe(0);
    await scheduler.flush();
    expect(sends).toBe(1);
    scheduler.stop();
  });

  it("flush() is a no-op when nothing is dirty", async () => {
    let sends = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        sends += 1;
      },
      intervalMs: 10,
    });
    await scheduler.flush();
    expect(sends).toBe(0);
    scheduler.stop();
  });

  it("flushNow() renders a freshly opened panel before the first tick", async () => {
    let sends = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        sends += 1;
      },
      intervalMs: 5000,
    });

    await scheduler.flushNow();
    expect(sends).toBe(1);
    // …and does not double-send the frame the open() already delivered.
    await scheduler.flush();
    expect(sends).toBe(1);
    scheduler.stop();
  });
});

describe("failure isolation", () => {
  it("does not let a synchronously throwing send escape as an unhandled error", async () => {
    let attempts = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("pipe reset");
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => attempts >= 1);
    expect(scheduler.stats.delivered).toBe(0);
    await until(() => scheduler.stats.delivered === 1);
    expect(attempts).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });

  it("recovers from an async rejecting send on the next frame", async () => {
    let attempts = 0;
    const scheduler = createViewFrameScheduler({
      send: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("pipe reset");
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => scheduler.stats.delivered === 1);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(scheduler.lastError).toBeNull();
    scheduler.stop();
  });

  it("stops retrying permanent failures and recovers on a new dirty mark", async () => {
    let attempts = 0;
    const failure = new Error("invalid frame");
    const reported: unknown[] = [];
    const scheduler = createViewFrameScheduler({
      send: () => {
        attempts += 1;
        if (attempts === 1) throw failure;
      },
      shouldRetry: () => false,
      onError: (error) => reported.push(error),
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => reported.length === 1);
    await delay(40);
    expect(attempts).toBe(1);
    expect(scheduler.lastError).toBe(failure);

    scheduler.markDirty();
    await until(() => scheduler.stats.delivered === 1);
    expect(attempts).toBe(2);
    expect(scheduler.lastError).toBeNull();
    scheduler.stop();
  });

  it("isolates exceptions from error and retry callbacks", async () => {
    let attempts = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary");
      },
      onError: () => {
        throw new Error("observer failed");
      },
      shouldRetry: () => {
        if (attempts === 1) throw new Error("policy failed");
        return true;
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => attempts === 1);
    expect(scheduler.lastError).toBeInstanceOf(Error);
    await delay(30);
    expect(attempts).toBe(1);

    scheduler.markDirty();
    await until(() => scheduler.stats.delivered === 1);
    expect(attempts).toBe(2);
    expect(scheduler.lastError).toBeNull();
    scheduler.stop();
  });

  it("keeps a dirty mark made during a non-retryable failed send", async () => {
    let attempts = 0;
    let release!: () => void;
    const gate = new Promise<void>((_resolve, reject) => {
      release = () => reject(new Error("permanent"));
    });
    const scheduler = createViewFrameScheduler({
      send: async () => {
        attempts += 1;
        if (attempts === 1) await gate;
      },
      shouldRetry: () => false,
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => attempts === 1);
    scheduler.markDirty();
    release();
    await until(() => scheduler.stats.delivered === 1);
    expect(attempts).toBe(2);
    scheduler.stop();
  });
});

describe("teardown", () => {
  it("clears timers and ignores later marks", async () => {
    let sends = 0;
    const scheduler = createViewFrameScheduler({
      send: () => {
        sends += 1;
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    scheduler.stop();
    await delay(50);
    expect(sends).toBe(0);
    await scheduler.flush();
    scheduler.markDirty();
    await delay(50);
    expect(sends).toBe(0);
  });

  it("releases a flush() blocked on an in-flight send", async () => {
    let sends = 0;
    const gate = new Promise<void>(() => undefined);
    const scheduler = createViewFrameScheduler({
      send: async () => {
        sends += 1;
        await gate;
      },
      intervalMs: 10,
    });

    scheduler.markDirty();
    await until(() => sends === 1);
    const flushing = scheduler.flush();
    scheduler.stop();
    await Promise.race([
      flushing,
      delay(500).then(() => {
        throw new Error("flush hung after stop");
      }),
    ]);
  });

  it("leaves no timer behind after stop()", async () => {
    let cleared = 0;
    const scheduler = createViewFrameScheduler({
      send: () => undefined,
      intervalMs: 10,
      setTimer: () => "t" as unknown,
      clearTimer: () => {
        cleared += 1;
      },
    });
    scheduler.markDirty();
    scheduler.stop();
    expect(cleared).toBeGreaterThanOrEqual(1);
  });
});
