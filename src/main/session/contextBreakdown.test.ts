import { describe, expect, it } from "vitest";
import {
  buildContextBreakdown,
  estimateMessageBuckets,
  estimateSkillsTokens,
  estimateTextTokens,
} from "./contextBreakdown";

describe("estimateTextTokens", () => {
  it("CJK counts ~1 token per char", () => {
    expect(estimateTextTokens("上下文用量")).toBe(5);
  });

  it("Latin uses chars/4", () => {
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcde")).toBe(2);
  });
});

describe("estimateMessageBuckets", () => {
  it("respects bashExecution.excludeFromContext", () => {
    const acc = estimateMessageBuckets([
      {
        role: "bashExecution",
        command: "ls",
        output: "file.txt",
        excludeFromContext: true,
      },
      {
        role: "bashExecution",
        command: "ls",
        output: "file.txt",
        excludeFromContext: false,
      },
    ]);
    expect(acc.toolResult).toBeGreaterThan(0);
  });

  it("splits assistant thinking vs text", () => {
    const acc = estimateMessageBuckets([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "好好好好" },
          { type: "text", text: "abcd" },
        ],
      },
    ]);
    expect(acc.thinking).toBe(4);
    expect(acc.assistant).toBe(1);
  });
});

describe("estimateSkillsTokens", () => {
  it("only counts source=skill metadata", () => {
    const n = estimateSkillsTokens([
      { name: "skill:foo", description: "说明说明", source: "skill" },
      { name: "bar", description: "ignored", source: "prompt" },
    ]);
    expect(n).toBe(estimateTextTokens("skill:foo\n说明说明"));
  });
});

describe("buildContextBreakdown", () => {
  it("assigns residual to other when real > estimates", () => {
    const result = buildContextBreakdown({
      messages: [{ role: "user", content: "abcd" }],
      commands: [],
      realTokens: 20,
    });
    const other = result.slices.find((s) => s.bucket === "other");
    expect(other).toBeDefined();
    expect(result.otherPercent).toBeGreaterThan(0);
    const sum = result.slices.reduce((a, s) => a + s.ratioPercent, 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it("omits other when real <= estimates", () => {
    const result = buildContextBreakdown({
      messages: [{ role: "user", content: "abcdefgh" }],
      commands: [],
      realTokens: 1,
    });
    expect(result.slices.find((s) => s.bucket === "other")).toBeUndefined();
    expect(result.otherPercent).toBe(0);
    const sum = result.slices.reduce((a, s) => a + s.ratioPercent, 0);
    expect(sum).toBeCloseTo(100, 1);
  });
});
