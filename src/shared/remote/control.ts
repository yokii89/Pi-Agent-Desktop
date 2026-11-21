import {
  parseRequestFrame,
  parseServerFrame,
  type RequestFrame,
  type ServerFrame,
  utf8ByteLength,
} from "./business";
import {
  exact,
  fail,
  id,
  LIMITS,
  parsePrincipal,
  positive,
  record,
  SECURITY_PROFILE,
  timestamp,
} from "./contract";
import { parsePairingState, relayFeatures } from "./features";

export type SocketRole = "desktop" | "mobile";
export const SOCKET_CLOSE_CODE = 4001;
export interface SocketParseState {
  role: SocketRole | null;
  authenticated: boolean;
}

export interface PushNotification {
  eventId: string;
  desktopId: string;
  sessionId: string;
  title: string;
  kind: "interaction" | "finished" | "failed";
}

export type ClientSocketFrame =
  | { controlVersion: 2; type: "authenticate"; accessToken: string }
  | { controlVersion: 2; type: "ack"; deliverySequence: number }
  | { controlVersion: 2; type: "task_notification"; notification: PushNotification }
  | {
      controlVersion: 2;
      type: "reauthenticate";
      renewalId: string;
      accessToken: string;
      accountToken: string;
    }
  | RequestFrame
  | { controlVersion: 2; type: "deliver"; context: Record<string, unknown>; frame: ServerFrame };

export type RelaySocketFrame =
  | {
      controlVersion: 2;
      type: "authenticated";
      principal: Record<string, unknown>;
      securityProfile: string;
      desktopOnline: boolean;
      features?: string[];
      accountExpiresAt?: string;
    }
  | {
      controlVersion: 2;
      type: "reauthenticated";
      renewalId: string;
      principal: Record<string, unknown>;
      accountExpiresAt: string;
      deliverySequence: number;
    }
  | {
      controlVersion: 2;
      type: "pairing_state";
      state: ReturnType<typeof parsePairingState>;
      deliverySequence: number;
    }
  | { controlVersion: 2; type: "desktop_status"; online: boolean; deliverySequence: number }
  | {
      controlVersion: 2;
      type: "route";
      context: Record<string, unknown>;
      frame: RequestFrame;
      deliverySequence: number;
    }
  | { controlVersion: 2; type: "business"; frame: ServerFrame; deliverySequence: number };

const ACCOUNT_ID = /^account-v1-[0-9a-f]{64}$/;
const PRINCIPAL_KEYS = [
  "role",
  "relayInstanceId",
  "desktopId",
  "deviceId",
  "grantId",
  "grantVersion",
  "connectionGeneration",
  "accessExpiresAt",
] as const;
const CONTEXT_KEYS = [
  "relayInstanceId",
  "desktopId",
  "deviceId",
  "grantId",
  "grantVersion",
  "connectionGeneration",
  "accessExpiresAt",
  "accountId",
] as const;

function parseJson(raw: string): Record<string, unknown> {
  if (utf8ByteLength(raw) > LIMITS.businessBytes) fail("FRAME_TOO_LARGE");
  try {
    return record(JSON.parse(raw));
  } catch {
    return fail("INVALID_FRAME");
  }
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 8192) fail("AUTH_REQUIRED");
  return value;
}
function parseTaskNotification(value: unknown): PushNotification {
  const notification = exact(value, ["eventId", "desktopId", "sessionId", "title", "kind"]);
  const eventId = id(notification.eventId);
  const desktopId = id(notification.desktopId);
  const sessionId = id(notification.sessionId);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(desktopId) ||
    typeof notification.title !== "string" ||
    !notification.title.trim() ||
    notification.title.length > 128 ||
    Array.from(notification.title).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    }) ||
    !["interaction", "finished", "failed"].includes(String(notification.kind))
  )
    fail("INVALID_FRAME");
  return {
    eventId,
    desktopId,
    sessionId,
    title: notification.title.trim(),
    kind: notification.kind as PushNotification["kind"],
  };
}
function principalWithAccount(value: unknown, role?: SocketRole): Record<string, unknown> {
  const raw = exact(value, ["accountId", ...PRINCIPAL_KEYS]);
  if (typeof raw.accountId !== "string" || !ACCOUNT_ID.test(raw.accountId)) fail("AUTH_REQUIRED");
  const principal = parsePrincipal(
    Object.fromEntries(PRINCIPAL_KEYS.map((key) => [key, raw[key]])),
  );
  if (role && principal.role !== role) fail("FORBIDDEN");
  return { ...principal, accountId: raw.accountId };
}
function context(value: unknown): Record<string, unknown> {
  const raw = exact(value, CONTEXT_KEYS);
  if (typeof raw.accountId !== "string" || !ACCOUNT_ID.test(raw.accountId)) fail("AUTH_REQUIRED");
  const { accountId, ...binding } = raw;
  const principal = parsePrincipal({ role: "mobile", ...binding });
  const { role: _role, ...routing } = principal;
  return { ...routing, accountId };
}

/** Validate the only client-to-relay frames permitted in the current handshake state. */
export function parseClientSocketFrame(raw: string, state: SocketParseState): ClientSocketFrame {
  const value = parseJson(raw);
  if (!state.authenticated) {
    if (value.controlVersion !== 2 || typeof value.type !== "string") fail("VERSION_MISMATCH");
    exact(value, ["controlVersion", "type", "accessToken"]);
    if (value.type !== "authenticate") fail("AUTH_REQUIRED");
    return { controlVersion: 2, type: "authenticate", accessToken: text(value.accessToken) };
  }
  if (state.role === "mobile" && value.version === 1 && value.type === "request")
    return parseRequestFrame(raw);
  if (state.role !== "mobile" && value.version === 1 && value.type === "request")
    return fail("FORBIDDEN");
  if (value.controlVersion !== 2 || typeof value.type !== "string") fail("VERSION_MISMATCH");
  if (value.type === "ack") {
    exact(value, ["controlVersion", "type", "deliverySequence"]);
    return { controlVersion: 2, type: "ack", deliverySequence: positive(value.deliverySequence) };
  }
  if (value.type === "task_notification") {
    if (state.role !== "desktop") fail("FORBIDDEN");
    exact(value, ["controlVersion", "type", "notification"]);
    return {
      controlVersion: 2,
      type: "task_notification",
      notification: parseTaskNotification(value.notification),
    };
  }
  if (value.type === "reauthenticate") {
    exact(value, ["controlVersion", "type", "renewalId", "accessToken", "accountToken"]);
    return {
      controlVersion: 2,
      type: "reauthenticate",
      renewalId: id(value.renewalId),
      accessToken: text(value.accessToken),
      accountToken: text(value.accountToken),
    };
  }
  if (state.role === "mobile" && value.type === "deliver") fail("FORBIDDEN");
  if (state.role === "mobile") return parseRequestFrame(raw);
  if (state.role === "desktop" && value.type === "deliver") {
    exact(value, ["controlVersion", "type", "context", "frame"]);
    return {
      controlVersion: 2,
      type: "deliver",
      context: context(value.context),
      frame: parseServerFrame(JSON.stringify(value.frame)),
    };
  }
  return fail("FORBIDDEN");
}

/** Validate relay-to-client frames, including direction and exact envelope fields. */
export function parseRelaySocketFrame(raw: string, role?: SocketRole): RelaySocketFrame {
  const value = parseJson(raw);
  if (value.controlVersion !== 2 || typeof value.type !== "string") fail("VERSION_MISMATCH");
  if (value.type === "authenticated") {
    const keys = ["controlVersion", "type", "principal", "securityProfile", "desktopOnline"];
    const hasFeatures = Object.hasOwn(value, "features");
    if (hasFeatures) keys.push("features", "accountExpiresAt");
    exact(value, keys);
    if (value.securityProfile !== SECURITY_PROFILE || typeof value.desktopOnline !== "boolean")
      fail("AUTH_REQUIRED");
    const principal = principalWithAccount(value.principal, role);
    if (!hasFeatures) {
      return {
        controlVersion: 2,
        type: "authenticated",
        principal,
        securityProfile: SECURITY_PROFILE,
        desktopOnline: value.desktopOnline,
      };
    }
    relayFeatures(value.features);
    return {
      controlVersion: 2,
      type: "authenticated",
      principal,
      securityProfile: SECURITY_PROFILE,
      desktopOnline: value.desktopOnline,
      features: value.features as string[],
      accountExpiresAt: timestamp(value.accountExpiresAt),
    };
  }
  if (value.type === "reauthenticated") {
    exact(value, [
      "controlVersion",
      "type",
      "renewalId",
      "principal",
      "accountExpiresAt",
      "deliverySequence",
    ]);
    return {
      controlVersion: 2,
      type: "reauthenticated",
      renewalId: id(value.renewalId),
      principal: principalWithAccount(value.principal, role),
      accountExpiresAt: timestamp(value.accountExpiresAt),
      deliverySequence: positive(value.deliverySequence),
    };
  }
  if (value.type === "pairing_state") {
    if (role === "mobile") fail("FORBIDDEN");
    exact(value, ["controlVersion", "type", "state", "deliverySequence"]);
    return {
      controlVersion: 2,
      type: "pairing_state",
      state: parsePairingState(value.state),
      deliverySequence: positive(value.deliverySequence),
    };
  }
  if (value.type === "desktop_status") {
    if (role === "desktop") fail("FORBIDDEN");
    exact(value, ["controlVersion", "type", "online", "deliverySequence"]);
    if (typeof value.online !== "boolean") fail("INVALID_FRAME");
    return {
      controlVersion: 2,
      type: "desktop_status",
      online: value.online,
      deliverySequence: positive(value.deliverySequence),
    };
  }
  if (value.type === "route") {
    if (role === "mobile") fail("FORBIDDEN");
    exact(value, ["controlVersion", "type", "context", "frame", "deliverySequence"]);
    return {
      controlVersion: 2,
      type: "route",
      context: context(value.context),
      frame: parseRequestFrame(JSON.stringify(value.frame)),
      deliverySequence: positive(value.deliverySequence),
    };
  }
  if (value.type === "business") {
    if (role === "desktop") fail("FORBIDDEN");
    exact(value, ["controlVersion", "type", "frame", "deliverySequence"]);
    return {
      controlVersion: 2,
      type: "business",
      frame: parseServerFrame(JSON.stringify(value.frame)),
      deliverySequence: positive(value.deliverySequence),
    };
  }
  return fail("INVALID_FRAME");
}

export function encodeClientSocketFrame(
  frame: Record<string, unknown>,
  state: SocketParseState,
): string {
  const raw = JSON.stringify(frame);
  parseClientSocketFrame(raw, state);
  return raw;
}
export function encodeRelaySocketFrame(frame: Record<string, unknown>, role?: SocketRole): string {
  const raw = JSON.stringify(frame);
  parseRelaySocketFrame(raw, role);
  return raw;
}
