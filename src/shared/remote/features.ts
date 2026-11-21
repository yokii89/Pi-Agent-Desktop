import {
  type ClaimStatus,
  exact,
  fail,
  type Grant,
  parseClaim,
  parseGrant,
  record,
} from "./contract";

export const RELAY_FEATURE_HEADER = "X-PiDesk-Relay-Features";
export const RELAY_FEATURES = [
  "state-push-v1",
  "session-reauth-v1",
  "completed-history-v1",
  "push-notifications-v1",
] as const;
export type RelayFeature = (typeof RELAY_FEATURES)[number];
export const RELAY_FEATURE_VALUE = RELAY_FEATURES.join(",");
export const RELAY_TIMING = {
  directoryRefreshMs: 120_000,
  overviewLeaseMs: 180_000,
  localReconcileMs: 10_000,
  renewBeforeMs: 60_000,
  unavailableRetryMs: 300_000,
} as const;

export interface PairingSnapshot {
  revision: number;
  grant: Grant | null;
  claim: ClaimStatus | null;
}

export function parsePairingState(value: unknown): PairingSnapshot {
  const r = exact(value, ["revision", "grant", "claim"]);
  if (!Number.isSafeInteger(r.revision) || Number(r.revision) < 0) fail("INVALID_FRAME");
  return {
    revision: r.revision as number,
    grant: r.grant === null ? null : parseGrant(r.grant),
    claim: r.claim === null ? null : parseClaim(r.claim),
  };
}

export function relayFeatures(value: unknown): RelayFeature[] {
  if (!Array.isArray(value) || value.length > RELAY_FEATURES.length) fail("VERSION_MISMATCH");
  if (new Set(value).size !== value.length) fail("VERSION_MISMATCH");
  return value.map((feature) => {
    if (!(RELAY_FEATURES as readonly unknown[]).includes(feature)) fail("VERSION_MISMATCH");
    return feature as RelayFeature;
  });
}

export const REQUIRED_RELAY_FEATURES: readonly RelayFeature[] = [
  "state-push-v1",
  "session-reauth-v1",
  "completed-history-v1",
];

export function requireRelayFeatures(value: unknown): void {
  const features = relayFeatures(value);
  if (REQUIRED_RELAY_FEATURES.some((feature) => !features.includes(feature)))
    fail("VERSION_MISMATCH");
}

export type HistoryNotice =
  | { kind: "history_committed"; revision: string }
  | { kind: "status_changed"; changes: ("projects" | "sessions")[] };

export function parseHistoryNotice(value: unknown): HistoryNotice {
  const r = record(value);
  if (r.kind === "history_committed") {
    exact(r, ["kind", "revision"]);
    if (typeof r.revision !== "string" || !r.revision || r.revision.length > 128)
      fail("INVALID_FRAME");
    return { kind: r.kind, revision: r.revision };
  }
  exact(r, ["kind", "changes"]);
  if (r.kind !== "status_changed" || !Array.isArray(r.changes) || r.changes.length > 2)
    fail("INVALID_FRAME");
  const changes = r.changes.map((item) => {
    if (item !== "projects" && item !== "sessions") fail("INVALID_FRAME");
    return item as "projects" | "sessions";
  });
  if (new Set(changes).size !== changes.length) fail("INVALID_FRAME");
  return { kind: r.kind, changes };
}
