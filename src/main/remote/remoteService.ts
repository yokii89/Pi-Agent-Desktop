import { randomUUID } from "node:crypto";
import type { SessionPushMessage, SessionUiPush } from "../../shared/ipc";
import {
  ConnectionRenewal,
  type ControlClient,
  ControlError,
  DeliveryReceiver,
  type DesktopCredential,
  type DesktopSummary,
  desktopId,
  encodeClientSocketFrame,
  exact,
  fail,
  id,
  LIMITS,
  origin,
  type PushNotification,
  parseMeta,
  parseRelaySocketFrame,
  RELAY_TIMING,
  RelayAccountSession,
  type RoutingContext,
  record,
  relayPrincipal,
  requireRelayFeatures,
  revoked,
  SECURITY_PROFILE,
  sameBinding,
  secret,
  timestamp,
} from "../../shared/remote";
import type {
  DesktopEnrollmentDraft,
  RemoteAccountInput,
  RemoteEnrollment,
  RemoteSnapshot,
} from "../../shared/remoteDesktop";
import { setRemoteViewing } from "../session/idleReclaim";
import { subscribeSessionEvents, subscribeSessionUiEvents } from "../session/sessionEvents";
import {
  clearRemoteEnrollmentDraft,
  loadRemoteEnrollment,
  saveRemoteEnrollment,
} from "../settings/remoteEnrollmentStore";
import {
  clearRemoteCredential,
  loadRemoteCredential,
  loadRemoteGrant,
  loadRemoteOperations,
  remoteStorageAvailable,
  saveRemoteCredential,
  saveRemoteGrant,
  saveRemoteOperations,
} from "../settings/remoteStore";
import { getSettings } from "../settings/settings";
import {
  cancelDesktopLogin,
  desktopAccessToken,
  desktopAuthError,
  desktopAuthGeneration,
  desktopAuthSnapshot,
  hasDesktopAuth,
  loginDesktop,
  revokeDesktopAuth,
} from "./desktopAuth";
import { DesktopPairing } from "./desktopPairing";
import { DesktopReadOnlySource } from "./desktopSource";
import { RemoteOperationLedger } from "./operationLedger";
import { ReadOnlyBridge } from "./readOnlyBridge";
import { relaySocket } from "./relaySocket";

interface NotificationSnapshot {
  sessions: Map<string, { status: "running" | "waiting" | "idle"; title: string }>;
  interactions: Map<string, string>;
}

function notificationTitle(value: string): string {
  const cleaned = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  })
    .join("")
    .trim();
  let result = "";
  for (const character of cleaned) {
    if (result.length + character.length > 128) break;
    result += character;
  }
  return result || "PiDesk";
}

function remoteError(cause: unknown, fallback = "CONTROL_FAILED"): string {
  if (cause instanceof ControlError) return cause.code;
  const code = desktopAuthError(cause, fallback);
  if (cause instanceof Error && /^REGISTRATION_[A-Z_]+$/.test(cause.message)) return cause.message;
  return code;
}

async function ensureDesktopLogin(reauthenticate = false): Promise<number> {
  let needsLogin = reauthenticate;
  if (!needsLogin) {
    try {
      if (hasDesktopAuth()) await desktopAccessToken();
      else needsLogin = true;
    } catch (cause) {
      if (!["ACCOUNT_AUTH_REQUIRED", "AUTH_STORE_INVALID"].includes(remoteError(cause)))
        throw cause;
      needsLogin = true;
    }
  }
  if (needsLogin) {
    const settings = getSettings();
    await loginDesktop({
      reauthenticate: true,
      theme: settings.theme === "light" ? "light" : "dark",
    });
  }
  return desktopAuthGeneration();
}

export class RemoteService {
  private readonly account = new RelayAccountSession(randomUUID);
  private operation: RemoteSnapshot["operation"] = null;
  private operationSequence = 0;
  private accountAuthEpoch: number | null = null;
  private readonly removalRequests = new Map<string, string>();
  private readonly trustedOrigins = new Set<string>();
  private starting = false;
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
  private eventTimer: ReturnType<typeof setTimeout> | null = null;
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
  private renewal: ConnectionRenewal | null = null;
  private stateRevision = -1;
  private readonly notificationOutcomes = new Map<
    string,
    {
      kind: "finished" | "failed";
      session: Promise<{ id: string; title: string; projectId: string } | null>;
    }
  >();
  private notificationSnapshot: NotificationSnapshot | null = null;
  private pushNotificationsSupported = false;
  private readonly releaseViewing = setRemoteViewing(
    (sessionId) =>
      this.ready && this.source.isViewingLive(sessionId, (id) => this.bridge.isViewing(id)),
  );
  private readonly unsubscribe = subscribeSessionEvents((event) => {
    this.observeNotificationOutcome(event);
    if (this.source.observe(event)) this.scheduleEventTick();
  });
  private readonly unsubscribeUi = subscribeSessionUiEvents((event) => {
    this.observeUiNotification(event);
    this.scheduleEventTick();
  });
  private observeNotificationOutcome(event: SessionPushMessage): void {
    const updates =
      event.type === "event" ? [event.payload] : event.type === "eventBatch" ? event.payload : [];
    const kind =
      event.type === "exit" && event.payload !== 0
        ? "failed"
        : updates.some(
              (item) =>
                (item.type === "agent_settled" && item.aborted === true) ||
                (item.type === "auto_retry_end" && item.success === false),
            )
          ? "failed"
          : updates.some((item) => item.type === "agent_settled")
            ? "finished"
            : null;
    if (!kind) return;
    const grant = loadRemoteGrant();
    if (grant?.state !== "active") return;
    const projectIds =
      grant.projectIds === "all"
        ? this.source.projects().map((project) => project.id)
        : grant.projectIds;
    const previous = this.notificationOutcomes.get(event.sessionId);
    if (previous?.kind === "failed" && kind === "finished") return;
    const session = this.source
      .notificationSession(event.sessionId, projectIds)
      .then((value) =>
        value &&
        getSettings().projects.some(
          (project) => project.id === value.projectId && projectIds.includes(project.id),
        )
          ? value
          : null,
      );
    this.notificationOutcomes.set(event.sessionId, { kind, session });
    if (this.notificationOutcomes.size > 100)
      this.notificationOutcomes.delete(this.notificationOutcomes.keys().next().value as string);
  }
  private observeUiNotification(_event: SessionUiPush): void {
    // The authoritative pending interaction list is read together with the next desktop tick.
  }
  private scheduleEventTick(): void {
    if (!this.ready || this.eventTimer) return;
    this.eventTimer = setTimeout(() => {
      this.eventTimer = null;
      if (this.ready)
        void this.bridge
          .tick((context, frame) => this.deliver(context, frame))
          .then(
            () => this.dispatchTaskNotifications(),
            () => this.dispatchTaskNotifications(),
          );
    }, 250);
  }
  private async dispatchTaskNotifications(): Promise<void> {
    const grant = loadRemoteGrant();
    const socket = this.socket;
    const generation = this.generation;
    if (
      !this.ready ||
      !this.pushNotificationsSupported ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      grant?.state !== "active"
    )
      return;
    try {
      const projectIds =
        grant.projectIds === "all"
          ? this.source.projects().map((project) => project.id)
          : grant.projectIds;
      const sessions = await this.source.sessions(projectIds);
      const interactions = grant.scopes.includes("interactions.read")
        ? await this.source.interactions(projectIds)
        : [];
      const next: NotificationSnapshot = {
        sessions: new Map(
          sessions.map((session) => [session.id, { status: session.status, title: session.title }]),
        ),
        interactions: new Map(
          interactions.map((interaction) => [interaction.id, interaction.sessionId]),
        ),
      };
      const outcomes = await Promise.all(
        [...this.notificationOutcomes].map(async ([runtimeSessionId, outcome]) => {
          let session = await outcome.session.catch(() => null);
          if (!session)
            session = await this.source
              .notificationSession(runtimeSessionId, projectIds)
              .catch(() => null);
          return { runtimeSessionId, outcome: session, kind: outcome.kind };
        }),
      );
      if (
        !this.ready ||
        this.generation !== generation ||
        this.socket !== socket ||
        loadRemoteGrant()?.state !== "active"
      )
        return;
      const previous = this.notificationSnapshot;
      this.notificationSnapshot = next;
      const outcomesBySession = new Map<string, "finished" | "failed">();
      for (const item of outcomes) {
        if (item.outcome) outcomesBySession.set(item.outcome.id, item.kind);
      }
      for (const interaction of interactions) {
        if (previous?.interactions.has(interaction.id)) continue;
        const session = next.sessions.get(interaction.sessionId);
        if (session)
          this.sendTaskNotification(
            {
              eventId: randomUUID(),
              desktopId: grant.desktopId,
              sessionId: interaction.sessionId,
              title: notificationTitle(session.title),
              kind: "interaction",
            },
            grant,
            generation,
          );
      }
      for (const [sessionId, session] of next.sessions) {
        const old = previous?.sessions.get(sessionId);
        const completed = !!old && old.status !== "idle" && session.status === "idle";
        const pendingOutcome = outcomesBySession.get(sessionId);
        const settledWhileOffline =
          !previous && session.status === "idle" && pendingOutcome !== undefined;
        if (
          (!completed && !settledWhileOffline && pendingOutcome === undefined) ||
          [...next.interactions.values()].includes(sessionId)
        )
          continue;
        const kind = pendingOutcome ?? "finished";
        for (const item of outcomes)
          if (item.outcome?.id === sessionId)
            this.notificationOutcomes.delete(item.runtimeSessionId);
        this.sendTaskNotification(
          {
            eventId: randomUUID(),
            desktopId: grant.desktopId,
            sessionId,
            title: notificationTitle(session.title),
            kind,
          },
          grant,
          generation,
        );
      }
    } catch {
      // Task notifications are best-effort; the desktop remains authoritative.
    }
  }
  private sendTaskNotification(
    notification: PushNotification,
    expectedGrant: NonNullable<ReturnType<typeof loadRemoteGrant>>,
    generation: number,
  ): void {
    const socket = this.socket;
    const currentGrant = loadRemoteGrant();
    if (
      !this.ready ||
      this.generation !== generation ||
      !this.pushNotificationsSupported ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      currentGrant?.state !== "active" ||
      currentGrant.desktopId !== expectedGrant.desktopId ||
      currentGrant.grantId !== expectedGrant.grantId ||
      currentGrant.grantVersion !== expectedGrant.grantVersion
    )
      return;
    try {
      socket.send(
        encodeClientSocketFrame(
          { controlVersion: 2, type: "task_notification", notification },
          { role: "desktop", authenticated: true },
        ),
      );
    } catch {
      // Notification delivery is deliberately best-effort.
    }
  }
  snapshot(): RemoteSnapshot {
    this.pairing?.expireInvitation();
    const auth = desktopAuthSnapshot();
    let credential = this.credential;
    let credentialState: RemoteSnapshot["credentialState"] = "none";
    let enrollment: DesktopEnrollmentDraft | null = null;
    let grant: ReturnType<typeof loadRemoteGrant> = null;
    let storageError: string | null = null;
    try {
      credential ??= loadRemoteCredential();
      credentialState = credential
        ? Date.now() >= Date.parse(credential.expiresAt)
          ? "expired"
          : "ready"
        : "none";
      grant = loadRemoteGrant();
    } catch (cause) {
      credentialState = "invalid";
      storageError = remoteError(cause, "STATE_UNAVAILABLE");
    }
    try {
      enrollment = loadRemoteEnrollment();
    } catch (cause) {
      storageError ??= remoteError(cause);
    }
    let accountReady = false;
    try {
      accountReady = hasDesktopAuth();
    } catch {
      // The auth snapshot carries the recoverable error instead of hiding the entire panel.
    }
    return {
      configured: !!credential || credentialState === "invalid",
      controlVersion: 2,
      accountReady,
      auth,
      accountId: accountReady ? (this.account.getSnapshot()?.accountId ?? null) : null,
      desktopId: credential?.desktopId ?? null,
      operation: this.operation,
      connectionState: this.ready
        ? "connected"
        : this.starting || this.connecting || this.socket
          ? "connecting"
          : this.stopped
            ? "paused"
            : "disconnected",
      enrollment,
      credentialState,
      relayOrigin: credential?.relayOrigin ?? enrollment?.relayOrigin ?? null,
      connected: this.ready,
      qr: this.pairing?.qr ?? null,
      claim: this.pairing?.claim ?? null,
      grant,
      revocationPending: this.pairing
        ? this.pairing.revocationPending || this.pairing.needsRevocationSync()
        : grant?.state === "revoked",
      projects: getSettings().projects.map((p) => ({ id: p.id, name: p.name })),
      error: this.error ?? auth.error ?? storageError,
    };
  }
  private async manage(
    operation: NonNullable<RemoteSnapshot["operation"]>,
    action: () => Promise<void>,
  ): Promise<RemoteSnapshot> {
    if (this.operation) fail("BUSY");
    const sequence = ++this.operationSequence;
    this.operation = operation;
    this.error = null;
    try {
      await action();
    } catch (cause) {
      const code = remoteError(cause);
      if (
        sequence === this.operationSequence &&
        !["AUTH_CANCELLED", "ACCOUNT_CHANGED"].includes(code)
      )
        this.error = code;
      throw new ControlError(code, false);
    } finally {
      if (sequence === this.operationSequence) this.operation = null;
    }
    return this.snapshot();
  }
  async enroll(raw: RemoteEnrollment): Promise<RemoteSnapshot> {
    return this.manage("enrolling", () => this.enrollRequest(raw));
  }
  async logout(): Promise<RemoteSnapshot> {
    return this.manage("signing_out", async () => {
      this.stop();
      this.account.disconnect();
      this.accountAuthEpoch = null;
      await revokeDesktopAuth();
    });
  }
  /** Cancel only browser authentication; registration requests retain their durable intent. */
  cancelLogin(): RemoteSnapshot {
    const phase = desktopAuthSnapshot().phase;
    if (!["opening_browser", "waiting_for_browser", "exchanging_code"].includes(phase))
      return this.snapshot();
    this.operationSequence++;
    this.operation = null;
    cancelDesktopLogin();
    this.stop();
    this.account.disconnect();
    this.accountAuthEpoch = null;
    return this.snapshot();
  }
  async setAccount(raw: RemoteAccountInput): Promise<RemoteSnapshot> {
    const r = exact(
      raw,
      Object.hasOwn(record(raw), "reauthenticate")
        ? ["relayOrigin", "reauthenticate"]
        : ["relayOrigin"],
    );
    if (r.reauthenticate !== undefined && typeof r.reauthenticate !== "boolean")
      fail("INVALID_FRAME");
    const relayOrigin = origin(r.relayOrigin);
    return this.manage("signing_in", async () => {
      const credential = this.credential ?? loadRemoteCredential();
      if (credential && credential.relayOrigin !== relayOrigin) fail("AUTH_REQUIRED");
      if (!credential && loadRemoteEnrollment()?.relayOrigin !== relayOrigin)
        fail("SECURITY_PROFILE_MISMATCH");
      this.stop();
      const generation = this.generation;
      const authGeneration = await ensureDesktopLogin(r.reauthenticate !== false);
      if (generation !== this.generation) fail("ACCOUNT_CHANGED");
      await this.account.connectWithTokenProvider(relayOrigin, () =>
        desktopAccessToken(authGeneration),
      );
      if (generation !== this.generation) fail("ACCOUNT_CHANGED");
      this.accountAuthEpoch = authGeneration;
      if (credential && this.account.getSnapshot()?.accountId !== credential.accountId) {
        this.account.disconnect();
        fail("ACCOUNT_MISMATCH");
      }
      await this.start();
    });
  }
  private async directoryAccount(relayOrigin: string): Promise<RelayAccountSession> {
    origin(relayOrigin);
    const credential = this.credential ?? loadRemoteCredential();
    if (
      !this.trustedOrigins.has(relayOrigin) &&
      credential?.relayOrigin !== relayOrigin &&
      loadRemoteEnrollment()?.relayOrigin !== relayOrigin
    )
      fail("SECURITY_PROFILE_MISMATCH");
    this.trustedOrigins.add(relayOrigin);
    if (!hasDesktopAuth()) fail("ACCOUNT_AUTH_REQUIRED");
    const epoch = desktopAuthGeneration();
    const account = new RelayAccountSession(randomUUID);
    await account.connectWithTokenProvider(origin(relayOrigin), () => desktopAccessToken(epoch));
    return account;
  }
  /** Fetch the account directory explicitly without replacing an active desktop connection. */
  async desktops(relayOrigin: string): Promise<DesktopSummary[]> {
    const account = await this.directoryAccount(relayOrigin);
    return account.desktops();
  }
  private async deleteRegistration(
    relayOrigin: string,
    target: string,
    owner: string | null,
  ): Promise<void> {
    const account = await this.directoryAccount(relayOrigin);
    if (owner && account.getSnapshot()?.accountId !== owner) fail("ACCOUNT_MISMATCH");
    const key = `${account.getSnapshot()?.accountId}:${relayOrigin}:${target}`;
    const requestId = this.removalRequests.get(key) ?? randomUUID();
    this.removalRequests.set(key, requestId);
    await account
      .client()
      .request(
        "DELETE",
        `/v2/account/me/desktops/${desktopId(target)}`,
        null,
        {},
        (value) => value,
        requestId,
      );
    this.removalRequests.delete(key);
  }
  private forgetEnrollment(): void {
    let relayOrigin = this.credential?.relayOrigin;
    try {
      relayOrigin ??= loadRemoteCredential()?.relayOrigin ?? loadRemoteEnrollment()?.relayOrigin;
    } catch {
      // Explicit local recovery must also work when the persisted registration is unreadable.
    }
    if (relayOrigin) this.trustedOrigins.add(relayOrigin);
    clearRemoteCredential();
    this.credential = null;
    clearRemoteEnrollmentDraft();
    this.account.disconnect();
    this.accountAuthEpoch = null;
    this.startup = true;
  }
  /** Stop and revoke local access first; local-only reset explicitly leaves relay cleanup to the user. */
  async resetEnrollment(localOnly: boolean): Promise<RemoteSnapshot> {
    if (typeof localOnly !== "boolean") fail("INVALID_FRAME");
    return this.manage("resetting", async () => {
      this.stop();
      if (!localOnly) {
        const credential = this.credential ?? loadRemoteCredential();
        const draft = loadRemoteEnrollment();
        const target = credential?.desktopId ?? draft?.desktopId;
        const relayOrigin = credential?.relayOrigin ?? draft?.relayOrigin;
        if (!target || !relayOrigin) fail("REGISTRATION_PENDING");
        const grant = loadRemoteGrant();
        if (grant && grant.state !== "revoked")
          saveRemoteGrant(revoked(grant, Date.now(), "user_revoked"));
        await this.deleteRegistration(
          relayOrigin,
          target,
          credential?.accountId ?? draft?.accountId ?? null,
        );
      }
      this.forgetEnrollment();
    });
  }
  /** Directory removal requires an explicit user-selected desktop and the current account. */
  async removeDesktop(relayOrigin: string, target: string): Promise<RemoteSnapshot> {
    origin(relayOrigin);
    desktopId(target);
    const credential = this.credential ?? loadRemoteCredential();
    const draft = loadRemoteEnrollment();
    if (
      (credential?.desktopId === target && credential.relayOrigin === relayOrigin) ||
      (draft?.desktopId === target && draft.relayOrigin === relayOrigin)
    )
      return this.resetEnrollment(false);
    return this.manage("resetting", () => this.deleteRegistration(relayOrigin, target, null));
  }
  private async enrollRequest(raw: RemoteEnrollment): Promise<void> {
    const r = exact(raw, [
      "controlVersion",
      "relayOrigin",
      "displayName",
      "registrationRequestId",
      "trustRelay",
    ]);
    if (r.controlVersion !== 2) fail("VERSION_MISMATCH");
    if (r.trustRelay !== true) fail("SECURITY_PROFILE_MISMATCH");
    if (!remoteStorageAvailable()) fail("SECURE_STORAGE_UNAVAILABLE");
    if (this.credential || loadRemoteCredential()) fail("DEVICE_LIMIT_REACHED");
    const relayOrigin = origin(r.relayOrigin);
    if (
      typeof r.displayName !== "string" ||
      !r.displayName.trim() ||
      Array.from(r.displayName).length > 64
    )
      fail("INVALID_FRAME");
    const previous = loadRemoteEnrollment();
    if (
      previous &&
      (previous.relayOrigin !== relayOrigin || previous.displayName !== r.displayName.trim())
    )
      fail("REGISTRATION_PENDING");
    const draft: DesktopEnrollmentDraft = previous ?? {
      relayOrigin,
      displayName: r.displayName.trim(),
      registrationRequestId: id(r.registrationRequestId),
      desktopId: null,
      accountId: null,
    };
    saveRemoteEnrollment(draft);
    this.stop();
    const generation = this.generation;
    const authGeneration = await ensureDesktopLogin();
    if (generation !== this.generation) fail("ACCOUNT_CHANGED");
    await this.account.connectWithTokenProvider(relayOrigin, () =>
      desktopAccessToken(authGeneration),
    );
    if (generation !== this.generation) fail("ACCOUNT_CHANGED");
    this.accountAuthEpoch = authGeneration;
    const owner = this.account.getSnapshot()?.accountId ?? fail("ACCOUNT_AUTH_REQUIRED");
    if (draft.accountId && draft.accountId !== owner) fail("ACCOUNT_MISMATCH");
    draft.accountId = owner;
    saveRemoteEnrollment(draft);
    const client = this.account.client();
    const meta = await client.request("GET", "/v2/meta", null, null, parseMeta);
    if (generation !== this.generation) fail("ACCOUNT_CHANGED");
    const credential = await client.request(
      "POST",
      "/v2/account/me/desktops",
      null,
      {
        displayName: draft.displayName,
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
        const item = record(result.item);
        draft.desktopId = desktopId(item.desktopId);
        saveRemoteEnrollment(draft);
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
      draft.registrationRequestId,
    );
    // A completed registration can return its credential only once. Persist it even if a
    // concurrent pause occurred, but never resume sharing after that pause.
    saveRemoteCredential(credential);
    const saved = loadRemoteCredential();
    if (
      !saved ||
      saved.desktopCredential !== credential.desktopCredential ||
      saved.desktopId !== credential.desktopId
    )
      fail("SECURE_STORAGE_UNAVAILABLE");
    this.credential = credential;
    clearRemoteEnrollmentDraft();
    if (generation === this.generation) await this.start();
  }
  async start(): Promise<void> {
    if (!this.stopped || this.starting) return;
    this.starting = true;
    const generation = this.generation;
    try {
      this.credential = loadRemoteCredential();
      if (!this.credential) return;
      if (Date.now() >= Date.parse(this.credential.expiresAt)) fail("AUTH_EXPIRED");
      if (!this.account.getSnapshot() || this.accountAuthEpoch !== desktopAuthGeneration()) {
        if (!hasDesktopAuth()) fail("ACCOUNT_AUTH_REQUIRED");
        const authGeneration = desktopAuthGeneration();
        await this.account.connectWithTokenProvider(this.credential.relayOrigin, () =>
          desktopAccessToken(authGeneration),
        );
        this.accountAuthEpoch = authGeneration;
      }
      if (generation !== this.generation) return;
      if (this.account.getSnapshot()?.accountId !== this.credential.accountId)
        fail("ACCOUNT_MISMATCH");
      this.client = this.account.client(this.credential.desktopId, this.credential.accountId);
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
      if (generation === this.generation) this.error = remoteError(cause, "CONTROL_FAILED");
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }
  private schedule(delay?: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.stopped)
      this.timer = setTimeout(
        () => {
          void (this.ready ? this.tick() : this.connect());
        },
        delay ?? (this.ready ? RELAY_TIMING.localReconcileMs : this.reconnectDelay()),
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
        "/auth/desktop-access",
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
      const url = `${credential.relayOrigin.replace(/^https:/, "wss:")}/v2/connect/${credential.desktopId}`;
      const headers = await client.socketHeaders();
      if (this.stopped || generation !== this.generation) return;
      const ws = relaySocket(url, headers);
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
            encodeClientSocketFrame(
              { controlVersion: 2, type: "authenticate", accessToken: token },
              { role: "desktop", authenticated: false },
            ),
          );
      };
      ws.onmessage = (event) => {
        const raw = String(event.data);
        const size = Buffer.byteLength(raw);
        queued++;
        queuedBytes += size;
        if (queued > 8 || queuedBytes > 262_144) {
          ws.close();
          return;
        }
        received = received
          .then(async () => {
            if (this.socket !== ws) return;
            const raw = String(event.data);
            const r = parseRelaySocketFrame(raw, "desktop");
            if (!authenticated) {
              if (r.type !== "authenticated" || r.securityProfile !== SECURITY_PROFILE)
                fail("AUTH_REQUIRED");
              const p = relayPrincipal(r.principal, credential.accountId);
              if (
                p.role !== "desktop" ||
                p.desktopId !== this.credential?.desktopId ||
                p.relayInstanceId !== this.credential?.relayInstanceId
              )
                fail("AUTH_REQUIRED");
              requireRelayFeatures(r.features);
              this.pushNotificationsSupported =
                r.features?.includes("push-notifications-v1") === true;
              authenticated = true;
              const renewal = new ConnectionRenewal(
                {
                  accountId: credential.accountId,
                  newId: randomUUID,
                  now: () => client.now(),
                  credentials: async () => {
                    const refreshed = await client.request(
                      "POST",
                      "/auth/desktop-access",
                      credential.desktopCredential,
                      {},
                      (value) => {
                        const item = exact(value, ["accessToken", "accessExpiresAt"]);
                        return {
                          token: secret(item.accessToken),
                          expires: Date.parse(timestamp(item.accessExpiresAt)),
                        };
                      },
                    );
                    if (this.socket !== ws) fail("DESKTOP_OFFLINE");
                    this.access = refreshed;
                    return {
                      accessToken: refreshed.token,
                      accountToken: await client.v2.account.token(),
                    };
                  },
                  send: (frame) => {
                    if (this.socket !== ws) fail("DESKTOP_OFFLINE");
                    ws.send(
                      encodeClientSocketFrame(frame, { role: "desktop", authenticated: true }),
                    );
                  },
                  close: () => ws.close(),
                  renewed: () => {},
                },
                p,
              );
              this.renewal?.dispose();
              this.renewal = renewal;
              this.stateRevision = -1;
              renewal.start(r.accountExpiresAt);
              clearTimeout(authTimer);
              await this.pairing?.reconcile(this.startup);
              if (this.socket !== ws) return;
              this.startup = false;
              this.ready = true;
              this.reconnectAttempts = 0;
              this.error = null;
              this.schedule();
              this.scheduleEventTick();
              return;
            }
            if (!this.ready) return;
            if (r.type === "pairing_state" || r.type === "reauthenticated") {
              ws.send(
                encodeClientSocketFrame(
                  {
                    controlVersion: 2,
                    type: "ack",
                    deliverySequence: delivery.accept(r),
                  },
                  { role: "desktop", authenticated: true },
                ),
              );
              if (r.type === "reauthenticated") {
                this.renewal?.accept(r);
              } else {
                const state = r.state;
                if (state.revision > this.stateRevision) {
                  await this.pairing?.applyState(state);
                  this.stateRevision = state.revision;
                }
              }
              return;
            }
            if (r.type !== "route") fail("FORBIDDEN");
            const p = relayPrincipal({ ...r.context, role: "mobile" }, credential.accountId);
            const { role: _role, ...context } = p;
            if (
              context.desktopId !== this.credential?.desktopId ||
              context.relayInstanceId !== this.credential?.relayInstanceId
            )
              fail("AUTH_REQUIRED");
            ws.send(
              encodeClientSocketFrame(
                {
                  controlVersion: 2,
                  type: "ack",
                  deliverySequence: delivery.accept(r),
                },
                { role: "desktop", authenticated: true },
              ),
            );
            let frame: unknown;
            try {
              frame = await this.bridge.request(context, r.frame);
            } catch (cause) {
              const request = record(r.frame);
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
            if (this.socket === ws) this.error = remoteError(cause);
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
          this.renewal?.dispose();
          this.renewal = null;
          this.socket = null;
          this.ready = false;
          this.bridge.clear();
          this.schedule(
            this.error === "VERSION_MISMATCH" ? RELAY_TIMING.unavailableRetryMs : undefined,
          );
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
        const code = remoteError(cause, "DESKTOP_OFFLINE");
        if (
          [
            "ACCOUNT_AUTH_REQUIRED",
            "ACCOUNT_CLOSED",
            "AUTH_EXPIRED",
            "DEVICE_REVOKED",
            "AUTH_STORE_INVALID",
          ].includes(code)
        ) {
          this.stop();
          this.account.disconnect();
          this.accountAuthEpoch = null;
        } else {
          this.schedule(
            code === "STATE_UNAVAILABLE"
              ? RELAY_TIMING.unavailableRetryMs
              : cause instanceof ControlError && cause.code === "RATE_LIMITED"
                ? Math.max(LIMITS.pollMs, cause.retryAfterMs)
                : undefined,
          );
        }
        this.error = code;
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
      encodeClientSocketFrame(
        { controlVersion: 2, type: "deliver", context, frame },
        { role: "desktop", authenticated: true },
      ),
    );
  }
  private async tick(): Promise<void> {
    if (this.ticking || !this.ready || !this.pairing) return;
    this.ticking = true;
    const generation = this.generation;
    const pairing = this.pairing;
    try {
      if (
        !this.access ||
        (!this.renewal && (this.client?.now() ?? Date.now()) >= this.access.expires)
      ) {
        this.socket?.close();
        return;
      }
      if (
        pairing.grant?.state === "revoked" &&
        (pairing.revocationPending || pairing.needsRevocationSync())
      )
        await pairing.revoke();
      if (this.stopped || generation !== this.generation) return;
      await this.bridge.tick((context, frame) => this.deliver(context, frame));
      if (generation === this.generation) this.error = null;
    } catch (cause) {
      if (generation === this.generation) this.error = remoteError(cause);
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
  async approve(claimId: string) {
    if (!this.ready || !this.pairing) fail("DESKTOP_OFFLINE");
    await this.pairing.approve(claimId);
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
      this.error = remoteError(cause);
    }
    this.bridge.clear();
    return this.snapshot();
  }
  stop(): void {
    cancelDesktopLogin();
    this.stopped = true;
    this.generation++;
    this.ready = false;
    this.pushNotificationsSupported = false;
    this.notificationSnapshot = null;
    this.notificationOutcomes.clear();
    this.starting = false;
    this.connecting = false;
    this.ticking = false;
    this.bridge.clear();
    this.renewal?.dispose();
    this.renewal = null;
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
