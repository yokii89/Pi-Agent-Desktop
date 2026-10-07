import { describe, expect, it } from "vitest";
import type { PideskProject, SessionSummary } from "../../shared/ipc";
import { buildSessionTree, excludeArchivedSessions, flattenSessionTree } from "./sessionGroups";

const project = (id: string, dir: string): PideskProject => ({ id, name: id, dir });
const session = (file: string, cwd: string | null, updatedAt = 0): SessionSummary => ({
  file,
  id: file,
  startedAt: 0,
  updatedAt,
  firstUserMessage: file,
  cwd,
});

const PROJECTS = [project("p1", "D:\\work\\pi"), project("p2", "D:\\work\\pi-ui")];
const SESSIONS = [
  session("s-pi-1.jsonl", "D:\\work\\pi\\src", 3),
  session("s-ui.jsonl", "D:\\work\\pi-ui", 2),
  session("s-task.jsonl", null, 1),
];

describe("buildSessionTree / flattenSessionTree", () => {
  it("拍平顺序 = 侧栏展示顺序：项目组在前、任务在后", () => {
    const tree = buildSessionTree(SESSIONS, PROJECTS);
    const flat = flattenSessionTree(tree);
    // 会话 cwd 在项目目录内部时归入该项目（嵌套最深优先）
    expect(flat.map((s) => s.file)).toEqual(["s-pi-1.jsonl", "s-ui.jsonl", "s-task.jsonl"]);
  });

  it("置顶会话提到所属项目组最前，拍平保持该顺序", () => {
    // s-pi-2 与 s-pi-1 同属 p1：置顶把 s-pi-2 提到 s-pi-1 前面
    const withSecond = [...SESSIONS, session("s-pi-2.jsonl", "D:\\work\\pi", 4)];
    const tree = buildSessionTree(withSecond, PROJECTS, ["s-pi-2.jsonl"]);
    const flat = flattenSessionTree(tree);
    expect(flat.map((s) => s.file)).toEqual([
      "s-pi-2.jsonl",
      "s-pi-1.jsonl",
      "s-ui.jsonl",
      "s-task.jsonl",
    ]);
  });

  it("无项目时全部归入任务段", () => {
    const flat = flattenSessionTree(buildSessionTree(SESSIONS, []));
    expect(flat.map((s) => s.file)).toEqual(["s-pi-1.jsonl", "s-ui.jsonl", "s-task.jsonl"]);
  });
});

describe("excludeArchivedSessions", () => {
  it("剔除已归档条目，未登记的全部保留", () => {
    const kept = excludeArchivedSessions(SESSIONS, { "s-ui.jsonl": 1000 });
    expect(kept.map((s) => s.file)).toEqual(["s-pi-1.jsonl", "s-task.jsonl"]);
  });

  it("归档表为空时原样返回（不重建数组）", () => {
    expect(excludeArchivedSessions(SESSIONS, {})).toBe(SESSIONS);
  });
});
