import { randomUUID } from "node:crypto";
import {
  record as asRecord,
  ControlClient,
  ControlError,
  DeliveryReceiver,
  type DesktopCredential,
  exact,
  fail,
  id,
  LIMITS,
  origin,
  parseJson,
  parseMeta,
  RelayAccountSession,
  type RoutingContext,
  record,
  relayPrincipal,
  revoked,
  type Scope,
  SECURITY_PROFILE,
  sameBinding,
  secret,
  timestamp,
} from "../../shared/remote";
import type {
  RemoteAccountInput,
  RemoteEnrollment,
  RemoteSnapshot,
} from "../../shared/remoteDesktop";
import { setRemoteViewing } from "../session/idleReclaim";
import { subscribeSessionEvents, subscribeSessionUiEvents } from "../session/sessionEvents";
import {
  loadRemoteCredential,
  loadRemoteGrant,
  loadRemoteOperations,
  remoteStorageAvailable,
  saveRemoteCredential,
  saveRemoteGrant,
  saveRemoteOperations,
} from "../settings/remoteStore";
import { getSettings } from "../settings/settings";
import { DesktopPairing } from "./desktopPairing";
import { DesktopReadOnlySource } from "./desktopSource";
import { RemoteOperationLedger } from "./operationLedger";
import { ReadOnlyBridge } from "./readOnlyBridge";
import { relaySocket } from "./relaySocket";
export class RemoteService {
  private readonly account = new RelayAccountSession(randomUUID);
  private enrolling = false;
  private credential: DesktopCredential | null = null;
  private pairing: DesktopPairing | null = null;
  private client: ControlClient | null = null;
  private access: { token: string; expires: number } | null = null;
  private socket: WebSocket | null = null;
  private ready = false;
  private stopped = true;
  private startup = true;
  private error: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private connecting = false;
  private reconnectAttempts = 0;
  private generation = 0;
  private readonly source = new DesktopReadOnlySource();
  private readonly operations = new RemoteOperationLedger({
    load: loadRemoteOperations,
    save: saveRemoteOperations,
  });
  private readonly bridge = new ReadOnlyBridge(
    () => loadRemoteGrant(),
    this.source,
    randomUUID(),
    () => this.client?.now() ?? Date.now(),
    this.operations,
  );
  private eventTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly releaseViewing = setRemoteViewing(
    (sessionId) =>
      this.ready && this.source.isViewingLive(sessionId, (id) => this.bridge.isViewing(id)),
  );
  private readonly unsubscribe = subscribeSessionEvents((event) => {
    this.source.observe(event);
    this.scheduleEventTick();
  });
  private readonly unsubscribeUi = subscribeSessionUiEvents(() => this.scheduleEventTick());
  private scheduleEventTick(): void {
    if (!this.ready || this.eventTimer) return;
    this.eventTimer = setTimeout(() => {
      this.eventTimer = null;
      if (this.ready) void this.bridge.tick((context, frame) => this.deliver(context, frame));
    }, 250);
  }
  snapshot(): RemoteSnapshot {
    return {
      configured: !!this.credential,
      controlVersion: this.credential?.controlVersion ?? 1,
      accountReady: !!this.account.getSnapshot(),
      relayOrigin: this.credential?.relayOrigin ?? null,
      connected: this.ready,
      qr: this.pairing?.qr ?? null,
      claim: this.pairing?.claim ?? null,
      grant: loadRemoteGrant(),
      revocationPending: this.pairing?.revocationPending ?? loadRemoteGrant()?.state === "revoked",
      projects: getSettings().projects.map((p) => ({ id: p.id, name: p.name })),
      error: this.error,
    };
  }
  async enroll(raw: RemoteEnrollment): Promise<RemoteSnapshot> {
    if (this.enrolling) fail("BUSY");
    this.enrolling = true;
    try {
      return await this.enrollRequest(raw);
    } finally {
      this.enrolling = false;
    }
  }
  private async enrollRequest(raw: RemoteEnrollment): Promise<RemoteSnapshot> {
    if (asRecord(raw).controlVersion === 2) return this.enrollV2(raw);
    const r = exact(raw, ["relayOrigin", "enrollmentTicket", "trustRelay"]);
    if (r.trustRelay !== true) fail("SECURITY_PROFILE_MISMATCH");
    if (!remoteStorageAvailable()) fail("SECURE_STORAGE_UNAVAILABLE");
    if (this.credential || loadRemoteCredential()) fail("DEVICE_LIMIT_REACHED");
    const relayOrigin = origin(r.relayOrigin);
    const ticket = secret(r.enrollmentTicket);
    const client = new ControlClient(relayOrigin, randomUUID);
    const meta = await client.request("GET", "/v1/meta", null, null, parseMeta);
    const credential = await client.request("POST", "/v1/desktops/enroll", ticket, {}, (v) => {
      const data = exact(v, ["desktopId", "relayInstanceId", "desktopCredential", "expiresAt"]);
      if (data.relayInstanceId !== meta.relayInstanceId) fail("RELAY_INSTANCE_MISMATCH");
      return {
        version: 1 as const,
        relayOrigin,
        desktopId: id(data.desktopId),
        relayInstanceId: id(data.relayInstanceId),
        desktopCredential: secret(data.desktopCredential),
        expiresAt: timestamp(data.expiresAt),
      };
    });
    saveRemoteCredential(credential);
    await this.start();
    return this.snapshot();
  }
  async setAccount(raw: RemoteAccountInput): Promise<RemoteSnapshot> {
    const r = exact(raw, ["relayOrigin", "accessToken"]);
    const credential = this.credential ?? loadRemoteCredential();
    if (credential && (credential.controlVersion !== 2 || credential.relayOrigin !== r.relayOrigin))
      fail("AUTH_REQUIRED");
    this.stop();
    await this.account.connect(origin(r.relayOrigin), String(r.accessToken));
    if (credential && this.account.getSnapshot()?.accountId !== credential.accountId) {
      this.account.disconnect();
      fail("AUTH_REQUIRED");
    }
    await this.start();
    return this.snapshot();
  }
  private async enrollV2(raw: RemoteEnrollment): Promise<RemoteSnapshot> {
    const r = exact(raw, [
      "controlVersion",
      "relayOrigin",
      "accessToken",
      "displayName",
      "registrationRequestId",
      "trustRelay",
    ]);
    if (r.trustRelay !== true) fail("SECURITY_PROFILE_MISMATCH");
    if (!remoteStorageAvailable()) fail("SECURE_STORAGE_UNAVAILABLE");
    if (this.credential || loadRemoteCredential()) fail("DEVICE_LIMIT_REACHED");
    const relayOrigin = origin(r.relayOrigin);
    await this.account.connect(relayOrigin, String(r.accessToken));
    const client = this.account.client();
    const meta = await client.request("GET", "/v1/meta", null, null, parseMeta);
    const credential = await client.request(
      "POST",
      "/v2/account/me/desktops",
      null,
      {
        displayName: r.displayName,
        platform:
          process.platform === "win32"
            ? "windows"
            : process.platform === "darwin"
              ? "macos"
              : "linux",
        capabilities: ["pairing-v1", "readonly-relay-v1"],
      },
      (value) => {
        const result = record(value);
        exact(value, Object.hasOwn(result, "credential") ? ["item", "credential"] : ["item"]);
        const item = asRecord(result.item);
        if (!result.credential)
          fail(
            item.state === "registered" ? "REGISTRATION_CREDENTIAL_LOST" : "REGISTRATION_PENDING",
          );
        const c = exact(result.credential, [
          "desktopId",
          "relayInstanceId",
          "desktopCredential",
          "expiresAt",
        ]);
        if (
          item.state !== "registered" ||
          c.desktopId !== item.desktopId ||
          c.relayInstanceId !== meta.relayInstanceId
        )
          fail("AUTH_REQUIRED");
        return {
          version: 1 as const,
          controlVersion: 2 as const,
          accountId: this.account.access(relayOrigin).accountId,
          relayOrigin,
          desktopId: id(c.desktopId),
          relayInstanceId: id(c.relayInstanceId),
          desktopCredential: secret(c.desktopCredential),
          expiresAt: timestamp(c.expiresAt),
        };
      },
      id(r.registrationRequestId),
    );
    saveRemoteCredential(credential);
    const saved = loadRemoteCredential();
    if (
      !saved ||
      saved.desktopCredential !== credential.desktopCredential ||
      saved.desktopId !== credential.desktopId
    )
      fail("SECURE_STORAGE_UNAVAILABLE");
    await this.start();
    return this.snapshot();
  }
  async start(): Promise<void> {
    if (!this.stopped) return;
    try {
      this.credential = loadRemoteCredential();
      if (!this.credential) return;
      if (Date.now() >= Date.parse(this.credential.expiresAt)) fail("AUTH_EXPIRED");
      this.client =
        this.credential.controlVersion === 2
          ? this.account.client(this.credential.desktopId, this.credential.accountId)
          : new ControlClient(this.credential.relayOrigin, randomUUID);
      this.pairing = new DesktopPairing(
        this.client,
        { read: loadRemoteGrant, save: saveRemoteGrant },
        randomUUID,
        () => this.source.projects().map((p) => p.id),
        this.credential,
        async () => {
          if (!this.access) fail("AUTH_REQUIRED");
          return this.access.token;
        },
      );
      this.stopped = false;
      await this.connect();
    } catch (cause) {
      this.error = cause instanceof ControlError ? cause.code : "SECURE_STORAGE_UNAVAILABLE";
    }
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.stopped)
      this.timer = setTimeout(
        () => {
          void (this.ready ? this.tick() : this.connect());
        },
        this.ready ? LIMITS.pollMs : this.reconnectDelay(),
      );
  }
  private reconnectDelay(): number {
    const attempt = this.reconnectAttempts++;
    return attempt === 0
      ? LIMITS.pollMs
      : Math.round(
          Math.min(60_000, LIMITS.pollMs * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4),
        );
  }
  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || !this.credential || !this.client) return;
    this.connecting = true;
    const generation = this.generation;
    const client = this.client;
    const credential = this.credential;
    try {
      const access = await client.request(
        "POST",
        "/v1/desktops/access-token",
        credential.desktopCredential,
        {},
        (v) => {
          const r = exact(v, ["accessToken", "accessExpiresAt"]);
          return {
            token: secret(r.accessToken),
            expires: Date.parse(timestamp(r.accessExpiresAt)),
          };
        },
      );
      if (this.stopped || generation !== this.generation) return;
      this.access = access;
      const token = access.token;
      const version = credential.controlVersion ?? 1;
      const url = `${credential.relayOrigin.replace(/^https:/, "wss:")}/v${version}/connect/${credential.desktopId}`;
      const headers = version === 2 ? await client.socketHeaders() : null;
      if (this.stopped || generation !== this.generation) return;
      const ws = headers ? relaySocket(url, headers) : new WebSocket(url);
      const delivery = new DeliveryReceiver();
      let received = Promise.resolve();
      let queued = 0;
      let queuedBytes = 0;
      this.socket = ws;
      const authTimer = setTimeout(() => ws.close(), LIMITS.authMs);
      let authenticated = false;
      ws.onopen = () => {
        if (this.socket === ws)
          ws.send(
            JSON.stringify({ controlVersion: version, type: "authenticate", accessToken: token }),
          );
      };
      ws.onmessage = (event) => {
        const raw = String(event.data);
        const size = new TextEncoder().encode(raw).byteLength;
        queued++;
        queuedBytes += size;
        if (queued > 8 || queuedBytes > 262_144) {
          ws.close();
          return;
        }
        received = received
          .then(async () => {
            if (this.socket !== ws) return;
            const r = record(
              parseJson(
                raw,
                version === 2 ? LIMITS.businessBytes : LIMITS.businessBytes + LIMITS.controlBytes,
              ),
            );
            if (!authenticated) {
              if (
                r.controlVersion !== version ||
                r.type !== "authenticated" ||
                r.securityProfile !== SECURITY_PROFILE
              )
                fail("AUTH_REQUIRED");
              const p = relayPrincipal(r.principal, version, credential.accountId);
              if (
                p.role !== "desktop" ||
                p.desktopId !== this.credential?.desktopId ||
                p.relayInstanceId !== this.credential?.relayInstanceId
              )
                fail("AUTH_REQUIRED");
              authenticated = true;
              clearTimeout(authTimer);
              await this.pairing?.reconcile(this.startup);
              if (this.socket !== ws) return;
              this.startup = false;
              this.ready = true;
              this.reconnectAttempts = 0;
              this.error = null;
              this.schedule();
              return;
            }
            if (!this.ready) return;
            const routed = exact(
              r,
              version === 2
                ? ["controlVersion", "type", "context", "frame", "deliverySequence"]
                : ["controlVersion", "type", "context", "frame"],
            );
            if (routed.controlVersion !== version || routed.type !== "route") fail("FORBIDDEN");
            const contextValue = exact(routed.context, [
              "relayInstanceId",
              "desktopId",
              "deviceId",
              "grantId",
              "grantVersion",
              "connectionGeneration",
              "accessExpiresAt",
              ...(version === 2 ? ["accountId"] : []),
            ]);
            const p = relayPrincipal(
              { ...contextValue, role: "mobile" },
              version,
              credential.accountId,
            );
            const { role: _role, ...context } = p;
            if (
              context.desktopId !== this.credential?.desktopId ||
              context.relayInstanceId !== this.credential?.relayInstanceId
            )
              fail("AUTH_REQUIRED");
            if (version === 2)
              ws.send(
                JSON.stringify({
                  controlVersion: 2,
                  type: "ack",
                  deliverySequence: delivery.accept(r),
                }),
              );
            let frame: unknown;
            try {
              frame = await this.bridge.request(context, routed.frame);
            } catch (cause) {
              const request = record(routed.frame);
              frame = {
                version: 1,
                type: "response",
                id: id(request.id),
                status: "failed",
                error: {
                  code: cause instanceof ControlError ? cause.code : "RESOURCE_UNAVAILABLE",
                  message: cause instanceof ControlError ? cause.code : "RESOURCE_UNAVAILABLE",
                },
              };
            }
            this.deliver(context, frame, ws);
          })
          .catch((cause) => {
            this.error = cause instanceof ControlError ? cause.code : "CONTROL_FAILED";
            ws.close();
          })
          .finally(() => {
            queued--;
            queuedBytes -= size;
          });
      };
      ws.onclose = () => {
        clearTimeout(authTimer);
        if (this.socket === ws) {
          this.socket = null;
          this.ready = false;
          this.bridge.clear();
          this.schedule();
        }
      };
      ws.onerror = () => {
        if (this.socket === ws) {
          this.error = "DESKTOP_OFFLINE";
          ws.close();
        }
      };
    } catch (cause) {
      if (generation === this.generation && !this.stopped) {
        this.error = cause instanceof ControlError ? cause.code : "DESKTOP_OFFLINE";
        this.schedule();
      }
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }
  private deliver(context: RoutingContext, frame: unknown, ws = this.socket): void {
    if (!this.ready || !ws || ws !== this.socket || ws.readyState !== WebSocket.OPEN) return;
    const grant = loadRemoteGrant();
    if (
      grant?.state !== "active" ||
      !sameBinding(grant, context) ||
      Date.now() >= Date.parse(grant.expiresAt) ||
      Date.now() >= Date.parse(context.accessExpiresAt)
    )
      return;
    ws.send(
      JSON.stringify({
        controlVersion: this.credential?.controlVersion ?? 1,
        type: "deliver",
        context,
        frame,
      }),
    );
  }
  private async tick(): Promise<void> {
    if (this.ticking || !this.ready || !this.pairing) return;
    this.ticking = true;
    const generation = this.generation;
    const pairing = this.pairing;
    try {
      if (!this.access || (this.client?.now() ?? Date.now()) >= this.access.expires - 60_000) {
        this.socket?.close();
        return;
      }
      if (pairing.grant?.state === "revoked" && pairing.revocationPending) await pairing.revoke();
      if (this.stopped || generation !== this.generation) return;
      await pairing.poll();
      if (this.stopped || generation !== this.generation) return;
      await this.bridge.tick((context, frame) => this.deliver(context, frame));
      if (generation === this.generation) this.error = null;
    } catch (cause) {
      if (generation === this.generation)
        this.error = cause instanceof ControlError ? cause.code : "CONTROL_FAILED";
    } finally {
      if (generation === this.generation) {
        this.ticking = false;
        this.schedule();
      }
    }
  }
  async invite() {
    if (!this.ready || !this.pairing) fail("DESKTOP_OFFLINE");
    await this.pairing.invite();
    return this.snapshot();
  }
  async approve(claimId: string, projects: string[], scopes: Scope[]) {
    if (!this.ready || !this.pairing) fail("DESKTOP_OFFLINE");
    await this.pairing.approve(claimId, projects, scopes);
    return this.snapshot();
  }
  async reject() {
    if (!this.pairing) fail("AUTH_REQUIRED");
    await this.pairing.reject();
    return this.snapshot();
  }
  async revoke() {
    if (!this.pairing) {
      const grant = loadRemoteGrant();
      if (!grant) fail("AUTH_REQUIRED");
      saveRemoteGrant(revoked(grant, Date.now(), "user_revoked"));
      this.bridge.clear();
      return this.snapshot();
    }
    try {
      await this.pairing.revoke();
    } catch (cause) {
      this.error = cause instanceof ControlError ? cause.code : "CONTROL_FAILED";
    }
    this.bridge.clear();
    return this.snapshot();
  }
  stop(): void {
    this.stopped = true;
    this.generation++;
    this.ready = false;
    this.connecting = false;
    this.ticking = false;
    this.bridge.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.eventTimer) clearTimeout(this.eventTimer);
    this.eventTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.access = null;
    this.pairing = null;
    this.client = null;
    this.error = null;
  }
  dispose(): void {
    this.stop();
    this.unsubscribe();
    this.unsubscribeUi();
    this.releaseViewing();
    if (this.eventTimer) clearTimeout(this.eventTimer);
  }
}
export const remoteService = new RemoteService();
