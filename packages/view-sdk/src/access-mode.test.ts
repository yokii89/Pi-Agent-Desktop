import { describe, expect, it, vi } from "vitest";
import type { DesktopViewClient, LiveViewSession, ViewSessionEvent } from "./client.js";
import { ACCESS_MODE_ACTIONS, registerAccessMode } from "./index.js";
import type { ViewHelloPayload } from "./types.js";

interface FakeSession {
  session: LiveViewSession;
  update: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

/**
 * Fake LiveViewSession. The host outcome (opened / error) is emitted on a
 * timer so registerAccessMode's awaitOpened subscribes first — same ordering
 * as a real socket.
 */
function fakeSession(outcome: "opened" | "refused"): FakeSession {
  const handlers = new Set<(event: ViewSessionEvent) => void>();
  let resolveClosed!: (payload: { reason?: string } | null) => void;
  const update = vi.fn();
  const close = vi.fn();
  const session = {
    id: "view-test-1",
    placement: null,
    panelId: null,
    headerSide: null,
    update,
    close,
    onEvent(handler: (event: ViewSessionEvent) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    closed: new Promise<{ reason?: string } | null>((resolve) => {
      resolveClosed = resolve;
    }),
  } as unknown as LiveViewSession;
  setTimeout(() => {
    if (outcome === "opened") {
      for (const handler of [...handlers]) {
        handler({ type: "opened", placement: "access-mode" });
      }
    } else {
      for (const handler of [...handlers]) {
        handler({ type: "error", error: { message: "refused", code: "placement" } });
      }
      resolveClosed({ reason: "placement" });
    }
  }, 0);
  return { session, update, close };
}

function fakeClient(hello: ViewHelloPayload | null, session?: FakeSession) {
  const openLive = vi.fn(async () => session?.session ?? fakeSession("opened").session);
  const client = {
    ensureConnected: async () => hello,
    hello,
    openLive,
  };
  return { client: client as unknown as DesktopViewClient, openLive };
}

const HELLO_WITH_SLOT: ViewHelloPayload = {
  protocol: "view/v1",
  placements: ["modal", "access-mode"],
};

describe("registerAccessMode", () => {
  it("exposes the host action ids in lockstep", () => {
    expect(ACCESS_MODE_ACTIONS).toEqual({
      activate: "mode:activate",
      deactivate: "mode:deactivate",
    });
  });

  it("resolves null without hello (old host) and never opens", async () => {
    const { client, openLive } = fakeClient(null);
    const handle = await registerAccessMode(client, { id: "m", title: "M" });
    expect(handle).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("resolves null when hello lacks access-mode and never opens", async () => {
    const { client, openLive } = fakeClient({
      protocol: "view/v1",
      placements: ["modal", "widget"],
    });
    const handle = await registerAccessMode(client, { id: "m", title: "M" });
    expect(handle).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("opens with the access-mode spec and reports state via setActive", async () => {
    const session = fakeSession("opened");
    const { client, openLive } = fakeClient(HELLO_WITH_SLOT, session);
    const handle = await registerAccessMode(client, {
      id: "yoki-plan",
      title: "计划模式",
      description: "只读探索",
      icon: "clipboard",
      accent: "warning",
    });
    expect(handle).not.toBeNull();
    expect(openLive).toHaveBeenCalledTimes(1);
    const spec = openLive.mock.calls[0][0];
    expect(spec.placement).toBe("access-mode");
    expect(spec.placementRequired).toBe(true);
    expect(spec.placementHint?.mode).toMatchObject({
      id: "yoki-plan",
      title: "计划模式",
      description: "只读探索",
      icon: "clipboard",
      accent: "warning",
    });

    handle?.setActive(true, "只读：edit/write 已禁用");
    expect(session.update).toHaveBeenCalledWith({
      placementHint: {
        mode: expect.objectContaining({
          id: "yoki-plan",
          active: true,
          detail: "只读：edit/write 已禁用",
        }),
      },
    });

    handle?.setActive(false);
    expect(session.update).toHaveBeenLastCalledWith({
      placementHint: {
        mode: expect.objectContaining({ id: "yoki-plan", active: false }),
      },
    });
  });

  it("resolves null and closes the session when the host refuses the slot", async () => {
    const session = fakeSession("refused");
    const { client } = fakeClient(HELLO_WITH_SLOT, session);
    const handle = await registerAccessMode(client, { id: "m", title: "M" });
    expect(handle).toBeNull();
    expect(session.close).toHaveBeenCalled();
  });

  it("resolves null for an already-aborted signal", async () => {
    const { client, openLive } = fakeClient(HELLO_WITH_SLOT);
    const controller = new AbortController();
    controller.abort();
    const handle = await registerAccessMode(client, {
      id: "m",
      title: "M",
      signal: controller.signal,
    });
    expect(handle).toBeNull();
    expect(openLive).not.toHaveBeenCalled();
  });

  it("rejects empty id/title before opening and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { client, openLive } = fakeClient(HELLO_WITH_SLOT);
      expect(await registerAccessMode(client, { id: "  ", title: "M" })).toBeNull();
      expect(await registerAccessMode(client, { id: "m", title: "" })).toBeNull();
      expect(openLive).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("resolves null (never throws) when the connection fails", async () => {
    const client = {
      ensureConnected: async () => {
        throw new Error("View Host connect timeout (5000ms)");
      },
      hello: null,
      openLive: vi.fn(),
    } as unknown as DesktopViewClient;
    await expect(registerAccessMode(client, { id: "m", title: "M" })).resolves.toBeNull();
  });

  it("resolves null (never throws) when the client is disposed", async () => {
    const client = {
      ensureConnected: async () => {
        throw new Error("DesktopViewClient already disposed");
      },
      hello: null,
      openLive: vi.fn(async () => {
        throw new Error("DesktopViewClient disposed");
      }),
    } as unknown as DesktopViewClient;
    await expect(registerAccessMode(client, { id: "m", title: "M" })).resolves.toBeNull();
  });

  it("skips session close when openLive rejects before a session exists", async () => {
    const session = fakeSession("opened");
    const closeSpy = session.close;
    const client = {
      ensureConnected: async () => HELLO_WITH_SLOT,
      hello: HELLO_WITH_SLOT,
      openLive: vi.fn(async () => {
        throw new Error("disposed");
      }),
    } as unknown as DesktopViewClient;
    await expect(registerAccessMode(client, { id: "m", title: "M" })).resolves.toBeNull();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
