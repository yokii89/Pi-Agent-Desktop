import fs from "node:fs";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  directory: `${process.env.TEMP ?? process.env.TMP ?? "/tmp"}/pidesk-auth0-test-${process.pid}`,
  authorizeUrl: "",
  callbackState: "",
  responses: [] as Record<string, unknown>[],
  requests: [] as Record<string, string>[],
  revokeRequests: [] as Record<string, string>[],
  wrongState: false,
}));

vi.mock("electron", () => ({
  app: { getPath: () => fixture.directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  shell: {
    openExternal: async (value: string) => {
      fixture.authorizeUrl = value;
      const authorize = new URL(value);
      fixture.callbackState = authorize.searchParams.get("state") ?? "";
      const callback = new URL(authorize.searchParams.get("redirect_uri") ?? "");
      callback.searchParams.set("code", "authorization-code");
      const requestCallback = async (state: string) => {
        callback.searchParams.set("state", state);
        await new Promise<void>((resolve, reject) => {
          http
            .get(callback, { headers: { Connection: "close" } }, (response) => {
              response.resume();
              response.once("end", resolve);
            })
            .once("error", reject);
        });
      };
      if (fixture.wrongState) await requestCallback("wrong-state");
      await requestCallback(fixture.callbackState);
    },
  },
}));

import {
  clearDesktopAuth,
  desktopAccessToken,
  loginDesktop,
  revokeDesktopAuth,
} from "./desktopAuth";

beforeEach(() => {
  fs.rmSync(fixture.directory, { recursive: true, force: true });
  fixture.authorizeUrl = "";
  fixture.callbackState = "";
  fixture.responses = [];
  fixture.requests = [];
  fixture.revokeRequests = [];
  fixture.wrongState = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, string>;
      if (url.endsWith("/oauth/revoke")) {
        fixture.revokeRequests.push(body);
        return { ok: true, json: async () => ({}) };
      }
      fixture.requests.push(body);
      const response = fixture.responses.shift() ?? {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 1,
      };
      return { ok: true, json: async () => response };
    }),
  );
});
afterEach(() => {
  clearDesktopAuth();
  fs.rmSync(fixture.directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("Auth0 desktop PKCE", () => {
  it("ignores a forged loopback callback and accepts the matching state", async () => {
    fixture.wrongState = true;
    await loginDesktop();
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({ code: "authorization-code" });
  });

  it("uses a loopback authorization-code callback, PKCE and rotates refresh tokens", async () => {
    await loginDesktop();
    const authorize = new URL(fixture.authorizeUrl);
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:49182/callback");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    expect(fixture.requests[0]).toMatchObject({
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: "http://127.0.0.1:49182/callback",
    });
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
    });
    await revokeDesktopAuth();
    expect(fixture.revokeRequests[0]).toMatchObject({ token: "refresh-token-2" });
  });
});
