import { beforeEach, describe, expect, it, vi } from "vitest";
import { REMOTE_IPC } from "../../shared/remoteDesktop";

const f = vi.hoisted(() => {
  const frame = {};
  const contents = { mainFrame: frame };
  return {
    handlers: new Map<string, (event: unknown, request?: unknown) => unknown>(),
    window: { isDestroyed: vi.fn(() => false), webContents: contents },
    snapshot: vi.fn(() => ({ connected: false })),
    approve: vi.fn(async () => ({ connected: true })),
    enroll: vi.fn(),
    setAccount: vi.fn(),
    cancelLogin: vi.fn(() => ({ connected: false })),
    resetEnrollment: vi.fn(async () => ({ configured: false })),
    desktops: vi.fn(async () => []),
    removeDesktop: vi.fn(async () => ({ configured: false })),
    logout: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    invite: vi.fn(),
    reject: vi.fn(),
    revoke: vi.fn(),
  };
});
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, action: (event: unknown, request?: unknown) => unknown) => {
      if (f.handlers.has(channel)) throw new Error("DUPLICATE_HANDLER");
      f.handlers.set(channel, action);
    },
  },
}));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => f.window }));
vi.mock("./remoteService", () => ({ remoteService: f }));

import { registerRemoteIpc } from "./remoteIpc";

beforeEach(() => {
  vi.clearAllMocks();
  f.handlers.clear();
  f.window.isDestroyed.mockReturnValue(false);
  registerRemoteIpc();
});
const event = () => ({ sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame });

describe("remote IPC caller boundary", () => {
  it("registers exactly one handler per current API command", () => {
    expect([...f.handlers.keys()].sort()).toEqual(Object.values(REMOTE_IPC).sort());
  });
  it("rejects foreign windows, subframes and destroyed windows on every channel", async () => {
    for (const handler of f.handlers.values()) {
      expect(await handler({ ...event(), sender: {} })).toEqual({
        ok: false,
        error: "UNTRUSTED_SENDER",
      });
      expect(await handler({ ...event(), senderFrame: {} })).toEqual({
        ok: false,
        error: "UNTRUSTED_SENDER",
      });
      f.window.isDestroyed.mockReturnValue(true);
      expect(await handler(event())).toEqual({ ok: false, error: "UNTRUSTED_SENDER" });
      f.window.isDestroyed.mockReturnValue(false);
    }
    for (const action of [
      f.snapshot,
      f.approve,
      f.enroll,
      f.setAccount,
      f.cancelLogin,
      f.resetEnrollment,
      f.desktops,
      f.removeDesktop,
      f.logout,
      f.start,
      f.stop,
      f.invite,
      f.reject,
      f.revoke,
    ])
      expect(action).not.toHaveBeenCalled();
  });
  it("returns the standard envelope for a trusted caller", async () => {
    expect(await f.handlers.get(REMOTE_IPC.snapshot)?.(event())).toEqual({
      ok: true,
      data: { connected: false },
    });
  });
  it("submits only the approved claim id; projects and scopes are not caller-selectable", async () => {
    const request = { claimId: "claim-1" };
    expect(await f.handlers.get(REMOTE_IPC.approve)?.(event(), request)).toEqual({
      ok: true,
      data: { connected: true },
    });
    expect(f.approve).toHaveBeenCalledWith(request.claimId);
  });
  it("exposes cancellation and explicit reset through the trusted envelope", async () => {
    expect(await f.handlers.get(REMOTE_IPC.cancelLogin)?.(event())).toMatchObject({ ok: true });
    expect(
      await f.handlers.get(REMOTE_IPC.resetEnrollment)?.(event(), { localOnly: true }),
    ).toMatchObject({ ok: true });
    expect(f.resetEnrollment).toHaveBeenCalledWith(true);
    expect(
      await f.handlers.get(REMOTE_IPC.resetEnrollment)?.(event(), { localOnly: "true" }),
    ).toMatchObject({ ok: false, error: "INVALID_FRAME" });
    expect(f.resetEnrollment).toHaveBeenCalledOnce();
  });
  it("does not allow an extra field in directory removal requests", async () => {
    expect(
      await f.handlers.get(REMOTE_IPC.removeDesktop)?.(event(), {
        relayOrigin: "https://relay.example",
        desktopId: "desktop",
        accountId: "another-account",
      }),
    ).toMatchObject({ ok: false, error: "INVALID_FRAME" });
    expect(f.removeDesktop).not.toHaveBeenCalled();
  });
  it("rejects caller-selected project and scope fields", async () => {
    expect(
      await f.handlers.get(REMOTE_IPC.approve)?.(event(), {
        claimId: "claim-1",
        projects: ["project-1"],
        scopes: ["projects.read", "sessions.read"],
      }),
    ).toMatchObject({ ok: false, error: "INVALID_FRAME" });
    expect(f.approve).not.toHaveBeenCalled();
  });
});
