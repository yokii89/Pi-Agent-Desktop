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
  playNotification,
} from "../../../packages/view-sdk/src/index";
import type { ViewNode } from "../../../packages/view-sdk/src/types";
import { VIEW_LIMITS } from "../../shared/view";
import { disposeViewHost, ensureViewHost, sendViewEvent } from "./viewHost";

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
  it("advertises the panel slot and view-table in hello", async () => {
    const hello = await client.ensureConnected();
    expect(hello?.placements).toContain("panel");
    expect(client.hasCapability("view-table")).toBe(true);
    expect(client.hasCapability("system-toast")).toBe(true);
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
});
