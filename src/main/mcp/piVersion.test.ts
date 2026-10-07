import { describe, expect, it } from "vitest";
import { isVersionAtLeast, parsePiVersion, supportsBuiltinMcp } from "./piVersion";

/** pi 版本解析与 MCP 支持判定的纯函数直测（降级阈值 docs/design/39）。 */
describe("parsePiVersion", () => {
  it("解析纯 semver 输出", () => {
    expect(parsePiVersion("0.87.0")).toEqual({ major: 0, minor: 87, patch: 0 });
  });

  it("容忍前缀与构建信息，取首个 semver", () => {
    expect(parsePiVersion("pi 1.2.3 (abc123)")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parsePiVersion("v0.99.0-beta.1")).toEqual({ major: 0, minor: 99, patch: 0 });
  });

  it("无版本号返回 null", () => {
    expect(parsePiVersion("")).toBeNull();
    expect(parsePiVersion("unknown")).toBeNull();
    expect(parsePiVersion("1.2")).toBeNull();
  });
});

describe("isVersionAtLeast", () => {
  const min = { major: 0, minor: 99, patch: 0 };

  it("major / minor / patch 逐位比较", () => {
    expect(isVersionAtLeast({ major: 0, minor: 99, patch: 0 }, min)).toBe(true);
    expect(isVersionAtLeast({ major: 1, minor: 0, patch: 4 }, min)).toBe(true);
    expect(isVersionAtLeast({ major: 0, minor: 99, patch: 1 }, min)).toBe(true);
    expect(isVersionAtLeast({ major: 0, minor: 87, patch: 0 }, min)).toBe(false);
    expect(isVersionAtLeast({ major: 0, minor: 98, patch: 9 }, min)).toBe(false);
  });
});

describe("supportsBuiltinMcp", () => {
  it("0.99.0 及以上支持，以下不支持", () => {
    expect(supportsBuiltinMcp("0.87.0")).toBe(false);
    expect(supportsBuiltinMcp("0.98.5")).toBe(false);
    expect(supportsBuiltinMcp("0.99.0")).toBe(true);
    expect(supportsBuiltinMcp("1.0.4")).toBe(true);
  });

  it("版本未知返回 null（不误判为不支持）", () => {
    expect(supportsBuiltinMcp(null)).toBeNull();
    expect(supportsBuiltinMcp("")).toBeNull();
    expect(supportsBuiltinMcp("not a version")).toBeNull();
  });
});
