import { randomUUID } from "node:crypto";
import {
  ControlClient,
  ControlError,
  type DesktopCredential,
  exact,
  fail,
  id,
  LIMITS,
  origin,
  parseJson,
  parseMeta,
  parsePrincipal,
  type RoutingContext,
  record,
  type Scope,
  SECURITY_PROFILE,
  secret,
  timestamp,
} from "../../shared/remote";
import type { RemoteEnrollment, RemoteSnapshot } from "../../shared/remoteDesktop";
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
export class RemoteService {
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
  private readonly unsubscribe = subscribeSessionEvents(() => this.scheduleEventTick());
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
  async start(): Promise<void> {
    if (!this.stopped) return;
    try {
      this.credential = loadRemoteCredential();
      if (!this.credential) return;
      if (Date.now() >= Date.parse(this.credential.expiresAt)) fail("AUTH_EXPIRED");
      this.client = new ControlClient(this.credential.relayOrigin, randomUUID);
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
      this.timer = setTimeout(() => {
        void (this.ready ? this.tick() : this.connect());
      }, LIMITS.pollMs);
  }
  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || !this.credential || !this.client) return;
    this.connecting = true;
    try {
      this.access = await this.client.request(
        "POST",
        "/v1/desktops/access-token",
        this.credential.desktopCredential,
        {},
        (v) => {
          const r = exact(v, ["accessToken", "accessExpiresAt"]);
          return {
            token: secret(r.accessToken),
            expires: Date.parse(timestamp(r.accessExpiresAt)),
          };
        },
      );
      const token = this.access.token;
      const ws = new WebSocket(
        `${this.credential.relayOrigin.replace(/^https:/, "wss:")}/v1/connect/${this.credential.desktopId}`,
      );
      this.socket = ws;
      const authTimer = setTimeout(() => ws.close(), LIMITS.authMs);
      let authenticated = false;
      ws.onopen = () => {
        if (this.socket === ws)
          ws.send(JSON.stringify({ controlVersion: 1, type: "authenticate", accessToken: token }));
      };
      ws.onmessage = (event) => {
        void (async () => {
          if (this.socket !== ws) return;
          const r = record(
            parseJson(String(event.data), LIMITS.businessBytes + LIMITS.controlBytes),
          );
          if (!authenticated) {
            if (
              r.controlVersion !== 1 ||
              r.type !== "authenticated" ||
              r.securityProfile !== SECURITY_PROFILE
            )
              fail("AUTH_REQUIRED");
            const p = parsePrincipal(r.principal);
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
            this.error = null;
            this.schedule();
            return;
          }
          if (!this.ready) return;
          const routed = exact(r, ["controlVersion", "type", "context", "frame"]);
          if (routed.controlVersion !== 1 || routed.type !== "route") fail("FORBIDDEN");
          const contextValue = exact(routed.context, [
            "relayInstanceId",
            "desktopId",
            "deviceId",
            "grantId",
            "grantVersion",
            "connectionGeneration",
            "accessExpiresAt",
          ]);
          const p = parsePrincipal({ ...contextValue, role: "mobile" });
          const { role: _role, ...context } = p;
          if (
            context.desktopId !== this.credential?.desktopId ||
            context.relayInstanceId !== this.credential?.relayInstanceId
          )
            fail("AUTH_REQUIRED");
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
        })().catch((cause) => {
          this.error = cause instanceof ControlError ? cause.code : "CONTROL_FAILED";
          ws.close();
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
      this.error = cause instanceof ControlError ? cause.code : "DESKTOP_OFFLINE";
      this.schedule();
    } finally {
      this.connecting = false;
    }
  }
  private deliver(context: RoutingContext, frame: unknown, ws = this.socket): void {
    if (!this.ready || !ws || ws !== this.socket || ws.readyState !== WebSocket.OPEN) return;
    const grant = loadRemoteGrant();
    if (
      grant?.state !== "active" ||
      grant.deviceId !== context.deviceId ||
      grant.grantVersion !== context.grantVersion ||
      Date.now() >= Date.parse(grant.expiresAt) ||
      Date.now() >= Date.parse(context.accessExpiresAt)
    )
      return;
    ws.send(JSON.stringify({ controlVersion: 1, type: "deliver", context, frame }));
  }
  private async tick(): Promise<void> {
    if (this.ticking || !this.ready || !this.pairing) return;
    this.ticking = true;
    try {
      if (!this.access || (this.client?.now() ?? Date.now()) >= this.access.expires - 60_000) {
        this.socket?.close();
        return;
      }
      if (this.pairing.grant?.state === "revoked" && this.pairing.revocationPending)
        await this.pairing.revoke();
      await this.pairing.poll();
      await this.bridge.tick((context, frame) => this.deliver(context, frame));
      this.error = null;
    } catch (cause) {
      this.error = cause instanceof ControlError ? cause.code : "CONTROL_FAILED";
    } finally {
      this.ticking = false;
      this.schedule();
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
    if (!this.pairing) fail("AUTH_REQUIRED");
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
    this.ready = false;
    this.bridge.clear();
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.access = null;
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
