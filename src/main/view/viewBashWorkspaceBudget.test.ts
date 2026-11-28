import { describe, expect, it } from "vitest";
import { measureViewTree } from "../../../packages/view-sdk/src/limits";
import type { ViewBashWorkspaceNode } from "../../shared/view";
import { VIEW_LIMITS } from "../../shared/view";
import { sanitizeTree } from "./viewHostProtocol";

function workspace(jobs: unknown[]): Record<string, unknown> {
  return {
    type: "bash-workspace",
    id: "bash",
    jobs,
    value: { query: "", filter: "all", page: 0 },
    counts: { total: jobs.length, running: jobs.length, ended: 0, orphaned: 0 },
    matchedJobs: jobs.length,
    pageCount: 1,
    output: "",
    cursor: "",
    outputStartLine: 0,
    outputTruncated: false,
    outputMore: false,
    partial: false,
  };
}

function job(id: string): Record<string, unknown> {
  return {
    id,
    command: "run",
    mode: "detach",
    status: "running",
    reason: "requested",
    startedAt: 1,
    lastOutputAt: 1,
    detached: true,
    outputBytes: 0,
    outputLines: 0,
  };
}

const cases: Array<[string, unknown]> = [
  ["empty job list", workspace([])],
  ["ordinary jobs", workspace([job("a"), job("b")])],
  ["invalid and duplicate jobs are still charged", workspace([null, job("same"), job("same")])],
  [
    "jobs clipped at maxOptionItems",
    workspace(Array.from({ length: VIEW_LIMITS.maxOptionItems + 10 }, (_, i) => job(`j${i}`))),
  ],
];

describe("SDK measureViewTree and Host sanitizeTree agree for Bash workspaces", () => {
  it.each(cases)("%s", (_label, input) => {
    const root = input as unknown as ViewBashWorkspaceNode;
    const measured = measureViewTree(root, VIEW_LIMITS);
    const host = sanitizeTree(root);
    expect("error" in host).toBe(measured.nodes > VIEW_LIMITS.maxNodes);
    expect(measured.depth).toBe(1);
  });

  it("matches the exact node budget including raw malformed entries", () => {
    const atLimit = workspace(
      Array.from({ length: VIEW_LIMITS.maxNodes - 1 }, (_, i) => job(`j${i}`)),
    ) as unknown as ViewBashWorkspaceNode;
    const overLimit = workspace([...atLimit.jobs, job("extra")]) as unknown as ViewBashWorkspaceNode;
    expect(measureViewTree(atLimit, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes);
    expect(sanitizeTree(atLimit)).toHaveProperty("root");
    expect(measureViewTree(overLimit, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes + 1);
    expect(sanitizeTree(overLimit)).toHaveProperty("error");
  });
});
