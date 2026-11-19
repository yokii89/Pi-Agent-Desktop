import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { app, safeStorage, shell } from "electron";

const DOMAIN = "dev-f8lj4bpd4yx0iiob.us.auth0.com";
const CLIENT_ID = "zZopmSsOjW3u7cqK4G5ATxqmcTiRRC3P";
const AUDIENCE = "https://pidesk-relay-v2-staging.yecenglinjian.workers.dev";
const PORT = 49182;
const CALLBACK = `http://127.0.0.1:${PORT}/callback`;
const STORAGE = () => path.join(app.getPath("userData"), "auth0-session.bin");

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
let tokenSet: TokenSet | null | undefined;
let credentialEpoch = 0;
let loginFlight: Promise<TokenSet> | null = null;

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}
function verifier(): string {
  return base64Url(randomBytes(32));
}
function challenge(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
function read(): TokenSet | null {
  if (tokenSet !== undefined) return tokenSet;
  if (!fs.existsSync(STORAGE())) {
    tokenSet = null;
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE");
  const value = JSON.parse(
    safeStorage.decryptString(fs.readFileSync(STORAGE())),
  ) as Partial<TokenSet>;
  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.expiresAt !== "number"
  )
    throw new Error("AUTH_STORE_INVALID");
  tokenSet = value as TokenSet;
  return tokenSet;
}
function save(value: TokenSet): TokenSet {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE");
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  fs.mkdirSync(path.dirname(STORAGE()), { recursive: true });
  const temporary = `${STORAGE()}.tmp`;
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
  fs.renameSync(temporary, STORAGE());
  tokenSet = value;
  return value;
}
async function exchange(
  payload: Record<string, string>,
  epoch = credentialEpoch,
): Promise<TokenSet> {
  const response = await fetch(`https://${DOMAIN}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let error = "AUTH_EXCHANGE_FAILED";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (body.error === "invalid_grant") error = "AUTH_REAUTH_REQUIRED";
    } catch {
      // Don't leak identity-provider response bodies to callers or logs.
    }
    throw new Error(error);
  }
  if (epoch !== credentialEpoch) throw new Error("AUTH_CHANGED");
  const body = (await response.json()) as Record<string, unknown>;
  if (
    typeof body.access_token !== "string" ||
    typeof body.refresh_token !== "string" ||
    typeof body.expires_in !== "number" ||
    body.expires_in <= 0
  )
    throw new Error("AUTH_RESPONSE_INVALID");
  return save({
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
}

async function performLogin(): Promise<TokenSet> {
  const epoch = ++credentialEpoch;
  refreshFlight = null;
  const state = base64Url(randomBytes(24));
  const codeVerifier = verifier();
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  let callbackTimer: NodeJS.Timeout | null = null;
  const callback = new Promise<string>((resolve, reject) => {
    callbackTimer = setTimeout(() => reject(new Error("AUTH_CALLBACK_TIMEOUT")), 5 * 60_000);
    callbackTimer.unref();
    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
      if (
        request.method !== "GET" ||
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        url.port !== String(PORT) ||
        url.pathname !== "/callback"
      ) {
        response.writeHead(404).end();
        return;
      }
      if (callbackTimer === null) {
        response.writeHead(400).end();
        return;
      }
      const returnedState = url.searchParams.get("state") ?? "";
      const expected = Buffer.from(state);
      const received = Buffer.from(returnedState);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        response
          .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Invalid login state");
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error || !code) {
        response
          .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          .end("<!doctype html><title>PiDesk</title><p>登录未完成，请返回 PiDesk 重试。</p>");
        if (callbackTimer) clearTimeout(callbackTimer);
        callbackTimer = null;
        reject(new Error(error ?? "AUTH_CODE_MISSING"));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>PiDesk</title><p>PiDesk 登录完成，可以关闭此页面。</p>");
      if (callbackTimer) clearTimeout(callbackTimer);
      callbackTimer = null;
      resolve(code);
    });
  });
  try {
    const authorize = new URL(`https://${DOMAIN}/authorize`);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: CALLBACK,
      scope: "openid profile offline_access pidesk.relay",
      audience: AUDIENCE,
      state,
      code_challenge: challenge(codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    await shell.openExternal(authorize.toString());
    const code = await callback;
    if (epoch !== credentialEpoch) throw new Error("AUTH_CHANGED");
    return await exchange(
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK,
        code_verifier: codeVerifier,
        audience: AUDIENCE,
        scope: "openid profile offline_access pidesk.relay",
      },
      epoch,
    );
  } finally {
    if (callbackTimer) clearTimeout(callbackTimer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
export function loginDesktop(): Promise<TokenSet> {
  if (loginFlight) return loginFlight;
  loginFlight = performLogin().finally(() => {
    loginFlight = null;
  });
  return loginFlight;
}
let refreshFlight: Promise<string> | null = null;
export function desktopAuthGeneration(): number {
  return credentialEpoch;
}
export async function desktopAccessToken(expectedEpoch = credentialEpoch): Promise<string> {
  if (expectedEpoch !== credentialEpoch) throw new Error("AUTH_CHANGED");
  const current = read();
  if (!current) throw new Error("ACCOUNT_AUTH_REQUIRED");
  if (current.expiresAt > Date.now() + 60_000) return current.accessToken;
  if (refreshFlight) return refreshFlight;
  refreshFlight = exchange(
    {
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      audience: AUDIENCE,
      scope: "openid profile offline_access pidesk.relay",
    },
    credentialEpoch,
  )
    .then((next) => next.accessToken)
    .catch((cause: unknown) => {
      if (cause instanceof Error && cause.message === "AUTH_REAUTH_REQUIRED") {
        clearDesktopAuth();
        throw new Error("ACCOUNT_AUTH_REQUIRED");
      }
      throw cause;
    })
    .finally(() => {
      refreshFlight = null;
    });
  return refreshFlight;
}
export function hasDesktopAuth(): boolean {
  return !!read();
}
export function clearDesktopAuth(): void {
  credentialEpoch++;
  refreshFlight = null;
  tokenSet = null;
  try {
    fs.rmSync(STORAGE(), { force: true });
  } catch {
    // Keep logout idempotent when the credential file is already unavailable.
  }
}
export async function revokeDesktopAuth(): Promise<void> {
  let current: TokenSet | null = null;
  try {
    current = read();
  } catch {
    // Logout must still erase the local credential if secure storage has become unavailable.
  }
  clearDesktopAuth();
  if (!current) return;
  try {
    await fetch(`https://${DOMAIN}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID, token: current.refreshToken }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Local logout remains complete if the provider is temporarily unreachable.
  }
}
