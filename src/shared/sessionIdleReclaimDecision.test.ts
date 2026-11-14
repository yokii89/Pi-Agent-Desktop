import { describe, expect, it } from "vitest";
import {
  decideIdleReclaim,
  type IdleReclaimInput,
  pickIdleReclaimIds,
} from "./sessionIdleReclaimDecision";

const THRESHOLD = 30 * 60_000;
const NOW = 10_000_000;

function input(overrides: Partial<IdleReclaimInput> = {}): IdleReclaimInput {
  return {
    sessionId: "s1",
    lastActivityAt: NOW - THRESHOLD - 1,
    state: "idle",
    childAlive: true,
    hasActivationTxn: false,
    hasPendingRequests: false,
    pendingUiCount: 0,
    isActive: false,
    isScheduled: false,
    hasBackgroundJobs: false,
    ...overrides,
  };
}

describe("decideIdleReclaim", () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "非法时刻 %s 不能视为空闲",
    (invalid) => {
      expect(decideIdleReclaim(input({ lastActivityAt: invalid }), NOW, THRESHOLD).reclaim).toBe(
        false,
      );
      expect(decideIdleReclaim(input(), invalid, THRESHOLD).reclaim).toBe(false);
      expect(decideIdleReclaim(input(), NOW, invalid).reclaim).toBe(false);
    },
  );

  it("在途 RPC 即使 runtime 为 idle 也不能回收", () => {
    expect(decideIdleReclaim(input({ hasPendingRequests: true }), NOW, THRESHOLD).reason).toBe(
      "pending-rpc",
    );
  });
  it("超阈值且空闲的后台会话可回收", () => {
    expect(decideIdleReclaim(input(), NOW, THRESHOLD)).toEqual({
      reclaim: true,
      reason: "reclaim",
    });
  });

  it("阈值 0 = 关闭，永不回收", () => {
    expect(decideIdleReclaim(input(), NOW, 0).reclaim).toBe(false);
    expect(decideIdleReclaim(input(), NOW, 0).reason).toBe("disabled");
  });

  it("未到阈值不回收；恰好等于阈值算到点", () => {
    const fresh = input({ lastActivityAt: NOW - 60_000 });
    expect(decideIdleReclaim(fresh, NOW, THRESHOLD).reason).toBe("not-idle-enough");
    const exact = input({ lastActivityAt: NOW - THRESHOLD });
    expect(decideIdleReclaim(exact, NOW, THRESHOLD).reclaim).toBe(true);
  });

  it("后台还有存活进程的会话不回收（长任务让 turn 交还后状态就是 idle）", () => {
    // 15h 下载 / dev server：agent 早已交还 turn，runtime 停在 idle，
    // 看上去"停了 8 小时"实际上仍在等命令回执
    expect(decideIdleReclaim(input({ hasBackgroundJobs: true }), NOW, THRESHOLD)).toEqual({
      reclaim: false,
      reason: "background-jobs",
    });
  });

  it("active 会话、定时任务占用、在途事务、未答对话框都拦住", () => {
    expect(decideIdleReclaim(input({ isActive: true }), NOW, THRESHOLD).reason).toBe("active-view");
    expect(decideIdleReclaim(input({ isScheduled: true }), NOW, THRESHOLD).reason).toBe(
      "scheduled",
    );
    expect(decideIdleReclaim(input({ hasActivationTxn: true }), NOW, THRESHOLD).reason).toBe(
      "activation-txn",
    );
    expect(decideIdleReclaim(input({ pendingUiCount: 1 }), NOW, THRESHOLD).reason).toBe(
      "pending-ui",
    );
  });

  it("busy / starting / cold / failed 都不回收", () => {
    for (const state of ["busy", "starting", "cold", "failed", "stopping"] as const) {
      expect(decideIdleReclaim(input({ state }), NOW, THRESHOLD).reason).toBe("not-idle");
    }
    // ready 是探针还没推进到 idle 的短暂态，与 idle 同属"没人用"
    expect(decideIdleReclaim(input({ state: "ready" }), NOW, THRESHOLD).reclaim).toBe(true);
  });

  it("进程已死或没有活动时刻时不回收（交给对账）", () => {
    expect(decideIdleReclaim(input({ childAlive: false }), NOW, THRESHOLD).reason).toBe(
      "child-dead",
    );
    expect(decideIdleReclaim(input({ lastActivityAt: null }), NOW, THRESHOLD).reason).toBe(
      "no-activity",
    );
  });

  it("批量挑选保序且只返回命中项", () => {
    const ids = pickIdleReclaimIds(
      [
        input({ sessionId: "keep-active", isActive: true }),
        input({ sessionId: "idle-a" }),
        input({ sessionId: "small", lastActivityAt: NOW - 1_000 }),
        input({ sessionId: "idle-b" }),
      ],
      NOW,
      THRESHOLD,
    );
    expect(ids).toEqual(["idle-a", "idle-b"]);
  });
});
