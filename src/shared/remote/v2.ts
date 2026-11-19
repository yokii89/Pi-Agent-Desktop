import { exact, fail, id, parsePrincipal, positive, record, timestamp } from "./contract";

export const MAX_DESKTOPS = 5;
export interface AccountAccess {
  readonly accountId: string;
  token(): Promise<string>;
}
export interface V2ClientOptions {
  account: AccountAccess;
  desktopId?: string;
}
export function accountId(value: unknown): string {
  if (typeof value !== "string" || !/^account-v1-[0-9a-f]{64}$/.test(value)) fail("AUTH_REQUIRED");
  return value as string;
}
export function desktopId(value: unknown): string {
  const result = id(value);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result))
    fail("INVALID_FRAME");
  return result;
}
/** Accepts public v2 account paths or explicit operations scoped to one desktop. */
export function controlPath(path: string, desktop?: string): string {
  if (path === "/v2/meta") return path;
  if (path.startsWith("/v2/account/me")) {
    if (
      !/^\/v2\/account\/me(?:\/desktops(?:\/[a-f0-9-]{36})?)?(?:\?cursor=[A-Za-z0-9_-]{1,2048})?$/.test(
        path,
      )
    )
      fail("INVALID_PATH");
    return path;
  }
  if (
    !desktop ||
    !/^(?:\/(?:state|reconcile|activation-ack|pairings)|\/auth\/(?:desktop-access|refresh)|\/pairings\/[A-Za-z0-9_-]{1,128}\/claim|\/claims\/[A-Za-z0-9_-]{1,128}(?:\/(?:approve|reject|cancel|redeem))?|\/devices\/[A-Za-z0-9_-]{1,128}\/(?:activate|revoke))$/.test(
      path,
    )
  )
    return fail("INVALID_PATH");
  return `/v2/desktops/${desktopId(desktop)}${path}`;
}
export function relayPrincipal(value: unknown, expectedAccount: string) {
  const { accountId: owner, ...base } = record(value);
  if (accountId(owner) !== expectedAccount) fail("AUTH_REQUIRED");
  return { ...parsePrincipal(base), accountId: owner as string };
}
/** One receiver per socket; duplicates, gaps and unsafe counters require resynchronization. */
export class DeliveryReceiver {
  private sequence = 0;
  accept(frame: Record<string, unknown>): number {
    const sequence = positive(frame.deliverySequence);
    if (frame.controlVersion !== 2 || sequence !== this.sequence + 1) fail("RESYNC_REQUIRED");
    this.sequence = sequence;
    return sequence;
  }
}
export type DesktopRegistrationState =
  | "reserved"
  | "room_initializing"
  | "registered"
  | "revocation_pending"
  | "revoked"
  | "failed"
  | "expired";
export interface DesktopSummary {
  desktopId: string;
  state: DesktopRegistrationState;
  displayName: string;
  platform: string;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
  reservationExpiresAt: string | null;
  ownerVersion: number;
  lastSeenAt: string | null;
  online: boolean;
}
export function parseDesktopSummary(value: unknown): DesktopSummary {
  const r = exact(value, [
    "desktopId",
    "state",
    "displayName",
    "platform",
    "capabilities",
    "createdAt",
    "updatedAt",
    "reservationExpiresAt",
    "ownerVersion",
    "lastSeenAt",
    "online",
  ]);
  if (
    ![
      "reserved",
      "room_initializing",
      "registered",
      "revocation_pending",
      "revoked",
      "failed",
      "expired",
    ].includes(String(r.state)) ||
    typeof r.displayName !== "string" ||
    Array.from(r.displayName).length > 64 ||
    !["windows", "macos", "linux"].includes(String(r.platform)) ||
    typeof r.online !== "boolean" ||
    !Array.isArray(r.capabilities) ||
    r.capabilities.some((c) => c !== "pairing-v1" && c !== "readonly-relay-v1")
  )
    fail("INVALID_FRAME");
  return {
    desktopId: desktopId(r.desktopId),
    state: r.state as DesktopRegistrationState,
    displayName: r.displayName as string,
    platform: r.platform as string,
    capabilities: [...(r.capabilities as string[])],
    createdAt: timestamp(r.createdAt),
    updatedAt: timestamp(r.updatedAt),
    reservationExpiresAt:
      r.reservationExpiresAt === null ? null : timestamp(r.reservationExpiresAt),
    ownerVersion: positive(r.ownerVersion),
    lastSeenAt: r.lastSeenAt === null ? null : timestamp(r.lastSeenAt),
    online: r.online as boolean,
  };
}
