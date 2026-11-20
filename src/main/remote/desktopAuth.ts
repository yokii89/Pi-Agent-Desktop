import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { shell } from "electron";
import { getI18nLocale, type LocaleId } from "../../shared/i18n";
import type { DesktopAuthSnapshot } from "../../shared/remoteDesktop";
import {
  clearDesktopAuthStore,
  type DesktopAuthTokens,
  loadDesktopAuth,
  saveDesktopAuth,
} from "../settings/desktopAuthStore";
import { renderDesktopAuthPage } from "./authCallbackPage";

const DOMAIN = "dev-f8lj4bpd4yx0iiob.us.auth0.com";
const CLIENT_ID = "zZopmSsOjW3u7cqK4G5ATxqmcTiRRC3P";
const AUDIENCE = "https://pidesk-relay-v2-staging.yecenglinjian.workers.dev";
const PORT = 49182;
const CALLBACK = `http://127.0.0.1:${PORT}/callback`;
const SCOPE = "openid profile offline_access pidesk.relay";
const LOGIN_TIMEOUT = 5 * 60_000;

interface LoginOptions {
  locale?: LocaleId;
  theme?: "dark" | "light";
  reauthenticate?: boolean;
}
interface LoginAttempt {
  controller: AbortController;
  phase: "opening_browser" | "waiting_for_browser" | "exchanging_code";
  deadline: number;
  promise: Promise<DesktopAuthTokens> | null;
}
interface RefreshAttempt {
  controller: AbortController;
  promise: Promise<string>;
}
let credentialEpoch = 0;
let loginFlight: LoginAttempt | null = null;
let loginCleanup: Promise<unknown> = Promise.resolve();
let refreshFlight: RefreshAttempt | null = null;
let authError: string | null = null;

/** Preserve finite authentication errors without forwarding provider bodies or local paths. */
export function desktopAuthError(cause: unknown, fallback = "AUTH_EXCHANGE_FAILED"): string {
  const message = cause instanceof Error ? cause.message : "";
  return /^(?:AUTH_[A-Z_]+|ACCOUNT_AUTH_REQUIRED|SECURE_STORAGE_UNAVAILABLE)$/.test(message)
    ? message
    : fallback;
}

function checkCurrent(epoch: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
  if (epoch !== credentialEpoch) throw new Error("AUTH_CHANGED");
}

async function exchange(
  payload: Record<string, string>,
  epoch: number,
  signal: AbortSignal,
  previous?: DesktopAuthTokens,
): Promise<DesktopAuthTokens> {
  try {
    const response = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({ client_id: CLIENT_ID, ...payload }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) {
      let code = "AUTH_EXCHANGE_FAILED";
      try {
        const body = (await response.json()) as { error?: unknown };
        if (body.error === "invalid_grant") code = "AUTH_REAUTH_REQUIRED";
      } catch {
        // Identity-provider response text never becomes a UI error or a log entry.
      }
      throw new Error(code);
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new Error("AUTH_RESPONSE_INVALID");
    }
    checkCurrent(epoch, signal);
    const body = raw as Record<string, unknown> | null;
    const refreshToken = body?.refresh_token ?? previous?.refreshToken;
    if (
      !body ||
      typeof body.access_token !== "string" ||
      !body.access_token ||
      typeof refreshToken !== "string" ||
      !refreshToken ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 0 ||
      !Number.isSafeInteger(Date.now() + body.expires_in * 1000)
    )
      throw new Error("AUTH_RESPONSE_INVALID");
    return {
      accessToken: body.access_token,
      refreshToken,
      expiresAt: Date.now() + body.expires_in * 1000,
      identity: previous?.identity ?? null,
    };
  } catch (cause) {
    checkCurrent(epoch, signal);
    if (cause instanceof Error && cause.name === "TimeoutError")
      throw new Error("AUTH_NETWORK_TIMEOUT");
    throw new Error(desktopAuthError(cause, "AUTH_NETWORK_UNAVAILABLE"));
  }
}

async function identity(
  accessToken: string,
  epoch: number,
  signal: AbortSignal,
): Promise<DesktopAuthSnapshot["identity"]> {
  try {
    const response = await fetch(`https://${DOMAIN}/userinfo`, {
      redirect: "error",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Cache-Control": "no-store",
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    checkCurrent(epoch, signal);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const profile = raw as Record<string, unknown>;
    if (typeof profile.sub !== "string" || !profile.sub || profile.sub.length > 256) return null;
    const name = [profile.name, profile.nickname, profile.sub].find(
      (value): value is string => typeof value === "string" && !!value.trim(),
    );
    return { subject: profile.sub, name: (name ?? profile.sub).trim().slice(0, 256) };
  } catch {
    checkCurrent(epoch, signal);
    // A missing display profile does not invalidate a successfully exchanged account token.
    return null;
  }
}

async function performLogin(
  attempt: LoginAttempt,
  epoch: number,
  options: LoginOptions,
): Promise<DesktopAuthTokens> {
  const locale = options.locale ?? getI18nLocale();
  const theme = options.theme ?? "dark";
  const signal = attempt.controller.signal;
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const server = http.createServer();
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxConnections = 8;
  let resolve!: (tokens: DesktopAuthTokens) => void;
  let reject!: (cause: Error) => void;
  const completion = new Promise<DesktopAuthTokens>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  // openExternal can settle after a loopback callback (including in tests).
  void completion.catch(() => {});
  let claimed = false;
  let callbackResponse: http.ServerResponse | null = null;
  const respond = (
    response: http.ServerResponse,
    outcome: "success" | "error" | "cancelled",
    code?: string,
    status = outcome === "success" ? 200 : 400,
  ): void => {
    if (response.writableEnded || response.destroyed) return;
    response.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Connection: "close",
    });
    response.end(renderDesktopAuthPage(outcome, locale, theme, code));
  };
  const abort = (): void => {
    const code = desktopAuthError(signal.reason, "AUTH_CANCELLED");
    if (callbackResponse)
      respond(callbackResponse, code === "AUTH_CANCELLED" ? "cancelled" : "error", code);
    reject(new Error(code));
  };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => attempt.controller.abort(new Error("AUTH_CALLBACK_TIMEOUT")),
    Math.max(0, attempt.deadline - Date.now()),
  );
  timer.unref();
  server.on("request", (request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", CALLBACK);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (
      request.method !== "GET" ||
      request.headers.host !== `127.0.0.1:${PORT}` ||
      url.origin !== `http://127.0.0.1:${PORT}` ||
      url.pathname !== "/callback"
    ) {
      response.writeHead(404).end();
      return;
    }
    const received = Buffer.from(url.searchParams.get("state") ?? "");
    const expected = Buffer.from(state);
    if (
      url.searchParams.getAll("state").length !== 1 ||
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      respond(response, "error", "AUTH_STATE_INVALID");
      return;
    }
    if (claimed || signal.aborted) {
      respond(response, "cancelled", "AUTH_CANCELLED");
      return;
    }
    claimed = true;
    callbackResponse = response;
    void (async () => {
      try {
        const error = url.searchParams.get("error");
        if (error)
          throw new Error(error === "access_denied" ? "AUTH_CANCELLED" : "AUTH_EXCHANGE_FAILED");
        const code = url.searchParams.get("code");
        if (!code || url.searchParams.getAll("code").length !== 1)
          throw new Error("AUTH_CODE_MISSING");
        checkCurrent(epoch, signal);
        attempt.phase = "exchanging_code";
        const tokens = await exchange(
          {
            grant_type: "authorization_code",
            code,
            redirect_uri: CALLBACK,
            code_verifier: verifier,
            audience: AUDIENCE,
            scope: SCOPE,
          },
          epoch,
          signal,
        );
        tokens.identity = await identity(tokens.accessToken, epoch, signal);
        checkCurrent(epoch, signal);
        saveDesktopAuth(tokens);
        respond(response, "success");
        resolve(tokens);
      } catch (cause) {
        const code = desktopAuthError(cause);
        respond(response, code === "AUTH_CANCELLED" ? "cancelled" : "error", code);
        reject(new Error(code));
      }
    })();
  });
  try {
    await new Promise<void>((done, fail) => {
      const onError = (cause: NodeJS.ErrnoException): void => {
        fail(
          new Error(cause.code === "EADDRINUSE" ? "AUTH_PORT_IN_USE" : "AUTH_CALLBACK_UNAVAILABLE"),
        );
      };
      server.once("error", onError);
      server.listen(PORT, "127.0.0.1", () => {
        server.removeListener("error", onError);
        done();
      });
    });
    checkCurrent(epoch, signal);
    const authorize = new URL(`https://${DOMAIN}/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK,
      scope: SCOPE,
      audience: AUDIENCE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      ui_locales: locale === "zh-CN" ? "zh-CN" : "en",
      ...(options.reauthenticate ? { prompt: "login" } : {}),
    }).toString();
    const opening = shell.openExternal(authorize.toString()).catch(() => {
      throw new Error("AUTH_BROWSER_OPEN_FAILED");
    });
    await Promise.race([opening, completion.then(() => undefined)]);
    if (attempt.phase === "opening_browser") attempt.phase = "waiting_for_browser";
    return await completion;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    await new Promise<void>((done) => {
      const forceClose = setTimeout(() => server.closeAllConnections(), 250);
      forceClose.unref();
      server.close(() => {
        clearTimeout(forceClose);
        done();
      });
    });
  }
}

/** Share one cancellable login across UI remounts and expose only its display state. */
export function loginDesktop(options: LoginOptions = {}): Promise<DesktopAuthTokens> {
  if (loginFlight?.promise) return loginFlight.promise;
  const epoch = ++credentialEpoch;
  refreshFlight?.controller.abort(new Error("AUTH_CHANGED"));
  refreshFlight = null;
  authError = null;
  const attempt: LoginAttempt = {
    controller: new AbortController(),
    phase: "opening_browser",
    deadline: Date.now() + LOGIN_TIMEOUT,
    promise: null,
  };
  loginFlight = attempt;
  attempt.promise = loginCleanup
    .then(() => {
      checkCurrent(epoch, attempt.controller.signal);
      return performLogin(attempt, epoch, options);
    })
    .catch((cause: unknown) => {
      const code = desktopAuthError(cause);
      if (loginFlight === attempt) authError = code === "AUTH_CANCELLED" ? null : code;
      throw new Error(code);
    })
    .finally(() => {
      if (loginFlight === attempt) loginFlight = null;
    });
  return attempt.promise;
}

/** Invalidate callbacks and token exchanges before allowing another login attempt. */
export function cancelDesktopLogin(): void {
  const attempt = loginFlight;
  if (!attempt) return;
  loginFlight = null;
  loginCleanup = attempt.promise?.catch(() => {}) ?? Promise.resolve();
  credentialEpoch++;
  authError = null;
  attempt.controller.abort(new Error("AUTH_CANCELLED"));
}

export function desktopAuthGeneration(): number {
  return credentialEpoch;
}

export async function desktopAccessToken(expectedEpoch = credentialEpoch): Promise<string> {
  checkCurrent(expectedEpoch);
  const current = loadDesktopAuth();
  if (!current) throw new Error("ACCOUNT_AUTH_REQUIRED");
  if (current.expiresAt > Date.now() + 60_000) return current.accessToken;
  if (refreshFlight) return refreshFlight.promise;
  const controller = new AbortController();
  const attempt: RefreshAttempt = { controller, promise: Promise.resolve("") };
  attempt.promise = exchange(
    {
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      audience: AUDIENCE,
      scope: SCOPE,
    },
    expectedEpoch,
    controller.signal,
    current,
  )
    .then((tokens) => {
      checkCurrent(expectedEpoch, controller.signal);
      authError = null;
      return saveDesktopAuth(tokens).accessToken;
    })
    .catch((cause: unknown) => {
      const code = desktopAuthError(cause);
      if (expectedEpoch === credentialEpoch && code === "AUTH_REAUTH_REQUIRED") {
        clearDesktopAuth();
        authError = "ACCOUNT_AUTH_REQUIRED";
        throw new Error("ACCOUNT_AUTH_REQUIRED");
      }
      throw new Error(code);
    })
    .finally(() => {
      if (refreshFlight === attempt) refreshFlight = null;
    });
  refreshFlight = attempt;
  return attempt.promise;
}

export function hasDesktopAuth(): boolean {
  return !!loadDesktopAuth();
}

/** Corrupt credentials must not make the entire remote-management UI unreadable. */
export function desktopAuthSnapshot(): DesktopAuthSnapshot {
  let tokens: DesktopAuthTokens | null = null;
  let error = authError;
  try {
    tokens = loadDesktopAuth();
  } catch (cause) {
    error = desktopAuthError(cause);
  }
  return {
    phase: loginFlight?.phase ?? (error ? "error" : tokens ? "signed_in" : "signed_out"),
    identity: tokens?.identity ?? null,
    deadline: loginFlight?.deadline ?? null,
    error: loginFlight ? null : error,
  };
}

export function clearDesktopAuth(): void {
  cancelDesktopLogin();
  credentialEpoch++;
  refreshFlight?.controller.abort(new Error("AUTH_CHANGED"));
  refreshFlight = null;
  authError = null;
  try {
    clearDesktopAuthStore();
  } catch (cause) {
    authError = desktopAuthError(cause);
    throw cause;
  }
}

export async function revokeDesktopAuth(): Promise<void> {
  let current: DesktopAuthTokens | null = null;
  try {
    current = loadDesktopAuth();
  } catch {
    // Explicit logout must also recover unreadable or unavailable account storage.
  }
  clearDesktopAuth();
  if (!current) return;
  try {
    await fetch(`https://${DOMAIN}/oauth/revoke`, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, token: current.refreshToken }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // This signs out PiDesk locally; the browser's Auth0 SSO session remains independent.
  }
}
