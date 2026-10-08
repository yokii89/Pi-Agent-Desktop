import { describe, expect, it } from "vitest";
import { normalizeReport } from "./mcpProbe";

/** `pi mcp list --json` 单条报告的宽松归一化直测（docs/design/40 优化 13）。 */
describe("normalizeReport", () => {
  it("非对象或缺 name 返回 null", () => {
    expect(normalizeReport(null)).toBeNull();
    expect(normalizeReport("nope")).toBeNull();
    expect(normalizeReport({})).toBeNull();
    expect(normalizeReport({ name: 42 })).toBeNull();
  });

  it("已知状态原样保留", () => {
    for (const state of [
      "connected",
      "connecting",
      "disconnected",
      "needs-auth",
      "failed",
      "closed",
    ]) {
      expect(normalizeReport({ name: "fs", state })?.state).toBe(state);
    }
  });

  it("未知状态兜底为 unknown（UI 不暴露原样键名）", () => {
    expect(normalizeReport({ name: "fs", state: "quantum-entangled" })?.state).toBe("unknown");
    expect(normalizeReport({ name: "fs" })?.state).toBe("unknown");
    expect(normalizeReport({ name: "fs", state: 42 })?.state).toBe("unknown");
  });

  it("缺省字段落到安全默认值", () => {
    const report = normalizeReport({ name: "fs" });
    expect(report).toMatchObject({
      name: "fs",
      scope: "global",
      enabled: true,
      exposure: "codemode",
      transport: "",
      tools: [],
    });
    expect(report?.toolExposure).toBeUndefined();
    expect(report?.error).toBeUndefined();
  });
});
