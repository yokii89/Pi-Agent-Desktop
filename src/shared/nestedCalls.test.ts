import { describe, expect, it } from "vitest";
import { sanitizeNestedToolCalls } from "./nestedCalls";

describe("sanitizeNestedToolCalls", () => {
  it("只保留 name/status，丢掉 arguments / durationMs / id", () => {
    expect(
      sanitizeNestedToolCalls({
        calls: [
          {
            id: "n1",
            name: "mcp__filesystem__list_directory",
            status: "ok",
            arguments: { path: "." },
            durationMs: 4,
          },
          { name: "read", status: "unfinished", arguments: { path: "a.md" } },
        ],
        complete: true,
      }),
    ).toEqual({
      calls: [
        { name: "mcp__filesystem__list_directory", status: "ok" },
        { name: "read", status: "unfinished" },
      ],
    });
  });

  it("未知 status 省略、无名条目丢弃；全部无效返回 null", () => {
    expect(
      sanitizeNestedToolCalls({ calls: [{ name: "bash", status: "weird" }, { status: "ok" }] }),
    ).toEqual({ calls: [{ name: "bash" }] });
    expect(sanitizeNestedToolCalls({ calls: [{ status: "ok" }] })).toBeNull();
    expect(sanitizeNestedToolCalls({ calls: [] })).toBeNull();
    expect(sanitizeNestedToolCalls(null)).toBeNull();
    expect(sanitizeNestedToolCalls("x")).toBeNull();
  });

  it("记录被截断时保留 complete=false", () => {
    expect(
      sanitizeNestedToolCalls({ calls: [{ name: "read", status: "ok" }], complete: false }),
    ).toEqual({ calls: [{ name: "read", status: "ok" }], complete: false });
  });

  it("按 pi 的上限截到 256 条", () => {
    const calls = Array.from({ length: 300 }, (_, index) => ({ name: `t${index}`, status: "ok" }));
    expect(sanitizeNestedToolCalls({ calls })?.calls).toHaveLength(256);
  });
});
