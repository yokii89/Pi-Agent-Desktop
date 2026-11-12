import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../github/authStore", () => ({ readToken: () => null }));

import {
  compareWorktreeToSnapshot,
  createSnapshot,
  getChanges,
  getFileDiff,
  rollbackToSnapshot,
} from "./gitService";

const exec = promisify(execFile);
const directories: string[] = [];

async function createRepo(initial: Record<string, string | Buffer> = { "a.txt": "base\n" }) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pidesk-git-snapshot-"));
  directories.push(cwd);
  const git = (...args: string[]) => exec("git", args, { cwd, windowsHide: true });
  const write = async (file: string, content: string | Buffer) => {
    const abs = path.join(cwd, file);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  };
  await git("init", "-q");
  await git("config", "core.autocrlf", "false");
  await git("config", "user.name", "PiDesk Snapshot Test");
  await git("config", "user.email", "snapshot-test@example.invalid");
  for (const [file, content] of Object.entries(initial)) await write(file, content);
  if (Object.keys(initial).length > 0) {
    await git("add", "-A");
    await git("-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
  }
  const snapshot = async () => {
    const result = await createSnapshot(cwd);
    expect(result.treeOid).not.toBeNull();
    return result.treeOid as string;
  };
  const read = (file: string) => fs.readFile(path.join(cwd, file), "utf8");
  return { cwd, git, write, read, snapshot };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

// Windows 并行运行编译与真实 Git 子进程时，进程启动耗时可能超过默认单测时限。
describe("本轮快照与撤销（真实 Git 仓库）", { timeout: 30000 }, () => {
  it("同一文件连续修改且增删行数不变时仍检测到本轮改动", async () => {
    const repo = await createRepo();
    await repo.write("a.txt", "earlier turn\n");
    const before = await getChanges(repo.cwd);
    const treeOid = await repo.snapshot();
    await repo.write("a.txt", "latest turn\n");
    const after = await getChanges(repo.cwd, treeOid);
    expect(after.changes).toEqual(before.changes);
    expect(after.snapshotChanges).toEqual([
      expect.objectContaining({ path: "a.txt", additions: 1, deletions: 1 }),
    ]);
    const result = await rollbackToSnapshot(repo.cwd, {
      cwd: repo.cwd,
      treeOid,
      paths: after.snapshotChanges?.map((change) => change.path) ?? [],
    });
    expect(result).toEqual({ restored: 1, deleted: 0 });
    expect(await repo.read("a.txt")).toBe("earlier turn\n");
  });

  it("本轮把文件改回 HEAD 时仍可审阅和撤销", async () => {
    const repo = await createRepo();
    await repo.write("a.txt", "earlier turn\n");
    const treeOid = await repo.snapshot();
    await repo.write("a.txt", "base\n");
    const result = await getChanges(repo.cwd, treeOid);
    expect(result.changes).toEqual([]);
    expect(result.snapshotChanges).toHaveLength(1);
    const change = result.snapshotChanges?.[0];
    expect(change).toBeDefined();
    if (!change) return;
    const diff = await getFileDiff(repo.cwd, { cwd: repo.cwd, ...change });
    expect(diff.hunks.flatMap((hunk) => hunk.lines)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "del", text: "earlier turn" }),
        expect.objectContaining({ kind: "add", text: "base" }),
      ]),
    );
    await rollbackToSnapshot(repo.cwd, { cwd: repo.cwd, treeOid, paths: [change.path] });
    expect(await repo.read("a.txt")).toBe("earlier turn\n");
  });

  it("未跟踪文件行数不变仍检测内容；删除、空文件和二进制均纳入本轮", async () => {
    const repo = await createRepo();
    await repo.write("draft.txt", "before\n");
    const treeOid = await repo.snapshot();
    await repo.write("draft.txt", "after\n");
    await fs.unlink(path.join(repo.cwd, "a.txt"));
    await repo.write("新目录/empty.txt", "");
    await repo.write("binary.bin", Buffer.from([0, 1, 2, 3]));
    const { snapshotChanges: changes } = await getChanges(repo.cwd, treeOid);
    expect(changes?.map((change) => change.path).sort()).toEqual(
      ["a.txt", "draft.txt", "新目录/empty.txt", "binary.bin"].sort(),
    );
    expect(changes?.find((change) => change.path === "binary.bin")).toEqual(
      expect.objectContaining({ additions: null, deletions: null }),
    );
    const result = await rollbackToSnapshot(repo.cwd, {
      cwd: repo.cwd,
      treeOid,
      paths: changes?.map((change) => change.path) ?? [],
    });
    expect(result).toEqual({ restored: 2, deleted: 2 });
    expect(await repo.read("draft.txt")).toBe("before\n");
    expect(await repo.read("a.txt")).toBe("base\n");
    expect(await fs.readdir(repo.cwd)).not.toContain("新目录");
  });

  it("仅比较本轮内容，保留既有未提交改动和真实暂存区", async () => {
    const repo = await createRepo({ "a.txt": "base\n", "untouched.txt": "base\n" });
    await repo.write("a.txt", "staged\n");
    await repo.git("add", "a.txt");
    await repo.write("a.txt", "before turn\n");
    await repo.write("untouched.txt", "keep my changes\n");
    const indexBefore = await repo.git("ls-files", "--stage");
    const treeOid = await repo.snapshot();
    await repo.write("a.txt", "agent\n");
    const result = await getChanges(repo.cwd, treeOid);
    expect(result.snapshotChanges?.map((change) => change.path)).toEqual(["a.txt"]);
    await rollbackToSnapshot(repo.cwd, { cwd: repo.cwd, treeOid, paths: ["a.txt"] });
    expect(await repo.read("a.txt")).toBe("before turn\n");
    expect(await repo.read("untouched.txt")).toBe("keep my changes\n");
    expect((await repo.git("ls-files", "--stage")).stdout).toBe(indexBefore.stdout);
  });

  it("重命名保留新旧路径，撤销后恢复原文件", async () => {
    const repo = await createRepo({ "old name.txt": "one\ntwo\nthree\n" });
    const treeOid = await repo.snapshot();
    await fs.rename(path.join(repo.cwd, "old name.txt"), path.join(repo.cwd, "new name.txt"));
    const result = await getChanges(repo.cwd, treeOid);
    expect(result.snapshotChanges).toEqual([
      expect.objectContaining({ path: "new name.txt", oldPath: "old name.txt", status: "renamed" }),
    ]);
    const change = result.snapshotChanges?.[0];
    if (!change) return;
    await rollbackToSnapshot(repo.cwd, {
      cwd: repo.cwd,
      treeOid,
      paths: [change.path, change.oldPath as string],
    });
    expect(await repo.read("old name.txt")).toBe("one\ntwo\nthree\n");
    await expect(repo.read("new name.txt")).rejects.toThrow();
  });

  it("未发生内容变化时本轮为空，空仓库也能快照与撤销", async () => {
    const repo = await createRepo({});
    const treeOid = await repo.snapshot();
    expect((await getChanges(repo.cwd, treeOid)).snapshotChanges).toEqual([]);
    await repo.write("first.txt", "new\n");
    expect((await getChanges(repo.cwd, treeOid)).snapshotChanges).toEqual([
      expect.objectContaining({ path: "first.txt", status: "added" }),
    ]);
    expect(
      await rollbackToSnapshot(repo.cwd, { cwd: repo.cwd, treeOid, paths: ["first.txt"] }),
    ).toEqual({
      restored: 0,
      deleted: 1,
    });
  });

  it("强制暂存的忽略文件也进入快照，既有内容与暂存区均保留", async () => {
    const repo = await createRepo({ ".gitignore": "*.log\n" });
    await repo.write("existing.log", "before\n");
    await repo.git("add", "-f", "existing.log");
    const treeOid = await repo.snapshot();
    await repo.write("existing.log", "after\n");
    await repo.write("debug.log", "created this turn\n");
    await repo.git("add", "-f", "debug.log");
    const indexBefore = (await repo.git("ls-files", "--stage")).stdout;
    const result = await getChanges(repo.cwd, treeOid);
    expect(result.snapshotChanges?.map((change) => change.path).sort()).toEqual([
      "debug.log",
      "existing.log",
    ]);
    await rollbackToSnapshot(repo.cwd, {
      cwd: repo.cwd,
      treeOid,
      paths: result.snapshotChanges?.map((change) => change.path) ?? [],
    });
    expect(await repo.read("existing.log")).toBe("before\n");
    await expect(repo.read("debug.log")).rejects.toThrow();
    expect((await repo.git("ls-files", "--stage")).stdout).toBe(indexBefore);
  });

  it("轮末后的手工修改能被冲突核对识别", async () => {
    const repo = await createRepo();
    await repo.write("a.txt", "agent\n");
    await repo.write("new.txt", "created\n");
    const treeOid = await repo.snapshot();
    await repo.write("a.txt", "manual\n");
    await repo.write("new.txt", "manual too\n");
    const result = await compareWorktreeToSnapshot(repo.cwd, {
      cwd: repo.cwd,
      treeOid,
      paths: ["a.txt", "new.txt"],
    });
    expect(result.items).toEqual([
      { path: "a.txt", inSnapshot: true, inWorktree: true, differs: true },
      { path: "new.txt", inSnapshot: true, inWorktree: true, differs: true },
    ]);
  });

  it("快照对象失效时拒绝撤销，不能把读取失败当成新文件删除", async () => {
    const repo = await createRepo();
    await expect(
      rollbackToSnapshot(repo.cwd, { cwd: repo.cwd, treeOid: "deadbeef", paths: ["a.txt"] }),
    ).rejects.toThrow();
    expect(await repo.read("a.txt")).toBe("base\n");
  });
});
