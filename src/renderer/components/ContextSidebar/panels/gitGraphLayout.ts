import type { GitCommit } from "../../../../shared/ipc";

/** 泳道布局：每行 commit 的点位 + 贯穿竖线 + 向父节点的连线目标。 */
export interface GraphRow {
  commit: GitCommit;
  /** 提交圆点所在列。 */
  lane: number;
  /** 本行需要竖线贯穿的列（含圆点列与仍存活的并行分支）。 */
  activeLanes: number[];
  /** 从本提交连向父提交的列；首父与本列重合时只画竖线，不画弯线。 */
  parentLinks: { lane: number; fromLane: number }[];
  /** 布局用到的最大列数。 */
  laneCount: number;
}

/**
 * 只读提交图的泳道分配（date-order 输入）。
 * 首父优先延续当前列；若父提交已被其他子提交预占到别的列，则跨列连线并释放本列。
 * 其余父（merge）复用已预占列，否则取空闲列。适合侧栏紧凑列表，不追求 gitk 级重排。
 */
export function layoutGitGraph(commits: GitCommit[]): GraphRow[] {
  /** 各列当前占用的 oid；null 为空闲。 */
  const lanes: (string | null)[] = [];
  const oidLane = new Map<string, number>();
  const rows: GraphRow[] = [];

  const occupyLane = (lane: number, oid: string): void => {
    lanes[lane] = oid;
    oidLane.set(oid, lane);
  };

  const claimLaneFor = (oid: string): number => {
    const existing = oidLane.get(oid);
    if (existing !== undefined) return existing;
    let lane = lanes.indexOf(null);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(null);
    }
    occupyLane(lane, oid);
    return lane;
  };

  const freeLaneIfSelf = (lane: number, selfOid: string): void => {
    if (lanes[lane] === selfOid) lanes[lane] = null;
    if (oidLane.get(selfOid) === lane) oidLane.delete(selfOid);
  };

  for (const commit of commits) {
    const lane = claimLaneFor(commit.oid);
    const parents = commit.parentOids;
    const parentLinks: { lane: number; fromLane: number }[] = [];
    /** 本列是否仍有后继（竖线需要继续往下画）。 */
    let successorOnSelf = false;

    // 首父：未预占则延续当前列；已被其他子占列则跨列连线
    if (parents[0]) {
      const existing = oidLane.get(parents[0]);
      if (existing !== undefined) {
        parentLinks.push({ lane: existing, fromLane: lane });
        if (existing === lane) successorOnSelf = true;
      } else {
        occupyLane(lane, parents[0]);
        parentLinks.push({ lane, fromLane: lane });
        successorOnSelf = true;
      }
    }

    // 其余父（merge）：复用预占列或申请空闲列
    for (let i = 1; i < parents.length; i += 1) {
      const parent = parents[i];
      if (!parent) continue;
      const pLane = claimLaneFor(parent);
      parentLinks.push({ lane: pLane, fromLane: lane });
      if (pLane === lane) successorOnSelf = true;
    }

    // 无后继时释放本列，避免后续提交误 claim 到「幽灵占用」
    if (!successorOnSelf) freeLaneIfSelf(lane, commit.oid);

    // 收掉末尾空列，避免列数虚高
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const activeLanes: number[] = [];
    for (let i = 0; i < lanes.length; i += 1) {
      if (lanes[i] !== null) activeLanes.push(i);
    }
    if (!activeLanes.includes(lane)) activeLanes.push(lane);

    rows.push({
      commit,
      lane,
      activeLanes,
      parentLinks,
      laneCount: Math.max(lanes.length, lane + 1),
    });
  }

  return rows;
}

/** 全图最大列数（决定 SVG 宽度）。 */
export function maxLaneCount(rows: GraphRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.laneCount), 1);
}
