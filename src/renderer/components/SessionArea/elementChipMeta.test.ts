import { describe, expect, it } from "vitest";
import {
  EMPTY_CLASS_PLACEHOLDER,
  elementBadgeText,
  elementChipTitle,
  elementClassText,
  elementTone,
  shortClass,
  tagTone,
} from "./elementChipMeta";

describe("elementChipMeta", () => {
  it("tagTone 按语义类归档，未知 tag 落 other", () => {
    expect(tagTone("a")).toBe("interactive");
    expect(tagTone("BUTTON")).toBe("interactive");
    expect(tagTone("p")).toBe("text");
    expect(tagTone("div")).toBe("structure");
    expect(tagTone("img")).toBe("media");
    expect(tagTone("my-widget")).toBe("other");
  });

  it("elementTone 截图固定 media", () => {
    expect(elementTone({ kind: "screenshot", tag: "div" })).toBe("media");
    expect(elementTone({ kind: "element", tag: "a" })).toBe("interactive");
  });

  it("shortClass 优先人类可读类，跳过 CSS Modules 哈希", () => {
    expect(shortClass("div.Box-body")).toBe("Box-body");
    expect(shortClass("p.index_x7k2n.desc")).toBe("desc");
    expect(shortClass("span.index_x7k2n")).toBe("index_x7k2n");
    expect(shortClass("div")).toBeNull();
  });

  it("elementClassText：class / 截图标签 / 空 class 返回空串", () => {
    expect(elementClassText({ kind: "element", label: "a.btn", selector: "a.btn" }, "截图")).toBe(
      ".btn",
    );
    expect(elementClassText({ kind: "screenshot", label: "视口截图", selector: "" }, "截图")).toBe(
      "视口截图",
    );
    expect(elementClassText({ kind: "element", label: "div", selector: "div" }, "截图")).toBe("");
    expect(EMPTY_CLASS_PLACEHOLDER).toBe("el");
  });

  it("elementBadgeText / elementChipTitle", () => {
    expect(elementBadgeText({ kind: "screenshot", tag: "div" })).toBe("img");
    expect(elementBadgeText({ kind: "element", tag: "a" })).toBe("a");
    expect(elementBadgeText({ kind: "element", tag: "" })).toBe("el");
    expect(elementChipTitle({ label: "a.btn", selector: "a.btn", textSummary: "查看详情" })).toBe(
      "a.btn · 查看详情",
    );
  });
});
