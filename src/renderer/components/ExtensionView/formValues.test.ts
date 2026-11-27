import { describe, expect, it } from "vitest";
import type { ViewAgentWorkspaceNode, ViewNode } from "../../../shared/view";
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

function workspace(overrides: Partial<ViewAgentWorkspaceNode> = {}): ViewAgentWorkspaceNode {
  return {
    type: "agent-workspace",
    id: "agents",
    agents: [
      { id: "main", label: "Main", description: "Coordinate", state: "running", kind: "main" },
      { id: "child", parentId: "main", label: "Child", description: "Task", state: "queued" },
    ],
    streamAgentId: "main",
    events: [{ id: "event", kind: "assistant", content: "Update" }],
    ...overrides,
  };
}

describe("collectFormValues — workspace selection", () => {
  it("collects only the workspace selection, not Agents or event data", () => {
    expect(collectFormValues(workspace({ value: "child" }))).toEqual({ agents: "child" });
  });

  it("defaults to empty without implicitly selecting the first Agent or stream owner", () => {
    expect(collectFormValues(workspace())).toEqual({ agents: "" });
    expect(collectFormValues(workspace({ agents: [] }))).toEqual({ agents: "" });
  });

  it("preserves a still-valid local selection across full-tree updates", () => {
    expect(collectFormValues(workspace(), { agents: "child" })).toEqual({ agents: "child" });
    expect(collectFormValues(workspace({ value: "main" }), { agents: "child" })).toEqual({
      agents: "main",
    });
  });

  it("drops removed, non-string and explicitly invalid selections", () => {
    for (const selected of ["gone", 3, ["main"], null]) {
      expect(collectFormValues(workspace(), { agents: selected })).toEqual({ agents: "" });
    }
    expect(collectFormValues(workspace({ value: "gone" }), { agents: "main" })).toEqual({
      agents: "",
    });
    expect(collectFormValues(workspace({ agents: [] }), { agents: "child" })).toEqual({
      agents: "",
    });
    expect(collectFormValues({ type: "column", children: [] }, { agents: "main" })).toEqual({});
  });

  it("keeps the selected Agent when the stream still belongs to the previous Agent", () => {
    expect(collectFormValues(workspace({ value: "child", streamAgentId: "main" }))).toEqual({
      agents: "child",
    });
  });

  it("collects workspaces in inactive tabs and preserves unrelated fields", () => {
    const root: ViewNode = {
      type: "tabs",
      id: "tabs",
      activeTab: "one",
      tabs: [
        { id: "one", label: "One", children: [{ type: "input", id: "query", value: "live" }] },
        { id: "two", label: "Two", children: [workspace()] },
      ],
    };
    expect(collectFormValues(root, { agents: "child", query: "old" })).toEqual({
      query: "live",
      agents: "child",
    });
  });

  it("uses the first form control for a duplicate ID, including an empty selection", () => {
    expect(
      collectFormValues({ type: "column", children: [workspace(), workspace({ value: "child" })] }),
    ).toEqual({ agents: "" });
    expect(
      collectFormValues({
        type: "column",
        children: [{ type: "input", id: "agents", value: "first" }, workspace({ value: "child" })],
      }),
    ).toEqual({ agents: "first" });
    expect(
      collectFormValues({
        type: "column",
        children: [
          workspace({ value: "child" }),
          { type: "list", id: "agents", items: [], value: "second" },
        ],
      }),
    ).toEqual({ agents: "child" });
  });

  it("treats opaque IDs as own values even when they name Object prototype properties", () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      const values = collectFormValues(workspace({ id, value: "child" }));
      expect(Object.hasOwn(values, id)).toBe(true);
      expect(values[id]).toBe("child");
      expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
      expect(collectFormValues(workspace({ id }), values)[id]).toBe("child");
    }
  });
});

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

  it("keeps readonly lists out of the form snapshot (docs/06 R1)", () => {
    const root: ViewNode = {
      type: "column",
      children: [
        {
          type: "list",
          id: "threads",
          readonly: true,
          value: "a",
          items: [{ value: "a", label: "A" }],
        },
        { type: "list", id: "choice", value: "a", items: [{ value: "a", label: "A" }] },
      ],
    };
    expect(collectFormValues(root)).toEqual({ choice: "a" });
  });
});
