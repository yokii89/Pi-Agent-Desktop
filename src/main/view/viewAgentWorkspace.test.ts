import { describe, expect, it } from "vitest";
import type { ViewAgentWorkspaceNode, ViewNode } from "../../shared/view";
import { VIEW_HOST_CAPABILITIES, VIEW_LIMITS } from "../../shared/view";
import { sanitizeAgentWorkspace } from "./viewAgentWorkspace";
import { applyPatch, sanitizeTree, truncateString } from "./viewHostProtocol";

function agent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "main", label: "Main", description: "Coordinate", state: "running", ...overrides };
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "e1", kind: "assistant", content: "Working", ...overrides };
}

function workspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "agent-workspace",
    id: "agents",
    agents: [agent()],
    value: "main",
    streamAgentId: "main",
    events: [event()],
    ...overrides,
  };
}

function sanitized(raw: unknown = workspace()): ViewAgentWorkspaceNode {
  const result = sanitizeTree(raw);
  if ("error" in result) throw new Error(result.error);
  if (result.root.type !== "agent-workspace") throw new Error("Expected workspace");
  return result.root;
}

describe("agent-workspace sanitizer", () => {
  it("keeps the semantic contract and drops executable/layout/path fields at every level", () => {
    const root = sanitized(
      workspace({
        agents: [agent({ kind: "main", stateLabel: "Active", meta: ["18k", "3 tools"], x: 12 })],
        events: [
          event({
            title: "Read",
            timestamp: 1_700_000_000_000,
            toolName: "read",
            input: "a plain string",
            state: "completed",
            html: "<script>bad()</script>",
            path: "/secret",
          }),
        ],
        emptyText: "No history",
        notice: "Recent window",
        loadEarlierActionId: "earlier",
        css: "display:none",
        onChange: () => {},
      }),
    );
    expect(root).toEqual({
      type: "agent-workspace",
      id: "agents",
      agents: [
        {
          id: "main",
          label: "Main",
          description: "Coordinate",
          state: "running",
          kind: "main",
          stateLabel: "Active",
          meta: ["18k", "3 tools"],
        },
      ],
      value: "main",
      streamAgentId: "main",
      events: [
        {
          id: "e1",
          kind: "assistant",
          content: "Working",
          title: "Read",
          timestamp: 1_700_000_000_000,
          toolName: "read",
          input: "a plain string",
          state: "completed",
        },
      ],
      emptyText: "No history",
      notice: "Recent window",
      loadEarlierActionId: "earlier",
    });
  });

  it.each([
    { id: undefined },
    { id: "" },
    { id: "   " },
    { id: 1 },
    { agents: undefined },
    { agents: {} },
    { events: undefined },
    { events: "bad" },
  ])("degrades a malformed workspace without removing its siblings: %j", (overrides) => {
    const result = sanitizeTree({
      type: "column",
      children: [workspace(overrides), { type: "input", id: "tail", value: "ok" }],
    });
    expect(result).toMatchObject({
      root: {
        children: [
          { type: "unknown", originalType: "agent-workspace" },
          { type: "input", id: "tail", value: "ok" },
        ],
      },
    });
  });

  it("accepts an empty graph without fabricating a root or selecting the first Agent", () => {
    const root = sanitized(workspace({ agents: [], events: [], value: undefined }));
    expect(root.agents).toEqual([]);
    expect(root.events).toEqual([]);
    expect(root.value).toBeUndefined();
    expect(root.streamAgentId).toBeUndefined();
    expect(sanitized(workspace({ value: undefined })).value).toBeUndefined();
  });

  it("validates required Agent fields, enums and duplicates after valid entries", () => {
    const root = sanitized(
      workspace({
        agents: [
          null,
          [],
          agent({ id: 1 }),
          agent({ id: "" }),
          agent({ label: undefined }),
          agent({ description: null }),
          agent({ state: "finished" }),
          agent({ kind: "root", stateLabel: 2, meta: "bad" }),
          agent({ label: "duplicate" }),
          agent({ id: "other", state: "idle", kind: "agent" }),
        ],
      }),
    );
    expect(root.agents).toEqual([
      { id: "main", label: "Main", description: "Coordinate", state: "running" },
      { id: "other", label: "Main", description: "Coordinate", state: "idle", kind: "agent" },
    ]);
  });

  it.each(["idle", "queued", "running", "completed", "stopped", "error"])(
    "accepts Agent and event state %s",
    (state) => {
      const root = sanitized(workspace({ agents: [agent({ state })], events: [event({ state })] }));
      expect(root.agents[0]?.state).toBe(state);
      expect(root.events[0]?.state).toBe(state);
    },
  );

  it.each(["user", "assistant", "thinking", "tool", "notice", "error"])(
    "accepts event kind %s",
    (kind) =>
      expect(sanitized(workspace({ events: [event({ kind })] })).events[0]?.kind).toBe(kind),
  );

  it("validates required event fields and deduplicates the first valid event", () => {
    const root = sanitized(
      workspace({
        events: [
          null,
          event({ id: " " }),
          event({ kind: "spawn" }),
          event({ content: 5 }),
          event(),
          event({ content: "duplicate" }),
          event({ id: "e2", content: "" }),
        ],
      }),
    );
    expect(root.events.map((item) => [item.id, item.content])).toEqual([
      ["e1", "Working"],
      ["e2", ""],
    ]);
  });

  it("drops invalid optional fields and nonfinite timestamps", () => {
    for (const timestamp of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "12",
    ]) {
      const root = sanitized(
        workspace({
          emptyText: 1,
          notice: {},
          loadEarlierActionId: " ",
          events: [event({ timestamp, title: 2, toolName: {}, input: [], state: "done" })],
        }),
      );
      expect(root.events[0]).toEqual({ id: "e1", kind: "assistant", content: "Working" });
      expect(root.emptyText).toBeUndefined();
      expect(root.notice).toBeUndefined();
      expect(root.loadEarlierActionId).toBeUndefined();
    }
    expect(sanitized(workspace({ events: [event({ timestamp: 0 })] })).events[0]?.timestamp).toBe(
      0,
    );
  });

  it("limits meta to the first eight entries and keeps only strings", () => {
    const root = sanitized(
      workspace({ agents: [agent({ meta: ["a", 1, null, "b", "c", "d", "e", "f", "g"] })] }),
    );
    expect(root.agents[0]?.meta).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("truncates every string field with the existing UTF-8 rule before identity matching", () => {
    const long = "界😀".repeat(20_000);
    const expected = truncateString(long);
    const root = sanitized(
      workspace({
        id: long,
        agents: [
          agent({
            id: long,
            parentId: long,
            label: long,
            description: long,
            stateLabel: long,
            meta: [long],
          }),
        ],
        value: long,
        streamAgentId: long,
        events: [event({ id: long, title: long, content: long, toolName: long, input: long })],
        emptyText: long,
        notice: long,
        loadEarlierActionId: long,
      }),
    );
    expect(Buffer.byteLength(expected)).toBeLessThanOrEqual(VIEW_LIMITS.maxStringBytes);
    for (const value of [
      root.id,
      root.value,
      root.streamAgentId,
      root.emptyText,
      root.notice,
      root.loadEarlierActionId,
      root.agents[0]?.id,
      root.agents[0]?.label,
      root.agents[0]?.description,
      root.agents[0]?.stateLabel,
      root.agents[0]?.meta?.[0],
      root.events[0]?.id,
      root.events[0]?.title,
      root.events[0]?.content,
      root.events[0]?.toolName,
      root.events[0]?.input,
    ]) {
      expect(value).toBe(expected);
    }
    expect(root.agents[0]?.parentId).toBeUndefined();
  });

  it("deduplicates truncated Agent/event IDs and resolves a truncated parent reference", () => {
    const prefix = "x".repeat(VIEW_LIMITS.maxStringBytes);
    const first = `${prefix}a`;
    const second = `${prefix}b`;
    const root = sanitized(
      workspace({
        agents: [
          agent({ id: first }),
          agent({ id: second }),
          agent({ id: "child", parentId: first }),
        ],
        streamAgentId: first,
        events: [event({ id: first }), event({ id: second })],
      }),
    );
    expect(root.agents).toHaveLength(2);
    expect(root.agents[1]?.parentId).toBe(truncateString(first));
    expect(root.events).toHaveLength(1);
  });

  it("keeps a different valid selection and stream owner so the Renderer can hide stale content", () => {
    const root = sanitized(
      workspace({ agents: [agent(), agent({ id: "child" })], value: "child" }),
    );
    expect(root.value).toBe("child");
    expect(root.streamAgentId).toBe("main");
    expect(root.events).toHaveLength(1);
    expect(sanitized(workspace({ value: "gone" })).value).toBeUndefined();
  });

  it.each([undefined, "gone", 12, ""])(
    "clears an event stream with invalid owner %s",
    (streamAgentId) => {
      const root = sanitized(workspace({ streamAgentId }));
      expect(root.streamAgentId).toBeUndefined();
      expect(root.events).toEqual([]);
    },
  );

  it("removes invalid/self parents and deterministically cuts longer parent cycles", () => {
    const raw = workspace({
      agents: [
        agent({ id: "tail", parentId: "a" }),
        agent({ id: "a", parentId: "b" }),
        agent({ id: "b", parentId: "c" }),
        agent({ id: "c", parentId: "a" }),
        agent({ id: "self", parentId: "self" }),
        agent({ id: "orphan", parentId: "missing" }),
        agent({ id: "__proto__", parentId: "constructor" }),
        agent({ id: "constructor", parentId: "__proto__" }),
      ],
    });
    const root = sanitized(raw);
    expect(root).toEqual(sanitized(raw));
    expect(root.agents.map((item) => item.parentId)).toEqual([
      "a",
      undefined,
      "c",
      "a",
      undefined,
      undefined,
      undefined,
      "__proto__",
    ]);
    const byId = new Map(root.agents.map((item) => [item.id, item]));
    for (const item of root.agents) {
      const seen = new Set<string>();
      let cursor: typeof item | undefined = item;
      while (cursor) {
        expect(seen.has(cursor.id)).toBe(false);
        seen.add(cursor.id);
        cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
      }
    }
    expect((raw.agents as Array<Record<string, unknown>>)[1]?.parentId).toBe("b");
  });

  it("ignores cyclic non-protocol objects and handles the longest accepted parent chain iteratively", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.parentId = cyclic;
    const root = sanitized(workspace({ agents: [agent({ parentId: cyclic, meta: [cyclic] })] }));
    expect(root.agents[0]?.parentId).toBeUndefined();
    const agents = Array.from({ length: VIEW_LIMITS.maxNodes - 1 }, (_, i) =>
      agent({ id: `${i}`, parentId: `${i + 1}` }),
    );
    expect(sanitized(workspace({ agents, events: [] })).agents).toHaveLength(
      VIEW_LIMITS.maxNodes - 1,
    );
  });

  it("caps agents and events independently before validation (the caller charges this prefix)", () => {
    const raw = workspace({
      agents: Array.from({ length: VIEW_LIMITS.maxOptionItems + 3 }, (_, i) =>
        agent({ id: `a${i}` }),
      ),
      streamAgentId: "a0",
      events: Array.from({ length: VIEW_LIMITS.maxOptionItems + 5 }, (_, i) =>
        event({ id: `e${i}` }),
      ),
    });
    const node = sanitizeAgentWorkspace(raw, truncateString);
    if (node.type !== "agent-workspace") throw new Error("Expected workspace");
    expect(node.agents).toHaveLength(VIEW_LIMITS.maxOptionItems);
    expect(node.events).toHaveLength(VIEW_LIMITS.maxOptionItems);
    expect(node.agents.at(-1)?.id).toBe(`a${VIEW_LIMITS.maxOptionItems - 1}`);
    expect(sanitizeTree(raw)).toHaveProperty("error");
  });

  it("advertises the optional capability", () => {
    expect(VIEW_HOST_CAPABILITIES).toContain("view-agent-workspace");
  });
});

describe("workspace control IDs and patch boundaries", () => {
  it.each<ViewNode>([
    { type: "input", id: "agents" },
    { type: "select", id: "agents", options: [] },
    { type: "checkbox", id: "agents", label: "Check" },
    { type: "list", id: "agents", items: [] },
    { type: "list", id: "agents", items: [], readonly: true },
    { type: "button", id: "agents", label: "Go" },
    { type: "tabs", id: "agents", tabs: [] },
    { type: "agent-workspace", id: "agents", agents: [], events: [] },
  ])("degrades later duplicate control IDs in either order: $type", (control) => {
    for (const children of [
      [control, workspace()],
      [workspace(), control],
    ]) {
      const result = sanitizeTree({ type: "column", children });
      expect(result).toMatchObject({
        root: {
          children: [
            { type: children[0].type },
            { type: "unknown", originalType: children[1].type },
          ],
        },
      });
    }
  });

  it("checks all tabs and keeps unrelated controls and display-only tables", () => {
    const result = sanitizeTree({
      type: "tabs",
      id: "tabs",
      tabs: [
        { id: "one", label: "One", children: [workspace()] },
        {
          id: "two",
          label: "Two",
          children: [
            workspace(),
            { type: "input", id: "unique", value: "safe" },
            { type: "table", id: "agents", columns: [{ key: "a", label: "A" }], rows: [] },
          ],
        },
      ],
    });
    expect(result).toMatchObject({
      root: {
        tabs: [
          { children: [{ type: "agent-workspace" }] },
          { children: [{ type: "unknown" }, { type: "input", value: "safe" }, { type: "table" }] },
        ],
      },
    });
  });

  it("replaces a workspace as a whole and never traverses agents/events as View children", () => {
    const root = sanitized();
    expect(applyPatch(root, [{ path: [0], node: { type: "text", content: "no" } }])).toHaveProperty(
      "error",
    );
    const next = sanitized(workspace({ value: undefined, agents: [], events: [] }));
    const patched = applyPatch(root, [{ path: [], node: next }]);
    expect(patched).toEqual({ root: next });
    expect(root.agents).toHaveLength(1);
  });
});
