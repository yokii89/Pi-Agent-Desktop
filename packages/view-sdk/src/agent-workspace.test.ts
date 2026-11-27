import { describe, expect, it, vi } from "vitest";
import {
  DesktopViewClient,
  frameBudgetViolations,
  measureViewTree,
  supportsAgentWorkspace,
  supportsCapability,
  VIEW_LIMITS,
  VIEW_PROTOCOL_VERSION,
  VIEW_SESSION_OWNER_ENTRY_TYPE,
  type ViewAgentEvent,
  type ViewAgentNode,
  type ViewAgentState,
  type ViewAgentWorkspaceNode,
  type ViewNode,
  type ViewSessionEvent,
  type ViewSessionOwner,
} from "./index.js";
import { createTestViewHost } from "./testing.js";

function workspace(agents = 2, events = 3): ViewAgentWorkspaceNode {
  const state: ViewAgentState = "running";
  const graph: ViewAgentNode[] = Array.from({ length: agents }, (_, i) => ({
    id: `a${i}`,
    parentId: i > 0 ? "a0" : undefined,
    label: `Agent ${i}`,
    description: "Task",
    state,
    kind: i > 0 ? "agent" : "main",
  }));
  const stream: ViewAgentEvent[] = Array.from({ length: events }, (_, i) => ({
    id: `e${i}`,
    kind: "assistant",
    content: `Update ${i}`,
  }));
  return {
    type: "agent-workspace",
    id: "workspace",
    agents: graph,
    value: "a0",
    streamAgentId: "a0",
    events: stream,
  };
}

describe("public workspace contract", () => {
  it("exports the JSONL owner marker separately from View nodes and wire messages", () => {
    const owner: ViewSessionOwner = { panelId: "agent-panel", rootSessionId: "root-session" };
    expect(VIEW_SESSION_OWNER_ENTRY_TYPE).toBe("pidesk:view-owner");
    expect(
      JSON.parse(
        JSON.stringify({ type: "custom", customType: VIEW_SESSION_OWNER_ENTRY_TYPE, data: owner }),
      ),
    ).toEqual({
      type: "custom",
      customType: "pidesk:view-owner",
      data: owner,
    });
  });

  it("treats an unconnected or absent client as unsupported", () => {
    const client = new DesktopViewClient({
      endpoint: "http://127.0.0.1:1",
      token: "test",
      protocol: VIEW_PROTOCOL_VERSION,
    });
    try {
      expect(supportsAgentWorkspace(null)).toBe(false);
      expect(supportsAgentWorkspace(undefined)).toBe(false);
      expect(supportsAgentWorkspace(client)).toBe(false);
      expect(client.hasCapability("view-agent-workspace")).toBe(false);
    } finally {
      client.dispose();
    }
  });
});

describe("workspace outbound budget", () => {
  it("charges the workspace, each Agent, and each event without increasing View depth", () => {
    const measured = measureViewTree(workspace(), VIEW_LIMITS);
    expect(measured).toEqual({
      nodes: 6,
      depth: 1,
      truncatedRows: 0,
      truncatedOptionItems: 0,
      hitNodeBudget: false,
    });
  });

  it("caps the two arrays separately and reports advisory truncation", () => {
    const limits = { ...VIEW_LIMITS, maxOptionItems: 2 };
    const root = workspace(4, 5);
    const measured = measureViewTree(root, limits);
    expect(measured.nodes).toBe(5);
    expect(measured.truncatedOptionItems).toBe(5);
    expect(
      frameBudgetViolations({
        line: JSON.stringify(root),
        root,
        limits,
        maxMessageBytes: limits.maxMessageBytes,
      }),
    ).toEqual([{ kind: "truncated", limit: "maxOptionItems", dropped: 5 }]);
  });

  it("counts invalid and duplicate entries even when there is no valid stream owner", () => {
    const root = {
      ...workspace(0, 0),
      agents: [null, { id: "same" }, { id: "same" }],
      events: [null, 1],
    } as unknown as ViewNode;
    expect(measureViewTree(root, VIEW_LIMITS).nodes).toBe(6);
  });

  it("accepts the exact node limit and stops at the first over-budget event", () => {
    expect(measureViewTree(workspace(1, VIEW_LIMITS.maxNodes - 2), VIEW_LIMITS).nodes).toBe(
      VIEW_LIMITS.maxNodes,
    );
    const root = workspace(1, VIEW_LIMITS.maxNodes + 50);
    expect(measureViewTree(root, VIEW_LIMITS).nodes).toBe(VIEW_LIMITS.maxNodes + 1);
    expect(
      frameBudgetViolations({
        line: JSON.stringify(root),
        root,
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

describe("workspace capability and existing socket lifecycle", () => {
  it("negotiates the capability, routes ordinary selection/actions, and closes the View", async () => {
    const host = await createTestViewHost();
    const client = new DesktopViewClient({
      endpoint: host.endpoint,
      token: host.token,
      protocol: VIEW_PROTOCOL_VERSION,
    });
    const received: ViewSessionEvent[] = [];
    try {
      await client.ensureConnected();
      expect(supportsAgentWorkspace(client)).toBe(true);
      expect(supportsCapability(client, "view-agent-workspace")).toBe(true);
      expect(client.hasCapability("view-agent-workspace")).toBe(true);
      const root = workspace();
      const session = await client.openLive(
        { placement: "panel", root },
        {
          onEvent: (event) => {
            received.push(event);
          },
        },
      );
      await vi.waitFor(() => expect(session.placement).toBe("panel"));
      host.sendTo(session.id, "event", { type: "change", nodeId: root.id, value: "a1" });
      host.sendTo(session.id, "event", {
        type: "action",
        actionId: "earlier",
        values: { [root.id]: "a1" },
      });
      await vi.waitFor(() =>
        expect(
          received.filter((event) => event.type === "change" || event.type === "action"),
        ).toEqual([
          { type: "change", nodeId: root.id, value: "a1" },
          { type: "action", actionId: "earlier", values: { [root.id]: "a1" } },
        ]),
      );
      session.update({ root: { ...root, value: "a1", streamAgentId: "a1" } });
      await vi.waitFor(() => expect(host.framesOfType("update")).toHaveLength(1));
      session.close();
      await session.closed;
      await vi.waitFor(() => expect(host.framesOfType("close")).toHaveLength(1));
    } finally {
      client.dispose();
      await host.close();
    }
  });

  it("allows a new SDK to choose existing nodes on an old Host without capabilities", async () => {
    const host = await createTestViewHost({ legacy: true });
    const client = new DesktopViewClient({
      endpoint: host.endpoint,
      token: host.token,
      protocol: VIEW_PROTOCOL_VERSION,
    });
    try {
      await client.ensureConnected();
      expect(supportsAgentWorkspace(client)).toBe(false);
      const root: ViewNode = supportsAgentWorkspace(client)
        ? workspace()
        : { type: "list", id: "workspace", items: [{ value: "a0", label: "Main" }] };
      const session = await client.openLive({ root });
      await vi.waitFor(() => expect(session.placement).toBe("modal"));
      expect(host.framesOfType("open")[0]?.payload).toMatchObject({ root: { type: "list" } });
      session.close();
    } finally {
      client.dispose();
      await host.close();
    }
  });

  it("keeps existing-node clients working against a capable Host", async () => {
    const host = await createTestViewHost();
    const client = new DesktopViewClient({
      endpoint: host.endpoint,
      token: host.token,
      protocol: VIEW_PROTOCOL_VERSION,
    });
    try {
      const session = await client.openLive({
        root: { type: "input", id: "legacy", value: "unchanged" },
      });
      await vi.waitFor(() => expect(session.placement).toBe("modal"));
      expect(host.framesOfType("open")[0]?.payload).toMatchObject({
        root: { type: "input", value: "unchanged" },
      });
      session.close();
    } finally {
      client.dispose();
      await host.close();
    }
  });

  it("rejects an over-budget workspace before open or update is sent", async () => {
    const host = await createTestViewHost();
    const client = new DesktopViewClient({
      endpoint: host.endpoint,
      token: host.token,
      protocol: VIEW_PROTOCOL_VERSION,
    });
    try {
      await expect(
        client.openLive({ root: workspace(1, VIEW_LIMITS.maxNodes) }),
      ).rejects.toMatchObject({ code: "limit" });
      expect(host.framesOfType("open")).toHaveLength(0);
      const session = await client.openLive({ root: workspace() });
      await vi.waitFor(() => expect(session.placement).toBe("modal"));
      expect(() => session.update({ root: workspace(1, VIEW_LIMITS.maxNodes) })).toThrow(
        /maxNodes/,
      );
      expect(host.framesOfType("update")).toHaveLength(0);
      session.close();
    } finally {
      client.dispose();
      await host.close();
    }
  });
});
