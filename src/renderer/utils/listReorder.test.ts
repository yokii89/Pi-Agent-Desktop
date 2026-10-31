import { describe, expect, it } from "vitest";
import { dropTargetIndex, insertionIndexAt, moveById, moveToIndex } from "./listReorder";

const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("moveById", () => {
  it("moves an item onto another slot", () => {
    expect(moveById(list, "a", "c").map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(moveById(list, "c", "a").map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op for same slot or unknown ids", () => {
    expect(moveById(list, "a", "a").map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(moveById(list, "x", "a").map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(moveById(list, "a", "z").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input list", () => {
    moveById(list, "a", "c");
    expect(list.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});

describe("insertionIndexAt", () => {
  // 三行各 40px 高、间隔 2px：行顶 0 / 42 / 84，中线 20 / 62 / 104
  const bands = [
    { top: 0, height: 40 },
    { top: 42, height: 40 },
    { top: 84, height: 40 },
  ];

  it("ranks by row midpoint", () => {
    expect(insertionIndexAt(bands, -10)).toBe(0);
    expect(insertionIndexAt(bands, 20)).toBe(0);
    expect(insertionIndexAt(bands, 20.5)).toBe(1);
    expect(insertionIndexAt(bands, 80)).toBe(2);
    expect(insertionIndexAt(bands, 200)).toBe(3);
  });

  it("measures each row by its own height", () => {
    // 第一行明显更高：中线跟着行高走，而不是按固定行高猜
    const uneven = [
      { top: 0, height: 120 },
      { top: 122, height: 24 },
    ];
    expect(insertionIndexAt(uneven, 59)).toBe(0);
    expect(insertionIndexAt(uneven, 61)).toBe(1);
    expect(insertionIndexAt(uneven, 133)).toBe(1);
    expect(insertionIndexAt(uneven, 135)).toBe(2);
  });
});

describe("dropTargetIndex", () => {
  it("collapses the two no-op slots around the dragged row", () => {
    expect(dropTargetIndex(0, 1)).toBe(0);
    expect(dropTargetIndex(1, 1)).toBe(1);
    expect(dropTargetIndex(2, 1)).toBe(1);
    expect(dropTargetIndex(3, 1)).toBe(2);
    expect(dropTargetIndex(0, 0)).toBe(0);
    expect(dropTargetIndex(1, 0)).toBe(0);
  });
});

describe("moveToIndex", () => {
  const items = ["a", "b", "c", "d"];

  it("moves by target index (post-removal semantics)", () => {
    expect(moveToIndex(items, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveToIndex(items, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveToIndex(items, 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("clamps the target and ignores invalid sources", () => {
    expect(moveToIndex(items, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveToIndex(items, 1, -3)).toEqual(["b", "a", "c", "d"]);
    expect(moveToIndex(items, 9, 0)).toEqual(items);
    expect(moveToIndex(items, -1, 0)).toEqual(items);
  });

  it("does not mutate the input list", () => {
    moveToIndex(items, 0, 3);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });
});
