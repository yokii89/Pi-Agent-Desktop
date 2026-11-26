import { describe, expect, it } from "vitest";
import {
  collectSubtree,
  diffNewInSubtree,
  isDescendantOf,
  isShellWrapper,
  matchesServicePattern,
  mergeSnapshots,
  type ProcessSnapshot,
  type ProcessSnapshotRow,
  pickJobCandidates,
  pickServiceCandidates,
  summarizeCommand,
} from "./processWatch";

function row(partial: Partial<ProcessSnapshotRow> & { pid: number }): ProcessSnapshotRow {
  return {
    ppid: 0,
    name: "node.exe",
    commandLine: "",
    startedAt: 1000,
    ...partial,
  };
}

function snap(...rows: ProcessSnapshotRow[]): ProcessSnapshot {
  return new Map(rows.map((r) => [r.pid, r]));
}

describe("isShellWrapper / matchesServicePattern", () => {
  it("treats shell hosts as wrappers", () => {
    expect(isShellWrapper("cmd.exe")).toBe(true);
    expect(isShellWrapper("powershell.exe")).toBe(true);
    expect(isShellWrapper("conhost.exe")).toBe(true);
    expect(isShellWrapper("node.exe")).toBe(false);
  });

  it("matches default service substrings and regexes", () => {
    expect(matchesServicePattern("node.exe", "node server.js")).toBe(false);
    expect(matchesServicePattern("node.exe", "npx vite")).toBe(true);
    expect(matchesServicePattern("node.exe", "npm run dev")).toBe(true);
    expect(matchesServicePattern("python.exe", "python -m uvicorn app:app")).toBe(true);
    expect(matchesServicePattern("python.exe", "python -m http.server 8000")).toBe(false);
    expect(matchesServicePattern("node.exe", "node --watch main.js")).toBe(true);
    expect(matchesServicePattern("ruby.exe", "ruby bin/server")).toBe(true);
  });

  it("summarizes long command lines", () => {
    expect(summarizeCommand("npm run dev", "cmd.exe")).toBe("npm run dev");
    const long = "x".repeat(80);
    expect(summarizeCommand(long, "node.exe").endsWith("…")).toBe(true);
    expect(summarizeCommand("", "vite.exe")).toBe("vite.exe");
  });
});

describe("collectSubtree / isDescendantOf", () => {
  it("BFS includes root and descendants only", () => {
    const s = snap(
      row({ pid: 1, ppid: 0 }),
      row({ pid: 2, ppid: 1 }),
      row({ pid: 3, ppid: 2 }),
      row({ pid: 9, ppid: 0 }),
    );
    const ids = collectSubtree(s, 1).map((r) => r.pid);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });

  it("walks historical parents through merged snapshots", () => {
    const baseline = snap(row({ pid: 1, ppid: 0 }), row({ pid: 2, ppid: 1, name: "bash.exe" }));
    const current = snap(row({ pid: 1, ppid: 0 }), row({ pid: 3, ppid: 2 }));
    const merged = mergeSnapshots(baseline, current);
    expect(isDescendantOf(merged, 3, 1)).toBe(true);
    expect(isDescendantOf(merged, 3, 99)).toBe(false);
  });
});

describe("mergeSnapshots 的进程身份", () => {
  it("PID 已复用时保留新进程的父节点和创建时间", () => {
    const before = row({ pid: 2, ppid: 1, startedAt: 1000 });
    const after = row({ pid: 2, ppid: 99, name: "msedge.exe", startedAt: 10_000 });
    expect(mergeSnapshots(snap(before), snap(after)).get(2)).toEqual(after);
  });

  it.each([1000, 0])("同一进程或创建时间未知（%i）时保留历史父节点", (startedAt) => {
    const before = row({ pid: 2, ppid: 1, startedAt: 1000 });
    const after = row({ pid: 2, ppid: 99, startedAt });
    expect(mergeSnapshots(snap(before), snap(after)).get(2)).toMatchObject({
      ppid: 1,
      startedAt: 1000,
    });
  });
});

describe("diffNewInSubtree", () => {
  it("returns only new descendants of root", () => {
    const baseline = snap(
      row({ pid: 1, ppid: 0 }),
      row({ pid: 2, ppid: 1, name: "bash.exe", commandLine: "bash -c npm run dev &" }),
    );
    const current = snap(
      row({ pid: 1, ppid: 0 }),
      // bash 已退出：3 的父是死掉的 2
      row({ pid: 3, ppid: 2, name: "node.exe", commandLine: "node vite" }),
      row({ pid: 8, ppid: 0, name: "other.exe" }),
    );
    const fresh = diffNewInSubtree(baseline, current, 1);
    expect(fresh.map((r) => r.pid)).toEqual([3]);
  });

  it("excludes baseline pids and root itself", () => {
    const baseline = snap(row({ pid: 1, ppid: 0 }), row({ pid: 2, ppid: 1 }));
    const current = snap(row({ pid: 1, ppid: 0 }), row({ pid: 2, ppid: 1 }));
    expect(diffNewInSubtree(baseline, current, 1)).toEqual([]);
  });

  it("旧 shell 的 PID 被浏览器复用后，不把浏览器及其子进程归到会话", () => {
    const root = row({ pid: 1 });
    const baseline = snap(root, row({ pid: 2, ppid: 1, startedAt: 1000 }));
    const current = snap(
      root,
      row({ pid: 2, ppid: 99, name: "msedge.exe", startedAt: 10_000 }),
      row({ pid: 3, ppid: 2, name: "msedge.exe", startedAt: 11_000 }),
    );
    expect(diffNewInSubtree(baseline, current, 1, 1000)).toEqual([]);
  });

  it("父 PID 已复用时，仍通过历史身份找回原先未退出的后台作业", () => {
    const root = row({ pid: 1 });
    const baseline = snap(root, row({ pid: 2, ppid: 1, startedAt: 1000 }));
    const job = row({ pid: 3, ppid: 2, name: "curl.exe", startedAt: 2000 });
    const current = snap(
      root,
      row({ pid: 2, ppid: 99, name: "msedge.exe", startedAt: 10_000 }),
      job,
      row({ pid: 4, ppid: 2, name: "msedge.exe", startedAt: 11_000 }),
    );
    expect(diffNewInSubtree(baseline, current, 1, 1000)).toEqual([job]);
  });

  it("会话内新进程复用了基线 PID，仍应识别为新后台工作", () => {
    const root = row({ pid: 1 });
    const baseline = snap(root, row({ pid: 2, ppid: 99, startedAt: 1000 }));
    const job = row({ pid: 2, ppid: 1, name: "curl.exe", startedAt: 10_000 });
    expect(diffNewInSubtree(baseline, snap(root, job), 1)).toEqual([job]);
  });

  it("已知父进程晚于子进程创建时，不建立不可能的父子关系", () => {
    const root = row({ pid: 1 });
    const current = snap(
      root,
      row({ pid: 2, ppid: 1, startedAt: 10_000 }),
      row({ pid: 3, ppid: 2, startedAt: 2000 }),
    );
    expect(diffNewInSubtree(snap(root), current, 1).map((item) => item.pid)).toEqual([2]);
  });

  it("根 PID 已复用时，不把替代进程的子树归到原会话", () => {
    const baseline = snap(row({ pid: 1, startedAt: 1000 }));
    const current = snap(
      row({ pid: 1, ppid: 99, startedAt: 10_000 }),
      row({ pid: 2, ppid: 1, startedAt: 11_000 }),
    );
    expect(diffNewInSubtree(baseline, current, 1, 1000)).toEqual([]);
  });
});

describe("pickServiceCandidates", () => {
  it("drops wrappers and non-service processes", () => {
    const picked = pickServiceCandidates([
      row({ pid: 1, ppid: 0, name: "bash.exe", commandLine: "bash" }),
      row({ pid: 2, ppid: 1, name: "ls.exe", commandLine: "ls" }),
      row({ pid: 3, ppid: 1, name: "node.exe", commandLine: "node vite" }),
    ]);
    expect(picked.map((r) => r.pid)).toEqual([3]);
  });

  it("keeps only the deepest match on a chain", () => {
    const picked = pickServiceCandidates([
      row({ pid: 10, ppid: 0, name: "npm.exe", commandLine: "npm run dev" }),
      row({ pid: 11, ppid: 10, name: "node.exe", commandLine: "node vite" }),
    ]);
    expect(picked.map((r) => r.pid)).toEqual([11]);
  });

  it("keeps sibling matches", () => {
    const picked = pickServiceCandidates([
      row({ pid: 20, ppid: 1, name: "node.exe", commandLine: "npx vite" }),
      row({ pid: 21, ppid: 1, name: "python.exe", commandLine: "uvicorn app:app" }),
    ]);
    expect(picked.map((r) => r.pid).sort()).toEqual([20, 21]);
  });
});

/**
 * 第二档候选（docs/design/133 §2）：pi-bash-jobs 把长下载/转码转成后台作业时工具调用已返回，
 * 命令行里没有服务字样，只能靠「活满复核窗」进列表；同时不能把一个 dev server 裂成好几行。
 */
describe("pickJobCandidates", () => {
  it("收下单调命中不了服务启发式的长任务", () => {
    const rows = [
      row({ pid: 2, ppid: 1, name: "bash.exe" }),
      row({ pid: 3, ppid: 2, name: "curl.exe", commandLine: "curl -o isubs.tar https://…" }),
    ];
    expect(pickJobCandidates(rows, pickServiceCandidates(rows)).map((r) => r.pid)).toEqual([3]);
  });

  it("服务进程自己派生的助手不另起一行", () => {
    const rows = [
      row({ pid: 2, ppid: 1, name: "bash.exe" }),
      row({ pid: 3, ppid: 2, commandLine: "node vite" }),
      row({ pid: 4, ppid: 3, name: "esbuild.exe", commandLine: "esbuild --service=0.21" }),
    ];
    expect(pickJobCandidates(rows, pickServiceCandidates(rows))).toEqual([]);
  });

  it("服务行的祖先链（pnpm → node vite）已由最深那一行代表", () => {
    const rows = [
      row({ pid: 2, ppid: 1, name: "bash.exe" }),
      row({ pid: 3, ppid: 2, commandLine: "pnpm dev" }),
      row({ pid: 4, ppid: 3, commandLine: "node vite" }),
    ];
    const services = pickServiceCandidates(rows);
    expect(services.map((r) => r.pid)).toEqual([4]);
    expect(pickJobCandidates(rows, services)).toEqual([]);
  });

  it("与服务分支无关的旁支进程仍然收", () => {
    const rows = [
      row({ pid: 2, ppid: 1, name: "bash.exe" }),
      row({ pid: 3, ppid: 2, commandLine: "node vite" }),
      row({ pid: 5, ppid: 2, name: "ffmpeg.exe", commandLine: "ffmpeg -i a.mp4 b.mkv" }),
    ];
    const services = pickServiceCandidates(rows);
    expect(pickJobCandidates(rows, services).map((r) => r.pid)).toEqual([5]);
  });
});
