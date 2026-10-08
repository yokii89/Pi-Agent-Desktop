import { describe, expect, it } from "vitest";
import {
  addPiUsage,
  isZeroPiUsage,
  pickUsageGranularity,
  sanitizePiUsage,
  type UsageGranularity,
  usageBucketKey,
} from "./usage";

describe("addPiUsage", () => {
  it("两侧为空返回 null", () => {
    expect(addPiUsage(null, undefined)).toBeNull();
  });

  it("字段逐项求和，cost 按字段累加", () => {
    const a = {
      input: 100,
      output: 10,
      cacheRead: 5,
      cacheWrite: 1,
      totalTokens: 116,
      cost: { input: 0.5, output: 0.5, cacheRead: 0, cacheWrite: 0, total: 1 },
    };
    const b = {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    };
    expect(addPiUsage(a, b)).toEqual({
      input: 101,
      output: 12,
      cacheRead: 8,
      cacheWrite: 5,
      totalTokens: 126,
      cost: { input: 0.6, output: 0.7, cacheRead: 0, cacheWrite: 0, total: 1.3 },
    });
  });

  it("单侧带 cost 时另一侧按 0 计", () => {
    const merged = addPiUsage(
      { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 2 },
      },
    );
    expect(merged?.cost?.total).toBe(2);
  });

  it("totalTokens 缺失时退回分项和", () => {
    const merged = addPiUsage(
      { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: Number.NaN },
      { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    );
    expect(merged?.totalTokens).toBe(10);
  });
});

describe("isZeroPiUsage", () => {
  it("全零为 true，任一分量非零为 false", () => {
    expect(
      isZeroPiUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }),
    ).toBe(true);
    expect(
      isZeroPiUsage({ input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1 }),
    ).toBe(false);
  });
});

describe("sanitizePiUsage", () => {
  it("接受完整磁盘 usage 并透传 cost", () => {
    const usage = sanitizePiUsage({
      input: 300,
      output: 109,
      cacheRead: 10368,
      cacheWrite: 0,
      reasoning: 57,
      totalTokens: 10777,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
    expect(usage).not.toBeNull();
    expect(usage).toMatchObject({ input: 300, output: 109, cacheRead: 10368, totalTokens: 10777 });
    expect(usage?.cost?.total).toBe(0);
  });

  it("totalTokens 缺失时退回分项和；cost 结构不符时丢弃", () => {
    const usage = sanitizePiUsage({
      input: 10,
      output: 5,
      cacheRead: 1,
      cacheWrite: 2,
      cost: "free",
    });
    expect(usage).toMatchObject({ input: 10, output: 5, totalTokens: 18 });
    expect(usage?.cost).toBeUndefined();
  });

  it("无任何数值字段返回 null", () => {
    expect(sanitizePiUsage(null)).toBeNull();
    expect(sanitizePiUsage({})).toBeNull();
    expect(sanitizePiUsage({ input: "many" })).toBeNull();
  });
});

describe("usageBucketKey / pickUsageGranularity", () => {
  it("day 粒度键为本地时区 YYYY-MM-DD", () => {
    const ts = new Date(2026, 8, 26, 9, 30).getTime();
    expect(usageBucketKey(ts, "day")).toBe("2026-09-26");
  });

  it("month 粒度键为 YYYY-MM", () => {
    const ts = new Date(2026, 8, 26, 9, 30).getTime();
    expect(usageBucketKey(ts, "month")).toBe("2026-09");
  });

  it("跨度 ≤90 天按天，超过按月", () => {
    const start = new Date(2026, 0, 1).getTime();
    expect(pickUsageGranularity(start, start + 90 * 86_400_000)).toBe<UsageGranularity>("day");
    expect(pickUsageGranularity(start, start + 90 * 86_400_000 + 1)).toBe<UsageGranularity>(
      "month",
    );
  });
});
