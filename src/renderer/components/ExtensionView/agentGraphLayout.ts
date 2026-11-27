import type { ViewAgentNode } from "../../../shared/view";

export const AGENT_NODE_WIDTH = 192;
export const AGENT_NODE_HEIGHT = 130;
export const AGENT_COLUMN = 248;
export const AGENT_PADDING = 24;
const COMPACT_HEIGHT = 92;
const ROW_GAP = 40;

export type AgentGraphFilter = "all" | "running" | "attention";

export interface AgentGraphPosition {
  agent: ViewAgentNode;
  depth: number;
  x: number;
  y: number;
  height: number;
  summaryHeight: number;
}

export interface AgentGraphLayout {
  nodes: AgentGraphPosition[];
  parents: Map<string, string>;
  children: Map<string, ViewAgentNode[]>;
  visibleIds: Set<string>;
  width: number;
  height: number;
  maxDepth: number;
  matches: number;
}

/** State filters apply to tasks; orchestration and ancestors remain context. */
export function matchesAgentFilter(agent: ViewAgentNode, filter: AgentGraphFilter): boolean {
  return (
    agent.kind !== "main" &&
    (filter === "all" ||
      (filter === "running"
        ? agent.state === "running"
        : agent.state === "error" || agent.state === "stopped"))
  );
}

/** Includes folded descendants once, even for malformed parent relationships. */
export function agentDescendants(
  id: string,
  children: ReadonlyMap<string, readonly ViewAgentNode[]>,
): ViewAgentNode[] {
  const seen = new Set([id]);
  const pending = [...(children.get(id) ?? [])];
  const result: ViewAgentNode[] = [];
  for (let index = 0; index < pending.length; index++) {
    const agent = pending[index];
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    result.push(agent);
    pending.push(...(children.get(agent.id) ?? []));
  }
  return result;
}

/** Two state columns keep every status readable without overflowing a folded card. */
export function agentBranchSummaryHeight(tasks: readonly ViewAgentNode[]): number {
  return 32 + Math.ceil(new Set(tasks.map((task) => task.state)).size / 2) * 16;
}

/** Each delegation depth owns a column; disconnected tasks retain their own roots. */
export function layoutAgentGraph(
  agents: readonly ViewAgentNode[],
  {
    collapsed = new Set<string>(),
    compact = false,
    filter = "all",
  }: {
    collapsed?: ReadonlySet<string>;
    compact?: boolean;
    filter?: AgentGraphFilter;
  } = {},
): AgentGraphLayout {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const parents = new Map<string, string>();
  for (const agent of agents) {
    if (
      agent.kind === "main" ||
      !agent.parentId ||
      !byId.has(agent.parentId) ||
      agent.parentId === agent.id
    )
      continue;
    const seen = new Set([agent.id]);
    let cursor: string | undefined = agent.parentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
    if (!cursor) parents.set(agent.id, agent.parentId);
  }
  const children = new Map<string, ViewAgentNode[]>();
  for (const agent of agents) {
    const parent = parents.get(agent.id);
    if (!parent) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(agent);
    children.set(parent, siblings);
  }
  const visible = new Set(agents.filter((agent) => agent.kind === "main").map(({ id }) => id));
  for (const agent of agents) {
    if (!matchesAgentFilter(agent, filter)) continue;
    let id: string | undefined = agent.id;
    while (id && !visible.has(id)) {
      visible.add(id);
      id = parents.get(id);
    }
  }
  const nodes: AgentGraphPosition[] = [];
  const baseHeight = compact ? COMPACT_HEIGHT : AGENT_NODE_HEIGHT;
  let nextY = AGENT_PADDING;
  function place(agent: ViewAgentNode, depth: number): AgentGraphPosition {
    const folded = collapsed.has(agent.id) && !!children.get(agent.id)?.length;
    const summaryHeight = folded
      ? agentBranchSummaryHeight(agentDescendants(agent.id, children))
      : 0;
    const height = baseHeight + summaryHeight;
    const startY = nextY;
    const placed = folded
      ? []
      : (children.get(agent.id) ?? [])
          .filter((child) => visible.has(child.id))
          .map((child) => place(child, depth + 1));
    const center = placed.length
      ? (placed[0].y +
          placed[0].height / 2 +
          placed[placed.length - 1].y +
          placed[placed.length - 1].height / 2) /
        2
      : nextY + height / 2;
    const y = Math.max(startY, center - height / 2);
    nextY = Math.max(nextY, y + height + ROW_GAP);
    const node = {
      agent,
      depth,
      x: AGENT_PADDING + depth * AGENT_COLUMN,
      y,
      height,
      summaryHeight,
    };
    nodes.push(node);
    return node;
  }
  const roots = agents.filter((agent) => !parents.has(agent.id) && visible.has(agent.id));
  const hasMain = roots.some((agent) => agent.kind === "main");
  for (const root of roots) place(root, hasMain && root.kind !== "main" ? 1 : 0);
  const maxDepth = Math.max(0, ...nodes.map((node) => node.depth));
  return {
    nodes,
    parents,
    children,
    visibleIds: visible,
    maxDepth,
    width: AGENT_PADDING * 2 + maxDepth * AGENT_COLUMN + AGENT_NODE_WIDTH,
    height: Math.max(300, ...nodes.map((node) => node.y + node.height + AGENT_PADDING + 20)),
    matches: agents.filter((agent) => matchesAgentFilter(agent, filter)).length,
  };
}

/** Follow only present nodes and stop at the first repeated id. */
export function agentAncestry(agents: readonly ViewAgentNode[], id: string): ViewAgentNode[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const trail: ViewAgentNode[] = [];
  const seen = new Set<string>();
  let agent = byId.get(id);
  while (agent && !seen.has(agent.id)) {
    seen.add(agent.id);
    trail.unshift(agent);
    agent = agent.parentId ? byId.get(agent.parentId) : undefined;
  }
  return trail;
}
