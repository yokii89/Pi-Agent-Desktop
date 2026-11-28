import { describe, expect, it } from "vitest";
import type { ViewBashJob, ViewBashWorkspaceNode } from "../../../shared/view";
import { type BashWorkspacePanelEntry, findVisibleBashJob, projectBashJobs } from "./bashJobs";

function job(id: string): ViewBashJob {
  return {
    id,
    command: "pnpm dev",
    mode: "detach",
    status: "running",
    reason: "explicit",
    startedAt: 1000,
    lastOutputAt: 1000,
    detached: true,
    outputBytes: 0,
    outputLines: 0,
  };
}

function workspace(ids = ["J-1"], total = ids.length): ViewBashWorkspaceNode {
  return {
    type: "bash-workspace",
    id: "jobs",
    jobs: ids.map(job),
    value: { query: "", filter: "all", page: 0 },
    counts: { total, running: total, ended: 0, orphaned: 0 },
    matchedJobs: total,
    pageCount: 1,
    output: "",
    cursor: "0",
    outputStartLine: 1,
    outputTruncated: false,
    outputMore: false,
    partial: true,
  };
}

function entry(overrides: Partial<BashWorkspacePanelEntry> = {}): BashWorkspacePanelEntry {
  return {
    id: "view-1",
    panelId: "custom-jobs-provider",
    sessionId: "session-1",
    root: workspace(),
    values: {},
    ...overrides,
  };
}

describe("extension Bash job monitor projection", () => {
  it("uses any Bash-workspace provider and excludes other sessions and node types", () => {
    const result = projectBashJobs(
      [
        entry(),
        entry({ id: "other-session", sessionId: "session-2" }),
        entry({ id: "other-node", root: { type: "text", content: "hello" } }),
      ],
      "session-1",
    );
    expect(result.jobs.map((item) => item.entry.panelId)).toEqual(["custom-jobs-provider"]);
    expect(result.total).toBe(1);
  });

  it("uses bound legacy ownership but never an unbound global View", () => {
    const result = projectBashJobs(
      [entry({ sessionId: undefined, boundSessionId: "session-1" }), entry({ sessionId: undefined })],
      "session-1",
    );
    expect(result.jobs).toHaveLength(1);
    expect(projectBashJobs([entry()], null).jobs).toEqual([]);
  });

  it("bounds rows while retaining the extension total and workspace navigation", () => {
    const result = projectBashJobs(
      [entry({ root: workspace(Array.from({ length: 8 }, (_, index) => `J-${index}`), 100) })],
      "session-1",
    );
    expect(result.jobs).toHaveLength(5);
    expect(result.total).toBe(100);
    expect(result.workspaces).toHaveLength(1);
  });

  it("keeps an open-all destination when a filter has no visible jobs", () => {
    const result = projectBashJobs([entry({ root: workspace([], 4) })], "session-1");
    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(4);
    expect(result.workspaces[0]?.id).toBe("view-1");
  });

  it("revalidates view, session and current-page job identity before a click", () => {
    expect(findVisibleBashJob([entry()], "session-1", "view-1", "J-1")?.job.id).toBe("J-1");
    expect(findVisibleBashJob([entry()], "session-2", "view-1", "J-1")).toBeNull();
    expect(findVisibleBashJob([entry()], "session-1", "closed-view", "J-1")).toBeNull();
    expect(findVisibleBashJob([entry()], "session-1", "view-1", "old-job")).toBeNull();
    expect(findVisibleBashJob([], "session-1", "view-1", "J-1")).toBeNull();
  });

  it("does not conflate matching job IDs from different providers", () => {
    const views = [entry(), entry({ id: "view-2", panelId: "another-provider" })];
    expect(projectBashJobs(views, "session-1").jobs).toHaveLength(2);
    expect(findVisibleBashJob(views, "session-1", "view-2", "J-1")?.entry.panelId).toBe(
      "another-provider",
    );
  });
});
