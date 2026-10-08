import { describe, expect, it } from "vitest";
import { isVersionNewer, parseVersionParts } from "./update";

describe("parseVersionParts", () => {
  it("解析三段与 v 前缀", () => {
    expect(parseVersionParts("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersionParts("v0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersionParts("1.2")).toEqual([1, 2, 0]);
  });

  it("忽略 pre-release 标识", () => {
    expect(parseVersionParts("1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersionParts("v2.0.0-rc.2")).toEqual([2, 0, 0]);
  });

  it("非法版本返回 null", () => {
    expect(parseVersionParts("")).toBeNull();
    expect(parseVersionParts("abc")).toBeNull();
    expect(parseVersionParts("1.2.3.4")).toBeNull();
    expect(parseVersionParts("1.x.0")).toBeNull();
  });
});

describe("isVersionNewer", () => {
  it("严格比较三段", () => {
    expect(isVersionNewer("0.2.1", "0.2.0")).toBe(true);
    expect(isVersionNewer("0.3.0", "0.2.9")).toBe(true);
    expect(isVersionNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isVersionNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isVersionNewer("0.1.9", "0.2.0")).toBe(false);
  });

  it("解析失败不触发更新", () => {
    expect(isVersionNewer("bad", "0.2.0")).toBe(false);
    expect(isVersionNewer("0.2.1", "bad")).toBe(false);
    expect(isVersionNewer("0.2.1-beta", "0.2.0")).toBe(true);
  });

  it("两位版本补 0 比较；同号 pre-release 不算更新", () => {
    expect(isVersionNewer("1.2", "1.1.9")).toBe(true);
    expect(isVersionNewer("1.2.0-beta.1", "1.2.0")).toBe(false);
    expect(isVersionNewer("1.2.0", "1.2.0-beta.1")).toBe(false);
    expect(isVersionNewer("v1.2.1", "1.2.0")).toBe(true);
  });
});
