import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jobLogPathFor, matchJobByPid, type ParsedSnapshot, parseSnapshotFile } from "./jobLogs";

function snapshot(
  sessionId: string,
  jobs: Array<{ id: string; pid?: number; status?: string; startedAt?: number }>,
): ParsedSnapshot {
  return { sessionId, jobs };
}

describe("parseSnapshotFile", () => {
  it("解析 persist.ts 的快照结构（jobs[].record）", () => {
    const text = JSON.stringify({
      version: 1,
      sessionId: "pi-s1",
      updatedAt: 1,
      jobs: [
        {
          record: { id: "J-1", pid: 1234, status: "running", startedAt: 100, command: "pnpm dev" },
          tail: "...",
        },
        { record: { id: "J-2", pid: 2222, status: "exited", startedAt: 200 }, tail: "" },
      ],
      watchers: [],
    });
    const parsed = parseSnapshotFile(text, "pi-s1");
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe("pi-s1");
    expect(parsed?.jobs).toHaveLength(2);
    expect(parsed?.jobs[0]).toMatchObject({ id: "J-1", pid: 1234, status: "running" });
  });

  it("坏 JSON / 缺 jobs / 记录缺 id 返回 null 或被剔除", () => {
    expect(parseSnapshotFile("not json", "s")).toBeNull();
    expect(parseSnapshotFile("{}", "s")).toBeNull();
    expect(
      parseSnapshotFile(JSON.stringify({ jobs: [{ record: { pid: 1 } }, null] }), "s")?.jobs,
    ).toHaveLength(0);
  });
});

describe("matchJobByPid", () => {
  it("按 pid 精确匹配 running / orphaned，同 pid 多条取 startedAt 最新", () => {
    const snapshots = [
      snapshot("a", [
        { id: "J-1", pid: 1234, status: "running", startedAt: 100 },
        { id: "J-2", pid: 1234, status: "exited", startedAt: 300 },
      ]),
      snapshot("b", [{ id: "J-9", pid: 1234, status: "orphaned", startedAt: 200 }]),
    ];
    expect(matchJobByPid(snapshots, 1234)).toEqual({ sessionId: "b", jobId: "J-9" });
    expect(matchJobByPid(snapshots, 2222)).toBeNull();
  });

  it("已结束（exited/killed）的作业不参与匹配（跟随没有意义）", () => {
    const snapshots = [snapshot("a", [{ id: "J-1", pid: 1234, status: "exited", startedAt: 100 }])];
    expect(matchJobByPid(snapshots, 1234)).toBeNull();
  });
});

describe("jobLogPathFor", () => {
  it("与扩展 paths.ts 的 jobLogPath 同一公式", () => {
    expect(jobLogPathFor("C:/pi/agent", "pi-s1", "J-3")).toBe(
      join("C:/pi/agent", "bash-jobs", "logs", "pi-s1", "J-3.log"),
    );
  });
});
