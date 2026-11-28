import { describe, expect, it } from "vitest";
import { measureViewTree } from "../../../packages/view-sdk/src/limits";
import type { ViewBashWorkspaceNode, ViewNode } from "../../shared/view";
import { VIEW_HOST_CAPABILITIES, VIEW_LIMITS } from "../../shared/view";
import { sanitizeBashWorkspace } from "./viewBashWorkspace";
import { applyPatch, sanitizeTree, truncateString } from "./viewHostProtocol";

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "job-1",
    label: "Build",
    command: "pnpm build",
    mode: "finish",
    status: "running",
    reason: "requested",
    pid: 42,
    startedAt: 10,
    lastOutputAt: 12,
    detached: false,
    outputBytes: 4,
    outputLines: 1,
    ...overrides,
  };
}

function workspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "bash-workspace",
    id: "bash",
    jobs: [job()],
    value: { selectedId: "job-1", query: "", filter: "all", page: 0 },
    counts: { total: 1, running: 1, ended: 0, orphaned: 0 },
    matchedJobs: 1,
    pageCount: 1,
    outputJobId: "job-1",
    output: "output",
    cursor: "cursor-1",
    outputStartLine: 1,
    outputTruncated: false,
    outputMore: false,
    partial: false,
    stopActionId: "stop-job",
    ...overrides,
  };
}

function sanitized(raw: unknown = workspace()): ViewBashWorkspaceNode {
  const result = sanitizeTree(raw);
  if ("error" in result) throw new Error(result.error);
  if (result.root.type !== "bash-workspace") throw new Error("Expected Bash workspace");
  return result.root;
}

describe("bash-workspace Host sanitizer", () => {
  it.each([
    { id: undefined },
    { id: " " },
    { jobs: undefined },
    { jobs: {} },
    { value: undefined },
    { value: { query: "", filter: "wrong", page: 0 } },
    { value: { query: "", filter: "all", page: 1.5 } },
  ])("degrades malformed required workspace shape: %j", (overrides) => {
    expect(
      sanitizeTree({ type: "column", children: [workspace(overrides), { type: "divider" }] }),
    ).toMatchObject({
      root: {
        children: [{ type: "unknown", originalType: "bash-workspace" }, { type: "divider" }],
      },
    });
  });

  it("validates required job fields and drops invalid and duplicate jobs", () => {
    const root = sanitized(
      workspace({
        jobs: [
          null,
          job({ id: "" }),
          job({ mode: "shell" }),
          job({ status: "done" }),
          job({ startedAt: Number.POSITIVE_INFINITY }),
          job({ outputLines: 1.5 }),
          job(),
          job({ label: "duplicate id" }),
          job({ id: "job-2", status: "exited", exitedAt: 20, exitCode: 0 }),
        ],
      }),
    );
    expect(root.jobs.map((item) => [item.id, item.label])).toEqual([
      ["job-1", "Build"],
      ["job-2", "Build"],
    ]);
    expect(root.jobs[1]?.exitCode).toBe(0);
  });

  it("keeps optional migration metadata without granting process or filesystem authority", () => {
    const root = sanitized(workspace({ jobs: [job({
      sourceToolCallId: "call-1",
      processIdentity: "win:123",
      processStartedAt: 123,
      processState: "alive",
      logSessionId: "session-1",
      logAvailable: true,
    })] }));
    expect(root.jobs[0]).toMatchObject({
      sourceToolCallId: "call-1",
      processIdentity: "win:123",
      processStartedAt: 123,
      processState: "alive",
      logSessionId: "session-1",
      logAvailable: true,
    });
  });

  it("drops malformed optional migration metadata and keeps the otherwise valid job", () => {
    const root = sanitized(workspace({ jobs: [job({
      sourceToolCallId: {},
      processIdentity: " ",
      processStartedAt: Number.NaN,
      processState: "running",
      logSessionId: 10,
      logAvailable: "yes",
    })] }));
    expect(root.jobs).toHaveLength(1);
    for (const key of ["sourceToolCallId", "processIdentity", "processStartedAt", "processState", "logSessionId", "logAvailable"]) {
      expect(root.jobs[0]).not.toHaveProperty(key);
    }
  });

  it("retains workspace query/filter/page state when jobs are empty", () => {
    const root = sanitized({
      ...workspace({ jobs: [], value: { query: "no match", filter: "orphaned", page: 0 } }),
      matchedJobs: 0,
      pageCount: 1,
    });
    expect(root.jobs).toEqual([]);
    expect(root.value).toEqual({ query: "no match", filter: "orphaned", page: 0 });
  });

  it("keeps a selected id only when it belongs to a valid sanitized job", () => {
    expect(
      sanitized(workspace({ value: { selectedId: "missing", query: "x", filter: "all", page: 0 } }))
        .value.selectedId,
    ).toBeUndefined();
    expect(
      sanitized(
        workspace({
          jobs: [job(), job({ id: "second" })],
          value: { selectedId: "second", query: "", filter: "all", page: 0 },
        }),
      ).value.selectedId,
    ).toBe("second");
  });

  it("clears output and cursor rather than guessing when output ownership is absent or invalid", () => {
    for (const outputJobId of [undefined, "missing", 42]) {
      const root = sanitized(workspace({ outputJobId }));
      expect(root.outputJobId).toBeUndefined();
      expect(root.output).toBe("");
      expect(root.cursor).toBe("");
    }
  });

  it("does not expose an exit code for an orphaned process", () => {
    const root = sanitized(workspace({ jobs: [job({ status: "orphaned", exitCode: 137 })] }));
    expect(root.jobs[0]).not.toHaveProperty("exitCode");
  });

  it("normalizes counters, page bounds, and optional ids", () => {
    const root = sanitized(
      workspace({
        counts: { total: -1, running: 2.5, ended: 3, orphaned: Number.NaN },
        matchedJobs: Number.POSITIVE_INFINITY,
        pageCount: 0,
        value: { selectedId: "job-1", query: "", filter: "all", page: 99 },
        outputStartLine: -1,
        stoppingJobId: "not-a-job",
      }),
    );
    expect(root.counts).toEqual({ total: 4, running: 1, ended: 3, orphaned: 0 });
    expect(root.matchedJobs).toBe(0);
    expect(root.pageCount).toBe(1);
    expect(root.value.page).toBe(0);
    expect(root.outputStartLine).toBe(1);
    expect(root.stoppingJobId).toBeUndefined();
  });

  it("applies the UTF-8 string limit consistently to all job and workspace strings", () => {
    const long = "界😀".repeat(20_000);
    const expected = truncateString(long);
    const root = sanitized(
      workspace({
        id: long,
        jobs: [job({ id: long, label: long, command: long, reason: long })],
        value: { selectedId: long, query: long, filter: "all", page: 0 },
        outputJobId: long,
        output: long,
        cursor: long,
        stopActionId: long,
        notice: long,
      }),
    );
    expect(Buffer.byteLength(expected, "utf8")).toBeLessThanOrEqual(VIEW_LIMITS.maxStringBytes);
    expect([
      root.id,
      root.jobs[0]?.id,
      root.jobs[0]?.label,
      root.jobs[0]?.command,
      root.jobs[0]?.reason,
      root.value.selectedId,
      root.value.query,
      root.outputJobId,
      root.output,
      root.cursor,
      root.stopActionId,
      root.notice,
    ]).toEqual(Array(12).fill(expected));
  });

  it("caps raw jobs and charges invalid/duplicate entries before filtering", () => {
    const jobs = Array.from({ length: VIEW_LIMITS.maxOptionItems }, (_, index) =>
      index % 3 === 0 ? null : job({ id: index % 3 === 1 ? "duplicate" : `j${index}` }),
    );
    expect(sanitizeBashWorkspace(workspace({ jobs }), truncateString)).toHaveProperty("jobs");
    expect(
      sanitizeTree({
        type: "column",
        children: [
          workspace({ jobs }),
          ...Array.from({ length: VIEW_LIMITS.maxNodes }, () => ({ type: "divider" })),
        ],
      }),
    ).toHaveProperty("error");
    const capped = sanitizeBashWorkspace(
      workspace({ jobs: [...jobs, job({ id: "outside-cap" })] }),
      truncateString,
    );
    expect(capped.type).toBe("bash-workspace");
    if (capped.type !== "bash-workspace") return;
    expect(capped.jobs.some((item) => item.id === "outside-cap")).toBe(false);
  });

  it("charges raw entries to the exact node budget, including malformed and duplicate jobs", () => {
    const atLimit = {
      type: "column",
      children: [
        workspace({
          jobs: Array.from({ length: VIEW_LIMITS.maxNodes - 2 }, (_, index) =>
            index % 2 === 0 ? job({ id: `j${index}` }) : null,
          ),
        }),
      ],
    };
    const overLimit = {
      type: "column",
      children: [
        workspace({
          jobs: Array.from({ length: VIEW_LIMITS.maxNodes - 1 }, (_, index) =>
            index % 2 === 0 ? job({ id: `j${index}` }) : null,
          ),
        }),
      ],
    };
    expect(measureViewTree(atLimit as ViewNode, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes);
    expect(sanitizeTree(atLimit)).toHaveProperty("root");
    expect(measureViewTree(overLimit as ViewNode, VIEW_LIMITS).nodes).toBe(
      VIEW_LIMITS.maxNodes + 1,
    );
    expect(sanitizeTree(overLimit)).toHaveProperty("error");
  });

  it("advertises the optional capability", () => {
    expect(VIEW_HOST_CAPABILITIES).toContain("view-bash-workspace");
  });
});

describe("bash-workspace IDs and patch boundaries", () => {
  it.each<ViewNode>([
    { type: "input", id: "bash" },
    {
      type: "bash-workspace",
      id: "bash",
      jobs: [],
      value: { query: "", filter: "all", page: 0 },
      counts: { total: 0, running: 0, ended: 0, orphaned: 0 },
      matchedJobs: 0,
      pageCount: 1,
      output: "",
      cursor: "",
      outputStartLine: 0,
      outputTruncated: false,
      outputMore: false,
      partial: false,
    },
  ])("degrades a later duplicate control id: $type", (node) => {
    const children =
      node.type === "bash-workspace"
        ? [{ type: "input", id: "bash" }, workspace()]
        : [workspace(), node];
    expect(sanitizeTree({ type: "column", children })).toMatchObject({
      root: {
        children: [
          { type: children[0]?.type },
          { type: "unknown", originalType: children[1]?.type },
        ],
      },
    });
  });

  it("treats the workspace as an atomic patch boundary", () => {
    const root = sanitized();
    expect(
      applyPatch(root, [{ path: [0], node: { type: "text", content: "bad" } }]),
    ).toHaveProperty("error");
    const replacement = sanitized(workspace({ jobs: [job({ id: "new" })], outputJobId: "new" }));
    expect(applyPatch(root, [{ path: [], node: replacement }])).toEqual({ root: replacement });
    expect(root.jobs[0]?.id).toBe("job-1");
  });
});
