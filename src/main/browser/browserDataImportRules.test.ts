import { describe, expect, it } from "vitest";
import {
  buildLocalStorageReadExpression,
  buildLocalStorageWriteExpression,
  helperCookieToImportCookie,
  IMPORTED_SESSION_COOKIE_MAX_AGE_SEC,
  importCookieToDetails,
  LOCAL_STORAGE_MAX_ORIGINS,
  parseLocalStorageOrigins,
  selectLocalStorageOrigins,
} from "./browserDataImportRules";

describe("helperCookieToImportCookie", () => {
  it("keeps domain cookies as domain cookies and host-only as host-only", () => {
    const domain = helperCookieToImportCookie({
      name: "SID",
      value: "v",
      domain: ".google.com",
      path: "/",
      secure: true,
    });
    expect(domain.kind).toBe("ok");
    if (domain.kind !== "ok") return;
    expect(domain.cookie.domain).toBe(".google.com");

    const hostOnly = helperCookieToImportCookie({
      name: "sid",
      value: "v",
      domain: "metalforge.xyz",
      path: "/",
      secure: true,
    });
    expect(hostOnly.kind).toBe("ok");
    if (hostOnly.kind !== "ok") return;
    expect(hostOnly.cookie.domain).toBe("metalforge.xyz");
  });

  it("maps CDP sameSite vocabulary", () => {
    const read = (sameSite: string | undefined) => {
      const result = helperCookieToImportCookie({
        name: "a",
        value: "b",
        domain: "example.com",
        path: "/",
        sameSite,
      });
      return result.kind === "ok" ? result.cookie.sameSite : null;
    };
    expect(read("Strict")).toBe("strict");
    expect(read("Lax")).toBe("lax");
    expect(read("None")).toBe("no_restriction");
    expect(read(undefined)).toBe("unspecified");
  });

  it("skips partitioned (CHIPS) and malformed cookies", () => {
    expect(
      helperCookieToImportCookie({
        name: "a",
        value: "b",
        domain: "example.com",
        path: "/",
        partitionKey: { topLevelSite: "https://other.com" },
      }),
    ).toEqual({ kind: "skip", reason: "partitioned" });
    expect(
      helperCookieToImportCookie({ name: "", value: "b", domain: "example.com", path: "/" }),
    ).toEqual({ kind: "skip", reason: "invalid" });
    expect(helperCookieToImportCookie({ name: "a", value: "b", domain: " ", path: "/" })).toEqual({
      kind: "skip",
      reason: "invalid",
    });
  });
});

describe("importCookieToDetails", () => {
  const now = 1_700_000_000;

  it("writes domain attribute and keeps the url host inside it", () => {
    const details = importCookieToDetails(
      {
        name: "SID",
        value: "v",
        domain: ".google.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "no_restriction",
      },
      now,
    );
    expect(details.domain).toBe(".google.com");
    expect(details.url).toBe("https://google.com/");
    expect(details.httpOnly).toBe(true);
  });

  it("omits the domain attribute for host-only cookies", () => {
    const details = importCookieToDetails(
      {
        name: "sid",
        value: "v",
        domain: "metalforge.xyz",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "lax",
      },
      now,
    );
    expect(details.domain).toBeUndefined();
    expect(details.url).toBe("https://metalforge.xyz/");
  });

  it("persists session cookies with Chromium's 400-day ceiling", () => {
    const details = importCookieToDetails(
      {
        name: "sid",
        value: "v",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
        sameSite: "unspecified",
      },
      now,
    );
    expect(details.expirationDate).toBe(now + IMPORTED_SESSION_COOKIE_MAX_AGE_SEC);
    expect(details.url).toBe("http://example.com/");
  });

  it("repairs __Host- / __Secure- prefix constraints instead of dropping the cookie", () => {
    const host = importCookieToDetails(
      {
        name: "__Host-x",
        value: "v",
        domain: ".example.com",
        path: "/deep",
        secure: false,
        httpOnly: true,
        sameSite: "lax",
      },
      now,
    );
    expect(host.domain).toBeUndefined();
    expect(host.path).toBe("/");
    expect(host.secure).toBe(true);

    const secure = importCookieToDetails(
      {
        name: "__Secure-y",
        value: "v",
        domain: "example.com",
        path: "/",
        secure: false,
        httpOnly: false,
        sameSite: "lax",
      },
      now,
    );
    expect(secure.secure).toBe(true);
  });
});

describe("parseLocalStorageOrigins", () => {
  it("extracts origins from META keys and ignores junk", () => {
    const text = [
      "META:https://example.com",
      "META:http://localhost:5173",
      "\u0000\u0001junkMETA:https://evil",
      "MANIFEST-000001",
    ].join("\n");
    expect(parseLocalStorageOrigins(text)).toEqual([
      "http://localhost:5173",
      "https://example.com",
    ]);
  });

  it("keeps the preferred origin first and caps the queue", () => {
    const many = Array.from(
      { length: LOCAL_STORAGE_MAX_ORIGINS + 10 },
      (_, i) => `https://s${i}.test`,
    );
    const selected = selectLocalStorageOrigins(
      [...many, "https://current.test"],
      "https://current.test",
    );
    expect(selected[0]).toBe("https://current.test");
    expect(selected).toHaveLength(LOCAL_STORAGE_MAX_ORIGINS);
  });
});

describe("localStorage expressions", () => {
  it("checks the origin before reading", () => {
    expect(buildLocalStorageReadExpression("https://a.test")).toBe(
      '(() => (location.origin === "https://a.test" ? Object.entries(localStorage) : null))()',
    );
  });

  it("inlines entries as JSON literals", () => {
    const entries: Array<[string, string]> = [["token", 'a"b']];
    expect(buildLocalStorageWriteExpression(entries)).toBe(
      `(() => { const entries = ${JSON.stringify(entries)}; for (const [k, v] of entries) { localStorage.setItem(k, v); } return entries.length; })()`,
    );
  });
});
