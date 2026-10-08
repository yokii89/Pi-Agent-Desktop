import { describe, expect, it } from "vitest";
import type { ViewNode } from "../../../shared/view";
import { collectFormValues } from "./formValues";

function tabsTree(overrides?: { q0Value?: string; text1Value?: string }): ViewNode {
  return {
    type: "tabs",
    id: "t",
    tabs: [
      {
        id: "q0",
        label: "第一题",
        children: [
          {
            type: "list",
            id: "list-0",
            items: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
            ...(overrides?.q0Value !== undefined ? { value: overrides.q0Value } : {}),
          },
        ],
      },
      {
        id: "q1",
        label: "第二题",
        children: [
          {
            type: "input",
            id: "text-1",
            ...(overrides?.text1Value !== undefined ? { value: overrides.text1Value } : {}),
          },
          { type: "list", id: "multi-1", multiple: true, items: [{ value: "a", label: "A" }] },
        ],
      },
    ],
  };
}

describe("collectFormValues", () => {
  it("collects values from every tab, including inactive ones", () => {
    const values = collectFormValues(tabsTree({ q0Value: "a", text1Value: "x" }));
    expect(values["list-0"]).toBe("a");
    expect(values["text-1"]).toBe("x");
    expect(values["multi-1"]).toEqual([]);
  });

  it("preserves previous values for ids that still exist across full-tree updates", () => {
    const previous = collectFormValues(tabsTree(), {});
    previous["text-1"] = "用户输入中";
    previous["multi-1"] = ["a"];
    previous["list-0"] = "b";

    // 整树替换（扩展回显）：非激活页签的输入不得被清空
    const next = collectFormValues(tabsTree(), previous);
    expect(next["text-1"]).toBe("用户输入中");
    expect(next["multi-1"]).toEqual(["a"]);
    expect(next["list-0"]).toBe("b");
  });

  it("lets tree-supplied values win over previous", () => {
    const previous = { "list-0": "b", "text-1": "旧" };
    const next = collectFormValues(tabsTree({ q0Value: "a" }), previous);
    expect(next["list-0"]).toBe("a");
    expect(next["text-1"]).toBe("旧");
  });

  it("drops values for ids removed from the tree", () => {
    const previous = { "list-0": "a", "text-1": "x", gone: "y" };
    const next = collectFormValues(tabsTree(), previous);
    expect(next).not.toHaveProperty("gone");
  });

  it("collects nested containers (column/row/card) as before", () => {
    const root: ViewNode = {
      type: "column",
      children: [{ type: "input", id: "in", value: "v" }],
    };
    expect(collectFormValues(root)).toEqual({ in: "v" });
  });
});
