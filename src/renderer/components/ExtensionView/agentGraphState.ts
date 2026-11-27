import type { ViewAgentNode } from "../../../shared/view";
import { type AgentGraphFilter, agentAncestry, matchesAgentFilter } from "./agentGraphLayout";

export type AgentGraphReveals = ReadonlyMap<string, readonly string[]>;

/** Reveal new selection/filter paths once; live metadata must preserve manual folds. */
export function reconcileAgentGraphBranches(
  agents: readonly ViewAgentNode[],
  collapsed: Set<string>,
  filter: AgentGraphFilter,
  selectedId: string | undefined,
  previous: AgentGraphReveals,
): { collapsed: Set<string>; reveals: AgentGraphReveals } {
  const targets =
    filter === "all"
      ? agents.filter((agent) => agent.id === selectedId && agent.kind !== "main")
      : agents.filter((agent) => matchesAgentFilter(agent, filter));
  const liveIds = new Set(agents.map((agent) => agent.id));
  const next = new Set([...collapsed].filter((id) => liveIds.has(id)));
  const reveals = new Map<string, readonly string[]>();
  for (const target of targets) {
    const key = JSON.stringify([filter, target.id]);
    const path = agentAncestry(agents, target.id)
      .slice(0, -1)
      .map((agent) => agent.id);
    reveals.set(key, path);
    const before = previous.get(key);
    if (before?.length === path.length && path.every((id, index) => before[index] === id)) continue;
    for (const id of path) next.delete(id);
  }
  return {
    collapsed:
      next.size === collapsed.size && [...next].every((id) => collapsed.has(id)) ? collapsed : next,
    reveals,
  };
}
