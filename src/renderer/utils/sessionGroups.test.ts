import { describe, expect, it } from "vitest";
import type { PideskProject, SessionSummary } from "../../shared/ipc";
import {
  applySessionOrder,
  buildSessionTree,
  excludeArchivedSessions,
  findOwningProject,
  flattenSessionTree,
} from "./sessionGroups";

const project = (id: string, dir: string): PideskProject => ({ id, name: id, dir });
const session = (file: string, cwd: string | null, updatedAt = 0): SessionSummary => ({
  file,
  id: file,
  startedAt: 0,
  updatedAt,
  firstUserMessage: file,
  sessionName: null,
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

  it("嵌套项目归入路径最深（最具体）的一个", () => {
    const nested = [project("outer", "D:\\work"), project("inner", "D:\\work\\pi")];
    const tree = buildSessionTree(
      [
        session("deep.jsonl", "D:\\work\\pi\\src", 2),
        session("shallow.jsonl", "D:\\work\\other", 1),
      ],
      nested,
    );
    expect(tree.projectGroups.map((g) => [g.project.id, g.sessions.map((s) => s.file)])).toEqual([
      ["outer", ["shallow.jsonl"]],
      ["inner", ["deep.jsonl"]],
    ]);
  });

  it("无项目时全部归入任务段", () => {
    const flat = flattenSessionTree(buildSessionTree(SESSIONS, []));
    expect(flat.map((s) => s.file)).toEqual(["s-pi-1.jsonl", "s-ui.jsonl", "s-task.jsonl"]);
  });

  it("全局置顶会话从分组中提出，按置顶顺序排在拍平最前", () => {
    const tree = buildSessionTree(SESSIONS, PROJECTS, [], ["s-task.jsonl", "s-ui.jsonl"]);
    expect(tree.globalPinned.map((s) => s.file)).toEqual(["s-task.jsonl", "s-ui.jsonl"]);
    expect(tree.tasks).toEqual([]);
    expect(tree.projectGroups.flatMap((g) => g.sessions).map((s) => s.file)).toEqual([
      "s-pi-1.jsonl",
    ]);
    expect(flattenSessionTree(tree).map((s) => s.file)).toEqual([
      "s-task.jsonl",
      "s-ui.jsonl",
      "s-pi-1.jsonl",
    ]);
  });

  it("全局置顶优先于工作区置顶：同一会话只出现在置顶区一次", () => {
    const tree = buildSessionTree(SESSIONS, PROJECTS, ["s-pi-1.jsonl"], ["s-pi-1.jsonl"]);
    expect(tree.globalPinned.map((s) => s.file)).toEqual(["s-pi-1.jsonl"]);
    const flat = flattenSessionTree(tree);
    expect(flat.filter((s) => s.file === "s-pi-1.jsonl")).toHaveLength(1);
  });

  it("全局置顶登记了已不存在的会话时不影响其余分组", () => {
    const tree = buildSessionTree(SESSIONS, PROJECTS, [], ["missing.jsonl"]);
    expect(tree.globalPinned).toEqual([]);
    expect(flattenSessionTree(tree).map((s) => s.file)).toEqual([
      "s-pi-1.jsonl",
      "s-ui.jsonl",
      "s-task.jsonl",
    ]);
  });
});

describe("applySessionOrder", () => {
  // 入参顺序 = 侧栏默认的时间倒序
  const group = [
    session("s4.jsonl", "D:\\work\\pi", 4),
    session("s3.jsonl", "D:\\work\\pi", 3),
    session("s2.jsonl", "D:\\work\\pi", 2),
    session("s1.jsonl", "D:\\work\\pi", 1),
  ];

  it("没手动排过时保持原行为：置顶在前，其余时间倒序", () => {
    const ordered = applySessionOrder(group, ["s2.jsonl"], []);
    expect(ordered.map((s) => s.file)).toEqual(["s2.jsonl", "s4.jsonl", "s3.jsonl", "s1.jsonl"]);
  });

  it("手动顺序只排未置顶的会话", () => {
    const ordered = applySessionOrder(group, ["s2.jsonl"], ["s1.jsonl", "s4.jsonl", "s3.jsonl"]);
    expect(ordered.map((s) => s.file)).toEqual(["s2.jsonl", "s1.jsonl", "s4.jsonl", "s3.jsonl"]);
  });

  it("手动排序之后新建的会话排在置顶块下方最前，不被压到最底", () => {
    const withNew = [session("s5.jsonl", "D:\\work\\pi", 5), ...group];
    const ordered = applySessionOrder(withNew, [], ["s1.jsonl", "s3.jsonl"]);
    expect(ordered.map((s) => s.file)).toEqual([
      "s5.jsonl",
      "s4.jsonl",
      "s2.jsonl",
      "s1.jsonl",
      "s3.jsonl",
    ]);
  });

  it("手动表里残留的置顶会话不会改变置顶块的顺序", () => {
    // 先拖过、后置顶：置顶顺序以 pinnedFiles 为准，手动表里的位置忽略
    const ordered = applySessionOrder(group, ["s1.jsonl", "s4.jsonl"], ["s4.jsonl", "s3.jsonl"]);
    expect(ordered.map((s) => s.file)).toEqual(["s1.jsonl", "s4.jsonl", "s2.jsonl", "s3.jsonl"]);
  });

  it("只作用于传入的分组：顺序表里缺的条目按时间倒序补在最前", () => {
    const ordered = applySessionOrder(group, [], ["s2.jsonl"]);
    expect(ordered.map((s) => s.file)).toEqual(["s4.jsonl", "s3.jsonl", "s1.jsonl", "s2.jsonl"]);
  });
});

describe("findOwningProject", () => {
  it("多个项目嵌套时取路径最深（最具体）的一个", () => {
    const nested = [project("outer", "D:\\work"), project("inner", "D:\\work\\pi")];
    expect(findOwningProject("D:\\work\\pi\\src", nested)?.id).toBe("inner");
    expect(findOwningProject("D:\\work\\other", nested)?.id).toBe("outer");
    expect(findOwningProject(null, nested)).toBeNull();
    expect(findOwningProject("D:\\elsewhere", nested)).toBeNull();
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
