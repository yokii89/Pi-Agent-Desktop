/**
 * Process-wide `DesktopViewClient` for multi-pi parallel sessions.
 *
 * Each pi process (one session) owns at most one pipe to the View Host.
 * The connection is multiplexed by view id and reconnects on the next
 * `open`/`ensureConnected` after a drop — only `dispose()` is terminal.
 *
 * Ownership (docs/design/15 P1-1): use `acquireProcessViewClient` /
 * `releaseProcessViewClient` so multiple extensions share one pipe safely.
 * `disposeProcessViewClient` force-disposes on process teardown.
 *
 * Session isolation is Host-side: this client authenticates with the
 * `PIDESK_VIEW_SESSION` baked into the process env at spawn (mutable later
 * via `client.setSessionId`). The SDK never rebinds another process's session.
 */

import {
  type ConnectDesktopViewOptions,
  connectDesktopView,
  type DesktopViewClient,
} from "./client.js";

let processClient: DesktopViewClient | null = null;
let refCount = 0;

/**
 * Acquire the process-level desktop client (creates on first use).
 * Every successful acquire must be paired with `releaseProcessViewClient()`.
 * Returns `null` when not running under a PiDesk host.
 */
export function acquireProcessViewClient(
  options?: ConnectDesktopViewOptions,
): DesktopViewClient | null {
  if (processClient) {
    refCount += 1;
    return processClient;
  }
  const client = connectDesktopView(options);
  if (!client) return null;
  processClient = client;
  refCount = 1;
  return client;
}

/** Back-compat alias of `acquireProcessViewClient` (also increments refcount). */
export function getProcessViewClient(
  options?: ConnectDesktopViewOptions,
): DesktopViewClient | null {
  return acquireProcessViewClient(options);
}

/**
 * Release one acquire. Disposes the shared client only when the last holder
 * releases — safe for multiple extensions in the same pi process.
 */
export function releaseProcessViewClient(): void {
  if (!processClient) return;
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    processClient.dispose();
    processClient = null;
  }
}

/**
 * Force-dispose the process client regardless of refcount.
 * Call from process teardown only — not from a single extension's shutdown
 * when peers may still hold the pipe.
 */
export function disposeProcessViewClient(): void {
  refCount = 0;
  processClient?.dispose();
  processClient = null;
}

/** Current holder count (diagnostics / tests). */
export function processViewClientRefCount(): number {
  return processClient ? refCount : 0;
}

/**
 * Identity check for the process-level shared client. **Package-internal** —
 * deliberately not re-exported from `index.ts`; extensions get the same
 * guarantee by pairing `acquireProcessViewClient` / `releaseProcessViewClient`
 * and never calling `dispose()` on a client they acquired.
 *
 * Slot supervisors use this to decide ownership cleanup: a shared client must
 * be released through {@link releaseProcessViewClient} (refcounted) instead of
 * `dispose()`, which would kill a pipe other extensions still hold.
 */
export function isProcessViewClient(client: DesktopViewClient | null | undefined): boolean {
  return client != null && client === processClient;
}

/** Test helper: drop the cache without disposing (tests inject their own clients). */
export function __resetProcessViewClientForTests(): void {
  processClient = null;
  refCount = 0;
}
