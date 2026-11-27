import { describe, expect, it } from "vitest";
import { measureViewTree } from "../../../packages/view-sdk/src/limits";
import type { ViewAgentWorkspaceNode, ViewNode } from "../../shared/view";
import { VIEW_LIMITS } from "../../shared/view";
import { sanitizeTree } from "./viewHostProtocol";

function workspace(agentCount: number, eventCount: number): ViewAgentWorkspaceNode {
  return {
    type: "agent-workspace",
    id: "workspace",
    agents: Array.from({ length: agentCount }, (_, i) => ({
      id: `a${i}`,
      label: `Agent ${i}`,
      description: "Task",
      state: "running",
    })),
    streamAgentId: agentCount > 0 ? "a0" : undefined,
    events: Array.from({ length: eventCount }, (_, i) => ({
      id: `e${i}`,
      kind: "assistant",
      content: "Update",
    })),
  };
}

function unsafe(raw: unknown): ViewNode {
  return raw as ViewNode;
}

const CASES: Array<[string, ViewNode]> = [
  ["empty", workspace(0, 0)],
  ["agents and events both count", workspace(7, 9)],
  ["agents fill the whole budget", workspace(VIEW_LIMITS.maxNodes - 1, 0)],
  ["events fill the whole budget", workspace(1, VIEW_LIMITS.maxNodes - 2)],
  ["one Agent over the budget", workspace(VIEW_LIMITS.maxNodes, 0)],
  ["one event over the budget", workspace(1, VIEW_LIMITS.maxNodes - 1)],
  [
    "two capped arrays still exceed the global budget",
    workspace(VIEW_LIMITS.maxOptionItems + 2, VIEW_LIMITS.maxOptionItems + 3),
  ],
  ["entries without a stream owner still count", workspace(0, VIEW_LIMITS.maxNodes)],
  [
    "malformed entries still count",
    unsafe({ ...workspace(0, 0), agents: [null, 4, {}], events: [null, [], "bad"] }),
  ],
  [
    "malformed workspace still charges present arrays",
    unsafe({ ...workspace(2, 4), id: undefined }),
  ],
  [
    "malformed agents array does not hide event accounting",
    unsafe({ ...workspace(0, 4), agents: "bad" }),
  ],
  [
    "duplicates still count",
    unsafe({
      ...workspace(0, 0),
      agents: Array.from({ length: 20 }, () => ({
        id: "same",
        label: "A",
        description: "",
        state: "idle",
      })),
      events: [],
    }),
  ],
  [
    "workspace controls sharing an ID still count before being degraded",
    { type: "column", children: [workspace(1, 10), workspace(2, 8)] },
  ],
  [
    "budget shared with sibling nodes",
    {
      type: "column",
      children: [
        {
          type: "table",
          id: "table",
          columns: [{ key: "a", label: "A" }],
          rows: Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, cells: { a: i } })),
        },
        workspace(100, 210),
      ],
    },
  ],
  [
    "inactive tab children count",
    {
      type: "tabs",
      id: "tabs",
      tabs: [
        { id: "one", label: "One", children: [{ type: "text", content: "Shown" }] },
        { id: "two", label: "Two", children: [workspace(200, 309)] },
      ],
    },
  ],
];

describe("workspace Host/SDK budget lockstep", () => {
  it.each(CASES)("%s", (_label, root) => {
    const measured = measureViewTree(root, VIEW_LIMITS);
    expect("error" in sanitizeTree(root)).toBe(measured.nodes > VIEW_LIMITS.maxNodes);
  });

  it("accepts exactly the measured budget and rejects one additional sibling even after dropped data", () => {
    for (const [, root] of CASES) {
      const measured = measureViewTree(root, VIEW_LIMITS);
      if (measured.nodes >= VIEW_LIMITS.maxNodes) continue;
      const children: ViewNode[] = [
        root,
        ...Array.from(
          { length: VIEW_LIMITS.maxNodes - measured.nodes - 1 },
          (): ViewNode => ({ type: "divider" }),
        ),
      ];
      const atBoundary: ViewNode = { type: "column", children };
      expect(measureViewTree(atBoundary, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes);
      expect(sanitizeTree(atBoundary)).toHaveProperty("root");
      expect(
        sanitizeTree({ type: "column", children: [...children, { type: "divider" }] }),
      ).toHaveProperty("error");
    }
  });

  it("does not count parent chains as View depth, but still enforces actual container depth", () => {
    const graph = workspace(100, 0);
    graph.agents.forEach((agent, i) => {
      agent.parentId = `a${(i + 1) % graph.agents.length}`;
    });
    expect(measureViewTree(graph, VIEW_LIMITS).depth).toBe(1);
    expect(sanitizeTree(graph)).toHaveProperty("root");
    let root: ViewNode = graph;
    for (let i = 1; i < VIEW_LIMITS.maxDepth; i += 1) root = { type: "column", children: [root] };
    expect(measureViewTree(root, VIEW_LIMITS).depth).toBe(VIEW_LIMITS.maxDepth);
    expect(sanitizeTree(root)).toHaveProperty("root");
    const tooDeep: ViewNode = { type: "column", children: [root] };
    expect(measureViewTree(tooDeep, VIEW_LIMITS).depth).toBe(VIEW_LIMITS.maxDepth + 1);
    expect(sanitizeTree(tooDeep)).toHaveProperty("error");
  });
});
