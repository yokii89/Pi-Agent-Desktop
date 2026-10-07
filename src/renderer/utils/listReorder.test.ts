import { describe, expect, it } from "vitest";
import { moveById } from "./listReorder";

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
