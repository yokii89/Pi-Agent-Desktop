import fs from "node:fs";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  directory: `${process.env.TEMP ?? process.env.TMP ?? "/tmp"}/pidesk-auth0-test-${process.pid}`,
  authorizeUrl: "",
  callbackState: "",
  callbackBodies: [] as string[],
  responses: [] as Record<string, unknown>[],
  requests: [] as Record<string, string>[],
  revokeRequests: [] as Record<string, string>[],
  wrongState: false,
  browser: "auto" as "auto" | "wait" | "error" | "denied",
  tokenStatus: 200,
  tokenBody: null as (() => Promise<unknown>) | null,
  networkError: false,
  profile: null as unknown,
  profileError: false,
  profileBody: null as (() => Promise<unknown>) | null,
  encryptionFails: false,
  secureStorage: true,
}));

async function callback(url: string, state?: string, denied = false): Promise<string> {
  const authorize = new URL(url);
  const target = new URL(authorize.searchParams.get("redirect_uri") ?? "");
  target.searchParams.set("state", state ?? authorize.searchParams.get("state") ?? "");
  target.searchParams.set(
    denied ? "error" : "code",
    denied ? "access_denied" : "authorization-code",
  );
  return new Promise((resolve, reject) => {
    http
      .get(target, { headers: { Connection: "close" } }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.once("end", () => resolve(body));
      })
      .once("error", reject);
  });
}

vi.mock("electron", () => ({
  app: { getPath: () => fixture.directory },
  safeStorage: {
    isEncryptionAvailable: () => fixture.secureStorage,
    encryptString: (value: string) => {
      if (fixture.encryptionFails) throw new Error("private encryption failure");
      return Buffer.from(value);
    },
    decryptString: (value: Buffer) => value.toString(),
  },
  shell: {
    openExternal: vi.fn(async (value: string) => {
      if (fixture.browser === "error") throw new Error("private browser failure");
      fixture.authorizeUrl = value;
      fixture.callbackState = new URL(value).searchParams.get("state") ?? "";
      if (fixture.browser === "wait") return;
      if (fixture.wrongState) fixture.callbackBodies.push(await callback(value, "wrong-state"));
      fixture.callbackBodies.push(await callback(value, undefined, fixture.browser === "denied"));
    }),
  },
}));

import {
  cancelDesktopLogin,
  clearDesktopAuth,
  desktopAccessToken,
  desktopAuthSnapshot,
  hasDesktopAuth,
  loginDesktop,
  revokeDesktopAuth,
} from "./desktopAuth";

beforeEach(() => {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
  fixture.authorizeUrl = "";
  fixture.callbackState = "";
  fixture.callbackBodies = [];
  fixture.responses = [];
  fixture.requests = [];
  fixture.revokeRequests = [];
  fixture.wrongState = false;
  fixture.browser = "auto";
  fixture.tokenStatus = 200;
  fixture.tokenBody = null;
  fixture.networkError = false;
  fixture.profile = {
    sub: "auth0|test-account",
    name: "Remote test account",
    picture: "https://avatars.example/test-account",
  };
  fixture.profileError = false;
  fixture.profileBody = null;
  fixture.encryptionFails = false;
  fixture.secureStorage = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.endsWith("/userinfo")) {
        if (fixture.profileError) throw new TypeError("profile service unavailable");
        return { ok: true, json: fixture.profileBody ?? (async () => fixture.profile) };
      }
      const body = JSON.parse(init?.body ?? "{}") as Record<string, string>;
      if (url.endsWith("/oauth/revoke")) {
        fixture.revokeRequests.push(body);
        return { ok: true, json: async () => ({}) };
      }
      fixture.requests.push(body);
      if (fixture.networkError) throw new TypeError("private network failure");
      const response = fixture.responses.shift() ?? {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 1,
      };
      return { ok: fixture.tokenStatus === 200, json: fixture.tokenBody ?? (async () => response) };
    }),
  );
});
afterEach(() => {
  fixture.encryptionFails = false;
  fixture.secureStorage = true;
  clearDesktopAuth();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Auth0 desktop PKCE", () => {
  it("uses the official relay audience for authorization and token exchange", async () => {
    await loginDesktop();
    const authorize = new URL(fixture.authorizeUrl);
    expect(authorize.searchParams.get("audience")).toBe(
      "https://pidesk-pairing-relay.yecenglinjian.workers.dev",
    );
    expect(fixture.requests[0]).toMatchObject({
      grant_type: "authorization_code",
      audience: "https://pidesk-pairing-relay.yecenglinjian.workers.dev",
    });
  });

  it("ignores a forged loopback callback and accepts the matching state", async () => {
    fixture.wrongState = true;
    await loginDesktop();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({
      code: "authorization-code",
      audience: "https://pidesk-pairing-relay.yecenglinjian.workers.dev",
    });
    expect(fixture.callbackBodies[0]).toContain('<main class="auth-card" data-outcome="error">');
  });

  it("uses a loopback authorization-code callback, PKCE and rotates refresh tokens", async () => {
    await loginDesktop();
    const authorize = new URL(fixture.authorizeUrl);
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("audience")).toBe(
      "https://pidesk-pairing-relay.yecenglinjian.workers.dev",
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:49182/callback");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const verifier = fixture.requests[0]?.code_verifier;
    if (!verifier) throw new Error("missing PKCE verifier");
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      authorize.searchParams.get("code_challenge"),
    );
    fixture.responses.push({
      access_token: "access-token-2",
      refresh_token: "refresh-token-2",
      expires_in: 900,
    });
    expect(await desktopAccessToken()).toBe("access-token-2");
    expect(fixture.requests[1]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
      audience: "https://pidesk-pairing-relay.yecenglinjian.workers.dev",
    });
    await revokeDesktopAuth();
    expect(fixture.revokeRequests[0]).toMatchObject({ token: "refresh-token-2" });
  });

  it("passes the application language and requires fresh browser authentication when requested", async () => {
    await loginDesktop({ locale: "en-US", theme: "light", reauthenticate: true });
    const authorize = new URL(fixture.authorizeUrl);
    expect(authorize.searchParams.get("ui_locales")).toBe("en");
    expect(authorize.searchParams.get("prompt")).toBe("login");
    await vi.waitFor(() => expect(fixture.callbackBodies).toHaveLength(1));
    expect(fixture.callbackBodies[0]).toContain('lang="en-US" data-theme="light"');
    expect(fixture.callbackBodies[0]).toContain("Account sign-in complete");
    expect(fixture.callbackBodies[0]).toContain("--color-bg");
    expect(desktopAuthSnapshot()).toMatchObject({
      phase: "signed_in",
      identity: {
        name: "Remote test account",
        picture: "https://avatars.example/test-account",
      },
    });
    expect(JSON.stringify(desktopAuthSnapshot())).not.toContain("refresh-token");
  });

  it("restores the display name and avatar from encrypted account storage", async () => {
    await loginDesktop();
    vi.resetModules();
    const store = await import("../settings/desktopAuthStore");
    expect(store.loadDesktopAuth()?.identity).toEqual({
      subject: "auth0|test-account",
      name: "Remote test account",
      picture: "https://avatars.example/test-account",
    });
  });

  it("accepts an existing saved identity without an avatar", async () => {
    fs.mkdirSync(fixture.directory, { recursive: true });
    fs.writeFileSync(
      `${fixture.directory}/auth0-session.bin`,
      JSON.stringify({
        accessToken: "saved-access",
        refreshToken: "saved-refresh",
        expiresAt: Date.now() + 900_000,
        identity: { subject: "github|123", name: "Existing account" },
      }),
    );
    vi.resetModules();
    const store = await import("../settings/desktopAuthStore");
    expect(store.loadDesktopAuth()?.identity).toEqual({
      subject: "github|123",
      name: "Existing account",
      picture: null,
    });
    fixture.profile = {
      sub: "github|123",
      name: "Existing account",
      picture: "https://avatars.example/123",
    };
    const auth = await import("./desktopAuth");
    expect(await auth.desktopAccessToken()).toBe("saved-access");
    await vi.waitFor(() =>
      expect(auth.desktopAuthSnapshot().identity?.picture).toBe("https://avatars.example/123"),
    );
    expect(store.loadDesktopAuth()?.refreshToken).toBe("saved-refresh");
    auth.clearDesktopAuth();
  });

  it("preserves rotated refresh credentials when a restored profile arrives later", async () => {
    fixture.responses.push({
      access_token: "saved-access",
      refresh_token: "saved-refresh",
      expires_in: 900,
    });
    await loginDesktop();
    vi.resetModules();
    const auth = await import("./desktopAuth");
    const store = await import("../settings/desktopAuthStore");
    let finish!: (value: unknown) => void;
    fixture.profileBody = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    expect(await auth.desktopAccessToken()).toBe("saved-access");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const saved = store.loadDesktopAuth();
    if (!saved) throw new Error("missing saved credentials");
    store.saveDesktopAuth({ ...saved, expiresAt: 1 });
    fixture.responses.push({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      expires_in: 900,
    });
    expect(await auth.desktopAccessToken()).toBe("rotated-access");
    finish({
      sub: "auth0|test-account",
      name: "Updated account",
      picture: "https://avatars.example/updated",
    });
    await vi.waitFor(() =>
      expect(auth.desktopAuthSnapshot().identity?.name).toBe("Updated account"),
    );
    expect(store.loadDesktopAuth()?.refreshToken).toBe("rotated-refresh");
    auth.clearDesktopAuth();
  });

  it("discards restored display metadata after switching accounts", async () => {
    fixture.responses.push({
      access_token: "saved-access",
      refresh_token: "saved-refresh",
      expires_in: 900,
    });
    await loginDesktop();
    vi.resetModules();
    const auth = await import("./desktopAuth");
    let finish!: (value: unknown) => void;
    fixture.profileBody = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    expect(await auth.desktopAccessToken()).toBe("saved-access");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    auth.clearDesktopAuth();
    fixture.profileBody = null;
    fixture.profile = {
      sub: "github|new",
      name: "New account",
      picture: "https://avatars.example/new",
    };
    await auth.loginDesktop();
    finish({
      sub: "auth0|test-account",
      name: "Old account",
      picture: "https://avatars.example/old",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(auth.desktopAuthSnapshot().identity).toEqual({
      subject: "github|new",
      name: "New account",
      picture: "https://avatars.example/new",
    });
    auth.clearDesktopAuth();
  });

  it("uses a provider nickname when its name and avatar are absent", async () => {
    fixture.profile = { sub: "github|123", name: "", nickname: "yoki89" };
    await loginDesktop();
    expect(desktopAuthSnapshot().identity).toEqual({
      subject: "github|123",
      name: "yoki89",
      picture: null,
    });
    expect(hasDesktopAuth()).toBe(true);
  });

  it("keeps successful sign-in available when userinfo cannot be retrieved", async () => {
    fixture.profileError = true;
    await loginDesktop();
    expect(desktopAuthSnapshot()).toMatchObject({
      phase: "signed_in",
      identity: null,
      error: null,
    });
    expect(hasDesktopAuth()).toBe(true);
  });

  it("keeps the browser pending until token exchange and secure persistence succeed", async () => {
    let finish!: (value: unknown) => void;
    fixture.tokenBody = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const login = loginDesktop();
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    expect(desktopAuthSnapshot().phase).toBe("exchanging_code");
    expect(fixture.callbackBodies).toHaveLength(0);
    expect(hasDesktopAuth()).toBe(false);
    finish({ access_token: "saved-access", refresh_token: "saved-refresh", expires_in: 900 });
    await login;
    await vi.waitFor(() => expect(fixture.callbackBodies).toHaveLength(1));
    expect(fixture.callbackBodies[0]).toContain('data-outcome="success"');
    expect(fs.existsSync(`${fixture.directory}/auth0-session.bin`)).toBe(true);
  });

  it("does not show success in either UI when secure persistence fails", async () => {
    fixture.encryptionFails = true;
    await expect(loginDesktop()).rejects.toThrow("AUTH_STORE_WRITE_FAILED");
    await vi.waitFor(() => expect(fixture.callbackBodies).toHaveLength(1));
    expect(fixture.callbackBodies[0]).toContain('data-outcome="error"');
    expect(desktopAuthSnapshot().error).toBe("AUTH_STORE_WRITE_FAILED");
    expect(hasDesktopAuth()).toBe(false);
  });

  it("cancels browser waiting and immediately retries after the old listener closes", async () => {
    fixture.browser = "wait";
    const first = loginDesktop();
    const cancelled = expect(first).rejects.toThrow("AUTH_CANCELLED");
    await vi.waitFor(() => expect(desktopAuthSnapshot().phase).toBe("waiting_for_browser"));
    cancelDesktopLogin();
    fixture.browser = "auto";
    const second = loginDesktop();
    await cancelled;
    await second;
    expect(desktopAuthSnapshot().phase).toBe("signed_in");
    expect(fixture.requests).toHaveLength(1);
  });

  it("discards a cancelled token body even after a newer login has succeeded", async () => {
    let finish!: (value: unknown) => void;
    fixture.tokenBody = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const first = loginDesktop();
    const cancelled = expect(first).rejects.toThrow("AUTH_CANCELLED");
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    cancelDesktopLogin();
    await cancelled;
    fixture.tokenBody = null;
    fixture.responses.push({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 900,
    });
    await loginDesktop();
    finish({ access_token: "stale-access", refresh_token: "stale-refresh", expires_in: 900 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(await desktopAccessToken()).toBe("new-access");
  });

  it("invalidates a refresh body that arrives after local logout", async () => {
    await loginDesktop();
    let finish!: (value: unknown) => void;
    fixture.tokenBody = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const refresh = desktopAccessToken();
    const invalidated = expect(refresh).rejects.toThrow("AUTH_CHANGED");
    await vi.waitFor(() => expect(fixture.requests).toHaveLength(2));
    clearDesktopAuth();
    finish({ access_token: "late-access", refresh_token: "late-refresh", expires_in: 900 });
    await invalidated;
    expect(hasDesktopAuth()).toBe(false);
  });

  it("expires an abandoned browser login and releases its callback listener", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    fixture.browser = "wait";
    const login = loginDesktop();
    const timedOut = expect(login).rejects.toThrow("AUTH_CALLBACK_TIMEOUT");
    await vi.waitFor(() => expect(desktopAuthSnapshot().phase).toBe("waiting_for_browser"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await timedOut;
    expect(desktopAuthSnapshot().error).toBe("AUTH_CALLBACK_TIMEOUT");
  });

  it("reports a callback port conflict without misclassifying it as a storage failure", async () => {
    const occupied = http.createServer();
    await new Promise<void>((resolve) => occupied.listen(49182, "127.0.0.1", resolve));
    try {
      await expect(loginDesktop()).rejects.toThrow("AUTH_PORT_IN_USE");
      expect(desktopAuthSnapshot().error).toBe("AUTH_PORT_IN_USE");
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it.each([
    ["browser", "AUTH_BROWSER_OPEN_FAILED"],
    ["network", "AUTH_NETWORK_UNAVAILABLE"],
    ["denied", "AUTH_CANCELLED"],
  ])("maps %s failures to finite display errors", async (mode, code) => {
    if (mode === "browser") fixture.browser = "error";
    if (mode === "network") fixture.networkError = true;
    if (mode === "denied") fixture.browser = "denied";
    await expect(loginDesktop()).rejects.toThrow(code);
    expect(hasDesktopAuth()).toBe(false);
    expect(desktopAuthSnapshot().error ?? "").not.toContain("private");
  });

  it("clears expired refresh credentials and requests explicit reauthentication", async () => {
    await loginDesktop();
    fixture.tokenStatus = 400;
    fixture.responses.push({ error: "invalid_grant" });
    await expect(desktopAccessToken()).rejects.toThrow("ACCOUNT_AUTH_REQUIRED");
    expect(hasDesktopAuth()).toBe(false);
    expect(desktopAuthSnapshot().error).toBe("ACCOUNT_AUTH_REQUIRED");
  });

  it("rejects a token lifetime that cannot be safely represented or persisted", async () => {
    fixture.responses.push({
      access_token: "invalid-access",
      refresh_token: "invalid-refresh",
      expires_in: Number.MAX_VALUE,
    });
    await expect(loginDesktop()).rejects.toThrow("AUTH_RESPONSE_INVALID");
    expect(hasDesktopAuth()).toBe(false);
  });

  it("keeps corrupt account storage readable as a recoverable snapshot", async () => {
    fs.mkdirSync(fixture.directory, { recursive: true });
    fs.writeFileSync(`${fixture.directory}/auth0-session.bin`, "not-json");
    vi.resetModules();
    const auth = await import("./desktopAuth");
    expect(auth.desktopAuthSnapshot()).toMatchObject({
      phase: "error",
      error: "AUTH_STORE_INVALID",
    });
    auth.clearDesktopAuth();
    expect(auth.desktopAuthSnapshot()).toMatchObject({ phase: "signed_out", error: null });
  });
});
