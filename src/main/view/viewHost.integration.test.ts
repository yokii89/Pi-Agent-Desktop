/**
 * 真链路集成：@pidesk/view-sdk 公共导出 ↔ 真实 viewHost（docs/design/19 §8.3）。
 *
 * `packages/view-sdk/src/opened.integration.test.ts` 对的是协议桩（为让 SDK 包保持
 * Electron-free 而 mirror 了一份 placement 规则），且桩 hello 里没有 capabilities、
 * 也不跑 sanitizeTree。这里两端都是真的：Client 连上 `src/main/view/viewHost.ts`
 * 实际监听的 pipe/TCP，断言扩展真正拿到的能力广告、panelId 稳定性、同槽顶替，
 * 以及 Host 消毒后的 table 树。
 *
 * 只 mock 耦合点：主窗口（借此捕获渲染层收到的 push）、settings、toastService、
 * `os.tmpdir`（rendezvous 改写进私有目录，避免测试覆盖开发机上正在运行的 PiDesk 的 rendezvous）。
 */
import fs from "node:fs";
import net from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => {
  const base = (process.env.TEMP ?? process.env.TMP ?? "/tmp").replace(/[\\/]+$/, "");
  return {
    dir: `${base}/pidesk-viewhost-it-${process.pid}`,
    pushes: [] as Array<Record<string, unknown>>,
    toasts: [] as Array<Record<string, unknown>>,
  };
});

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  tmpdir: () => bag.dir,
}));

vi.mock("../settings/settings", () => ({
  getSettings: () => ({
    notification: {
      enabled: true,
      systemToast: true,
      debounceMs: 0,
      scenarios: {
        completed: { enabled: true, sound: "1" },
        failed: { enabled: true, sound: "2" },
        needsAttention: { enabled: true, sound: "3" },
        interrupted: { enabled: false, sound: "4" },
        terminalExit: { enabled: false, sound: "5" },
        custom: { enabled: true, sound: "3" },
      },
    },
  }),
}));

// Catalog discovery and session processes are outside this transport test and
// import Electron. Keep binding validation real against an empty catalog.
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: () => ({ entries: [] }),
}));

vi.mock("../session/runtimeCoordinator", () => ({
  listRuntimeSnapshots: () => [],
}));

vi.mock("../notification/toastService", () => ({
  showSystemToast: (req: Record<string, unknown>) => {
    bag.toasts.push(req);
    return true;
  },
}));

vi.mock("../window/createMainWindow", () => ({
  getMainWindow: () => ({
    webContents: {
      send: (_channel: string, message: Record<string, unknown>) => {
        bag.pushes.push(message);
      },
    },
  }),
}));

import type { LiveViewSession, OpenPanelOptions } from "../../../packages/view-sdk/src/index";
import {
  DesktopViewClient,
  openPanel,
  openPanelResult,
  parseEndpoint,
  playNotification,
} from "../../../packages/view-sdk/src/index";
import type { ViewNode } from "../../../packages/view-sdk/src/types";
import { VIEW_LIMITS } from "../../shared/view";
import {
  disposeViewHost,
  ensureViewHost,
  hasSessionModal,
  issueNativeViewBinding,
  reportViewLayout,
  revokeNativeExtensionViews,
  sendViewEvent,
} from "./viewHost";

/** docs/design/19 §4.1 的 Telegram 面板骨架：连接卡 + 队列卡（table）。 */
function panelTree(rowCount: number): ViewNode {
  return {
    type: "column",
    children: [
      { type: "text", content: "@bridge · leader · 轮询活跃", variant: "caption" },
      {
        type: "card",
        title: "队列",
        children: [
          {
            type: "table",
            id: "queue-table",
            columns: [
              { key: "lane", label: "车道", width: 1 },
              { key: "from", label: "来源" },
              { key: "age", label: "等待", align: "right" },
            ],
            rows: Array.from({ length: rowCount }, (_, i) => ({
              id: `q${i}`,
              cells: { lane: "default", from: `user${i}`, age: i },
            })),
            emptyText: "队列为空",
          },
        ],
      },
    ],
  };
}

function pushesOfType(type: string): Array<Record<string, unknown>> {
  return bag.pushes.filter((message) => message.type === type);
}

function lastPush(type: string): Record<string, unknown> {
  const found = pushesOfType(type);
  const last = found[found.length - 1];
  if (!last) throw new Error(`渲染层未收到 ${type} push`);
  return last;
}

interface SanitizedTable {
  type: string;
  id: string;
  columns: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
  maxRows?: number;
}

/** 取渲染层实际收到的 table 节点；缺失即失败，避免断言在 undefined 上空转。 */
function tableOf(root: unknown): SanitizedTable {
  const found = findNode(root, "table");
  if (!found) throw new Error("渲染层收到的树里没有 table 节点");
  return found as unknown as SanitizedTable;
}

function findNode(root: unknown, type: string): Record<string, unknown> | undefined {
  if (!root || typeof root !== "object") return undefined;
  const node = root as Record<string, unknown>;
  if (node.type === type) return node;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return undefined;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 3000) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let client: DesktopViewClient;

/** openLive 发出 open 即返回；这里等到 opened ack 落定，扩展侧读到的就是权威 panelId。 */
async function openTab(spec: OpenPanelOptions): Promise<LiveViewSession> {
  const session = await openPanel(client, spec);
  if (!session) throw new Error("openPanel 返回 null：真 Host 广告了 panel，必须拿到会话");
  await waitFor(() => session.panelId !== null, `opened ack（${spec.panelId}）`);
  return session;
}

beforeAll(async () => {
  fs.mkdirSync(bag.dir, { recursive: true });
  client = new DesktopViewClient(await ensureViewHost());
});

afterEach(() => {
  bag.pushes.length = 0;
  bag.toasts.length = 0;
});

afterAll(() => {
  client?.dispose();
  disposeViewHost();
  fs.rmSync(bag.dir, { recursive: true, force: true });
});

describe("viewHost ↔ view-sdk over the real transport", () => {
  it("binds native clients to their actual owner, isolates slots, and revokes every View on disposal", async () => {
    await ensureViewHost();
    const a = new DesktopViewClient(
      {
        ...issueNativeViewBinding(
          { ownerId: "native-a", sessionId: "ui-a", extensionId: "first", hostScope: "session" },
          {},
        ),
        sessionId: "forged",
      },
      { env: {} },
    );
    const b = new DesktopViewClient(
      issueNativeViewBinding(
        { ownerId: "native-b", sessionId: "ui-b", extensionId: "second", hostScope: "session" },
        {},
      ),
      { env: {} },
    );
    try {
      const first = await a.openLive({
        placement: "panel",
        placementHint: { panelId: "config" },
        root: { type: "text", content: "A" },
      });
      const second = await b.openLive({
        placement: "panel",
        placementHint: { panelId: "config" },
        root: { type: "text", content: "B" },
      });
      await waitFor(
        () => pushesOfType("open").some((push) => push.id === second.id),
        "native opens",
      );
      expect(pushesOfType("open").find((push) => push.id === first.id)?.sessionId).toBe("ui-a");
      expect(pushesOfType("open").find((push) => push.id === second.id)?.sessionId).toBe("ui-b");
      expect(first.panelId).not.toBe(second.panelId);
      revokeNativeExtensionViews("native-a");
      await first.closed;
      expect(pushesOfType("closed").some((push) => push.id === second.id)).toBe(false);
      second.update({ type: "text", content: "still alive" });
      await waitFor(
        () => pushesOfType("update").some((push) => push.id === second.id),
        "other owner survives",
      );
    } finally {
      a.dispose();
      b.dispose();
      revokeNativeExtensionViews("native-a");
      revokeNativeExtensionViews("native-b");
    }
  });

  it("enforces settings-only placement, preserves application scope, and refuses revoked credentials", async () => {
    await ensureViewHost();
    const binding = issueNativeViewBinding(
      { ownerId: "native-settings", extensionId: "config", hostScope: "settings" },
      {},
    );
    const settings = new DesktopViewClient(binding, { env: {} });
    const app = new DesktopViewClient(
      issueNativeViewBinding(
        { ownerId: "native-app", extensionId: "global", hostScope: "app" },
        {},
      ),
      { env: {} },
    );
    try {
      const allowed = await settings.openLive({
        placement: "settings",
        root: { type: "text", content: "Config" },
      });
      await waitFor(
        () => pushesOfType("open").some((push) => push.id === allowed.id),
        "settings opens",
      );
      const global = await app.openLive({
        placement: "header",
        root: { type: "text", content: "Global" },
      });
      await waitFor(() => pushesOfType("open").some((push) => push.id === global.id), "app opens");
      expect(pushesOfType("open").find((push) => push.id === global.id)).toMatchObject({
        hostScope: "app",
        sessionId: undefined,
      });
      await expect(
        settings.open({
          placement: "widget",
          placementRequired: true,
          root: { type: "text", content: "Forbidden" },
        }),
      ).rejects.toThrow();
      revokeNativeExtensionViews("native-settings");
      await allowed.closed;
      const expired = new DesktopViewClient(binding, {
        env: {},
        helloTimeoutMs: 100,
        connectTimeoutMs: 100,
      });
      try {
        await expect(expired.ensureConnected()).rejects.toThrow();
      } finally {
        expired.dispose();
      }
    } finally {
      settings.dispose();
      app.dispose();
      revokeNativeExtensionViews("native-settings");
      revokeNativeExtensionViews("native-app");
    }
  });

  it("SDK modal 在关闭前保护所属会话，不影响其它会话", async () => {
    const modalClient = new DesktopViewClient({
      ...(await ensureViewHost()),
      sessionId: "idle-guard",
    });
    const session = await modalClient.openLive({
      placement: "modal",
      title: "Pending input",
      root: { type: "text", content: "Please confirm" },
    });
    await waitFor(() => hasSessionModal("idle-guard"), "modal registered");
    expect(hasSessionModal("other-session")).toBe(false);
    session.close();
    await session.closed;
    await waitFor(() => !hasSessionModal("idle-guard"), "modal closed");
    expect(hasSessionModal("idle-guard")).toBe(false);
    modalClient.dispose();
  });
  it.each(["x", "中"])(
    "closes an authenticated peer with an oversized incomplete %s line",
    async (character) => {
      const env = await ensureViewHost();
      const target = parseEndpoint(env.endpoint);
      const socket =
        "port" in target ? net.connect(target.port, target.host) : net.connect(target.path);
      const disconnected = new Promise<boolean>((resolve, reject) => {
        socket.once("close", resolve);
        socket.once("error", reject);
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });

      socket.write(`${JSON.stringify({ token: env.token })}\n`);
      await new Promise<void>((resolve, reject) => {
        socket.once("data", () => resolve());
        socket.once("error", reject);
      });
      socket.write(
        character.repeat(
          Math.floor(VIEW_LIMITS.maxMessageBytes / Buffer.byteLength(character)) + 1,
        ),
      );
      await expect(disconnected).resolves.toBe(false);
    },
  );

  it.each([0, 1])(
    "checks fragmented CRLF against the Host payload byte limit (overflow=%i)",
    async (overflow) => {
      const env = await ensureViewHost();
      let accepted: net.Socket | undefined;
      const originalOn = net.Socket.prototype.on;
      const observe = vi.spyOn(net.Socket.prototype, "on").mockImplementation(function (
        this: net.Socket,
        event: string,
        listener: (...args: unknown[]) => void,
      ) {
        if (event === "data") accepted = this;
        Reflect.apply(originalOn, this, [event, listener]);
        return this;
      });
      const socket = net.connect(parseEndpoint(env.endpoint));
      socket.on("error", () => undefined);
      try {
        await waitFor(() => accepted !== undefined, "Host socket data handler");
        observe.mockRestore();
        const peer = accepted;
        if (!peer) throw new Error("Host socket missing");
        const hello = new Promise<Buffer>((resolve) => socket.once("data", resolve));
        peer.emit("data", Buffer.from(`${JSON.stringify({ token: env.token })}\n`));
        expect(JSON.parse((await hello).toString()).type).toBe("hello");
        const payload = {
          v: "view/v1",
          id: "crlf-boundary",
          type: "update",
          payload: {},
          padding: "",
        };
        payload.padding = "x".repeat(
          VIEW_LIMITS.maxMessageBytes - Buffer.byteLength(JSON.stringify(payload)) + overflow,
        );
        // Inject chunks into the accepted socket: real TCP may merge adjacent writes.
        peer.emit("data", Buffer.from(`${JSON.stringify(payload)}\r`));
        expect(peer.destroyed).toBe(overflow > 0);
        if (overflow === 0) {
          const reply = new Promise<Buffer>((resolve) => socket.once("data", resolve));
          peer.emit("data", Buffer.from("\n"));
          expect(JSON.parse((await reply).toString())).toMatchObject({
            id: "crlf-boundary",
            type: "error",
            payload: { code: "protocol" },
          });
          expect(peer.destroyed).toBe(false);
        }
      } finally {
        observe.mockRestore();
        socket.destroy();
      }
    },
  );

  it.each(["update", "patch"] as const)(
    "keeps the Host tree after a direct %s followed by a clean flushNow",
    async (method) => {
      const initial: ViewNode = { type: "text", content: "initial" };
      const current: ViewNode = {
        type: "column",
        children: [{ type: "text", content: "current" }],
      };
      const session = await openTab({ panelId: `flush-direct-${method}`, root: initial });
      try {
        if (method === "update") session.update(current);
        else expect(session.patch({ ops: [{ path: [], node: current }] })).toBe(true);
        await session.coalesced().flushNow();
        // A subsequent Host patch reads its retained tree, proving the clean
        // flush did not restore the initial root.
        const probe: ViewNode = { type: "text", content: "probe" };
        expect(session.patch({ ops: [{ path: [0], node: probe }], title: "probe" })).toBe(true);
        await waitFor(
          () =>
            pushesOfType("update").some((push) => push.id === session.id && push.title === "probe"),
          "Host tree after flush",
        );
        const updates = pushesOfType("update").filter((push) => push.id === session.id);
        expect(updates).toHaveLength(3);
        expect(updates[0]).toMatchObject({ root: current });
        expect(updates[1]).not.toHaveProperty("root");
        expect(updates[2]).toMatchObject({
          root: { type: "column", children: [probe] },
          title: "probe",
        });
      } finally {
        session.close();
        await waitFor(
          () => pushesOfType("closed").some((push) => push.id === session.id),
          "direct-write panel cleanup",
        );
      }
    },
  );

  it("Result returns the real Host's asynchronous open-view limit refusal", async () => {
    const limitedClient = new DesktopViewClient(await ensureViewHost());
    const sessions: LiveViewSession[] = [];
    try {
      for (let index = 0; index < VIEW_LIMITS.maxOpenViewsPerConnection; index += 1) {
        const result = await openPanelResult(limitedClient, {
          panelId: `cap-${index}`,
          root: { type: "text", content: "registered" },
        });
        if (!result.ok) throw new Error(result.message);
        sessions.push(result.session);
      }
      const result = await openPanelResult(limitedClient, {
        panelId: "over-cap",
        root: { type: "text", content: "refused" },
      });
      expect(result).toMatchObject({
        ok: false,
        code: "limit",
        retryable: true,
        error: { code: "limit" },
      });
      expect(pushesOfType("open").some((push) => push.panelId === "over-cap")).toBe(false);
    } finally {
      limitedClient.dispose();
      await waitFor(
        () =>
          sessions.every((session) =>
            pushesOfType("closed").some((push) => push.id === session.id),
          ),
        "limited connection cleanup",
      );
    }
  });

  it("bounds Host writes for a stalled peer and settles its live session", async () => {
    const session = await openTab({
      panelId: "stalled-peer",
      root: { type: "text", content: "test" },
    });
    const queuedBytes = vi
      .spyOn(net.Socket.prototype, "writableLength", "get")
      .mockReturnValue(4 * VIEW_LIMITS.maxMessageBytes);
    try {
      sendViewEvent(session.id, { type: "change", nodeId: "answer", value: "blocked" });
    } finally {
      queuedBytes.mockRestore();
    }
    await expect(session.closed).resolves.toMatchObject({ reason: "dispose" });
  });

  it("Result reports contribution binding refusal before registering the panel", async () => {
    const result = await openPanelResult(client, {
      panelId: "unbound-panel",
      contributionKey: "missing-contribution",
      root: { type: "text", content: "refused" },
    });
    expect(result).toMatchObject({ ok: false, code: "protocol", retryable: false });
    expect(pushesOfType("open")).toHaveLength(0);
  });

  it("coalesced disjoint patches converge both fields and retain pending actions", async () => {
    const pair = (a: string, b: string): ViewNode => ({
      type: "column",
      children: [
        { type: "text", content: a },
        { type: "text", content: b },
      ],
    });
    const session = await openTab({ panelId: "coalesced-pair", root: pair("A=0", "B=0") });
    const writer = session.coalesced();
    const actions = [{ id: "refresh", label: "Refresh", kind: "event" as const }];
    writer.set(pair("A=1", "B=0"), [{ path: [0], node: { type: "text", content: "A=1" } }], {
      actions,
    });
    writer.set(pair("A=1", "B=1"), [{ path: [1], node: { type: "text", content: "B=1" } }]);
    await writer.flush();
    await waitFor(
      () => pushesOfType("update").some((push) => push.id === session.id),
      "coalesced update",
    );
    expect(lastPush("update")).toMatchObject({ root: pair("A=1", "B=1"), actions });
    session.close();
    await waitFor(
      () => pushesOfType("closed").some((push) => push.id === session.id),
      "coalesced panel cleanup",
    );
  });

  it("advertises the panel slot and view-table in hello", async () => {
    const hello = await client.ensureConnected();
    expect(hello?.placements).toContain("panel");
    expect(client.hasCapability("view-table")).toBe(true);
    expect(client.hasCapability("system-toast")).toBe(true);
    expect(client.hasCapability("view-readonly-list")).toBe(true);
    expect(client.hasCapability("view-layout")).toBe(true);
    expect(client.hasCapability("panel-tab-badge")).toBe(true);
    expect(client.hasCapability("panel-header")).toBe(true);
  });

  it("notify without toast pushes sound only; with toast also calls toastService once", async () => {
    bag.pushes.length = 0;
    bag.toasts.length = 0;

    const soundOnly = await playNotification(client, { scenario: "completed" });
    expect(soundOnly).toEqual({ ok: true });
    expect(bag.toasts).toHaveLength(0);
    // Host 对 sdk 声音走 NOTIFICATION_IPC.output → mock webContents.send 原样进 bag
    expect(bag.pushes.some((p) => p.scenario === "completed" && p.source === "sdk")).toBe(true);

    const withToast = await playNotification(client, {
      scenario: "needsAttention",
      toast: { title: "PiDesk · deploy", body: "需要介入" },
      sessionId: "sess-1",
    });
    expect(withToast).toEqual({ ok: true });
    expect(bag.toasts).toHaveLength(1);
    expect(bag.toasts[0]).toMatchObject({
      title: "PiDesk · deploy",
      body: "需要介入",
      sessionId: "sess-1",
    });
    expect(bag.pushes.some((p) => p.scenario === "needsAttention")).toBe(true);
  });

  it("notify rejects an invalid toast payload", async () => {
    const outcome = await client.notify({
      scenario: "custom",
      toast: { title: "" },
    });
    expect(outcome).toMatchObject({ ok: false, reason: "rejected" });
    expect(bag.toasts).toHaveLength(0);
  });

  it("opens a right-hand panel tab whose table survives Host sanitizing", async () => {
    const session = await openTab({
      panelId: "telegram-bridge",
      title: "Telegram",
      root: panelTree(3),
      actions: [{ id: "refresh", label: "刷新", variant: "ghost", kind: "event" }],
    });
    expect(session.placement).toBe("panel");
    expect(session.panelId).toBe("telegram-bridge");

    const open = lastPush("open");
    expect(open).toMatchObject({
      id: session.id,
      placement: "panel",
      panelId: "telegram-bridge",
      title: "Telegram",
    });

    const table = tableOf(open.root);
    expect(table).toMatchObject({ type: "table", id: "queue-table" });
    expect(table.columns).toEqual([
      { key: "lane", label: "车道", width: 1 },
      { key: "from", label: "来源" },
      { key: "age", label: "等待", align: "right" },
    ]);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]?.cells).toEqual({ lane: "default", from: "user0", age: 0 });

    session.close();
    await session.closed;
  });

  it("replaces the stale view in place instead of stacking a second tab", async () => {
    const first = await openTab({ panelId: "telegram-replace", root: panelTree(1) });
    bag.pushes.length = 0;

    const second = await openTab({ panelId: "telegram-replace", root: panelTree(2) });
    expect((await first.closed)?.reason).toBe("replaced");

    expect(pushesOfType("open")).toHaveLength(1);
    expect(lastPush("closed")).toMatchObject({ id: first.id, reason: "replaced" });
    // 顶替复用同一格：Tab 身份仍是 telegram-replace，只是换了运行实例 viewId
    expect(lastPush("open")).toMatchObject({ panelId: "telegram-replace" });
    expect(second.id).not.toBe(first.id);
    expect(second.panelId).toBe("telegram-replace");

    second.close();
    await second.closed;
  });

  it("routes renderer actions to the extension and update() re-projects the sanitized tree", async () => {
    const events: Array<Record<string, unknown>> = [];
    const session = await openTab({
      panelId: "telegram-events",
      root: panelTree(1),
      actions: [{ id: "refresh", label: "刷新", kind: "event" }],
      onEvent: (event) => events.push(event as unknown as Record<string, unknown>),
    });
    bag.pushes.length = 0;

    sendViewEvent(session.id, { type: "action", actionId: "refresh" });
    await waitFor(() => events.some((event) => event.type === "action"), "action 抵达扩展");
    expect(events.find((event) => event.type === "action")).toMatchObject({
      actionId: "refresh",
    });

    session.update(panelTree(5));
    await waitFor(() => pushesOfType("update").length === 1, "update push");
    const update = lastPush("update");
    expect(update.id).toBe(session.id);
    expect(tableOf(update.root).rows).toHaveLength(5);

    session.close();
    await session.closed;
  });

  it("keeps the connection alive when the user dismisses the tab", async () => {
    const events: Array<Record<string, unknown>> = [];
    const session = await openTab({
      panelId: "telegram-dismiss",
      root: panelTree(1),
      onEvent: (event) => events.push(event as unknown as Record<string, unknown>),
    });
    bag.pushes.length = 0;

    // 关 Tab 是渲染层用户动作，不是 bridge 停机（§4.4）
    sendViewEvent(session.id, { type: "dismiss" });
    expect((await session.closed)?.reason).toBe("user");
    expect(lastPush("closed")).toMatchObject({ id: session.id, reason: "user" });
    expect(events.some((event) => event.type === "dismiss")).toBe(true);

    const again = await openTab({ panelId: "telegram-dismiss", root: panelTree(1) });
    expect(again.panelId).toBe("telegram-dismiss");
    again.close();
    await again.closed;
  });

  it("truncates table rows at the protocol budget, which the extension must pre-slice", async () => {
    const session = await openTab({
      panelId: "telegram-budget",
      root: panelTree(VIEW_LIMITS.maxTableRows + 200),
    });

    const table = tableOf(lastPush("open").root);
    expect(table.rows).toHaveLength(VIEW_LIMITS.maxTableRows);
    // maxRows 缺省时不写进 payload，扩展侧的「显示 N / 共 M」才是可信截断口径
    expect(table.maxRows).toBeUndefined();

    session.close();
    await session.closed;
  });

  it("pipes panel content sizes to the extension as layout events (docs/06 R5)", async () => {
    const events: Array<Record<string, unknown>> = [];
    const session = await openTab({
      panelId: "telegram-layout",
      root: panelTree(1),
      onEvent: (event) => events.push(event as unknown as Record<string, unknown>),
    });

    reportViewLayout(session.id, 291.4, 640.6);
    await waitFor(() => events.some((event) => event.type === "layout"), "layout 抵达扩展");
    expect(events.find((event) => event.type === "layout")).toEqual({
      type: "layout",
      width: 291,
      height: 641,
    });

    // 关闭后渲染层去抖里的最后一帧可能晚到：Host 必须静默丢弃
    session.close();
    await session.closed;
    const seen = events.length;
    reportViewLayout(session.id, 300, 700);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toHaveLength(seen);
  });

  it("sanitizes panel badge and fixed header hints and clears the badge (docs/06 R7/R9)", async () => {
    const session = await openTab({ panelId: "telegram-hints", root: panelTree(1) });
    bag.pushes.length = 0;

    session.update({
      placementHint: {
        panelId: "telegram-hints",
        panelBadge: { tone: "attention", count: 2, label: "失败" },
        panelHeader: [
          { type: "text", content: "🟢 已连接" },
          // 固定头部只收轻节点：交互控件整条消失，不降级成 unknown 占位
          { type: "button", id: "open", label: "点我" },
          { type: "row", children: [{ type: "text", content: "队列 3" }] },
        ],
      },
    });
    await waitFor(() => pushesOfType("update").length === 1, "update push（badge/header）");
    expect(lastPush("update").placementHint).toEqual({
      panelId: "telegram-hints",
      panelBadge: { tone: "attention", count: 2, label: "失败" },
      panelHeader: [
        { type: "text", content: "🟢 已连接", variant: "body" },
        { type: "row", children: [{ type: "text", content: "队列 3", variant: "body" }] },
      ],
    });

    // placementHint 整体替换：带上 panelId、不带 panelBadge 即清除
    session.update({ placementHint: { panelId: "telegram-hints" } });
    await waitFor(() => pushesOfType("update").length === 2, "update push（clear）");
    expect(lastPush("update").placementHint).toEqual({ panelId: "telegram-hints" });

    session.close();
    await session.closed;
  });
});
