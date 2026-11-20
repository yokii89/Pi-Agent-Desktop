import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCredential, Grant } from "../../shared/remote";
import type { DesktopEnrollmentDraft, DesktopLoginPhase } from "../../shared/remoteDesktop";

const f = vi.hoisted(() => ({
  owner: `account-v1-${"a".repeat(64)}`,
  credential: null as DesktopCredential | null,
  draft: null as DesktopEnrollmentDraft | null,
  grant: null as Grant | null,
  credentialError: null as Error | null,
  authReady: true,
  authError: null as string | null,
  authPhase: "signed_in" as DesktopLoginPhase,
  accountFailure: false,
  deleteFailure: false,
  registration: "ok" as "ok" | "network" | "pending" | "lost",
  registrationBody: null as (() => Promise<unknown>) | null,
  rejectLogin: null as ((error: Error) => void) | null,
  events: [] as string[],
  registrationIds: [] as string[],
}));
vi.mock("./desktopAuth", () => ({
  desktopAccessToken: async () => {
    if (f.authError) throw new Error(f.authError);
    if (!f.authReady) throw new Error("ACCOUNT_AUTH_REQUIRED");
    return "account-token";
  },
  desktopAuthGeneration: () => 7,
  hasDesktopAuth: () => {
    if (f.authError) throw new Error(f.authError);
    return f.authReady;
  },
  desktopAuthSnapshot: () => ({
    phase: f.authPhase,
    identity: null,
    deadline: null,
    error: f.authError,
  }),
  desktopAuthError: (cause: unknown, fallback: string) =>
    cause instanceof Error && /^(AUTH_|ACCOUNT_|SECURE_STORAGE)/.test(cause.message)
      ? cause.message
      : fallback,
  loginDesktop: vi.fn(async () => {
    f.authReady = true;
    f.authPhase = "signed_in";
    f.authError = null;
    return {
      accessToken: "account-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 300_000,
    };
  }),
  cancelDesktopLogin: vi.fn(() => {
    f.rejectLogin?.(new Error("AUTH_CANCELLED"));
    f.rejectLogin = null;
  }),
  revokeDesktopAuth: vi.fn(async () => {
    f.authReady = false;
    f.authPhase = "signed_out";
    f.authError = null;
  }),
}));
vi.mock("../settings/remoteStore", () => ({
  loadRemoteCredential: () => {
    if (f.credentialError) throw f.credentialError;
    return f.credential;
  },
  loadRemoteGrant: () => f.grant,
  loadRemoteOperations: () => [],
  saveRemoteOperations: vi.fn(),
  saveRemoteCredential: vi.fn((credential: DesktopCredential) => {
    f.credential = credential;
  }),
  saveRemoteGrant: vi.fn((grant: Grant) => {
    f.events.push("revoke-local");
    f.grant = grant;
  }),
  clearRemoteCredential: vi.fn(() => {
    f.events.push("clear-local");
    f.credential = null;
    f.grant = null;
    f.credentialError = null;
  }),
  remoteStorageAvailable: () => true,
}));
vi.mock("../settings/remoteEnrollmentStore", () => ({
  loadRemoteEnrollment: () => f.draft,
  saveRemoteEnrollment: vi.fn((draft: DesktopEnrollmentDraft) => {
    f.draft = structuredClone(draft);
  }),
  clearRemoteEnrollmentDraft: vi.fn(() => {
    f.draft = null;
  }),
}));
vi.mock("../settings/settings", () => ({ getSettings: () => ({ projects: [], theme: "dark" }) }));
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
vi.mock("./relaySocket", () => ({ relaySocket: vi.fn() }));

import { ControlError } from "../../shared/remote";
import { clearRemoteCredential, saveRemoteCredential } from "../settings/remoteStore";
import { loginDesktop } from "./desktopAuth";
import { RemoteService, remoteService } from "./remoteService";

const desktop = "00000000-0000-4000-8000-000000000001";
const otherDesktop = "00000000-0000-4000-8000-000000000002";
const origin = "https://relay.example";
const request = {
  controlVersion: 2 as const,
  relayOrigin: origin,
  displayName: "Test computer",
  registrationRequestId: "registration-request",
  trustRelay: true,
};
function credential(): DesktopCredential {
  return {
    version: 1,
    controlVersion: 2,
    accountId: f.owner,
    relayOrigin: origin,
    desktopId: desktop,
    relayInstanceId: "relay",
    desktopCredential: "d".repeat(43),
    expiresAt: "2099-01-01T00:00:00Z",
  };
}
function grant(): Grant {
  return {
    relayInstanceId: "relay",
    desktopId: desktop,
    deviceId: "phone",
    grantId: "grant",
    grantVersion: 1,
    state: "active",
    scopes: ["projects.read", "sessions.read"],
    projectIds: ["project"],
    createdAt: new Date().toISOString(),
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    revocationReason: null,
    approvalId: "approval",
    activationId: "activation",
    activationExpiresAt: "2099-01-01T00:00:00Z",
  };
}
function registrationData() {
  return {
    item: {
      desktopId: desktop,
      state: f.registration === "pending" ? "room_initializing" : "registered",
    },
    ...(f.registration === "ok"
      ? {
          credential: {
            desktopId: desktop,
            relayInstanceId: "relay",
            desktopCredential: "d".repeat(43),
            expiresAt: "2099-01-01T00:00:00Z",
          },
        }
      : {}),
  };
}
let service: RemoteService;
remoteService.dispose();
beforeEach(() => {
  vi.clearAllMocks();
  f.owner = `account-v1-${"a".repeat(64)}`;
  f.credential = null;
  f.draft = null;
  f.grant = null;
  f.credentialError = null;
  f.authReady = true;
  f.authPhase = "signed_in";
  f.authError = null;
  f.accountFailure = false;
  f.deleteFailure = false;
  f.registration = "ok";
  f.registrationBody = null;
  f.rejectLogin = null;
  f.events = [];
  f.registrationIds = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string; headers: Record<string, string> }) => {
      const path = new URL(url).pathname;
      let data: unknown;
      if (path === "/v2/account/me") {
        if (f.accountFailure) throw new TypeError("network unavailable");
        data = { accountId: f.owner, accountStatus: "active" };
      } else if (path === "/v2/meta") {
        data = {
          relayInstanceId: "relay",
          controlVersion: 2,
          businessVersion: 1,
          securityProfile: "trusted-relay-tls-v1",
          maxDesktops: 5,
          membershipLeaseMs: 30_000,
          deliveryAck: "cumulative-v1",
        };
      } else if (path === "/v2/account/me/desktops" && init.method === "POST") {
        f.registrationIds.push(init.headers["X-Request-Id"]);
        if (f.registration === "network") throw new TypeError("response lost");
        data = f.registrationBody ? await f.registrationBody() : registrationData();
      } else if (path === "/v2/account/me/desktops" && init.method === "GET") {
        data = { items: [], revision: 1, cursor: null, accountStatus: "active" };
      } else if (init.method === "DELETE") {
        f.events.push("delete-relay");
        if (f.deleteFailure) throw new TypeError("relay unavailable");
        data = { state: "revoked" };
      } else {
        throw new Error(`Unexpected path ${path}`);
      }
      return Response.json({
        controlVersion: 2,
        requestId: init.headers["X-Request-Id"],
        serverTime: new Date().toISOString(),
        data,
      });
    }),
  );
  service = new RemoteService();
});
afterEach(() => {
  service.dispose();
  vi.unstubAllGlobals();
});

describe("desktop enrollment recovery", () => {
  it("does not send account credentials to an origin the user has not confirmed", async () => {
    await expect(service.desktops("https://untrusted.example")).rejects.toMatchObject({
      code: "SECURITY_PROFILE_MISMATCH",
    });
    await expect(
      service.setAccount({ relayOrigin: "https://untrusted.example" }),
    ).rejects.toMatchObject({ code: "SECURITY_PROFILE_MISMATCH" });
    expect(fetch).not.toHaveBeenCalled();
    expect(loginDesktop).not.toHaveBeenCalled();
  });
  it("retains explicit directory access to a trusted relay after local-only reset", async () => {
    f.credential = credential();
    await service.resetEnrollment(true);
    expect(await service.desktops(origin)).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith(origin))).toBe(true);
  });
  it("rejects untrusted registration before acquiring account tokens or persisting intent", async () => {
    await expect(service.enroll({ ...request, trustRelay: false })).rejects.toMatchObject({
      code: "SECURITY_PROFILE_MISMATCH",
    });
    expect(f.draft).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains the registration request across service recreation and retries exactly the same id", async () => {
    f.registration = "network";
    await expect(service.enroll(request)).rejects.toMatchObject({ code: "NETWORK_UNCERTAIN" });
    expect(f.draft).toMatchObject({ registrationRequestId: request.registrationRequestId });
    service.dispose();
    service = new RemoteService();
    vi.spyOn(service, "start").mockResolvedValue();
    f.registration = "ok";
    await service.enroll({ ...request, registrationRequestId: "different-ui-request" });
    expect(f.registrationIds).toEqual([
      request.registrationRequestId,
      request.registrationRequestId,
    ]);
    expect(f.draft).toBeNull();
    expect(service.snapshot()).toMatchObject({
      configured: true,
      credentialState: "ready",
      operation: null,
    });
  });
  it("retains the returned desktop id when a one-time enrollment credential is lost", async () => {
    f.registration = "lost";
    await expect(service.enroll(request)).rejects.toMatchObject({
      code: "REGISTRATION_CREDENTIAL_LOST",
    });
    expect(service.snapshot().enrollment?.desktopId).toBe(desktop);
    await service.resetEnrollment(false);
    expect(f.events).toEqual(["delete-relay", "clear-local"]);
    expect(f.draft).toBeNull();
  });
  it("allows a reserved registration to be reconciled rather than replaced", async () => {
    f.registration = "pending";
    await expect(service.enroll(request)).rejects.toMatchObject({ code: "REGISTRATION_PENDING" });
    expect(f.draft?.desktopId).toBe(desktop);
    f.registration = "ok";
    vi.spyOn(service, "start").mockResolvedValue();
    await service.enroll(request);
    expect(f.registrationIds).toEqual([
      request.registrationRequestId,
      request.registrationRequestId,
    ]);
  });
  it("does not reuse a saved registration under a different account", async () => {
    f.draft = { ...request, desktopId: null, accountId: `account-v1-${"b".repeat(64)}` };
    await expect(service.enroll(request)).rejects.toMatchObject({ code: "ACCOUNT_MISMATCH" });
    expect(f.registrationIds).toHaveLength(0);
    expect(saveRemoteCredential).not.toHaveBeenCalled();
  });
  it("preserves a one-time credential returned after a pause without resuming sharing", async () => {
    let finish!: (value: unknown) => void;
    f.registrationBody = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const start = vi.spyOn(service, "start").mockResolvedValue();
    const enrollment = service.enroll(request);
    await vi.waitFor(() => expect(f.registrationIds).toHaveLength(1));
    service.stop();
    finish(registrationData());
    await enrollment;
    expect(saveRemoteCredential).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({ configured: true, connected: false });
  });
  it("marks expired credentials as recoverable and permits a fresh registration after reset", async () => {
    f.credential = { ...credential(), expiresAt: "2000-01-01T00:00:00Z" };
    await service.start();
    expect(service.snapshot()).toMatchObject({ credentialState: "expired", error: "AUTH_EXPIRED" });
    await service.resetEnrollment(false);
    vi.spyOn(service, "start").mockResolvedValue();
    await service.enroll(request);
    expect(service.snapshot().credentialState).toBe("ready");
  });
  it("revokes local phone access before removing a relay registration", async () => {
    f.credential = credential();
    f.grant = grant();
    await service.resetEnrollment(false);
    expect(f.events).toEqual(["revoke-local", "delete-relay", "clear-local"]);
    expect(service.snapshot()).toMatchObject({ configured: false, grant: null, connected: false });
  });
  it("retains retryable enrollment when relay deletion fails but already disables local access", async () => {
    f.credential = credential();
    f.grant = grant();
    f.deleteFailure = true;
    await expect(service.resetEnrollment(false)).rejects.toMatchObject({
      code: "NETWORK_UNCERTAIN",
    });
    expect(f.grant?.state).toBe("revoked");
    expect(clearRemoteCredential).not.toHaveBeenCalled();
    const first = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "DELETE");
    f.deleteFailure = false;
    await service.resetEnrollment(false);
    const deletes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(new Headers(first?.[1]?.headers).get("X-Request-Id")).toBe(
      new Headers(deletes[1][1]?.headers).get("X-Request-Id"),
    );
  });
  it("permits explicit local-only recovery without account or relay access", async () => {
    f.authReady = false;
    f.credentialError = new ControlError("SECURE_STORAGE_UNAVAILABLE", false);
    expect(service.snapshot()).toMatchObject({ configured: true, credentialState: "invalid" });
    await service.resetEnrollment(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(service.snapshot()).toMatchObject({
      configured: false,
      credentialState: "none",
      error: null,
    });
  });
  it("never removes a computer registration owned by another signed-in account", async () => {
    f.credential = credential();
    f.owner = `account-v1-${"b".repeat(64)}`;
    await expect(service.resetEnrollment(false)).rejects.toMatchObject({
      code: "ACCOUNT_MISMATCH",
    });
    expect(f.events).not.toContain("delete-relay");
    expect(clearRemoteCredential).not.toHaveBeenCalled();
  });
  it("does not misclassify account restoration network failures as secure storage failures", async () => {
    f.credential = credential();
    f.accountFailure = true;
    await service.start();
    expect(service.snapshot().error).toBe("NETWORK_UNCERTAIN");
  });
  it("keeps the management snapshot readable when the account credential is corrupt", () => {
    f.authError = "AUTH_STORE_INVALID";
    f.authPhase = "error";
    expect(service.snapshot()).toMatchObject({
      accountReady: false,
      auth: { error: "AUTH_STORE_INVALID" },
      error: "AUTH_STORE_INVALID",
    });
  });
  it("removes another directory computer without clearing this computer’s grant or credential", async () => {
    f.credential = credential();
    f.grant = grant();
    await service.removeDesktop(origin, otherDesktop);
    expect(f.credential.desktopId).toBe(desktop);
    expect(f.grant.state).toBe("active");
    expect(f.events).toEqual(["delete-relay"]);
  });
  it("cancels a waiting browser operation and never starts registration after cancellation", async () => {
    f.authReady = false;
    vi.mocked(loginDesktop).mockImplementationOnce(async () => {
      f.authPhase = "waiting_for_browser";
      return new Promise((_resolve, reject) => {
        f.rejectLogin = reject;
      });
    });
    const enrollment = service.enroll(request);
    const cancelled = expect(enrollment).rejects.toMatchObject({ code: "AUTH_CANCELLED" });
    await vi.waitFor(() => expect(service.snapshot().auth.phase).toBe("waiting_for_browser"));
    expect(service.snapshot().operation).toBe("enrolling");
    service.cancelLogin();
    await cancelled;
    expect(service.snapshot().operation).toBeNull();
    expect(f.registrationIds).toHaveLength(0);
  });
});
