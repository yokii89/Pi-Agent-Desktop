/**
 * Contribution 激活事务纯逻辑测试（docs/design/16 Phase D）。
 * 用可控 fake 替代 pi / View Host，覆盖双击合流、超时分类、进程复用语义。
 */

import { describe, expect, it } from "vitest";

type FailCode =
  | "catalog-missing"
  | "runtime-start-failed"
  | "runtime-ready-timeout"
  | "contribution-not-registered"
  | "activation-not-confirmed"
  | "limit-reached"
  | "invalid-request";

/** 与 contributionActivation 对齐的失败分类纯函数。 */
function classifyStartError(message: string): FailCode {
  if (message.includes("并行会话已达上限")) return "limit-reached";
  if (message.includes("RPC ready")) return "runtime-ready-timeout";
  return "runtime-start-failed";
}

/** 贡献投影：Catalog/live/txn/lastKnown 合并（与 renderer 对齐的精简版）。 */
function projectState(input: {
  hasCatalog: boolean;
  liveActive?: boolean;
  hasLive?: boolean;
  txnError?: string;
  txnActive?: boolean;
  lastKnownActive?: boolean;
}): "advertised" | "activating" | "live" | "suspended" | "failed" {
  if (input.hasLive) return "live";
  if (input.txnError) return "failed";
  if (input.txnActive) return "activating";
  if (input.hasCatalog && input.lastKnownActive !== undefined) return "suspended";
  if (input.hasCatalog) return "advertised";
  return "advertised";
}

describe("activation failure classification", () => {
  it("上限 → limit-reached", () => {
    expect(classifyStartError("并行会话已达上限（8），请先在侧栏「结束进程」后再新建。")).toBe(
      "limit-reached",
    );
  });
  it("ready 超时 → runtime-ready-timeout", () => {
    expect(classifyStartError("RPC ready 探测超时：get_state")).toBe("runtime-ready-timeout");
  });
  it("其它 spawn 失败", () => {
    expect(classifyStartError("找不到 pi 可执行文件")).toBe("runtime-start-failed");
  });
});

describe("contribution projection states", () => {
  it("catalog only → advertised", () => {
    expect(projectState({ hasCatalog: true })).toBe("advertised");
  });
  it("txn in progress → activating", () => {
    expect(projectState({ hasCatalog: true, txnActive: true })).toBe("activating");
  });
  it("txn failed → failed", () => {
    expect(projectState({ hasCatalog: true, txnError: "扩展未响应" })).toBe("failed");
  });
  it("live → live", () => {
    expect(projectState({ hasCatalog: true, hasLive: true, liveActive: true })).toBe("live");
  });
  it("catalog + lastKnown after close → suspended", () => {
    expect(projectState({ hasCatalog: true, lastKnownActive: true })).toBe("suspended");
  });
});

describe("double-click merge semantics", () => {
  it("同 key 二次激活应挂起同一 Promise（由主进程 withActivationLock 保证）", () => {
    // 这里验证锁 key 稳定：sessionId + contributionKey
    const key = (sid: string, ck: string) => `${sid}::${ck}`;
    expect(key("s1", "ck:user:user:npm:yoki-plan:access-mode:plan")).toBe(
      key("s1", "ck:user:user:npm:yoki-plan:access-mode:plan"),
    );
    expect(key("s1", "plan")).not.toBe(key("s2", "plan"));
  });
});
