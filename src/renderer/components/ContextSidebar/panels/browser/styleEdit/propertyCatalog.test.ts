import { describe, expect, it } from "vitest";
import {
  adjustedNameSet,
  isComputedAdjusted,
  resolvePropertyMeta,
  searchCatalog,
} from "./propertyCatalog";

describe("propertyCatalog", () => {
  it("resolvePropertyMeta 命中目录类型，未命中回退文本", () => {
    expect(resolvePropertyMeta("border-radius").kind).toBe("length");
    expect(resolvePropertyMeta("border-radius").defaultUnit).toBe("px");
    expect(resolvePropertyMeta("flex-grow").defaultUnit).toBe("");
    expect(resolvePropertyMeta("color").kind).toBe("color");
    expect(resolvePropertyMeta("display").kind).toBe("enum");
    expect(resolvePropertyMeta("content").kind).toBe("text");
  });

  it("searchCatalog 按名称过滤并限量", () => {
    const hits = searchCatalog("margin");
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every((meta) => meta.name.includes("margin") || meta.group.includes("margin")),
    ).toBe(true);
    expect(searchCatalog("zzz-not-a-prop")).toEqual([]);
  });

  it("isComputedAdjusted 支持简写与长手互认", () => {
    const adjusted = adjustedNameSet(["padding"]);
    expect(isComputedAdjusted("padding", adjusted)).toBe(true);
    expect(isComputedAdjusted("padding-top", adjusted)).toBe(true);
    expect(isComputedAdjusted("margin-top", adjusted)).toBe(false);

    const longhands = adjustedNameSet(["margin-top", "margin-left"]);
    expect(isComputedAdjusted("margin", longhands)).toBe(true);
    expect(isComputedAdjusted("color", longhands)).toBe(false);
  });
});
