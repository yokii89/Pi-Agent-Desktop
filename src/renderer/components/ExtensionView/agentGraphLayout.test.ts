import { describe, expect, it } from "vitest";
import type { ViewAgentNode } from "../../../shared/view";
import {
  AGENT_COLUMN,
  AGENT_NODE_HEIGHT,
  AGENT_NODE_WIDTH,
  agentAncestry,
  agentDescendants,
  layoutAgentGraph,
  matchesAgentFilter,
} from "./agentGraphLayout";

function agent(
  id: string,
  parentId?: string,
  state: ViewAgentNode["state"] = "running",
): ViewAgentNode {
  return { id, parentId, label: id, description: `Task ${id}`, state };
}
const main: ViewAgentNode = { ...agent("main"), kind: "main" };

function expectNoOverlap(graph: ReturnType<typeof layoutAgentGraph>): void {
  for (const node of graph.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.x + AGENT_NODE_WIDTH).toBeLessThanOrEqual(graph.width);
    expect(node.y + node.height).toBeLessThanOrEqual(graph.height);
    for (const other of graph.nodes) {
      if (node === other) continue;
      const overlapX = node.x < other.x + AGENT_NODE_WIDTH && other.x < node.x + AGENT_NODE_WIDTH;
      const overlapY = node.y < other.y + other.height && other.y < node.y + node.height;
      expect(overlapX && overlapY).toBe(false);
    }
  }
}

describe("agent workspace hierarchy geometry", () => {
  it("assigns a fixed column to each depth with siblings stacked vertically", () => {
    const graph = layoutAgentGraph([
      main,
      agent("a", "main"),
      agent("b", "main"),
      agent("c", "main"),
      agent("d", "b"),
      agent("e", "b"),
    ]);
    expect(graph.nodes).toHaveLength(6);
    expect(graph.parents.size).toBe(5);
    const byId = new Map(graph.nodes.map((node) => [node.agent.id, node]));
    for (const node of graph.nodes) {
      const parent = byId.get(graph.parents.get(node.agent.id) ?? "");
      if (parent) {
        expect(node.x - parent.x).toBe(AGENT_COLUMN);
        expect(node.depth).toBe(parent.depth + 1);
      }
    }
    expect(byId.get("a")?.x).toBe(byId.get("c")?.x);
    expect(byId.get("d")?.x).toBe(byId.get("e")?.x);
    expectNoOverlap(graph);
  });

  it("keeps twenty siblings in one column and preserves full-size cards", () => {
    const graph = layoutAgentGraph([
      main,
      ...Array.from({ length: 20 }, (_, index) => agent(`child-${index}`, "main")),
    ]);
    const children = graph.nodes.filter((node) => node.agent.kind !== "main");
    expect(children).toHaveLength(20);
    expect(new Set(children.map((node) => node.x)).size).toBe(1);
    expect(new Set(children.map((node) => node.y)).size).toBe(20);
    expect(children.every((node) => node.height === AGENT_NODE_HEIGHT)).toBe(true);
    expect(graph.maxDepth).toBe(1);
    expectNoOverlap(graph);
  });

  it("keeps nested forests apart, including missing parents and cycles", () => {
    const agents = [
      main,
      ...Array.from({ length: 8 }, (_, index) => agent(`child-${index}`, "main")),
      ...Array.from({ length: 7 }, (_, index) => agent(`nested-${index}`, "child-1")),
      agent("deep", "nested-3"),
      agent("other-root"),
      agent("other-child", "other-root"),
      agent("orphan", "missing"),
      agent("a", "b"),
      agent("b", "a"),
      agent("self", "self"),
    ];
    for (const compact of [true, false]) {
      const graph = layoutAgentGraph(agents, { compact });
      expect(new Set(graph.nodes.map((node) => node.agent.id))).toEqual(
        new Set(agents.map((node) => node.id)),
      );
      expect(graph.parents.has("orphan")).toBe(false);
      expect(graph.parents.has("self")).toBe(false);
      expectNoOverlap(graph);
    }
  });

  it("folds an entire subtree and counts descendants from already folded branches", () => {
    const agents = [main, agent("a", "main"), agent("b", "a"), agent("c", "b"), agent("d", "main")];
    const full = layoutAgentGraph(agents);
    const folded = layoutAgentGraph(agents, { collapsed: new Set(["a", "b"]) });
    expect(folded.nodes.map((node) => node.agent.id)).toEqual(["a", "d", "main"]);
    expect(agentDescendants("a", folded.children).map((node) => node.id)).toEqual(["b", "c"]);
    expect(folded.nodes.find((node) => node.agent.id === "a")?.height).toBeGreaterThan(
      AGENT_NODE_HEIGHT,
    );
    expect(layoutAgentGraph(agents).nodes).toEqual(full.nodes);
    expectNoOverlap(folded);
  });

  it("filters tasks but retains actual ancestors, depths, and disconnected matches", () => {
    const agents = [
      main,
      agent("a", "main", "completed"),
      agent("b", "a", "running"),
      agent("c", "main", "error"),
      agent("stopped", "missing", "stopped"),
      agent("queued", "a", "queued"),
    ];
    const running = layoutAgentGraph(agents, { filter: "running" });
    expect(running.nodes.map((node) => node.agent.id)).toEqual(["b", "a", "main"]);
    expect(running.matches).toBe(1);
    expect(running.nodes.find((node) => node.agent.id === "b")?.depth).toBe(2);
    const attention = layoutAgentGraph(agents, { filter: "attention" });
    expect(new Set(attention.nodes.map((node) => node.agent.id))).toEqual(
      new Set(["main", "c", "stopped"]),
    );
    expect(attention.matches).toBe(2);
    expect(matchesAgentFilter(main, "running")).toBe(false);
    expect(matchesAgentFilter(agents[5], "attention")).toBe(false);
    expectNoOverlap(attention);
  });

  it("supports no selection, no main, empty snapshots, and filters with no matches", () => {
    expect(layoutAgentGraph([]).nodes).toEqual([]);
    const orphan = layoutAgentGraph([agent("orphan", "missing")]);
    expect(orphan.nodes[0].depth).toBe(0);
    const empty = layoutAgentGraph([main, agent("done", "main", "completed")], {
      filter: "attention",
    });
    expect(empty.matches).toBe(0);
    expect(empty.nodes.map((node) => node.agent.id)).toEqual(["main"]);
    expect(Number.isFinite(empty.width)).toBe(true);
    expect(Number.isFinite(empty.height)).toBe(true);
  });

  it("preserves coordinates across status/metadata refreshes and reduces height in compact mode", () => {
    const agents = [main, agent("child", "main")];
    const before = layoutAgentGraph(agents);
    const after = layoutAgentGraph(
      agents.map((node) => ({ ...node, state: "completed", meta: ["2s"] })),
    );
    expect(after.nodes.map(({ x, y }) => [x, y])).toEqual(before.nodes.map(({ x, y }) => [x, y]));
    expect(
      layoutAgentGraph(agents, { compact: true }).nodes.every(
        (node) => node.height < AGENT_NODE_HEIGHT,
      ),
    ).toBe(true);
  });

  it("returns only actual ancestors and terminates on malformed cycles", () => {
    expect(
      agentAncestry([main, agent("a", "main"), agent("b", "a")], "b").map((node) => node.id),
    ).toEqual(["main", "a", "b"]);
    expect(agentAncestry([agent("a", "b"), agent("b", "a")], "a")).toHaveLength(2);
    expect(agentAncestry([agent("a")], "missing")).toEqual([]);
  });
});
