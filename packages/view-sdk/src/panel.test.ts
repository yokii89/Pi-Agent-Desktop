import { describe, expect, it, vi } from "vitest";
import type { DesktopViewClient, LiveViewSession } from "./client.js";
import { openPanel, openSettingsView, openSidebar } from "./index.js";
import type { ViewHelloPayload, ViewSpec } from "./types.js";

function fakeSession(): LiveViewSession {
  return {
    id: "view-test-1",
    placement: "panel",
    panelId: "telegram-bridge",
    headerSide: null,
    update: vi.fn(),
    patch: vi.fn(() => false),
    close: vi.fn(),
    onEvent: () => () => undefined,
    closed: new Promise(() => undefined),
  } as unknown as LiveViewSession;
}

function fakeClient(hello: ViewHelloPayload | null) {
  const session = fakeSession();
  const openLive = vi.fn(async (_spec: ViewSpec) => session);
  const client = { ensureConnected: async () => hello, hello, openLive };
  return { client: client as unknown as DesktopViewClient, openLive, session };
}

const ALL_SLOTS: ViewHelloPayload = {
  protocol: "view/v1",
  placements: ["modal", "widget", "panel", "sidebar", "settings"],
};

/** Last spec passed to openLive — the factories' contract surface. */
function lastSpec(openLive: ReturnType<typeof vi.fn>): ViewSpec {
  return openLive.mock.calls[openLive.mock.calls.length - 1][0] as ViewSpec;
}

describe("openPanel", () => {
  it("opens a right-hand panel with a required slot and stable panelId", async () => {
    const { client, openLive } = fakeClient(ALL_SLOTS);
    const session = await openPanel(client, {
      panelId: "telegram-bridge",
      title: "Telegram",
      root: { type: "text", content: "…" },
      actions: [{ id: "refresh", label: "刷新", variant: "ghost" }],
    });
    expect(session).not.toBeNull();
    const spec = lastSpec(openLive);
    expect(spec.placement).toBe("panel");
    expect(spec.placementRequired).toBe(true);
    expect(spec.placementHint).toEqual({ panelId: "telegram-bridge" });
    expect(spec.title).toBe("Telegram");
    expect(spec.actions).toHaveLength(1);
  });

  it("forwards contributionKey so the Host can bind a catalog entry", async () => {
    const { client, openLive } = fakeClient(ALL_SLOTS);
    await openPanel(client, {
      panelId: "p",
      root: { type: "text", content: "x" },
      contributionKey: "ck:1",
    });
    expect(lastSpec(openLive).contributionKey).toBe("ck:1");
  });

  it("resolves null without a client (TUI fallback) and never opens", async () => {
    const openLive = vi.fn();
    expect(
      await openPanel(null, { panelId: "p", root: { type: "text", content: "x" } }),
    ).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("resolves null when hello is absent (old host) and never opens", async () => {
    const { client, openLive } = fakeClient(null);
    expect(
      await openPanel(client, { panelId: "p", root: { type: "text", content: "x" } }),
    ).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("resolves null when hello lacks the panel slot and never opens", async () => {
    const { client, openLive } = fakeClient({
      protocol: "view/v1",
      placements: ["modal", "widget"],
    });
    expect(
      await openPanel(client, { panelId: "p", root: { type: "text", content: "x" } }),
    ).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("resolves null for an already-aborted signal", async () => {
    const { client, openLive } = fakeClient(ALL_SLOTS);
    const controller = new AbortController();
    controller.abort();
    expect(
      await openPanel(client, {
        panelId: "p",
        root: { type: "text", content: "x" },
        signal: controller.signal,
      }),
    ).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("resolves null (never throws) when the connection fails", async () => {
    const client = {
      ensureConnected: async () => {
        throw new Error("View Host connect timeout (5000ms)");
      },
      hello: null,
      openLive: vi.fn(),
    } as unknown as DesktopViewClient;
    await expect(
      openPanel(client, { panelId: "p", root: { type: "text", content: "x" } }),
    ).resolves.toBeNull();
  });

  it("resolves null (never throws) when openLive rejects", async () => {
    const client = {
      ensureConnected: async () => ALL_SLOTS,
      hello: ALL_SLOTS,
      openLive: vi.fn(async () => {
        throw new Error("disposed");
      }),
    } as unknown as DesktopViewClient;
    await expect(
      openPanel(client, { panelId: "p", root: { type: "text", content: "x" } }),
    ).resolves.toBeNull();
  });
});

describe("openSidebar", () => {
  it("opens the left nav slot", async () => {
    const { client, openLive } = fakeClient(ALL_SLOTS);
    await openSidebar(client, { panelId: "nav", root: { type: "text", content: "x" } });
    const spec = lastSpec(openLive);
    expect(spec.placement).toBe("sidebar");
    expect(spec.placementRequired).toBe(true);
    expect(spec.placementHint).toEqual({ panelId: "nav" });
  });

  it("tolerates an omitted panelId", async () => {
    const { client, openLive } = fakeClient(ALL_SLOTS);
    await openSidebar(client, { root: { type: "text", content: "x" } });
    expect(lastSpec(openLive).placementHint).toEqual({ panelId: undefined });
  });
});

describe("openSettingsView", () => {
  it("opens the settings page slot", async () => {
    const { client, openLive } = fakeClient(ALL_SLOTS);
    await openSettingsView(client, { panelId: "creds", root: { type: "text", content: "x" } });
    const spec = lastSpec(openLive);
    expect(spec.placement).toBe("settings");
    expect(spec.placementRequired).toBe(true);
    expect(spec.placementHint).toEqual({ panelId: "creds" });
  });

  it("resolves null when the host does not advertise settings", async () => {
    const { client, openLive } = fakeClient({
      protocol: "view/v1",
      placements: ["modal", "panel"],
    });
    expect(
      await openSettingsView(client, { panelId: "c", root: { type: "text", content: "x" } }),
    ).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });
});
