/**
 * `session.coalesced()` frame contract (docs/design/20 §9).
 *
 * The bare scheduler is covered in `frame-scheduler.test.ts`; this file pins
 * what a coalesced *session* write actually puts on the wire — especially
 * `meta.actions`, which is how a live panel updates its action-bar `disabled`
 * state without a side-channel `setInterval`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { DesktopViewClient } from "./client.js";
import { createTestViewHost, type TestViewHost } from "./testing.js";
import { VIEW_PROTOCOL_VERSION, type ViewAction, type ViewNode } from "./types.js";

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
