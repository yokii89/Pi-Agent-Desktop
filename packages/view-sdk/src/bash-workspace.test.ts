import { describe, expect, it, vi } from "vitest";
import {
  DesktopViewClient,
  frameBudgetViolations,
  measureViewTree,
  supportsBashWorkspace,
  supportsCapability,
  VIEW_LIMITS,
  VIEW_PROTOCOL_VERSION,
  type ViewBashJob,
  type ViewBashWorkspaceNode,
  type ViewHelloPayload,
  type ViewNode,
} from "./index.js";
import { createTestViewHost } from "./testing.js";

function job(id: string, overrides: Partial<ViewBashJob> = {}): ViewBashJob {
  return {
    id,
    label: `Job ${id}`,
    command: "pnpm build",
    mode: "finish",
    status: "running",
    reason: "requested",
    startedAt: 10,
    lastOutputAt: 12,
    detached: false,
    outputBytes: 0,
    outputLines: 0,
    ...overrides,
  };
}

function workspace(jobs = 2): ViewBashWorkspaceNode {
  const entries = Array.from({ length: jobs }, (_, index) => job(`j${index}`));
  return {
    type: "bash-workspace",
    id: "bash",
    jobs: entries,
    value: { selectedId: entries[0]?.id, query: "", filter: "all", page: 0 },
    counts: { total: entries.length, running: entries.length, ended: 0, orphaned: 0 },
    matchedJobs: entries.length,
    pageCount: 1,
    outputJobId: entries[0]?.id,
    output: "ok",
    cursor: "cursor",
    outputStartLine: 1,
    outputTruncated: false,
    outputMore: false,
    partial: false,
  };
}

describe("Bash workspace SDK contract", () => {
  it("exports the complete public job/workspace types and uses the standard value object", () => {
    const root = workspace();
    const event = { type: "change", nodeId: root.id, value: root.value } as const;
    expect(event.value).toEqual({ selectedId: "j0", query: "", filter: "all", page: 0 });
    expect(root.jobs[0]).toMatchObject({ status: "running", mode: "finish" });
  });

  it("probes the optional capability safely for absent and capable clients", () => {
    const clientWith = (capabilities?: string[]) =>
      ({
        hello: {
          protocol: VIEW_PROTOCOL_VERSION,
          placements: ["modal"],
          capabilities,
        } satisfies ViewHelloPayload,
      }) as unknown as DesktopViewClient;
    expect(supportsBashWorkspace(null)).toBe(false);
    expect(supportsBashWorkspace(undefined)).toBe(false);
    expect(supportsBashWorkspace(clientWith())).toBe(false);
    expect(supportsBashWorkspace(clientWith(["view-bash-workspace"]))).toBe(true);
    expect(supportsCapability(clientWith(["future-host-feature"]), "view-bash-workspace")).toBe(
      false,
    );
  });
});

describe("Bash workspace budget mirror", () => {
  it("charges the workspace and every capped raw job entry without increasing depth", () => {
    expect(measureViewTree(workspace(3), VIEW_LIMITS)).toEqual({
      nodes: 4,
      depth: 1,
      truncatedRows: 0,
      truncatedOptionItems: 0,
      hitNodeBudget: false,
    });
  });

  it("charges invalid and duplicate entries and reports items beyond the cap", () => {
    const limits = { ...VIEW_LIMITS, maxOptionItems: 2 };
    const root = {
      ...workspace(0),
      jobs: [null, { id: "dup" }, { id: "dup" }, { id: "outside" }],
    } as unknown as ViewNode;
    const measured = measureViewTree(root, limits);
    expect(measured.nodes).toBe(3);
    expect(measured.truncatedOptionItems).toBe(2);
    expect(
      frameBudgetViolations({
        line: JSON.stringify(root),
        root,
        limits,
        maxMessageBytes: limits.maxMessageBytes,
      }),
    ).toContainEqual({ kind: "truncated", limit: "maxOptionItems", dropped: 2 });
  });

  it("rejects at the same exact workspace node boundary as the Host", () => {
    const accepted: ViewNode = {
      type: "column",
      children: [
        {
          ...workspace(0),
          jobs: Array.from({ length: VIEW_LIMITS.maxNodes - 2 }, (_, i) => job(`j${i}`)),
        },
      ],
    };
    const rejected: ViewNode = {
      type: "column",
      children: [
        {
          ...workspace(0),
          jobs: Array.from({ length: VIEW_LIMITS.maxNodes - 1 }, (_, i) => job(`j${i}`)),
        },
      ],
    };
    expect(measureViewTree(accepted, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes);
    expect(measureViewTree(rejected, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes + 1);
    expect(
      frameBudgetViolations({
        line: JSON.stringify(rejected),
        root: rejected,
        limits: VIEW_LIMITS,
        maxMessageBytes: VIEW_LIMITS.maxMessageBytes,
      }),
    ).toContainEqual({
      kind: "rejected",
      limit: "maxNodes",
      measured: VIEW_LIMITS.maxNodes + 1,
    });
  });
});

describe("Bash workspace Host handshake and events", () => {
  it("advertises the capability and forwards complete change values and stop actions", async () => {
    const host = await createTestViewHost();
    const client = new DesktopViewClient({
      endpoint: host.endpoint,
      token: host.token,
      protocol: VIEW_PROTOCOL_VERSION,
    });
    const events: unknown[] = [];
    try {
      await client.ensureConnected();
      expect(client.hello?.capabilities).toContain("view-bash-workspace");
      expect(supportsBashWorkspace(client)).toBe(true);
      const root = workspace(1);
      const session = await client.openLive({ root }, { onEvent: (event) => events.push(event) });
      await vi.waitFor(() => expect(host.framesOfType("open")).toHaveLength(1));
      expect(host.framesOfType("open")[0]?.payload).toMatchObject({
        root: {
          type: "bash-workspace",
          outputJobId: "j0",
          output: "ok",
          cursor: "cursor",
        },
      });
      const value = { selectedId: "j0", query: "build", filter: "running" as const, page: 2 };
      host.sendTo(session.id, "event", { type: "change", nodeId: root.id, value });
      host.sendTo(session.id, "event", { type: "action", actionId: "stop-job" });
      await vi.waitFor(() =>
        expect(
          events.filter((event) => (event as { type: string }).type !== "opened"),
        ).toHaveLength(2),
      );
      expect(events.filter((event) => (event as { type: string }).type !== "opened")).toEqual([
        { type: "change", nodeId: "bash", value },
        { type: "action", actionId: "stop-job" },
      ]);
      session.close();
    } finally {
      client.dispose();
      await host.close();
    }
  });
});

describe("older Host capability compatibility", () => {
  it("treats absent capability advertisement as unsupported without breaking existing nodes", async () => {
    const host = await createTestViewHost({ legacy: true });
    const client = new DesktopViewClient({
      endpoint: host.endpoint,
      token: host.token,
      protocol: VIEW_PROTOCOL_VERSION,
    });
    try {
      await client.ensureConnected();
      expect(client.hello?.capabilities).toBeUndefined();
      expect(supportsBashWorkspace(client)).toBe(false);
      const session = await client.openLive({ root: { type: "text", content: "fallback" } });
      await vi.waitFor(() => expect(host.framesOfType("open")).toHaveLength(1));
      expect(host.framesOfType("open")[0]?.payload).toMatchObject({
        root: { type: "text", content: "fallback" },
      });
      session.close();
    } finally {
      client.dispose();
      await host.close();
    }
  });
});
