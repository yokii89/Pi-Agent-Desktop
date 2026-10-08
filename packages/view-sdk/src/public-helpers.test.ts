/**
 * Direct coverage for the public helpers that design/20 §6.3 listed as
 * still zero-test after O1–O7: `viewOnDesktop`, `openWidget`, `headerSpec`,
 * `openHeader` (happy path), and the `column`/`row`/`card` builders.
 *
 * These are the paths an extension author copies from the README, so a silent
 * regression here is the most expensive kind.
 */

import { describe, expect, it, vi } from "vitest";
import type { DesktopViewClient, LiveViewSession, ViewSessionEvent } from "./client.js";
import type { ViewHelloPayload, ViewNode, ViewResult, ViewSpec } from "./types.js";
import { card, column, headerSpec, openHeader, openWidget, row, viewOnDesktop } from "./view.js";

const ALL_SLOTS: ViewHelloPayload = {
  protocol: "view/v1",
  placements: ["modal", "widget", "panel", "sidebar", "settings", "header", "access-mode"],
};

function textNode(content = "x"): ViewNode {
  return { type: "text", content };
}

interface FakeSession extends LiveViewSession {
  emit: (event: ViewSessionEvent) => void;
  closedWith: ViewResult | null;
}

/** Minimal live session that records close results and lets tests push events. */
function fakeSession(): FakeSession {
  const handlers = new Set<(event: ViewSessionEvent) => void>();
  let resolveClosed!: (payload: { reason?: string } | null) => void;
  const closed = new Promise<{ reason?: string } | null>((resolve) => {
    resolveClosed = resolve;
  });
  const session: FakeSession = {
    id: "view-helpers-1",
    placement: null,
    panelId: null,
    headerSide: null,
    hello: ALL_SLOTS,
    limits: { maxNodes: 512 },
    closedWith: null,
    update: vi.fn(),
    patch: vi.fn(() => false),
    close: vi.fn((result?: ViewResult) => {
      session.closedWith = result ?? null;
      resolveClosed(result ? { reason: "client" } : null);
    }),
    onEvent: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit: (event) => {
      for (const handler of [...handlers]) handler(event);
    },
    closed,
  } as unknown as FakeSession;
  return session;
}

function sessionClient(session: FakeSession): DesktopViewClient & {
  openLive: ReturnType<typeof vi.fn>;
  open: ReturnType<typeof vi.fn>;
} {
  const openLive = vi.fn(async () => session as unknown as LiveViewSession);
  // `viewOnDesktop` goes through `client.open()`, which resolves `ViewResult | null`
  // on close — mirror that contract and replay events through the handler it passes.
  const open = vi.fn(
    async (
      _spec: ViewSpec,
      handlers?: {
        onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
        signal?: AbortSignal;
      },
    ): Promise<ViewResult | null> => {
      if (handlers?.signal?.aborted) return null;
      if (handlers?.onEvent) {
        const userHandler = handlers.onEvent;
        session.onEvent((event) => userHandler(event, session));
      }
      const payload = await session.closed;
      return session.closedWith ?? (payload ? null : null);
    },
  );
  return {
    ensureConnected: async () => ALL_SLOTS,
    hello: ALL_SLOTS,
    openLive,
    open,
  } as unknown as DesktopViewClient & {
    openLive: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };
}

describe("headerSpec", () => {
  it("pins placement, required flag and default side", () => {
    const spec = headerSpec({ root: textNode() });
    expect(spec.placement).toBe("header");
    expect(spec.placementRequired).toBe(true);
    expect(spec.placementHint).toEqual({ headerSide: "left" });
  });

  it("forwards side, title and actions", () => {
    const spec = headerSpec({
      side: "right",
      title: "索引",
      root: textNode("索引中…"),
      actions: [{ id: "stop", label: "停止", variant: "ghost", kind: "event" }],
    });
    expect(spec.title).toBe("索引");
    expect(spec.placementHint).toEqual({ headerSide: "right" });
    expect(spec.actions).toHaveLength(1);
  });
});

describe("openHeader / openWidget happy paths", () => {
  it("openHeader opens a live session with the header spec", async () => {
    const session = fakeSession();
    const client = sessionClient(session);
    const live = await openHeader(client, { side: "center", root: textNode("hi") });
    expect(live).toBe(session);
    expect(client.openLive).toHaveBeenCalledWith(
      expect.objectContaining({ placement: "header", placementRequired: true }),
      expect.anything(),
    );
  });

  it("openWidget opens a floating widget when requested", async () => {
    const session = fakeSession();
    const client = sessionClient(session);
    const live = await openWidget(client, {
      floating: true,
      title: "回答问题",
      root: textNode("q"),
    });
    expect(live).toBe(session);
    expect(client.openLive).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "widget",
        placementRequired: true,
        placementHint: { side: "aboveEditor", floating: true },
      }),
      expect.anything(),
    );
  });

  it("openWidget fails fast when the host lacks the widget slot", async () => {
    const session = fakeSession();
    const client = {
      ensureConnected: async () =>
        ({
          protocol: "view/v1",
          placements: ["modal"],
        }) satisfies ViewHelloPayload,
      hello: { protocol: "view/v1", placements: ["modal"] },
      openLive: vi.fn(async () => session),
    } as unknown as DesktopViewClient;
    await expect(openWidget(client, { root: textNode() })).rejects.toMatchObject({
      code: "placement",
    });
  });
});

describe("viewOnDesktop one-shot form", () => {
  const spec: ViewSpec = {
    title: "选择",
    root: { type: "list", id: "model", items: [{ value: "a", label: "A" }] },
    actions: [
      { id: "cancel", label: "取消", kind: "submit", variant: "ghost" },
      { id: "ok", label: "确认", kind: "submit", variant: "primary" },
    ],
  };

  it("collects change values and returns them on the first submit action", async () => {
    const session = fakeSession();
    const client = sessionClient(session);
    const pending = viewOnDesktop(client, spec);

    // onEvent is registered synchronously inside open(); give it a tick.
    await Promise.resolve();
    session.emit({ type: "change", nodeId: "model", value: "a" });
    session.emit({ type: "action", actionId: "ok", values: { extra: 1 } });

    const result = await pending;
    expect(result).toEqual({ action: "ok", values: { model: "a", extra: 1 } });
    expect(session.close).toHaveBeenCalledWith({
      action: "ok",
      values: { model: "a", extra: 1 },
    });
  });

  it("returns undefined on dismiss (Host force-close without a client result)", async () => {
    const session = fakeSession();
    const client = sessionClient(session);
    const pending = viewOnDesktop(client, spec);
    await Promise.resolve();
    session.close(); // user dismiss
    await expect(pending).resolves.toBeUndefined();
  });

  it("returns undefined immediately for a pre-aborted signal and never opens", async () => {
    const session = fakeSession();
    const client = sessionClient(session);
    const controller = new AbortController();
    controller.abort();
    await expect(
      viewOnDesktop(client, spec, { signal: controller.signal }),
    ).resolves.toBeUndefined();
    expect(client.open).not.toHaveBeenCalled();
    expect(client.openLive).not.toHaveBeenCalled();
  });

  it("routes Host error frames to options.onError without closing", async () => {
    const session = fakeSession();
    const client = sessionClient(session);
    const onError = vi.fn();
    const pending = viewOnDesktop(client, spec, { onError });
    await Promise.resolve();
    session.emit({
      type: "error",
      error: { code: "limit", message: "too big" },
    });
    session.emit({ type: "action", actionId: "cancel" });
    const result = await pending;
    expect(onError).toHaveBeenCalledWith({ code: "limit", message: "too big" });
    expect(result?.action).toBe("cancel");
  });

  it("does not auto-close on a non-submit action (kind: event)", async () => {
    const eventSpec: ViewSpec = {
      ...spec,
      actions: [{ id: "refresh", label: "刷新", kind: "event" }],
    };
    const session = fakeSession();
    const client = sessionClient(session);
    const pending = viewOnDesktop(client, eventSpec);
    await Promise.resolve();
    session.emit({ type: "action", actionId: "refresh" });
    // Still open — only a later close settles the promise.
    session.close({ action: "cancel", values: {} });
    await expect(pending).resolves.toEqual({ action: "cancel", values: {} });
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledWith({ action: "cancel", values: {} });
  });
});

describe("column / row / card builders", () => {
  it("omits gap / title when not provided", () => {
    const kids = [textNode("a"), textNode("b")];
    expect(column(kids)).toEqual({ type: "column", children: kids });
    expect(row(kids)).toEqual({ type: "row", children: kids });
    expect(card(undefined, kids)).toEqual({ type: "card", children: kids });
  });

  it("keeps explicit gap and title", () => {
    const kids = [textNode()];
    expect(column(kids, 8)).toEqual({ type: "column", children: kids, gap: 8 });
    expect(row(kids, 4)).toEqual({ type: "row", children: kids, gap: 4 });
    expect(card("队列", kids)).toEqual({ type: "card", title: "队列", children: kids });
  });
});
