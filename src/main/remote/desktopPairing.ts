import {
  ALL_SCOPES,
  type ClaimStatus,
  type ControlClient,
  exact,
  fail,
  type Grant,
  LIMITS,
  type PairingQr,
  type Scope,
  parseClaim,
  parseGrant,
  parseQr,
  projectIds,
  READ_SCOPES,
  revoked,
  sameBinding,
} from "../../shared/remote";
export interface DesktopGrantStore {
  read(): Grant | null;
  save(grant: Grant): void;
}
/** Desktop is the authority. Every state transition is durable before it is acknowledged. */
export class DesktopPairing {
  claim: ClaimStatus | null = null;
  qr: PairingQr | null = null;
  revocationPending = false;
  constructor(
    readonly client: ControlClient,
    private readonly store: DesktopGrantStore,
    private readonly newId: () => string,
    private readonly projects: () => readonly string[],
    readonly binding: { relayInstanceId: string; desktopId: string },
    private readonly access: () => Promise<string>,
  ) {}
  get grant(): Grant | null {
    return this.store.read();
  }
  private async call<T>(
    path: string,
    body: Record<string, unknown> | null,
    parse: (v: unknown) => T,
  ): Promise<T> {
    return this.client.request(
      body === null ? "GET" : "POST",
      path,
      await this.access(),
      body,
      parse,
    );
  }
  async invite(): Promise<PairingQr> {
    this.qr = null;
    this.claim = null;
    this.qr = await this.call("/v1/pairings", {}, (v) => parseQr(JSON.stringify(v)));
    return this.qr;
  }
  async poll(): Promise<void> {
    const state = await this.call("/v1/desktops/self/state", null, (v) => {
      const r = exact(v, ["grant", "claim"]);
      return {
        grant: r.grant === null ? null : parseGrant(r.grant),
        claim: r.claim === null ? null : parseClaim(r.claim),
      };
    });
    this.claim = state.claim;
    if (state.claim || (this.qr && this.client.now() >= Date.parse(this.qr.expiresAt)))
      this.qr = null;
    const local = this.grant;
    if (
      local?.state === "revoked" &&
      state.grant?.grantId === local.grantId &&
      state.grant.state !== "revoked"
    )
      await this.revoke();
    if (
      local?.state === "prepared" &&
      !state.claim &&
      (!state.grant || state.grant.state === "revoked")
    )
      this.store.save(revoked(local, this.client.now(), "pairing_terminated"));
    if (
      local &&
      state.grant?.grantId === local.grantId &&
      state.grant.state === "revoked" &&
      local.state !== "revoked"
    )
      this.store.save(revoked(local, this.client.now(), "relay_revoked"));
    if (this.claim?.state === "activating") await this.activate(this.claim);
  }
  async approve(
    selected: string[],
    scopes: Scope[] = ["projects.read", "sessions.read"],
  ): Promise<void> {
    const claim = this.claim;
    if (!claim || !["claimed", "approved"].includes(claim.state)) fail("PAIRING_UNAVAILABLE");
    const ids = projectIds(selected).sort();
    const selectedScopes = [...new Set(scopes)].sort();
    if (
      selectedScopes.some((scope) => !(ALL_SCOPES as readonly string[]).includes(scope)) ||
      !selectedScopes.includes("projects.read") ||
      !selectedScopes.includes("sessions.read") ||
      (selectedScopes.includes("interactions.answer") && !selectedScopes.includes("interactions.read"))
    )
      fail("FORBIDDEN");
    if (ids.some((p) => !this.projects().includes(p))) fail("INVALID_PROJECTS");
    let grant = this.grant;
    if (grant && grant.state !== "revoked") {
      if (
        grant.deviceId !== claim.deviceId ||
        grant.state !== "prepared" ||
        JSON.stringify(grant.projectIds) !== JSON.stringify(ids) ||
        JSON.stringify([...grant.scopes].sort()) !== JSON.stringify(selectedScopes)
      )
        fail("IDEMPOTENCY_CONFLICT");
    } else {
      const now = this.client.now();
      grant = {
        relayInstanceId: this.binding.relayInstanceId,
        desktopId: this.binding.desktopId,
        grantId: this.newId(),
        deviceId: claim.deviceId,
        grantVersion: 1,
        state: "prepared",
        scopes: selectedScopes as Scope[],
        projectIds: ids,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + LIMITS.grantMs).toISOString(),
        revokedAt: null,
        revocationReason: null,
        approvalId: this.newId(),
        activationId: null,
        activationExpiresAt: new Date(now + LIMITS.activationMs).toISOString(),
      };
      this.store.save(grant);
    }
    this.claim = await this.call(
      `/v1/claims/${claim.claimId}/approve`,
      { approvalId: grant.approvalId, grant },
      parseClaim,
    );
  }
  async reject(): Promise<void> {
    if (!this.claim) fail("PAIRING_UNAVAILABLE");
    const local = this.grant;
    if (local?.state === "prepared") this.store.save(revoked(local, this.client.now(), "rejected"));
    this.claim = await this.call(`/v1/claims/${this.claim.claimId}/reject`, {}, parseClaim);
    this.qr = null;
  }
  private async activate(claim: ClaimStatus): Promise<void> {
    const remote = claim.grant;
    let local = this.grant;
    if (
      !local ||
      !remote ||
      local.state === "revoked" ||
      !sameBinding(local, remote) ||
      !remote.activationId ||
      this.client.now() >= Date.parse(local.activationExpiresAt) ||
      JSON.stringify(local.projectIds) !== JSON.stringify(remote.projectIds) ||
      local.projectIds.some((p) => !this.projects().includes(p))
    )
      fail("DEVICE_REVOKED");
    if (local.activationId && local.activationId !== remote.activationId)
      fail("IDEMPOTENCY_CONFLICT");
    if (local.state !== "active") {
      local = { ...local, state: "active", activationId: remote.activationId };
      this.store.save(local);
    }
    const confirmed = await this.call(
      "/v1/desktops/self/activation-ack",
      {
        grantId: local.grantId,
        grantVersion: local.grantVersion,
        activationId: local.activationId,
      },
      (v) => {
        const r = exact(v, ["state", "grant"]);
        if (r.state !== "active") fail("STATE_UNAVAILABLE");
        return parseGrant(r.grant);
      },
    );
    if (!sameBinding(local, confirmed)) fail("DEVICE_REVOKED");
  }
  async reconcile(startup: boolean): Promise<void> {
    const local = this.grant;
    // An interrupted prepared grant never survives a desktop process restart.
    if (startup && local?.state === "prepared")
      this.store.save(revoked(local, this.client.now(), "desktop_restart"));
    const remote = await this.call(
      "/v1/desktops/self/reconcile",
      { grant: this.grant, startup },
      (v) => {
        const r = exact(v, ["grant"]);
        return r.grant === null ? null : parseGrant(r.grant);
      },
    );
    const current = this.grant;
    if (
      current &&
      current.state !== "revoked" &&
      (!remote || remote.state === "revoked" || !sameBinding(current, remote))
    )
      this.store.save(revoked(current, this.client.now(), "reconciliation"));
    this.revocationPending = false;
  }
  async revoke(): Promise<void> {
    const local = this.grant;
    if (!local) return;
    const next = revoked(local, this.client.now(), "user_revoked");
    this.store.save(next);
    this.revocationPending = true;
    this.qr = null;
    await this.call(
      `/v1/devices/${next.deviceId}/revoke`,
      { grantId: next.grantId, grantVersion: next.grantVersion },
      (v) => exact(v, ["grant"]),
    );
    this.revocationPending = false;
  }
}
