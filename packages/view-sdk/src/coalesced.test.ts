/**
 * `session.coalesced()` frame contract (docs/design/20 §9).
 *
 * The bare scheduler is covered in `frame-scheduler.test.ts`; this file pins
 * what a coalesced *session* write actually puts on the wire — especially
 * `meta.actions`, which is how a live panel updates its action-bar `disabled`
 * state without a side-channel `setInterval`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopViewClient } from "./client.js";
import { createTestViewHost, type TestViewHost } from "./testing.js";
import { VIEW_LIMITS, VIEW_PROTOCOL_VERSION, type ViewAction, type ViewNode } from "./types.js";

let host: TestViewHost | null = null;
let client: DesktopViewClient | null = null;

afterEach(async () => {
  client?.dispose();
  client = null;
  await host?.close();
  host = null;
});

async function openLiveSession(): Promise<{
  host: TestViewHost;
  client: DesktopViewClient;
  session: Awaited<ReturnType<DesktopViewClient["openLive"]>>;
}> {
  host = await createTestViewHost();
  client = new DesktopViewClient(
    { endpoint: host.endpoint, token: "test-token", protocol: VIEW_PROTOCOL_VERSION },
    { connectTimeoutMs: 1000, helloTimeoutMs: 500 },
  );
  const session = await client.openLive({
    root: { type: "text", content: "first" },
    actions: [{ id: "connect", label: "连接", kind: "event" }],
  });
  return { host, client, session };
}

function tree(label: string): ViewNode {
  return { type: "text", content: label };
}

function actions(disabled: boolean): ViewAction[] {
  return [
    { id: "connect", label: "连接", kind: "event", disabled },
    { id: "disconnect", label: "断开", kind: "event", disabled: !disabled },
  ];
}

async function settle(ms = 40): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("coalesced().set() frame meta", () => {
  it.each(["update", "patch"] as const)(
    "does not replay the initial or last coalesced tree after a direct %s",
    async (method) => {
      const { host: h, session } = await openLiveSession();
      const writeDirect = (label: string): void => {
        if (method === "update") session.update(tree(label));
        else expect(session.patch({ ops: [{ path: [], node: tree(label) }] })).toBe(true);
      };

      writeDirect("before writer");
      const writer = session.coalesced();
      await writer.flushNow();
      writer.set(tree("coalesced"));
      await writer.flush();
      writeDirect("after writer");
      await writer.flushNow();
      await settle();

      expect(h.framesOfType("update").map((frame) => frame.payload)).toEqual(
        method === "update"
          ? [
              { root: tree("before writer") },
              {},
              { root: tree("coalesced") },
              { root: tree("after writer") },
              {},
            ]
          : [{}, { root: tree("coalesced") }, {}],
      );
      expect(writer.lastError).toBeNull();
    },
  );

  it("keeps disjoint patches by sending the full latest tree, then resumes single patches", async () => {
    const { host: h, session } = await openLiveSession();
    const pair = (a: string, b: string): ViewNode => ({
      type: "column",
      children: [tree(a), tree(b)],
    });
    session.update(pair("A=0", "B=0"));
    await settle();
    h.reset();
    const writer = session.coalesced();
    writer.set(pair("A=1", "B=0"), [{ path: [0], node: tree("A=1") }]);
    writer.set(pair("A=1", "B=1"), [{ path: [1], node: tree("B=1") }]);
    await writer.flush();
    await settle();
    expect(h.framesOfType("patch")).toHaveLength(0);
    expect(h.framesOfType("update").map((frame) => frame.payload)).toEqual([
      { root: pair("A=1", "B=1") },
    ]);

    h.reset();
    writer.set(pair("A=2", "B=1"), [{ path: [0], node: tree("A=2") }]);
    await writer.flush();
    await settle();
    expect(h.framesOfType("patch").map((frame) => frame.payload)).toEqual([
      { ops: [{ path: [0], node: tree("A=2") }] },
    ]);
    expect(h.framesOfType("update")).toHaveLength(0);
  });

  it("preserves unsent meta field by field and does not replay it after delivery", async () => {
    const { host: h, session } = await openLiveSession();
    const writer = session.coalesced();
    writer.set(tree("a"), undefined, {
      actions: actions(true),
      title: "first",
      placementHint: { panelBadge: { tone: "muted", count: 1 }, side: "aboveEditor" },
    });
    writer.set(tree("b"), undefined, {
      title: "last",
      placementHint: { panelBadge: { tone: "attention", count: 2 } },
    });
    writer.set(tree("c"), undefined, { actions: undefined });
    await writer.flush();
    await settle();
    expect(h.framesOfType("update")[0].payload).toEqual({
      root: tree("c"),
      actions: actions(true),
      title: "last",
      placementHint: { panelBadge: { tone: "attention", count: 2 } },
    });
    h.reset();
    await writer.flushNow();
    await settle();
    expect(h.framesOfType("update")[0].payload).toEqual({});

    h.reset();
    writer.set(tree("d"), undefined, { actions: actions(false) });
    writer.set(tree("e"), undefined, { actions: [], title: "" });
    await writer.flush();
    await settle();
    expect(h.framesOfType("update")[0].payload).toEqual({
      root: tree("e"),
      actions: [],
      title: "",
    });
  });

  it.each(["nodes", "bytes"])(
    "reports local %s overflow once and recovers on new state",
    async (budget) => {
      const { host: h, session } = await openLiveSession();
      const onError = vi.fn();
      const update = vi.spyOn(session, "update");
      const writer = session.coalesced({ intervalMs: 10, onError });
      const invalid: ViewNode =
        budget === "nodes"
          ? {
              type: "column",
              children: Array.from({ length: VIEW_LIMITS.maxNodes }, () => tree("x")),
            }
          : tree("x".repeat(VIEW_LIMITS.maxMessageBytes));
      writer.set(invalid, undefined, { actions: actions(true) });
      await writer.flush();
      await settle(60);
      expect(writer.lastError).toMatchObject({ code: "limit" });
      expect(onError).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledOnce();
      expect(h.framesOfType("update")).toHaveLength(0);
      await writer.flush();
      expect(update).toHaveBeenCalledOnce();

      writer.set(tree("valid"), [{ path: [], node: tree("valid") }]);
      await writer.flush();
      await settle();
      expect(writer.lastError).toBeNull();
      expect(h.framesOfType("patch")).toHaveLength(0);
      expect(h.framesOfType("update")[0].payload).toEqual({
        root: tree("valid"),
        actions: actions(true),
      });
    },
  );

  it("retries temporary failures with complete state and preserves meta", async () => {
    const { host: h, session } = await openLiveSession();
    const update = session.update.bind(session);
    vi.spyOn(session, "update")
      .mockImplementationOnce(() => {
        throw new Error("temporary");
      })
      .mockImplementation(update);
    const onError = vi.fn();
    const writer = session.coalesced({ intervalMs: 10, onError });
    writer.set(tree("retry"), undefined, { title: "pending" });
    await writer.flush();
    expect(writer.lastError).toBeInstanceOf(Error);
    await vi.waitFor(() => expect(h.framesOfType("update")).toHaveLength(1));
    expect(h.framesOfType("update")[0].payload).toEqual({ root: tree("retry"), title: "pending" });
    expect(writer.lastError).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("pauses serialization failures and accepts new state supplied from onError", async () => {
    const { host: h, session } = await openLiveSession();
    const invalid: ViewNode = { type: "column", children: [] };
    if (invalid.type !== "column") throw new Error("Expected container");
    invalid.children.push(invalid);
    const onError = vi.fn(() => writer.set(tree("recovered")));
    const writer = session.coalesced({ intervalMs: 10, onError });
    writer.set(invalid, undefined, { title: "preserved" });
    await writer.flush();
    expect(writer.lastError).toBeInstanceOf(TypeError);
    await vi.waitFor(() => expect(h.framesOfType("update")).toHaveLength(1));
    expect(h.framesOfType("update")[0].payload).toEqual({
      root: tree("recovered"),
      title: "preserved",
    });
    expect(writer.lastError).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("pauses an over-deep tree that overflows serialization", async () => {
    const { session } = await openLiveSession();
    let invalid: ViewNode = tree("deep");
    for (let depth = 0; depth < 20000; depth += 1)
      invalid = { type: "column", children: [invalid] };
    const onError = vi.fn();
    const update = vi.spyOn(session, "update");
    const writer = session.coalesced({ intervalMs: 10, onError });
    writer.set(invalid);
    await writer.flush();
    await settle(50);
    expect(writer.lastError).toBeInstanceOf(RangeError);
    expect(update).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not resend a non-idempotent patch on flushNow and stops after close", async () => {
    const { host: h, session } = await openLiveSession();
    const writer = session.coalesced({ intervalMs: 10 });
    writer.set(tree("latest"), [{ path: [], node: tree("latest") }]);
    await writer.flush();
    await writer.flushNow();
    await settle();
    expect(h.framesOfType("patch")).toHaveLength(1);
    expect(h.framesOfType("update")[0].payload).toEqual({});
    session.close();
    await settle();
    h.reset();
    writer.set(tree("closed"));
    await writer.flushNow();
    await settle();
    expect(h.framesOfType("update")).toHaveLength(0);
  });

  it("ships actions on the whole-tree update when set() has no ops", async () => {
    const { host: h, session } = await openLiveSession();
    const writer = session.coalesced({ intervalMs: 10 });
    h.reset();

    writer.set(tree("tick"), undefined, { actions: actions(false) });
    await writer.flush();
    await settle();

    const updates = h.framesOfType("update");
    expect(updates).toHaveLength(1);
    const payload = updates[0].payload as { root?: ViewNode; actions?: ViewAction[] };
    expect(payload.root).toEqual(tree("tick"));
    expect(payload.actions).toEqual(actions(false));
    expect(h.framesOfType("patch")).toHaveLength(0);
  });

  it("ships actions on the patch frame when the Host advertises view-patch", async () => {
    const { host: h, session } = await openLiveSession();
    // current test Host advertises view-patch (VIEW_HOST_CAPABILITIES)
    expect(session.hello?.capabilities).toContain("view-patch");
    const writer = session.coalesced({ intervalMs: 10 });
    h.reset();

    writer.set(tree("tick"), [{ path: [], node: tree("tick") }], {
      actions: actions(true),
      title: "Telegram bridge",
    });
    await writer.flush();
    await settle();

    const patches = h.framesOfType("patch");
    expect(patches).toHaveLength(1);
    const payload = patches[0].payload as {
      ops: unknown[];
      actions?: ViewAction[];
      title?: string;
    };
    expect(payload.ops).toHaveLength(1);
    expect(payload.actions).toEqual(actions(true));
    expect(payload.title).toBe("Telegram bridge");
    expect(h.framesOfType("update")).toHaveLength(0);
  });

  it("falls back to update carrying the same meta on a legacy Host without view-patch", async () => {
    host = await createTestViewHost({ legacy: true });
    client = new DesktopViewClient(
      { endpoint: host.endpoint, token: "test-token", protocol: VIEW_PROTOCOL_VERSION },
      { connectTimeoutMs: 1000, helloTimeoutMs: 500 },
    );
    const session = await client.openLive({ root: tree("first") });
    expect(session.hello?.capabilities).toBeUndefined();

    const writer = session.coalesced({ intervalMs: 10 });
    host.reset();
    writer.set(tree("tick"), [{ path: [], node: tree("tick") }], { actions: actions(true) });
    await writer.flush();
    await settle();

    expect(host.framesOfType("patch")).toHaveLength(0);
    const updates = host.framesOfType("update");
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as { actions?: ViewAction[] }).actions).toEqual(actions(true));
  });

  it("omits meta fields the caller did not pass (Host keeps its current value)", async () => {
    const { host: h, session } = await openLiveSession();
    const writer = session.coalesced({ intervalMs: 10 });
    h.reset();

    writer.set(tree("quiet"));
    await writer.flush();
    await settle();

    const payload = h.framesOfType("update")[0].payload as Record<string, unknown>;
    expect(payload.root).toEqual(tree("quiet"));
    expect("actions" in payload).toBe(false);
    expect("title" in payload).toBe(false);
  });

  it("sends actions: [] as an explicit clear (not an omit)", async () => {
    const { host: h, session } = await openLiveSession();
    const writer = session.coalesced({ intervalMs: 10 });
    h.reset();

    writer.set(tree("cleared"), undefined, { actions: [] });
    await writer.flush();
    await settle();

    const payload = h.framesOfType("update")[0].payload as { actions?: ViewAction[] };
    expect(payload.actions).toEqual([]);
  });

  it("coalesces content and actions into one frame", async () => {
    const { host: h, session } = await openLiveSession();
    const writer = session.coalesced({ intervalMs: 50 });
    h.reset();

    writer.set(tree("a"), undefined, { actions: actions(true) });
    writer.set(tree("b"), undefined, { actions: actions(false) });
    await writer.flush();
    await settle();

    const updates = h.framesOfType("update");
    expect(updates).toHaveLength(1);
    const payload = updates[0].payload as { root?: ViewNode; actions?: ViewAction[] };
    expect(payload.root).toEqual(tree("b"));
    expect(payload.actions).toEqual(actions(false));
  });
});
