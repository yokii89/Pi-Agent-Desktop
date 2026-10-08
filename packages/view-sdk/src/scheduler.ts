/**
 * Frame scheduling as an SDK primitive (docs/design/20 O4).
 *
 * 准则 §9 says a live view must not be driven by per-extension `setInterval`
 * loops, and §1.4 puts connection, throttling and lifecycle on the SDK side.
 * Until now the only working implementation lived in `pi-telegram-main`, which
 * is exactly the copy the rules forbid — so the semantics move here, pinned by
 * the tests in `frame-scheduler.test.ts` that were ported from that extension.
 *
 * Contract, in one breath: mark state dirty, get at most one frame per window,
 * never lose the last change, never deadlock a caller that is about to act.
 *
 * Failure handling is deliberately *not* a retry policy: a failed `send` marks
 * state dirty again and the next window retries. Reconnecting is
 * `superviseSlot`'s job, and the two must not race to re-send the same frame —
 * the scheduler owns "when", the session owns "whether the wire is there".
 */

import type { ViewNode, ViewPatchOp, ViewUpdatePayload } from "./types.js";

/** Steady-state ceiling: 1000 / 250 = 4 updates per second (docs/design/19 §4.3). */
export const DEFAULT_VIEW_FRAME_INTERVAL_MS = 250;

/**
 * Non-tree parts of an `update` / `patch` frame that ride with `set()`.
 *
 * Same fields as `ViewUpdatePayload` minus `root` — the wire already carries
 * them on both frame types, so coalesced writes are not a second-class path
 * (docs/design/20 §9: panel action-bar `disabled` must be able to change
 * without a side-channel `setInterval`).
 */
export type CoalescedFrameMeta = Pick<ViewUpdatePayload, "actions" | "title" | "placementHint">;

/**
 * State-latest-wins writer bound to one live session.
 *
 * `set()` takes the full tree *and* the patch that would have expressed the
 * same change; the scheduler picks `patch` when the Host advertises
 * `view-patch` and falls back to the whole tree when it does not, so the
 * extension never forks that decision itself (docs/design/20 O4).
 */
export interface CoalescedViewWriter {
  /**
   * Record the newest state; the frame goes out at the end of the window.
   *
   * `meta` fields are copied onto the same frame (`actions` / `title` /
   * `placementHint`). Omitted fields are left off the frame and the Host keeps
   * its current value — same as `session.update({ root })`. Pass `actions: []`
   * to clear the action bar.
   */
  set(root: ViewNode, ops?: ViewPatchOp[], meta?: CoalescedFrameMeta): void;
  /** Deliver now (action boundary). No-op when nothing changed. */
  flush(): Promise<void>;
  /** Deliver now even when nothing changed — the first frame after `open()`. */
  flushNow(): Promise<void>;
  /** Stop the timer. Called automatically when the view settles. */
  stop(): void;
}

export interface ViewFrameSchedulerOptions {
  /**
   * Deliver one coalesced frame. Re-read live state — the scheduler never
   * buffers a tree, which is what lets twenty marks collapse into one send
   * without losing the latest value. May be async; overlap is serialized.
   */
  send: () => Promise<void> | void;
  /** Minimum gap between two deliveries. Default 250ms (≤4/s). */
  intervalMs?: number;
  /** Timer injection for tests. */
  setTimer?: (handler: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ViewFrameScheduler {
  /** Mark live state dirty; absorbed into the pending frame if one is already owed. */
  markDirty(): void;
  /**
   * Deliver any pending frame now and await it. Call before an action so the
   * Host never acts on stale state (§4.3 「动作边界不得丢」). No-op when clean.
   */
  flush(): Promise<void>;
  /**
   * Deliver a frame now **even when nothing is dirty**: right after `open()`
   * the Host already holds the initial tree, so a plain `flush()` would idle and
   * the panel would wait up to `intervalMs` for its first live frame (§4.4).
   */
  flushNow(): Promise<void>;
  /** Cancel timers, settle waiters, discard an in-flight delivery. Idempotent. */
  stop(): void;
  /** Diagnostics: marks requested vs. frames delivered vs. absorbed. */
  readonly stats: { requested: number; delivered: number; coalesced: number };
}

export function createViewFrameScheduler(options: ViewFrameSchedulerOptions): ViewFrameScheduler {
  const intervalMs = options.intervalMs ?? DEFAULT_VIEW_FRAME_INTERVAL_MS;
  const setTimer = options.setTimer ?? ((handler, ms) => setTimeout(handler, ms) as unknown);
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  let stopped = false;
  /** A frame is pending but its timer has not fired yet. */
  let scheduled = false;
  /** The sender is mid-flight; it owes another pass once it resolves. */
  let inFlight = false;
  /** State changed while a frame was in flight (or while scheduled). */
  let dirty = false;
  let timer: unknown = null;
  let waiters: Array<() => void> = [];

  /** Resolves on stop so a slow `send` can never pin a caller's promise. */
  let signalStop!: () => void;
  const stopSignal = new Promise<void>((resolve) => {
    signalStop = resolve;
  });

  const stats = { requested: 0, delivered: 0, coalesced: 0 };

  const settleWaiters = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  async function deliver(): Promise<void> {
    if (stopped) return;
    inFlight = true;
    dirty = false;
    // `send` may throw synchronously (a render-phase blowup). Wrapping it before
    // attaching handlers keeps that from escaping as an unhandled rejection.
    const raced = new Promise<"sent" | "failed">((resolve) => {
      try {
        resolve(
          Promise.resolve(options.send()).then(
            () => "sent" as const,
            () => "failed" as const,
          ),
        );
      } catch {
        resolve("failed");
      }
    });
    const outcome = await Promise.race([raced, stopSignal.then(() => "stopped" as const)]);
    inFlight = false;

    if (outcome === "sent") {
      stats.delivered += 1;
    } else if (outcome === "failed") {
      // A failed frame must not break the loop: the next window retries with
      // current state. Reconnection itself belongs to superviseSlot.
      dirty = true;
    }

    if (stopped) {
      settleWaiters();
      return;
    }
    if (dirty) {
      // Backpressure: state moved while this frame was on the wire, so owe one
      // more frame to converge. Waiters still settle — the follow-up frame
      // already carries the latest state, and parking them would deadlock
      // `flush()`.
      schedule();
    }
    settleWaiters();
  }

  function fire(): void {
    timer = null;
    scheduled = false;
    void deliver();
  }

  function schedule(): void {
    if (stopped || inFlight || scheduled) return;
    scheduled = true;
    timer = setTimer(fire, intervalMs);
    // Must not pin the event loop: a pi process exiting should not wait on a panel.
    (timer as { unref?: () => void } | null)?.unref?.();
  }

  const clearPending = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    scheduled = false;
  };

  return {
    markDirty() {
      if (stopped) return;
      stats.requested += 1;
      dirty = true;
      if (scheduled || inFlight) {
        // Absorbed — `send` re-reads state, so the newest value still ships.
        stats.coalesced += 1;
        return;
      }
      schedule();
    },

    async flush() {
      if (stopped) return;
      clearPending();
      if (inFlight) {
        await new Promise<void>((resolve) => waiters.push(resolve));
        if (!dirty || stopped) return;
      }
      if (!dirty) return;
      await deliver();
    },

    async flushNow() {
      if (stopped) return;
      clearPending();
      if (inFlight) {
        await new Promise<void>((resolve) => waiters.push(resolve));
        if (stopped) return;
      }
      dirty = true;
      await deliver();
    },

    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      scheduled = false;
      // Release an awaiting `send` first, then the waiters queued behind it.
      signalStop();
      settleWaiters();
    },

    stats,
  };
}
