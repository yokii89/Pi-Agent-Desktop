import { describe, expect, it } from "vitest";
import type { ViewAgentNode } from "../../../shared/view";
import {
  AGENT_NODE_HEIGHT,
  AGENT_NODE_WIDTH,
  agentAncestry,
  layoutAgentGraph,
} from "./agentGraphLayout";

function agent(id: string, parentId?: string): ViewAgentNode {
  return { id, parentId, label: id, description: `Task ${id}`, state: "running" };
}

describe("agent workspace graph geometry", () => {
  it("places descendants below parents and keeps cards at each depth apart", () => {
    const graph = layoutAgentGraph([
      agent("main"),
      agent("a", "main"),
      agent("b", "main"),
      agent("c", "main"),
      agent("d", "b"),
      agent("e", "b"),
    ]);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.edges).toHaveLength(5);
    for (const edge of graph.edges) {
      expect(edge.child.y).toBeGreaterThan(edge.parent.y + AGENT_NODE_HEIGHT);
    }
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + AGENT_NODE_WIDTH).toBeLessThanOrEqual(graph.width);
      expect(node.y + AGENT_NODE_HEIGHT).toBeLessThanOrEqual(graph.height);
      for (const other of graph.nodes) {
        if (node.agent.id !== other.agent.id && node.y === other.y)
          expect(Math.abs(node.x - other.x)).toBeGreaterThan(AGENT_NODE_WIDTH);
      }
    }
  });

  it("wraps large sibling groups to the available width while keeping full-size cards", () => {
    const agents = [
      agent("main"),
      ...Array.from({ length: 20 }, (_, index) => agent(`child-${index}`, "main")),
    ];
    for (const [width, columns] of [
      [360, 1],
      [640, 2],
      [960, 3],
    ] as const) {
      const graph = layoutAgentGraph(agents, width);
      expect(graph.nodes).toHaveLength(agents.length);
      expect(graph.edges).toHaveLength(20);
      expect(graph.width).toBeLessThanOrEqual(width);
      const rows = new Map<number, number>();
      for (const { agent: item, y } of graph.nodes) {
        if (item.id !== "main") rows.set(y, (rows.get(y) ?? 0) + 1);
      }
      expect(rows.size).toBe(Math.ceil(20 / columns));
      expect(Math.max(...rows.values())).toBe(columns);
    }
  });

  it("keeps nested subtrees and forest roots apart and routes edges around every card", () => {
    const agents = [
      agent("main"),
      ...Array.from({ length: 8 }, (_, index) => agent(`child-${index}`, "main")),
      ...Array.from({ length: 7 }, (_, index) => agent(`nested-${index}`, "child-1")),
      agent("deep", "nested-3"),
      ...Array.from({ length: 6 }, (_, index) => agent(`deep-${index}`, "deep")),
      agent("other-root"),
      agent("other-child", "other-root"),
    ];
    for (const width of [360, 640, 960]) {
      const graph = layoutAgentGraph(agents, width);
      expect(graph.nodes).toHaveLength(agents.length);
      for (const node of graph.nodes) {
        expect(node.x + AGENT_NODE_WIDTH).toBeLessThanOrEqual(graph.width);
        expect(node.y + AGENT_NODE_HEIGHT).toBeLessThanOrEqual(graph.height);
        for (const other of graph.nodes) {
          if (node === other) continue;
          const overlapX =
            node.x < other.x + AGENT_NODE_WIDTH && other.x < node.x + AGENT_NODE_WIDTH;
          const overlapY =
            node.y < other.y + AGENT_NODE_HEIGHT && other.y < node.y + AGENT_NODE_HEIGHT;
          expect(overlapX && overlapY).toBe(false);
        }
      }
      for (const edge of graph.edges) {
        expect(edge.child.y).toBeGreaterThan(edge.parent.y + AGENT_NODE_HEIGHT);
        for (let index = 1; index < edge.points.length; index++) {
          const start = edge.points[index - 1];
          const end = edge.points[index];
          expect(start.x === end.x || start.y === end.y).toBe(true);
          for (const node of graph.nodes) {
            const overlapsX =
              Math.max(start.x, end.x) > node.x &&
              Math.min(start.x, end.x) < node.x + AGENT_NODE_WIDTH;
            const overlapsY =
              Math.max(start.y, end.y) > node.y &&
              Math.min(start.y, end.y) < node.y + AGENT_NODE_HEIGHT;
            expect(overlapsX && overlapsY).toBe(false);
          }
        }
      }
    }
  });

  it("lays out very narrow or initially unmeasured viewports without losing nodes", () => {
    const agents = [agent("main"), agent("a", "main"), agent("b", "main")];
    for (const width of [0, 120, Number.NaN, Number.POSITIVE_INFINITY]) {
      const graph = layoutAgentGraph(agents, width);
      expect(graph.nodes).toHaveLength(3);
      expect(Number.isFinite(graph.width)).toBe(true);
      expect(Number.isFinite(graph.height)).toBe(true);
      for (const node of graph.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.x + AGENT_NODE_WIDTH).toBeLessThanOrEqual(graph.width);
      }
    }
  });

  it("preserves every node in a forest, including a missing parent and cycles", () => {
    const graph = layoutAgentGraph([
      agent("a", "b"),
      agent("b", "a"),
      agent("orphan", "missing"),
      agent("self", "self"),
    ]);
    expect(new Set(graph.nodes.map((node) => node.agent.id))).toEqual(
      new Set(["a", "b", "orphan", "self"]),
    );
    expect(graph.edges).toHaveLength(1);
  });

  it("does not move a graph when only execution state changes", () => {
    const nodes = [agent("main"), agent("child", "main")];
    const before = layoutAgentGraph(nodes);
    const after = layoutAgentGraph(nodes.map((node) => ({ ...node, state: "completed" })));
    expect(after.nodes.map(({ x, y }) => [x, y])).toEqual(before.nodes.map(({ x, y }) => [x, y]));
  });

  it("returns only actual ancestors and terminates on malformed cycles", () => {
    expect(
      agentAncestry([agent("main"), agent("a", "main"), agent("b", "a")], "b").map(
        (node) => node.id,
      ),
    ).toEqual(["main", "a", "b"]);
    expect(agentAncestry([agent("a", "b"), agent("b", "a")], "a")).toHaveLength(2);
    expect(agentAncestry([agent("a")], "missing")).toEqual([]);
  });
});
