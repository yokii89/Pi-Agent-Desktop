import type { ViewAgentNode } from "../../../shared/view";

export const AGENT_NODE_WIDTH = 224;
export const AGENT_NODE_HEIGHT = 130;
const COLUMN_GAP = 48;
const ROW_GAP = 76;
const BRANCH_GUTTER = 24;
const PADDING = 24;
const DEFAULT_WIDTH = AGENT_NODE_WIDTH * 3 + COLUMN_GAP * 2 + BRANCH_GUTTER + PADDING * 2;

interface Point {
  x: number;
  y: number;
}

export interface AgentGraphPosition extends Point {
  agent: ViewAgentNode;
}

export interface AgentGraphLayout {
  nodes: AgentGraphPosition[];
  edges: {
    parent: AgentGraphPosition;
    child: AgentGraphPosition;
    points: Point[];
  }[];
  width: number;
  height: number;
}

interface Subtree {
  agent: ViewAgentNode;
  width: number;
  height: number;
  gutter: number;
  rows: SubtreeRow[];
}

interface SubtreeRow {
  trees: Subtree[];
  width: number;
  height: number;
}

function packRows(trees: Subtree[], availableWidth: number): SubtreeRow[] {
  const rows: SubtreeRow[] = [];
  let row: SubtreeRow = { trees: [], width: 0, height: 0 };
  for (const tree of trees) {
    if (row.trees.length && row.width + COLUMN_GAP + tree.width > availableWidth) {
      rows.push(row);
      row = { trees: [], width: 0, height: 0 };
    }
    row.width += (row.trees.length ? COLUMN_GAP : 0) + tree.width;
    row.height = Math.max(row.height, tree.height);
    row.trees.push(tree);
  }
  if (row.trees.length) rows.push(row);
  return rows;
}

/** Wrap whole subtrees to the viewport width, keeping every parent above its descendants. */
export function layoutAgentGraph(
  agents: readonly ViewAgentNode[],
  viewportWidth = DEFAULT_WIDTH,
): AgentGraphLayout {
  const availableWidth = Math.max(
    AGENT_NODE_WIDTH,
    (Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : DEFAULT_WIDTH) -
      PADDING * 2,
  );
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

  function measure(agent: ViewAgentNode, width: number): Subtree {
    const descendants = children.get(agent.id) ?? [];
    // A side lane carries edges to later rows without crossing earlier cards or their subtrees.
    const gutter = descendants.length > 1 ? BRANCH_GUTTER : 0;
    const childWidth = Math.max(AGENT_NODE_WIDTH, width - gutter);
    const rows = packRows(
      descendants.map((child) => measure(child, childWidth)),
      childWidth,
    );
    return {
      agent,
      gutter,
      rows,
      width: Math.max(AGENT_NODE_WIDTH, ...rows.map((row) => row.width)) + gutter,
      height: AGENT_NODE_HEIGHT + rows.reduce((sum, row) => sum + ROW_GAP + row.height, 0),
    };
  }

  const roots = agents.filter((agent) => !parents.has(agent.id));
  const forest = packRows(
    roots.map((root) => measure(root, availableWidth)),
    availableWidth,
  );
  const contentWidth = Math.max(AGENT_NODE_WIDTH, ...forest.map((row) => row.width));
  const positions = new Map<string, AgentGraphPosition>();
  const edges: AgentGraphLayout["edges"] = [];

  function place(tree: Subtree, left: number, top: number): AgentGraphPosition {
    const childWidth = tree.width - tree.gutter;
    const parent: AgentGraphPosition = {
      agent: tree.agent,
      x: left + tree.gutter + (childWidth - AGENT_NODE_WIDTH) / 2,
      y: top,
    };
    positions.set(tree.agent.id, parent);
    const start = { x: parent.x + AGENT_NODE_WIDTH / 2, y: top + AGENT_NODE_HEIGHT };
    const firstLaneY = start.y + ROW_GAP / 2;
    const trunkX = left + tree.gutter / 2;
    let rowTop = top + AGENT_NODE_HEIGHT + ROW_GAP;
    for (const [rowIndex, row] of tree.rows.entries()) {
      let childLeft = left + tree.gutter + (childWidth - row.width) / 2;
      for (const childTree of row.trees) {
        const child = place(childTree, childLeft, rowTop);
        const end = { x: child.x + AGENT_NODE_WIDTH / 2, y: child.y };
        const laneY = rowTop - ROW_GAP / 2;
        edges.push({
          parent,
          child,
          points:
            rowIndex === 0
              ? [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end]
              : [
                  start,
                  { x: start.x, y: firstLaneY },
                  { x: trunkX, y: firstLaneY },
                  { x: trunkX, y: laneY },
                  { x: end.x, y: laneY },
                  end,
                ],
        });
        childLeft += childTree.width + COLUMN_GAP;
      }
      rowTop += row.height + ROW_GAP;
    }
    return parent;
  }

  let rowTop = PADDING;
  for (const row of forest) {
    let left = PADDING + (contentWidth - row.width) / 2;
    for (const tree of row.trees) {
      place(tree, left, rowTop);
      left += tree.width + COLUMN_GAP;
    }
    rowTop += row.height + ROW_GAP;
  }
  return {
    nodes: agents.flatMap((agent) => {
      const position = positions.get(agent.id);
      return position ? [position] : [];
    }),
    edges,
    width: contentWidth + PADDING * 2,
    height:
      PADDING * 2 +
      (forest.length
        ? forest.reduce((sum, row) => sum + row.height, 0) + (forest.length - 1) * ROW_GAP
        : AGENT_NODE_HEIGHT),
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
