import { describe, expect, it } from "vitest";
import {
  cookieOriginUrl,
  isLocalCookieHost,
  normalizeCookieHost,
  parsePastedCookiePairs,
} from "./loginImportParse";

describe("parsePastedCookiePairs", () => {
  it("parses semicolon-separated pairs", () => {
    expect(parsePastedCookiePairs("a=1; b=2;c=three")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
      { name: "c", value: "three" },
    ]);
  });

  it("accepts newline-separated pairs", () => {
    expect(parsePastedCookiePairs("session=abc\ntoken=xyz")).toEqual([
      { name: "session", value: "abc" },
      { name: "token", value: "xyz" },
    ]);
  });

  it("skips cookie attribute words and invalid names", () => {
    expect(
      parsePastedCookiePairs("sid=1; Path=/; Domain=example.com; HttpOnly; Secure; bad name=2"),
    ).toEqual([{ name: "sid", value: "1" }]);
  });

  it("lets later duplicates win", () => {
    expect(parsePastedCookiePairs("a=1; a=2")).toEqual([{ name: "a", value: "2" }]);
  });

  it("returns empty for blank input", () => {
    expect(parsePastedCookiePairs("   ")).toEqual([]);
  });
});

describe("normalizeCookieHost", () => {
  it("accepts bare host and full URL", () => {
    expect(normalizeCookieHost("LocalHost:5173")).toBe("localhost");
    expect(normalizeCookieHost("https://staging.example.com/path")).toBe("staging.example.com");
  });

  it("strips leading dot", () => {
    expect(normalizeCookieHost(".example.com")).toBe("example.com");
  });

  it("rejects empty or path-like input", () => {
    expect(() => normalizeCookieHost("")).toThrow();
    expect(() => normalizeCookieHost("example.com/app")).toThrow();
  });
});

describe("isLocalCookieHost", () => {
  it("classifies local hosts", () => {
    expect(isLocalCookieHost("localhost")).toBe(true);
    expect(isLocalCookieHost("127.0.0.1")).toBe(true);
    expect(isLocalCookieHost("192.168.1.8")).toBe(true);
    expect(isLocalCookieHost("example.com")).toBe(false);
  });
});

describe("cookieOriginUrl", () => {
  it("defaults local to http and remote to https", () => {
    expect(cookieOriginUrl("localhost", undefined)).toBe("http://localhost/");
    expect(cookieOriginUrl("example.com", undefined)).toBe("https://example.com/");
    expect(cookieOriginUrl("example.com", false)).toBe("http://example.com/");
  });
});
