/**
 * Host service helpers: system notification sounds (docs/design/18) and
 * optional desktop toasts (docs/design/24). Soft-fails on older hosts that do
 * not advertise the required capabilities.
 */

import type { DesktopViewClient } from "./client.js";
import type {
  ViewNotificationScenarioId,
  ViewNotificationSoundId,
  ViewNotifyPayload,
} from "./types.js";

export type PlayNotificationScenario = ViewNotificationScenarioId;
export type PlayNotificationSound = ViewNotificationSoundId;

/** Desktop toast copy (plain text; Host truncates). Requires capability `system-toast`. */
export interface PlayNotificationToast {
  title: string;
  body?: string;
}

export interface PlayNotificationOptions {
  /**
   * Host scenario mapping. Defaults to `"custom"` when omitted and `sound` is set;
   * both omitted → `"custom"`.
   */
  scenario?: PlayNotificationScenario;
  /** Override the scenario's default built-in sound id (`"1"`–`"5"`). */
  sound?: PlayNotificationSound;
  /** Session attribution; defaults to the connection auth sessionId. */
  sessionId?: string;
  /** Short diagnostic label for host logs; not guaranteed to surface in UI. */
  reason?: string;
  /**
   * Also show a system desktop toast (Windows corner popup). Host only displays
   * it while the main window is unfocused; focused suppression is not a failure.
   * Requires capability `system-toast`; missing → local `{ ok:false, reason:"unsupported" }`
   * without sending (no silent sound-only downgrade).
   */
  toast?: PlayNotificationToast;
  signal?: AbortSignal;
  /** Wait budget for Host ack. Default 2000ms. */
  timeoutMs?: number;
}

export type PlayNotificationFailureReason =
  | "unsupported"
  | "disabled"
  | "rejected"
  | "timeout"
  | "aborted"
  | "disconnected"
  /** The client object itself violated its contract (e.g. a stub missing `notify`). */
  | "internal";

export type PlayNotificationOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: PlayNotificationFailureReason;
      /**
       * Host's own reason string when {@link reason} had to fold an unlisted
       * value into `"rejected"` — kept so the author can still see what the
       * Host actually said (docs/design/20 O2).
       */
      detail?: string;
    };

function mapReason(raw: string | undefined): PlayNotificationOutcome & { ok: false } {
  const reason = raw ?? "rejected";
  if (
    reason === "unsupported" ||
    reason === "disabled" ||
    reason === "rejected" ||
    reason === "timeout" ||
    reason === "aborted" ||
    reason === "disconnected" ||
    reason === "internal"
  ) {
    return { ok: false, reason };
  }
  return { ok: false, reason: "rejected", detail: reason };
}

/**
 * Ask PiDesk to play a system notification sound, optionally with a desktop toast.
 *
 * ```ts
 * const desktop = connectDesktopView();
 * if (desktop) {
 *   await playNotification(desktop, {
 *     scenario: "needsAttention",
 *     reason: "deploy confirm",
 *     toast: { title: "PiDesk · deploy", body: "Needs attention" },
 *   });
 * }
 * ```
 *
 * Terminal pi / old hosts → `{ ok:false, reason:"unsupported" }` (never throws for soft failures).
 * Requesting `toast` without capability `system-toast` also returns unsupported locally.
 */
export async function playNotification(
  client: DesktopViewClient | null | undefined,
  options: PlayNotificationOptions = {},
): Promise<PlayNotificationOutcome> {
  if (!client) return { ok: false, reason: "unsupported" };
  const payload: ViewNotifyPayload = {
    scenario: options.scenario,
    sound: options.sound,
    sessionId: options.sessionId,
    reason: options.reason,
  };
  if (options.toast) {
    if (typeof options.toast.title !== "string" || !options.toast.title.trim()) {
      return { ok: false, reason: "rejected", detail: "toast.title required" };
    }
    payload.toast = {
      title: options.toast.title,
      body: options.toast.body,
    };
  }
  if (!payload.scenario && !payload.sound) payload.scenario = "custom";
  try {
    const result = await client.notify(payload, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
    if (result.ok) return { ok: true };
    return mapReason(result.reason);
  } catch (err) {
    // TypeError = 调用方给的 client 不合契约（缺方法），不是管道故障；
    // 把它报成 "disconnected" 会让人去查网络。docs/design/20 §1.2 的假 client 就是这种。
    if (err instanceof TypeError) {
      return { ok: false, reason: "internal", detail: err.message };
    }
    return { ok: false, reason: "disconnected" };
  }
}
