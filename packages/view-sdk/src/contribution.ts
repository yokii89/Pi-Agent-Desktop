/**
 * Contribution-key helpers (docs/design/16 §5.3, docs/design/19 §3.1.1).
 *
 * The Host spawns extension processes with the Catalog bindings they are
 * allowed to claim, encoded as a JSON object in an environment variable:
 *
 * ```txt
 * PIDESK_VIEW_CONTRIBUTION_KEYS='{"yoki-plan":"ck:9f3…"}'
 * ```
 *
 * Extensions look their own id up in that map and pass the resulting
 * `contributionKey` to `registerAccessMode()` / their `ViewSpec`, which lets
 * the Host bind a cold-state Catalog entry to the live registration
 * (`viewHost.ts` → `contributionIndex`).
 *
 * Everything here is a **soft** read: no Host, no injection, or a malformed
 * payload all resolve to `undefined`, and callers fall back to the legacy
 * `mode.id` binding. Never throws.
 */

import type { ViewProcessEnv } from "./client.js";

/** Env var carrying the id→key map. `PIDESK_VIEW_*` wins over `PI_VIEW_*`. */
const KEYS_ENV = "CONTRIBUTION_KEYS";

/**
 * Read the Host-injected Contribution key for `id`.
 *
 * Returns `undefined` when the extension runs headless (TUI / plain pi), when
 * the Host injected no map, when the payload is not a JSON object, or when the
 * entry is missing / not a non-empty string. Malformed JSON is swallowed.
 *
 * ```ts
 * const contributionKey = resolveContributionKey("yoki-plan");
 * await superviseAccessMode({ client, mode: { id: "yoki-plan", … }, contributionKey });
 * ```
 *
 * @param id Contribution id — must match `pidesk.contributes.*[].id` in
 *   `package.json` (yoki-plan keeps this in `PLAN_MODE_CONTRIBUTION_ID`).
 * @param env Lookup source; defaults to `process.env` (tests inject their own).
 */
export function resolveContributionKey(
  id: string,
  env: ViewProcessEnv = process.env,
): string | undefined {
  return parseContributionKeyMap(readContributionKeysEnv(env))[id];
}

/**
 * Parse a raw `PIDESK_VIEW_CONTRIBUTION_KEYS` payload into a plain string map.
 * Exposed for callers that batch several lookups. Non-object payloads and
 * non-string / empty values are dropped rather than thrown on.
 */
export function parseContributionKeyMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

/** Raw env lookup honouring the `PIDESK_VIEW_` → `PI_VIEW_` fallback order. */
export function readContributionKeysEnv(env: ViewProcessEnv = process.env): string | undefined {
  return env[`PIDESK_VIEW_${KEYS_ENV}`] || env[`PI_VIEW_${KEYS_ENV}`] || undefined;
}
