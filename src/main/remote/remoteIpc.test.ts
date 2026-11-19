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
  it("preserves the exact claim, projects and permissions for explicit approval", async () => {
    const request = {
      claimId: "claim-1",
      projects: ["project-1"],
      scopes: ["projects.read", "sessions.read"],
    };
    expect(await f.handlers.get(REMOTE_IPC.approve)?.(event(), request)).toEqual({
      ok: true,
      data: { connected: true },
    });
    expect(f.approve).toHaveBeenCalledWith(request.claimId, request.projects, request.scopes);
  });
  it("rejects the old approval payload without invoking the service", async () => {
    expect(await f.handlers.get(REMOTE_IPC.approve)?.(event(), { id: "phone-1" })).toMatchObject({
      ok: false,
    });
    expect(f.approve).not.toHaveBeenCalled();
  });
});
