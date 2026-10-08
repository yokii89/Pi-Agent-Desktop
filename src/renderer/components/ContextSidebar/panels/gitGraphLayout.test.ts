import { describe, expect, it } from "vitest";
import type { GitCommit } from "../../../../shared/ipc";
import { layoutGitGraph, maxLaneCount } from "./gitGraphLayout";

function commit(partial: Partial<GitCommit> & Pick<GitCommit, "oid">): GitCommit {
  return {
    shortOid: partial.oid.slice(0, 7),
    subject: "",
    authorName: "dev",
    authorEmail: "dev@example.com",
    avatarDataUrl: null,
    authorTime: 0,
    parentOids: [],
    refs: [],
    isHead: false,
    isCurrentBranchTip: false,
    ...partial,
  };
}

describe("layoutGitGraph", () => {
  it("keeps first-parent chain on a single lane", () => {
    const rows = layoutGitGraph([
      commit({ oid: "a", parentOids: ["b"] }),
      commit({ oid: "b", parentOids: ["c"] }),
      commit({ oid: "c", parentOids: [] }),
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.parentLinks.every((l) => l.lane === l.fromLane))).toBe(true);
    expect(maxLaneCount(rows)).toBe(1);
  });

  it("allocates a second lane for merge side parents", () => {
    const rows = layoutGitGraph([
      // merge M：首父在 lane0 延续，侧父占 lane1
      commit({ oid: "m", parentOids: ["main1", "side1"] }),
      commit({ oid: "main1", parentOids: ["base"] }),
      commit({ oid: "side1", parentOids: ["base"] }),
      commit({ oid: "base", parentOids: [] }),
    ]);
    const merge = rows[0];
    expect(merge.lane).toBe(0);
    expect(merge.parentLinks).toContainEqual({ lane: 0, fromLane: 0 });
    expect(merge.parentLinks).toContainEqual({ lane: 1, fromLane: 0 });
    expect(merge.activeLanes).toEqual(expect.arrayContaining([0, 1]));
    expect(maxLaneCount(rows)).toBeGreaterThanOrEqual(2);
  });

  it("reuses a free lane after the branch tip ends", () => {
    const rows = layoutGitGraph([
      commit({ oid: "tip2", parentOids: ["base"] }),
      commit({ oid: "tip1", parentOids: ["base"] }),
      commit({ oid: "base", parentOids: [] }),
    ]);
    // tip1 / tip2 各占一列，汇入 base 前列数为 2
    expect(maxLaneCount(rows)).toBeGreaterThanOrEqual(2);
    expect(rows[2].lane).toBe(0);
  });
});
