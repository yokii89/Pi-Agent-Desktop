import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Grant } from "../../shared/remote";

const f = vi.hoisted(() => ({
  request: vi.fn(),
  poll: vi.fn(async () => {}),
  reconcile: vi.fn(async () => {}),
  grant: null as Grant | null,
  saveGrant: vi.fn(),
  credential: {
    version: 1,
    relayOrigin: "https://relay.example",
    desktopId: "desktop-1",
    relayInstanceId: "relay-1",
    desktopCredential: "credential",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));
vi.mock("../../shared/remote", async (original) => {
  const actual = await original<typeof import("../../shared/remote")>();
  return {
    ...actual,
    ControlClient: class {
      request = f.request;
      now = Date.now;
    },
  };
});
vi.mock("../settings/remoteStore", () => ({
  loadRemoteCredential: () => f.credential,
  loadRemoteGrant: () => f.grant,
  loadRemoteOperations: () => [],
  saveRemoteOperations: vi.fn(),
  saveRemoteGrant: f.saveGrant,
  saveRemoteCredential: vi.fn(),
  remoteStorageAvailable: () => true,
}));
vi.mock("../settings/settings", () => ({ getSettings: () => ({ projects: [] }) }));
vi.mock("../session/idleReclaim", () => ({ setRemoteViewing: () => () => {} }));
vi.mock("../session/sessionEvents", () => ({
  subscribeSessionEvents: () => () => {},
  subscribeSessionUiEvents: () => () => {},
}));
vi.mock("./desktopSource", () => ({
  DesktopReadOnlySource: class {
    projects = () => [];
  },
}));
vi.mock("./desktopPairing", () => ({
  DesktopPairing: class {
    qr = { invitationSecret: "private-invitation" };
    claim = { claimId: "claim-1" };
    grant = null;
    poll = f.poll;
    reconcile = f.reconcile;
  },
}));

import { RemoteService, remoteService } from "./remoteService";

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
}
let service: RemoteService;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  f.grant = null;
  f.saveGrant.mockImplementation((grant: Grant) => {
    f.grant = grant;
  });
  vi.stubGlobal("WebSocket", FakeSocket);
  FakeSocket.instances = [];
  f.request.mockResolvedValue({ token: "access", expires: Date.now() + 300_000 });
  service = new RemoteService();
});
afterEach(() => {
  service.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
remoteService.dispose();

const authenticate = async (socket: FakeSocket) => {
  socket.onmessage?.({
    data: JSON.stringify({
      controlVersion: 1,
      type: "authenticated",
      securityProfile: "trusted-relay-tls-v1",
      principal: {
        role: "desktop",
        desktopId: "desktop-1",
        relayInstanceId: "relay-1",
        deviceId: "desktop-1",
        grantId: "grant-1",
        grantVersion: 1,
        connectionGeneration: 1,
        accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    }),
  });
  await Promise.resolve();
  await Promise.resolve();
};

describe("remote service pause and shutdown", () => {
  it("does not open a socket when an access request finishes after pause", async () => {
    let resolve!: (value: { token: string; expires: number }) => void;
    f.request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const starting = service.start();
    service.stop();
    resolve({ token: "late-access", expires: Date.now() + 300_000 });
    await starting;
    expect(FakeSocket.instances).toHaveLength(0);
    expect(service.snapshot()).toMatchObject({ connected: false, qr: null, claim: null });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("allows a fresh connection while ignoring completion of an earlier request", async () => {
    let resolve!: (value: { token: string; expires: number }) => void;
    f.request.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const stale = service.start();
    service.stop();
    await service.start();
    resolve({ token: "stale", expires: Date.now() + 300_000 });
    await stale;
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toBe("wss://relay.example/v1/connect/desktop-1");
  });
  it.each([false, true])(
    "ignores an old socket's reconciliation failure after pause (reconnect: %s)",
    async (reconnect) => {
      let reject!: (cause: Error) => void;
      f.reconcile.mockReturnValueOnce(
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
      );
      await service.start();
      const oldSocket = FakeSocket.instances[0];
      await authenticate(oldSocket);
      expect(f.reconcile).toHaveBeenCalledOnce();
      service.stop();
      if (reconnect) {
        await service.start();
        await authenticate(FakeSocket.instances[1]);
        expect(service.snapshot().connected).toBe(true);
      }
      reject(new Error("stale connection failed"));
      await vi.advanceTimersByTimeAsync(0);
      expect(service.snapshot()).toMatchObject({ connected: reconnect, error: null });
      if (reconnect) expect(FakeSocket.instances[1].close).not.toHaveBeenCalled();
    },
  );
  it("clears pairing secrets and timers on pause, retaining only enrollment", async () => {
    await service.start();
    expect(service.snapshot().qr).not.toBeNull();
    service.stop();
    expect(service.snapshot()).toMatchObject({
      configured: true,
      connected: false,
      qr: null,
      claim: null,
    });
    expect(FakeSocket.instances[0].close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("revokes the local grant while paused and defers relay reconciliation until reconnect", async () => {
    f.grant = {
      relayInstanceId: "relay-1",
      desktopId: "desktop-1",
      deviceId: "phone-1",
      grantId: "grant-1",
      grantVersion: 1,
      state: "active",
      scopes: ["projects.read", "sessions.read"],
      projectIds: ["project-1"],
      createdAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      approvalId: "approval-1",
      activationId: "activation-1",
      activationExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      revokedAt: null,
      revocationReason: null,
    };
    await service.start();
    service.stop();
    const state = await service.revoke();
    expect(state).toMatchObject({
      connected: false,
      revocationPending: true,
      grant: { state: "revoked", revocationReason: "user_revoked" },
    });
    expect(f.saveGrant).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not recreate polling after an in-flight poll completes following pause", async () => {
    await service.start();
    await authenticate(FakeSocket.instances[0]);
    expect(service.snapshot().connected).toBe(true);
    let resolve!: () => void;
    f.poll.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.poll).toHaveBeenCalledOnce();
    service.stop();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.snapshot()).toMatchObject({ connected: false, qr: null, claim: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
