/** Pairing control plane; deliberately independent of business protocol v1. */
export const CONTROL_VERSION = 1;
export const SECURITY_PROFILE = "trusted-relay-tls-v1";
export const LIMITS = {
  invitationMs: 120_000,
  approvalMs: 120_000,
  activationMs: 60_000,
  grantMs: 30 * 86_400_000,
  refreshIdleMs: 7 * 86_400_000,
  accessMs: 300_000,
  enrollmentMs: 600_000,
  desktopMs: 90 * 86_400_000,
  authMs: 5_000,
  pollMs: 2_000,
  controlBytes: 4_096,
  businessBytes: 65_536,
  projects: 20,
  refreshMinMs: 60_000,
  refreshRotations: 12_000,
  terminalMs: 600_000,
  tombstoneMs: 300_000,
} as const;
export const READ_SCOPES = ["projects.read", "sessions.read"] as const;
export const OPTIONAL_SCOPES = [
  "sessions.send",
  "sessions.stop",
  "sessions.create",
  "interactions.read",
  "interactions.answer",
] as const;
export const ALL_SCOPES = [...READ_SCOPES, ...OPTIONAL_SCOPES] as const;
export type Scope = (typeof ALL_SCOPES)[number];
export type PairingState =
  | "open"
  | "claimed"
  | "approved"
  | "credential_issued"
  | "activating"
  | "completed"
  | "rejected"
  | "cancelled"
  | "expired"
  | "revoked";
export const TERMINAL = new Set<PairingState>([
  "completed",
  "rejected",
  "cancelled",
  "expired",
  "revoked",
]);
export interface Binding {
  relayInstanceId: string;
  desktopId: string;
  deviceId: string;
  grantId: string;
  grantVersion: number;
}
export interface Grant extends Binding {
  state: "prepared" | "active" | "revoked";
  scopes: Scope[];
  projectIds: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
  approvalId: string;
  activationId: string | null;
  activationExpiresAt: string;
}
export interface PairingQr {
  kind: "pidesk.pairing";
  pairingVersion: 1;
  relayOrigin: string;
  relayInstanceId: string;
  desktopId: string;
  invitationId: string;
  invitationSecret: string;
  expiresAt: string;
}
export interface Meta {
  relayInstanceId: string;
  controlVersion: 1;
  securityProfile: typeof SECURITY_PROFILE;
}
export interface ClaimStatus {
  invitationId: string;
  claimId: string;
  deviceId: string;
  state: PairingState;
  deviceName: string;
  confirmationCode: string | null;
  expiresAt: string;
  grant: Grant | null;
}
export type PendingWriteCommand =
  | "sessions.send"
  | "sessions.stop"
  | "sessions.create"
  | "interactions.answer";
export interface PendingOperationRef {
  requestId: string;
  command: PendingWriteCommand;
  createdAt: number;
}
export interface MobileCredential extends Binding {
  version: 1;
  projectIds: string[];
  scopes: Scope[];
  relayOrigin: string;
  securityProfile: typeof SECURITY_PROFILE;
  refreshToken: string;
  grantExpiresAt: string;
  refreshExpiresAt: string;
  activationId: string;
  activationExpiresAt: string;
  state: "activating" | "active";
  refreshPending: boolean;
  pendingOperations: PendingOperationRef[];
}
export interface IssuedTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  grant: Grant;
}
export interface DesktopCredential {
  version: 1;
  relayOrigin: string;
  relayInstanceId: string;
  desktopId: string;
  desktopCredential: string;
  expiresAt: string;
}
export interface Principal extends Binding {
  role: "desktop" | "mobile";
  connectionGeneration: number;
  accessExpiresAt: string;
}
export interface RoutingContext extends Binding {
  connectionGeneration: number;
  accessExpiresAt: string;
}
export interface ReconcileState {
  grants: Grant[];
  claim: ClaimStatus | null;
}
export class ControlError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    public readonly retryAfterMs = 0,
  ) {
    super(code);
    this.name = "ControlError";
  }
}
export function fail(code: string): never {
  throw new ControlError(code);
}
/** Hermes-compatible byte budget check, including malformed UTF-16. */
export function byteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n < 128) bytes++;
    else if (n < 2048) bytes += 2;
    else if (
      n >= 0xd800 &&
      n <= 0xdbff &&
      i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
export function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail("INVALID_FRAME");
  return v as Record<string, unknown>;
}
export function exact(v: unknown, keys: readonly string[]): Record<string, unknown> {
  const r = record(v);
  if (Object.keys(r).length !== keys.length || keys.some((k) => !Object.hasOwn(r, k)))
    fail("INVALID_FRAME");
  return r;
}
export function id(v: unknown): string {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(v)) return fail("INVALID_FRAME");
  return v;
}
export function secret(v: unknown): string {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{43,128}$/.test(v)) return fail("AUTH_REQUIRED");
  return v;
}
export function positive(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) return fail("INVALID_FRAME");
  return v;
}
export function timestamp(v: unknown): string {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) ||
    !Number.isFinite(Date.parse(v))
  )
    return fail("INVALID_FRAME");
  return v;
}
export function origin(v: unknown): string {
  if (typeof v !== "string" || v.length > 512) return fail("INVALID_ORIGIN");
  try {
    const u = new URL(v);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      v !== u.origin
    )
      return fail("INVALID_ORIGIN");
    return u.origin;
  } catch {
    return fail("INVALID_ORIGIN");
  }
}
export function deviceName(v: unknown): string {
  if (typeof v !== "string") return fail("INVALID_FRAME");
  const name = Array.from(v)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return !(
        code <= 0x1f ||
        (code >= 0x7f && code <= 0x9f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    })
    .join("")
    .trim();
  if (!name || name.length > 64) return fail("INVALID_FRAME");
  return name;
}
export function projectIds(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.length > LIMITS.projects) return fail("INVALID_PROJECTS");
  const ids = v.map(id);
  if (new Set(ids).size !== ids.length) fail("INVALID_PROJECTS");
  return ids;
}
export function parseJson(raw: string, max: number = LIMITS.controlBytes): unknown {
  if (byteLength(raw) > max) return fail("FRAME_TOO_LARGE");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fail("INVALID_FRAME");
  }
}
export function parseQr(raw: string): PairingQr {
  const r = exact(parseJson(raw), [
    "kind",
    "pairingVersion",
    "relayOrigin",
    "relayInstanceId",
    "desktopId",
    "invitationId",
    "invitationSecret",
    "expiresAt",
  ]);
  if (r.kind !== "pidesk.pairing" || r.pairingVersion !== 1) return fail("VERSION_MISMATCH");
  return {
    kind: "pidesk.pairing",
    pairingVersion: 1,
    relayOrigin: origin(r.relayOrigin),
    relayInstanceId: id(r.relayInstanceId),
    desktopId: id(r.desktopId),
    invitationId: id(r.invitationId),
    invitationSecret: secret(r.invitationSecret),
    expiresAt: timestamp(r.expiresAt),
  };
}
export function parseMeta(v: unknown): Meta {
  const r = exact(v, ["relayInstanceId", "controlVersion", "securityProfile"]);
  if (r.controlVersion !== 1) fail("VERSION_MISMATCH");
  if (r.securityProfile !== SECURITY_PROFILE) fail("SECURITY_PROFILE_MISMATCH");
  return {
    relayInstanceId: id(r.relayInstanceId),
    controlVersion: 1,
    securityProfile: SECURITY_PROFILE,
  };
}
export function parseBinding(v: unknown): Binding {
  const r = record(v);
  return {
    relayInstanceId: id(r.relayInstanceId),
    desktopId: id(r.desktopId),
    deviceId: id(r.deviceId),
    grantId: id(r.grantId),
    grantVersion: positive(r.grantVersion),
  };
}
function parseScopes(v: unknown): Scope[] {
  if (
    !Array.isArray(v) ||
    v.length < READ_SCOPES.length ||
    v.length > ALL_SCOPES.length ||
    !READ_SCOPES.every((scope) => v.includes(scope)) ||
    v.some((scope) => !(ALL_SCOPES as readonly unknown[]).includes(scope)) ||
    new Set(v).size !== v.length
  )
    return fail("INVALID_GRANT");
  if (v.includes("interactions.answer") && !v.includes("interactions.read"))
    return fail("INVALID_GRANT");
  return [...v] as Scope[];
}

export function parseGrant(v: unknown): Grant {
  const r = exact(v, [
    "relayInstanceId",
    "desktopId",
    "deviceId",
    "grantId",
    "grantVersion",
    "state",
    "scopes",
    "projectIds",
    "createdAt",
    "expiresAt",
    "revokedAt",
    "revocationReason",
    "approvalId",
    "activationId",
    "activationExpiresAt",
  ]);
  if (r.state !== "prepared" && r.state !== "active" && r.state !== "revoked")
    fail("INVALID_GRANT");
  const scopes = parseScopes(r.scopes);
  if (
    r.revocationReason !== null &&
    (typeof r.revocationReason !== "string" || r.revocationReason.length > 128)
  )
    fail("INVALID_GRANT");
  return {
    ...parseBinding(r),
    state: r.state as Grant["state"],
    scopes,
    projectIds: projectIds(r.projectIds),
    createdAt: timestamp(r.createdAt),
    expiresAt: timestamp(r.expiresAt),
    revokedAt: r.revokedAt === null ? null : timestamp(r.revokedAt),
    revocationReason: r.revocationReason as string | null,
    approvalId: id(r.approvalId),
    activationId: r.activationId === null ? null : id(r.activationId),
    activationExpiresAt: timestamp(r.activationExpiresAt),
  };
}
export function parseClaim(v: unknown): ClaimStatus {
  const r = exact(v, [
    "invitationId",
    "claimId",
    "deviceId",
    "state",
    "deviceName",
    "confirmationCode",
    "expiresAt",
    "grant",
  ]);
  if (
    ![
      "open",
      "claimed",
      "approved",
      "credential_issued",
      "activating",
      "completed",
      "rejected",
      "cancelled",
      "expired",
      "revoked",
    ].includes(String(r.state))
  )
    fail("INVALID_FRAME");
  if (
    r.confirmationCode !== null &&
    (typeof r.confirmationCode !== "string" || !/^\d{8}$/.test(r.confirmationCode))
  )
    fail("INVALID_FRAME");
  return {
    invitationId: id(r.invitationId),
    claimId: id(r.claimId),
    deviceId: id(r.deviceId),
    state: r.state as PairingState,
    deviceName: deviceName(r.deviceName),
    confirmationCode: r.confirmationCode as string | null,
    expiresAt: timestamp(r.expiresAt),
    grant: r.grant === null ? null : parseGrant(r.grant),
  };
}
export function parseTokens(v: unknown): IssuedTokens {
  const r = exact(v, [
    "accessToken",
    "accessExpiresAt",
    "refreshToken",
    "refreshExpiresAt",
    "grant",
  ]);
  return {
    accessToken: secret(r.accessToken),
    accessExpiresAt: timestamp(r.accessExpiresAt),
    refreshToken: secret(r.refreshToken),
    refreshExpiresAt: timestamp(r.refreshExpiresAt),
    grant: parseGrant(r.grant),
  };
}
export function parseMobileCredential(v: unknown): MobileCredential {
  const raw = record(v);
  const legacyKeys = [
    "version",
    "relayOrigin",
    "securityProfile",
    "relayInstanceId",
    "desktopId",
    "deviceId",
    "grantId",
    "grantVersion",
    "refreshToken",
    "grantExpiresAt",
    "refreshExpiresAt",
    "activationId",
    "activationExpiresAt",
    "state",
    "refreshPending",
  ];
  const withScopes = [...legacyKeys, "scopes"];
  const withProjects = [...withScopes, "projectIds"];
  const currentKeys = [...withProjects, "pendingOperations"];
  const allowedKeys = Object.hasOwn(raw, "pendingOperations")
    ? currentKeys
    : Object.hasOwn(raw, "projectIds")
      ? withProjects
      : Object.hasOwn(raw, "scopes")
        ? withScopes
        : legacyKeys;
  const r = exact(v, allowedKeys);
  if (r.version !== 1 || r.securityProfile !== SECURITY_PROFILE) fail("SECURITY_PROFILE_MISMATCH");
  if ((r.state !== "activating" && r.state !== "active") || typeof r.refreshPending !== "boolean")
    fail("INVALID_FRAME");
  const projectIdsValue = Object.hasOwn(r, "projectIds") ? projectIds(r.projectIds) : [];
  const scopes = Object.hasOwn(r, "scopes") ? parseScopes(r.scopes) : [...READ_SCOPES];
  const pendingOperations = Object.hasOwn(r, "pendingOperations")
    ? (() => {
        if (!Array.isArray(r.pendingOperations) || r.pendingOperations.length > 64)
          return fail("INVALID_FRAME");
        const refs = r.pendingOperations.map((item) => {
          const pending = exact(item, ["requestId", "command", "createdAt"]);
          if (
            !["sessions.send", "sessions.stop", "sessions.create", "interactions.answer"].includes(
              String(pending.command),
            ) ||
            typeof pending.createdAt !== "number" ||
            !Number.isSafeInteger(pending.createdAt) ||
            pending.createdAt < 0
          )
            fail("INVALID_FRAME");
          return {
            requestId: id(pending.requestId),
            command: pending.command as PendingWriteCommand,
            createdAt: pending.createdAt,
          };
        });
        if (new Set(refs.map((item) => item.requestId)).size !== refs.length) fail("INVALID_FRAME");
        return refs;
      })()
    : [];
  return {
    ...parseBinding(r),
    projectIds: projectIdsValue,
    scopes,
    pendingOperations,
    state: r.state as "activating" | "active",
    refreshPending: r.refreshPending as boolean,
    version: 1,
    relayOrigin: origin(r.relayOrigin),
    securityProfile: SECURITY_PROFILE,
    refreshToken: secret(r.refreshToken),
    grantExpiresAt: timestamp(r.grantExpiresAt),
    refreshExpiresAt: timestamp(r.refreshExpiresAt),
    activationId: id(r.activationId),
    activationExpiresAt: timestamp(r.activationExpiresAt),
  };
}
export function parsePrincipal(v: unknown): Principal {
  const r = exact(v, [
    "role",
    "relayInstanceId",
    "desktopId",
    "deviceId",
    "grantId",
    "grantVersion",
    "connectionGeneration",
    "accessExpiresAt",
  ]);
  if (r.role !== "desktop" && r.role !== "mobile") fail("AUTH_REQUIRED");
  return {
    ...parseBinding(r),
    role: r.role as Principal["role"],
    connectionGeneration: positive(r.connectionGeneration),
    accessExpiresAt: timestamp(r.accessExpiresAt),
  };
}
export function sameBinding(a: Binding, b: Binding): boolean {
  return (
    a.relayInstanceId === b.relayInstanceId &&
    a.desktopId === b.desktopId &&
    a.deviceId === b.deviceId &&
    a.grantId === b.grantId &&
    a.grantVersion === b.grantVersion
  );
}
export function revoked(grant: Grant, now: number, reason: string): Grant {
  if (grant.state === "revoked") return grant;
  return {
    ...grant,
    state: "revoked",
    grantVersion: positive(grant.grantVersion + 1),
    revokedAt: new Date(now).toISOString(),
    revocationReason: reason,
  };
}
