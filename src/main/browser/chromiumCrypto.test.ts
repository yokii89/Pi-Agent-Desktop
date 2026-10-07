import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ChromiumABEError,
  ChromiumDecryptError,
  chromeTimeToUnixSeconds,
  cookieDomainMatches,
  decryptChromiumCookieValue,
  extractDpapiWrappedKey,
  mapChromeSameSite,
} from "./chromiumCrypto";

function gcmDecrypt(key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptV10(plain: string, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v10", "utf8"), nonce, enc, tag]);
}

describe("chromeTimeToUnixSeconds", () => {
  it("converts chrome epoch microseconds", () => {
    const chrome = (1577836800 + 11644473600) * 1_000_000;
    expect(chromeTimeToUnixSeconds(chrome)).toBe(1577836800);
  });

  it("returns undefined for zero or invalid", () => {
    expect(chromeTimeToUnixSeconds(0)).toBeUndefined();
    expect(chromeTimeToUnixSeconds(Number.NaN)).toBeUndefined();
  });
});

describe("mapChromeSameSite", () => {
  it("maps enums", () => {
    expect(mapChromeSameSite(-1)).toBe("unspecified");
    expect(mapChromeSameSite(0)).toBe("no_restriction");
    expect(mapChromeSameSite(1)).toBe("lax");
    expect(mapChromeSameSite(2)).toBe("strict");
  });
});

describe("cookieDomainMatches", () => {
  it("matches exact and parent domain", () => {
    expect(cookieDomainMatches("example.com", "example.com")).toBe(true);
    expect(cookieDomainMatches(".example.com", "www.example.com")).toBe(true);
    expect(cookieDomainMatches("example.com", "api.example.com")).toBe(true);
    expect(cookieDomainMatches("localhost", "localhost")).toBe(true);
  });

  it("rejects unrelated hosts", () => {
    expect(cookieDomainMatches("example.com", "notexample.com")).toBe(false);
    expect(cookieDomainMatches("www.example.com", "example.com")).toBe(false);
    expect(cookieDomainMatches("", "example.com")).toBe(false);
  });
});

describe("extractDpapiWrappedKey", () => {
  it("strips DPAPI marker", () => {
    const payload = Buffer.from("secret-key-bytes");
    const raw = Buffer.concat([Buffer.from("DPAPI", "utf8"), payload]);
    expect(extractDpapiWrappedKey(raw.toString("base64"))).toEqual(payload);
  });
});

describe("decryptChromiumCookieValue", () => {
  const key = randomBytes(32);

  it("decrypts v10 aes-gcm payload", () => {
    const enc = encryptV10("session-token", key);
    expect(decryptChromiumCookieValue(enc, "", key, gcmDecrypt)).toBe("session-token");
  });

  it("decrypts v11 prefix the same way", () => {
    const v10 = encryptV10("abc", key);
    const v11 = Buffer.concat([Buffer.from("v11", "utf8"), v10.subarray(3)]);
    expect(decryptChromiumCookieValue(v11, "", key, gcmDecrypt)).toBe("abc");
  });

  it("throws ABE error for v20", () => {
    const enc = Buffer.concat([Buffer.from("v20", "utf8"), randomBytes(40)]);
    expect(() => decryptChromiumCookieValue(enc, "", key, gcmDecrypt)).toThrow(ChromiumABEError);
  });

  it("falls back to plaintext when empty cipher", () => {
    expect(decryptChromiumCookieValue(new Uint8Array(), "plain", key, gcmDecrypt)).toBe("plain");
  });

  it("throws on unknown prefix without fallback", () => {
    const enc = Buffer.concat([Buffer.from("v99", "utf8"), randomBytes(40)]);
    expect(() => decryptChromiumCookieValue(enc, "", key, gcmDecrypt)).toThrow(
      ChromiumDecryptError,
    );
  });
});
