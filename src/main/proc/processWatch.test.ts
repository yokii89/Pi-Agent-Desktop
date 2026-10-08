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
