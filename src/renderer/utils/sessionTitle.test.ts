import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../shared/ipc";
import { sessionTitle } from "./sessionTitle";

function summary(patch: Partial<SessionSummary>): SessionSummary {
  return {
    file: "C:/s/a.jsonl",
    id: "a",
    startedAt: 0,
    updatedAt: 0,
    firstUserMessage: null,
    sessionName: null,
    cwd: null,
    ...patch,
  };
}

describe("sessionTitle", () => {
  it("显式会话名优先于首条用户消息", () => {
    expect(
      sessionTitle(summary({ sessionName: "显式名字", firstUserMessage: "第一条消息" }), "占位"),
    ).toBe("显式名字");
  });

  it("显式名字为空白时回退首条用户消息（空白归一）", () => {
    expect(
      sessionTitle(summary({ sessionName: "  ", firstUserMessage: "第一条\n  消息" }), "占位"),
    ).toBe("第一条 消息");
  });

  it("两者都缺时用调用方给的占位文案", () => {
    expect(sessionTitle(summary({}), "未命名会话")).toBe("未命名会话");
  });
});
