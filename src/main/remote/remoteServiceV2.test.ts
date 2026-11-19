import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Grant } from "../../shared/remote";

const fixture = vi.hoisted(() => ({
  owner: `account-v1-${"a".repeat(64)}`,
  desktop: "00000000-0000-4000-8000-000000000001",
  grant: null as Grant | null,
}));
vi.mock("../settings/remoteStore", () => ({
  loadRemoteCredential: () => ({
    version: 1,
    controlVersion: 2,
    accountId: fixture.owner,
    relayOrigin: "https://relay.example",
    relayInstanceId: "relay",
    desktopId: fixture.desktop,
    desktopCredential: "d".repeat(43),
    expiresAt: "2099-01-01T00:00:00Z",
  }),
  loadRemoteGrant: () => fixture.grant,
  saveRemoteGrant: (grant: Grant) => {
    fixture.grant = grant;
  },
  loadRemoteOperations: () => [],
  saveRemoteOperations: vi.fn(),
  saveRemoteCredential: vi.fn(),
  remoteStorageAvailable: () => true,
}));
vi.mock("../settings/settings", () => ({
  getSettings: () => ({ projects: [{ id: "project", name: "Project" }] }),
}));
vi.mock("../session/idleReclaim", () => ({ setRemoteViewing: () => () => {} }));
vi.mock("../session/sessionEvents", () => ({
  subscribeSessionEvents: () => () => {},
  subscribeSessionUiEvents: () => () => {},
}));
vi.mock("./desktopSource", () => ({
  DesktopReadOnlySource: class {
    projects = () => [
      { id: "project", name: "Project", description: { "zh-CN": "", "en-US": "" } },
    ];
  },
}));
vi.mock("./relaySocket", () => ({
  relaySocket: (url: string, headers: Record<string, string>) => new FakeSocket(url, headers),
}));
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
  });
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {
    FakeSocket.instances.push(this);
  }
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

import { RemoteService, remoteService } from "./remoteService";

remoteService.dispose();
let service: RemoteService;
const accountToken = "header.payload.signature";
beforeEach(() => {
  vi.stubGlobal("WebSocket", { OPEN: 1 });
  FakeSocket.instances = [];
  const now = Date.now();
  fixture.grant = {
    relayInstanceId: "relay",
    desktopId: fixture.desktop,
    deviceId: "phone",
    grantId: "grant",
    grantVersion: 1,
    state: "active",
    scopes: ["projects.read", "sessions.read"],
    projectIds: ["project"],
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    revokedAt: null,
    revocationReason: null,
    approvalId: "approval",
    activationId: "activation",
    activationExpiresAt: new Date(now + 300_000).toISOString(),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const path = new URL(url).pathname;
      const data =
        path === "/v2/account/me"
          ? { accountId: fixture.owner, accountStatus: "active" }
          : path.endsWith("/auth/desktop-access")
            ? {
                accessToken: "a".repeat(43),
                accessExpiresAt: new Date(now + 300_000).toISOString(),
              }
            : { grant: fixture.grant };
      return {
        status: 200,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            controlVersion: 2,
            requestId: init.headers["X-Request-Id"],
            serverTime: new Date().toISOString(),
            data,
          }),
      };
    }),
  );
  service = new RemoteService();
});
afterEach(() => {
  service.dispose();
  vi.unstubAllGlobals();
});
async function connected() {
  await service.setAccount({ relayOrigin: "https://relay.example", accessToken: accountToken });
  const socket = FakeSocket.instances[0];
  socket.onopen?.();
  socket.receive({
    controlVersion: 2,
    type: "authenticated",
    securityProfile: "trusted-relay-tls-v1",
    principal: {
      accountId: fixture.owner,
      role: "desktop",
      relayInstanceId: "relay",
      desktopId: fixture.desktop,
      deviceId: fixture.desktop,
      grantId: "desktop-grant",
      grantVersion: 1,
      connectionGeneration: 1,
      accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  });
  await vi.waitFor(() => expect(service.snapshot().connected).toBe(true));
  return socket;
}
function route(accountId = fixture.owner) {
  return {
    controlVersion: 2,
    type: "route",
    deliverySequence: 1,
    context: {
      accountId,
      relayInstanceId: "relay",
      desktopId: fixture.desktop,
      deviceId: "phone",
      grantId: "grant",
      grantVersion: 1,
      connectionGeneration: 1,
      accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
    frame: { version: 1, type: "request", id: randomUUID(), command: "projects.list", payload: {} },
  };
}
describe("desktop v2 service", () => {
  it("authenticates the upgrade with the account and ACKs routed business frames", async () => {
    const socket = await connected();
    expect(socket.url).toBe(`wss://relay.example/v2/connect/${fixture.desktop}`);
    expect(socket.headers).toMatchObject({
      Authorization: `Bearer ${accountToken}`,
      "X-PiDesk-Control-Version": "2",
    });
    socket.receive(route());
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(3));
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({
      controlVersion: 2,
      type: "ack",
      deliverySequence: 1,
    });
    expect(JSON.parse(socket.send.mock.calls[2][0])).toMatchObject({
      controlVersion: 2,
      type: "deliver",
      context: { accountId: fixture.owner },
      frame: { status: "completed", data: { projects: [{ id: "project" }] } },
    });
  });
  it("closes on another account's context before exposing project data", async () => {
    const socket = await connected();
    socket.receive(route(`account-v1-${"b".repeat(64)}`));
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalled());
    expect(socket.send).toHaveBeenCalledTimes(1);
  });
  it("bounds queued UTF-8 bytes independently of the pending frame count", async () => {
    const socket = await connected();
    const request = route();
    request.frame.payload = { text: "文".repeat(20_000) };
    for (let i = 0; i < 4; i++) socket.receive({ ...request, deliverySequence: i + 1 });
    expect(socket.close).not.toHaveBeenCalled();
    socket.receive({ ...request, deliverySequence: 5 });
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it("bounds pending input even if a peer sends without receiving credit", async () => {
    const socket = await connected();
    for (let i = 0; i < 9; i++) socket.receive({ ...route(), deliverySequence: i + 1 });
    expect(socket.close).toHaveBeenCalled();
  });
});
