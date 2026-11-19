import { describe, expect, it, vi } from "vitest";
import { RelayAccountSession } from "./account";
import { ControlClient, type ControlFetch } from "./client";
import { parseMeta, parseMobileCredential, parseQr, SECURITY_PROFILE } from "./contract";
import { controlPath, DeliveryReceiver, relayPrincipal } from "./v2";

const owner = `account-v1-${"a".repeat(64)}`;
const desktop = "00000000-0000-4000-8000-000000000001";
const reply = (init: Parameters<ControlFetch>[1], data: unknown, status = 200) => ({
  status,
  headers: new Headers(),
  text: async () =>
    JSON.stringify({
      controlVersion: 2,
      requestId: init.headers["X-Request-Id"],
      serverTime: new Date().toISOString(),
      data,
    }),
});
describe("v2 client boundary", () => {
  it("separates account and room credentials and retains stable mutation ids", async () => {
    const fetcher = vi.fn<ControlFetch>(async (_url, init) => reply(init, {}));
    const c = new ControlClient("https://relay.example", () => "new-id", fetcher, Date.now, {
      account: { accountId: owner, token: async () => "account-token" },
      desktopId: desktop,
    });
    await c.request(
      "POST",
      "/auth/refresh",
      "room-token",
      { controlVersion: 1, requestId: "forged" },
      (v) => v,
      "stable-id",
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`https://relay.example/v2/desktops/${desktop}/auth/refresh`);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer account-token",
      "X-PiDesk-Room-Authorization": "Bearer room-token",
      "X-PiDesk-Control-Version": "2",
      "X-Request-Id": "stable-id",
    });
    expect(JSON.parse(init.body ?? "")).toEqual({ controlVersion: 2, requestId: "stable-id" });
    expect(url).not.toContain("token");
    expect(init.redirect).toBe("error");
    expect(await c.socketHeaders()).toMatchObject({ Authorization: "Bearer account-token" });
  });
  it("only accepts v2 paths and valid desktop identities", () => {
    expect(controlPath("/reconcile", desktop)).toBe(`/v2/desktops/${desktop}/reconcile`);
    for (const path of [
      "/v1/desktops/enroll",
      "/v1/unknown",
      "/v2/desktops/x",
      "/v2/account/me/../../admin",
    ])
      expect(() => controlPath(path, desktop)).toThrow();
    expect(() => controlPath("/pairings", "invalid")).toThrow();
  });
  it("accepts anonymous meta's null request id and validates version", async () => {
    const c = new ControlClient(
      "https://relay.example",
      () => "req",
      async (_url, init) => ({
        ...reply(init, {}),
        text: async () =>
          JSON.stringify({
            controlVersion: 2,
            requestId: null,
            serverTime: new Date().toISOString(),
            data: "meta",
          }),
      }),
      Date.now,
      {
        account: {
          accountId: owner,
          token: async () => {
            throw new Error("not authenticated");
          },
        },
      },
    );
    expect(await c.request("GET", "/v2/meta", null, null, (v) => v)).toBe("meta");
  });
  it("invalidates previously captured account access on sign out", async () => {
    const session = new RelayAccountSession(
      () => "req",
      async (_url, init) => reply(init, { accountId: owner, accountStatus: "active" }),
    );
    await session.connect("https://relay.example", "header.payload.signature");
    const access = session.access("https://relay.example", owner);
    expect(() => session.access("https://other.example")).toThrow();
    expect(() => session.access("https://relay.example", `account-v1-${"b".repeat(64)}`)).toThrow();
    session.disconnect();
    await expect(access.token()).rejects.toThrow("ACCOUNT_CHANGED");
  });
  it("rejects cross-account principals and delivery gaps before handling content", () => {
    const principal = {
      accountId: owner,
      role: "mobile",
      relayInstanceId: "relay",
      desktopId: desktop,
      deviceId: "phone",
      grantId: "grant",
      grantVersion: 1,
      connectionGeneration: 1,
      accessExpiresAt: new Date().toISOString(),
    };
    expect(relayPrincipal(principal, owner)).toMatchObject({ accountId: owner });
    expect(() => relayPrincipal(principal, "other")).toThrow("AUTH_REQUIRED");
    const delivery = new DeliveryReceiver();
    expect(delivery.accept({ controlVersion: 2, deliverySequence: 1 })).toBe(1);
    expect(() => delivery.accept({ controlVersion: 2, deliverySequence: 1 })).toThrow(
      "RESYNC_REQUIRED",
    );
    expect(() => delivery.accept({ controlVersion: 2, deliverySequence: 3 })).toThrow(
      "RESYNC_REQUIRED",
    );
    expect(delivery.accept({ controlVersion: 2, deliverySequence: 2 })).toBe(2);
  });
  it("rejects retired pairing QR and metadata versions", () => {
    const qr = {
      kind: "pidesk.pairing",
      pairingVersion: 2,
      relayOrigin: "https://relay.example",
      relayInstanceId: "relay",
      desktopId: desktop,
      invitationId: "invitation",
      invitationSecret: "a".repeat(43),
      expiresAt: "2099-01-01T00:00:00Z",
    };
    expect(parseQr(JSON.stringify(qr)).pairingVersion).toBe(2);
    expect(() => parseQr(JSON.stringify({ ...qr, pairingVersion: 1 }))).toThrow("VERSION_MISMATCH");
    const meta = {
      relayInstanceId: "relay",
      controlVersion: 2,
      businessVersion: 1,
      securityProfile: SECURITY_PROFILE,
      maxDesktops: 5,
      membershipLeaseMs: 30_000,
      deliveryAck: "cumulative-v1",
    };
    expect(parseMeta(meta).controlVersion).toBe(2);
    expect(() => parseMeta({ ...meta, controlVersion: 1 })).toThrow("VERSION_MISMATCH");
    expect(() =>
      parseMeta({ relayInstanceId: "relay", controlVersion: 1, securityProfile: SECURITY_PROFILE }),
    ).toThrow();
  });
  it("requires account-scoped credentials without filling missing legacy fields", () => {
    const credential = {
      version: 1,
      controlVersion: 2,
      accountId: owner,
      relayOrigin: "https://relay.example",
      securityProfile: SECURITY_PROFILE,
      relayInstanceId: "relay",
      desktopId: desktop,
      deviceId: "phone",
      grantId: "grant",
      grantVersion: 1,
      refreshToken: "a".repeat(43),
      grantExpiresAt: "2099-01-01T00:00:00Z",
      refreshExpiresAt: "2099-01-01T00:00:00Z",
      activationId: "activation",
      activationExpiresAt: "2099-01-01T00:00:00Z",
      state: "active",
      refreshPending: false,
      scopes: ["projects.read", "sessions.read"],
      projectIds: ["project"],
      pendingOperations: [],
    };
    expect(parseMobileCredential(credential)).toEqual(credential);
    expect(() => parseMobileCredential({ ...credential, controlVersion: 1 })).toThrow(
      "VERSION_MISMATCH",
    );
    for (const key of [
      "controlVersion",
      "accountId",
      "scopes",
      "projectIds",
      "pendingOperations",
    ]) {
      const incomplete: Record<string, unknown> = { ...credential };
      delete incomplete[key];
      expect(() => parseMobileCredential(incomplete)).toThrow();
    }
  });
});
