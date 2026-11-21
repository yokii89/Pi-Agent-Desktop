import { describe, expect, it, vi } from "vitest";
import {
  ALL_SCOPES,
  type ClaimStatus,
  ControlClient,
  ControlError,
  type ControlFetch,
  type Grant,
  LIMITS,
  READ_SCOPES,
} from "../../shared/remote";
import { DesktopPairing } from "./desktopPairing";

const now = Date.parse("2026-11-19T10:00:00Z");
const binding = { relayInstanceId: "relay-1", desktopId: "00000000-0000-4000-8000-000000000001" };
const baseGrant = (): Grant => ({
  ...binding,
  deviceId: "phone-1",
  grantId: "grant-1",
  grantVersion: 1,
  state: "prepared",
  scopes: [...READ_SCOPES],
  projectIds: ["allowed", "other"],
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + LIMITS.grantMs).toISOString(),
  revokedAt: null,
  revocationReason: null,
  approvalId: "approval-1",
  activationId: null,
  activationExpiresAt: new Date(now + LIMITS.activationMs).toISOString(),
});
const baseClaim = (): ClaimStatus => ({
  invitationId: "invitation-1",
  claimId: "claim-1",
  deviceId: "phone-1",
  state: "claimed",
  deviceName: "Test phone",
  confirmationCode: "12345678",
  expiresAt: new Date(now + LIMITS.approvalMs).toISOString(),
  grant: null,
});

function fixture(initial: Grant | null = baseGrant()) {
  let saved = structuredClone(initial);
  let relay = structuredClone(initial);
  let claim = baseClaim();
  let acknowledged: Grant | null = null;
  let nextId = 0;
  const save = vi.fn((grant: Grant) => {
    saved = structuredClone(grant);
  });
  const fetcher = vi.fn<ControlFetch>(async (url, init) => {
    const route = new URL(url).pathname.slice(`/v2/desktops/${binding.desktopId}`.length);
    let data: unknown;
    if (route === "/state") data = { grant: relay, claim };
    else if (route === "/reconcile") data = { grant: relay };
    else if (route === "/activation-ack") {
      expect(saved?.state).toBe("active");
      data = { state: "active", grant: acknowledged ?? saved };
    } else if (route === `/claims/${claim.claimId}/approve`) {
      expect(saved?.state).toBe("prepared");
      data = { ...claim, state: "approved", grant: saved };
    } else if (route === `/devices/${claim.deviceId}/revoke`) {
      data = { grant: { ...saved, state: "revoked" } };
    } else throw new Error(`Unexpected route: ${route}`);
    return {
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({
          controlVersion: 2,
          requestId: init.headers["X-Request-Id"],
          serverTime: new Date(now).toISOString(),
          data,
        }),
    };
  });
  const client = new ControlClient(
    "https://relay.example.invalid",
    () => `request-${++nextId}`,
    fetcher,
    () => now,
    {
      account: { accountId: `account-v1-${"a".repeat(64)}`, token: async () => "account-token" },
      desktopId: binding.desktopId,
    },
  );
  const pairing = new DesktopPairing(
    client,
    { read: () => saved, save },
    () => `generated-${++nextId}`,
    () => ["allowed", "other"],
    binding,
    async () => "a".repeat(43),
  );
  pairing.claim = claim;
  return {
    pairing,
    save,
    fetcher,
    saved: () => saved,
    relay: (grant: Grant | null) => {
      relay = grant;
    },
    claim: (value: ClaimStatus) => {
      claim = value;
      pairing.claim = value;
    },
    ack: (grant: Grant) => {
      acknowledged = grant;
    },
  };
}

describe("desktop pairing authorization", () => {
  it("rejects approval of a different claim than the one the desktop user confirmed", async () => {
    const f = fixture(null);
    f.claim({ ...baseClaim(), claimId: "new-claim", deviceId: "other-phone" });
    await expect(f.pairing.approve("claim-1")).rejects.toThrow("PAIRING_UNAVAILABLE");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("rejects an expired claim before saving an authorization", async () => {
    const f = fixture(null);
    f.claim({ ...baseClaim(), expiresAt: new Date(now).toISOString() });
    f.claim({ ...baseClaim(), expiresAt: new Date(now).toISOString() });
    await expect(f.pairing.approve("claim-1")).rejects.toThrow("PAIRING_UNAVAILABLE");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("approves the full v2 project and action range after desktop confirmation", async () => {
    const f = fixture(null);
    await f.pairing.approve("claim-1");
    expect(f.saved()).toMatchObject({
      state: "prepared",
      projectIds: "all",
      scopes: [...ALL_SCOPES].sort(),
    });
    expect(f.pairing.claim?.state).toBe("approved");
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not expand an interrupted previously restricted grant", async () => {
    const f = fixture();
    await expect(f.pairing.approve("claim-1")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("never sends approval when the local authorization cannot be persisted", async () => {
    const f = fixture(null);
    f.save.mockImplementationOnce(() => {
      throw new ControlError("STATE_UNAVAILABLE");
    });
    await expect(f.pairing.approve("claim-1")).rejects.toThrow("STATE_UNAVAILABLE");
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.saved()).toBeNull();
  });

  it.each(["scopes", "projectIds"] as const)(
    "revokes a reconciled grant with different %s",
    async (field) => {
      const local: Grant = { ...baseGrant(), state: "active", activationId: "activation-1" };
      const f = fixture(local);
      const remote =
        field === "scopes"
          ? { ...local, scopes: [...READ_SCOPES, "sessions.send" as const] }
          : { ...local, projectIds: ["allowed"] };
      f.relay(remote);
      await f.pairing.reconcile(false);
      expect(f.saved()).toMatchObject({ state: "revoked", grantVersion: 2 });
    },
  );

  it("accepts equivalent authorization sets regardless of ordering", async () => {
    const local: Grant = { ...baseGrant(), state: "active", activationId: "activation-1" };
    const f = fixture(local);
    f.relay({
      ...local,
      scopes: [...local.scopes].reverse(),
      projectIds: [...local.projectIds].reverse(),
    });
    await f.pairing.reconcile(false);
    expect(f.saved()).toEqual(local);
    expect(f.save).not.toHaveBeenCalled();
  });

  it.each(["scopes", "projectIds", "deviceId"] as const)(
    "rejects activation with changed %s",
    async (field) => {
      const local = baseGrant();
      const f = fixture(local);
      const remote: Grant = { ...local, activationId: "activation-1" };
      if (field === "scopes") remote.scopes = [...READ_SCOPES, "sessions.send"];
      if (field === "projectIds") remote.projectIds = ["allowed"];
      f.claim({
        ...baseClaim(),
        state: "activating",
        deviceId: field === "deviceId" ? "other-phone" : local.deviceId,
        grant: remote,
      });
      await expect(f.pairing.poll()).rejects.toThrow("DEVICE_REVOKED");
      expect(f.saved()?.state).toBe("prepared");
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("persists activation before acknowledgment and checks the acknowledged authorization", async () => {
    const local = baseGrant();
    const f = fixture(local);
    f.claim({
      ...baseClaim(),
      state: "activating",
      grant: { ...local, activationId: "activation-1" },
    });
    await f.pairing.poll();
    expect(f.saved()).toMatchObject({ state: "active", activationId: "activation-1" });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("revokes local access if acknowledgment changes the approved capabilities", async () => {
    const local = baseGrant();
    const f = fixture(local);
    f.claim({
      ...baseClaim(),
      state: "activating",
      grant: { ...local, activationId: "activation-1" },
    });
    f.ack({
      ...local,
      state: "active",
      activationId: "activation-1",
      scopes: [...READ_SCOPES, "sessions.send"],
    });
    await expect(f.pairing.poll()).rejects.toThrow("DEVICE_REVOKED");
    expect(f.saved()).toMatchObject({ state: "revoked", revocationReason: "activation_mismatch" });
    expect(f.pairing.revocationPending).toBe(true);
  });

  it("syncs a locally revoked grant before clearing its pending state", async () => {
    const local: Grant = { ...baseGrant(), state: "active", activationId: "activation-1" };
    const f = fixture(local);
    f.save({
      ...local,
      state: "revoked",
      grantVersion: 2,
      revokedAt: new Date(now).toISOString(),
      revocationReason: "project_configuration_changed",
    });
    expect(f.pairing.needsRevocationSync()).toBe(true);
    await f.pairing.revoke();
    expect(f.pairing.needsRevocationSync()).toBe(false);
    expect(f.pairing.revocationPending).toBe(false);
    expect(f.fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/devices/phone-1/revoke"),
      expect.anything(),
    );
  });
  it("invalidates an interrupted prepared grant before reconciling after restart", async () => {
    const f = fixture();
    await f.pairing.reconcile(true);
    expect(f.saved()).toMatchObject({ state: "revoked", revocationReason: "desktop_restart" });
    const body = JSON.parse(f.fetcher.mock.calls[0][1].body ?? "{}");
    expect(body.grant.state).toBe("revoked");
  });
});
