import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPushMessage } from "../../shared/ipc";
import { type Grant, RELAY_FEATURES } from "../../shared/remote";

const fixture = vi.hoisted(() => ({
  owner: `account-v1-${"a".repeat(64)}`,
  desktop: "00000000-0000-4000-8000-000000000001",
  grant: null as Grant | null,
  sessions: [] as {
    id: string;
    projectId: string;
    title: string;
    status: "running" | "waiting" | "idle";
    updatedAt: number;
    preview: string;
  }[],
  interactions: [] as { id: string; sessionId: string }[],
  eventListeners: new Set<(event: SessionPushMessage) => void>(),
}));

vi.mock("./desktopAuth", () => ({
  desktopAccessToken: async () => "header.payload.signature",
  desktopAuthGeneration: () => 0,
  hasDesktopAuth: () => true,
  loginDesktop: async () => ({
    accessToken: "header.payload.signature",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 300_000,
  }),
  clearDesktopAuth: vi.fn(),
  cancelDesktopLogin: vi.fn(),
  revokeDesktopAuth: vi.fn(async () => {}),
  desktopAuthSnapshot: () => ({ phase: "signed_in", identity: null, deadline: null, error: null }),
  desktopAuthError: (cause: unknown, fallback: string) =>
    cause instanceof Error && /^(AUTH_|ACCOUNT_)/.test(cause.message) ? cause.message : fallback,
}));
vi.mock("../settings/remoteEnrollmentStore", () => ({
  loadRemoteEnrollment: () => null,
  saveRemoteEnrollment: vi.fn(),
  clearRemoteEnrollmentDraft: vi.fn(),
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
  clearRemoteCredential: vi.fn(),
  remoteStorageAvailable: () => true,
}));
vi.mock("../settings/settings", () => ({
  getSettings: () => ({ projects: [{ id: "project", name: "Project" }] }),
}));
vi.mock("../session/idleReclaim", () => ({ setRemoteViewing: () => () => {} }));
vi.mock("../session/sessionEvents", () => ({
  subscribeSessionEvents: (listener: (event: SessionPushMessage) => void) => {
    fixture.eventListeners.add(listener);
    return () => fixture.eventListeners.delete(listener);
  },
  subscribeSessionUiEvents: () => () => {},
}));
vi.mock("./desktopSource", () => ({
  DesktopReadOnlySource: class {
    projects = () => [
      { id: "project", name: "Project", description: { "zh-CN": "", "en-US": "" } },
    ];
    observe = () => true;
    sessions = async () => fixture.sessions;
    interactions = async () => fixture.interactions;
    notificationSession = async () => ({ id: "session-id", title: "Task", projectId: "project" });
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
  fixture.sessions = [];
  fixture.interactions = [];
  fixture.eventListeners.clear();
  const now = Date.now();
  fixture.grant = {
    relayInstanceId: "relay",
    desktopId: fixture.desktop,
    deviceId: "phone",
    grantId: "grant",
    grantVersion: 1,
    state: "active",
    scopes: ["projects.read", "sessions.read", "interactions.read"],
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
  await service.setAccount({ relayOrigin: "https://relay.example" });
  const socket = FakeSocket.instances[0];
  socket.onopen?.();
  socket.receive({
    controlVersion: 2,
    type: "authenticated",
    securityProfile: "trusted-relay-tls-v1",
    features: RELAY_FEATURES,
    accountExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    desktopOnline: true,
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
function pendingAccountLookup() {
  let resolve!: (response: Response) => void;
  let reject!: (cause: Error) => void;
  let requestId: string | null = null;
  const response = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
    requestId = new Headers(init?.headers).get("X-Request-Id");
    return response;
  });
  return {
    wait: () => vi.waitFor(() => expect(requestId).not.toBeNull()),
    complete: () =>
      resolve(
        Response.json({
          controlVersion: 2,
          requestId,
          serverTime: new Date().toISOString(),
          data: { accountId: fixture.owner, accountStatus: "active" },
        }),
      ),
    fail: () => reject(new Error("Delayed network failure")),
  };
}

describe("desktop v2 service", () => {
  it.each([false, true])(
    "ignores account restoration completing after pause (reconnect: %s)",
    async (reconnect) => {
      const pending = pendingAccountLookup();
      const stale = service.start();
      await pending.wait();
      service.stop();
      if (reconnect) await service.start();
      pending.complete();
      await stale;
      expect(FakeSocket.instances).toHaveLength(reconnect ? 1 : 0);
      expect(service.snapshot().error).toBeNull();
    },
  );
  it.each([false, true])(
    "ignores account restoration failing after pause (reconnect: %s)",
    async (reconnect) => {
      const pending = pendingAccountLookup();
      const stale = service.start();
      await pending.wait();
      service.stop();
      if (reconnect) await service.start();
      pending.fail();
      await stale;
      expect(FakeSocket.instances).toHaveLength(reconnect ? 1 : 0);
      expect(service.snapshot().error).toBeNull();
    },
  );
  it("ignores duplicate starts while account restoration is in progress", async () => {
    const pending = pendingAccountLookup();
    const first = service.start();
    await pending.wait();
    await service.start();
    expect(fetch).toHaveBeenCalledOnce();
    pending.complete();
    await first;
    expect(FakeSocket.instances).toHaveLength(1);
  });
  it("does not reconnect after an explicit account login is paused", async () => {
    const pending = pendingAccountLookup();
    const login = service.setAccount({ relayOrigin: "https://relay.example" });
    await pending.wait();
    service.stop();
    pending.complete();
    await expect(login).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(FakeSocket.instances).toHaveLength(0);
    expect(service.snapshot().error).toBeNull();
  });
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
  it("syncs a locally revoked grant during the online reconciliation tick", async () => {
    await connected();
    const activeGrant = fixture.grant;
    if (!activeGrant) throw new Error("Missing active grant");
    fixture.grant = {
      ...activeGrant,
      state: "revoked",
      grantVersion: 2,
      revokedAt: new Date().toISOString(),
      revocationReason: "project_configuration_changed",
    };
    await (service as unknown as { tick: () => Promise<void> }).tick();
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/devices/phone/revoke")),
    ).toBe(true);
    expect(service.snapshot().revocationPending).toBe(false);
  });
  it("sends finished and failed notifications for observed session completions", async () => {
    const socket = await connected();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.sessions = [
      {
        id: "session-id",
        projectId: "project",
        title: "Task",
        status: "idle",
        updatedAt: Date.now(),
        preview: "",
      },
    ];
    const dispatchNotifications = () =>
      (
        service as unknown as { dispatchTaskNotifications: () => Promise<void> }
      ).dispatchTaskNotifications();
    await dispatchNotifications();
    fixture.sessions[0].title = `Task\n${"😀".repeat(100)}`;
    fixture.interactions = [{ id: "interaction-id", sessionId: "session-id" }];
    await dispatchNotifications();
    const interactionFrame = socket.send.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .find(
        (frame) => frame.type === "task_notification" && frame.notification.kind === "interaction",
      );
    const sentTitle = String(interactionFrame?.notification.title ?? "");
    expect(sentTitle).toHaveLength(127);
    expect(
      Array.from(sentTitle).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      }),
    ).toBe(false);
    fixture.interactions = [];
    await dispatchNotifications();
    const publish = (kind: "start" | "finished" | "failed") => {
      const payload =
        kind === "start"
          ? { type: "agent_start" as const }
          : kind === "failed"
            ? { type: "agent_settled" as const, aborted: true }
            : { type: "agent_settled" as const };
      for (const listener of fixture.eventListeners)
        listener({ sessionId: "runtime-session-id", type: "event", payload });
    };
    fixture.sessions[0].status = "running";
    publish("start");
    await dispatchNotifications();
    fixture.sessions[0].status = "idle";
    publish("finished");
    await dispatchNotifications();
    await vi.waitFor(() =>
      expect(
        socket.send.mock.calls.some(
          ([raw]) =>
            JSON.parse(raw).type === "task_notification" &&
            JSON.parse(raw).notification.kind === "finished",
        ),
      ).toBe(true),
    );
    fixture.sessions[0].status = "running";
    publish("start");
    await dispatchNotifications();
    fixture.sessions[0].status = "idle";
    publish("failed");
    await dispatchNotifications();
    await vi.waitFor(() =>
      expect(
        socket.send.mock.calls.some(
          ([raw]) =>
            JSON.parse(raw).type === "task_notification" &&
            JSON.parse(raw).notification.kind === "failed",
        ),
      ).toBe(true),
    );
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
