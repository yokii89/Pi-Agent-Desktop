import { describe, expect, it } from "vitest";
import type { ViewAgentNode } from "../../../shared/view";
import { reconcileAgentGraphBranches } from "./agentGraphState";

const agents: ViewAgentNode[] = [
  { id: "main", kind: "main", label: "main", description: "main", state: "running" },
  { id: "lead", parentId: "main", label: "lead", description: "lead", state: "running" },
  { id: "child", parentId: "lead", label: "child", description: "child", state: "error" },
];

describe("agent graph branch reveal state", () => {
  it("reveals matching ancestors once and preserves manual folds across metadata refreshes", () => {
    const initial = reconcileAgentGraphBranches(
      agents,
      new Set(["lead"]),
      "attention",
      "child",
      new Map(),
    );
    expect(initial.collapsed.has("lead")).toBe(false);
    const folded = new Set(["lead"]);
    const refreshed = reconcileAgentGraphBranches(
      agents.map((agent) => ({ ...agent, meta: ["refresh"] })),
      folded,
      "attention",
      "lead",
      initial.reveals,
    );
    expect(refreshed.collapsed).toBe(folded);
  });
  it("reveals newly matching tasks and reparented paths", () => {
    const initial = reconcileAgentGraphBranches(agents, new Set(), "running", "lead", new Map());
    const updated = agents.map(
      (agent): ViewAgentNode => (agent.id === "child" ? { ...agent, state: "running" } : agent),
    );
    const reveal = reconcileAgentGraphBranches(
      updated,
      new Set(["lead"]),
      "running",
      "lead",
      initial.reveals,
    );
    expect(reveal.collapsed.has("lead")).toBe(false);
    const moved = [...updated, { ...agents[1], id: "other", parentId: "main" }].map((agent) =>
      agent.id === "child" ? { ...agent, parentId: "other" } : agent,
    );
    expect(
      reconcileAgentGraphBranches(
        moved,
        new Set(["other"]),
        "running",
        "child",
        reveal.reveals,
      ).collapsed.has("other"),
    ).toBe(false);
  });
  it("reveals an external selection and prunes removed branch identities", () => {
    const initial = reconcileAgentGraphBranches(agents, new Set(), "all", "lead", new Map());
    const folded = new Set(["lead", "removed"]);
    const next = reconcileAgentGraphBranches(agents, folded, "all", "child", initial.reveals);
    expect(next.collapsed.size).toBe(0);
    expect(folded).toEqual(new Set(["lead", "removed"]));
  });
  it("re-enters a filter with matching paths even if that task was already selected", () => {
    const initial = reconcileAgentGraphBranches(agents, new Set(), "all", "child", new Map());
    expect(
      reconcileAgentGraphBranches(
        agents,
        new Set(["lead"]),
        "attention",
        "child",
        initial.reveals,
      ).collapsed.has("lead"),
    ).toBe(false);
  });
});
