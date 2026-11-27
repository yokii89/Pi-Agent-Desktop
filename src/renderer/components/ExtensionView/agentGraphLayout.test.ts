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
