import type { ViewAgentNode } from "../../../shared/view";

export const AGENT_NODE_WIDTH = 224;
export const AGENT_NODE_HEIGHT = 130;
const COLUMN_GAP = 48;
const ROW_GAP = 76;
const PADDING = 40;

export interface AgentGraphPosition {
  agent: ViewAgentNode;
  x: number;
  y: number;
}

export interface AgentGraphLayout {
  nodes: AgentGraphPosition[];
  edges: { parent: AgentGraphPosition; child: AgentGraphPosition }[];
  width: number;
  height: number;
}

/** A bounded forest layout; malformed cycles become separate roots rather than recursing forever. */
export function layoutAgentGraph(agents: readonly ViewAgentNode[]): AgentGraphLayout {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const parents = new Map<string, string>();
  for (const agent of agents) {
    if (!agent.parentId || !byId.has(agent.parentId) || agent.parentId === agent.id) continue;
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
    const list = children.get(parent) ?? [];
    list.push(agent);
    children.set(parent, list);
  }
  const spans = new Map<string, number>();
  function span(agent: ViewAgentNode): number {
    const value = Math.max(
      1,
      (children.get(agent.id) ?? []).reduce((sum, child) => sum + span(child), 0),
    );
    spans.set(agent.id, value);
    return value;
  }
  const roots = agents.filter((agent) => !parents.has(agent.id));
  for (const root of roots) span(root);
  const positions = new Map<string, AgentGraphPosition>();
  let maxDepth = 0;
  function place(agent: ViewAgentNode, start: number, depth: number): void {
    maxDepth = Math.max(maxDepth, depth);
    positions.set(agent.id, {
      agent,
      x:
        PADDING +
        (start + (spans.get(agent.id) ?? 1) / 2) * (AGENT_NODE_WIDTH + COLUMN_GAP) -
        AGENT_NODE_WIDTH / 2,
      y: PADDING + depth * (AGENT_NODE_HEIGHT + ROW_GAP),
    });
    let offset = start;
    for (const child of children.get(agent.id) ?? []) {
      place(child, offset, depth + 1);
      offset += spans.get(child.id) ?? 1;
    }
  }
  let offset = 0;
  for (const root of roots) {
    place(root, offset, 0);
    offset += spans.get(root.id) ?? 1;
  }
  return {
    nodes: agents.flatMap((agent) => {
      const position = positions.get(agent.id);
      return position ? [position] : [];
    }),
    edges: [...parents].flatMap(([childId, parentId]) => {
      const child = positions.get(childId);
      const parent = positions.get(parentId);
      return parent && child ? [{ parent, child }] : [];
    }),
    width: Math.max(
      AGENT_NODE_WIDTH + PADDING * 2,
      offset * (AGENT_NODE_WIDTH + COLUMN_GAP) + PADDING * 2,
    ),
    height: PADDING * 2 + maxDepth * (AGENT_NODE_HEIGHT + ROW_GAP) + AGENT_NODE_HEIGHT,
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
