/**
 * Chromium Cookie 解密纯逻辑（docs/design/09 M2）。
 * 不依赖 Electron / 子进程，便于 vitest。
 */

/** Chrome `v20` App-Bound Encryption：第三方无法在用户态解密。 */
export class ChromiumABEError extends Error {
  constructor(message = "当前浏览器 Cookie 使用应用绑定加密（v20），无法自动解密") {
    super(message);
    this.name = "ChromiumABEError";
  }
}

/** 其他解密失败（前缀未知、密钥长度不对、GCM tag 校验失败等）。 */
export class ChromiumDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChromiumDecryptError";
  }
}

/** Chrome 时间：自 1601-01-01 UTC 起的微秒。 */
export function chromeTimeToUnixSeconds(chromeTime: number): number | undefined {
  if (!Number.isFinite(chromeTime) || chromeTime <= 0) return undefined;
  const unix = Math.floor(chromeTime / 1_000_000) - 11_644_473_600;
  return unix > 0 ? unix : undefined;
}

/** Chrome samesite 枚举 → Electron sameSite。 */
export function mapChromeSameSite(
  samesite: number,
): "unspecified" | "no_restriction" | "lax" | "strict" {
  if (samesite === 0) return "no_restriction";
  if (samesite === 1) return "lax";
  if (samesite === 2) return "strict";
  return "unspecified";
}

/**
 * host_key 是否适用于目标 host。
 * `.example.com` / `example.com` 匹配 `example.com` 与 `www.example.com`；
 * 不匹配无关后缀（`notexample.com`）。
 */
export function cookieDomainMatches(cookieHostKey: string, targetHost: string): boolean {
  const domain = cookieHostKey.trim().replace(/^\./, "").toLowerCase();
  const host = targetHost.trim().toLowerCase();
  if (!domain || !host) return false;
  if (domain === host) return true;
  return host.endsWith(`.${domain}`);
}

/** 从 encrypted_value 解出明文；value 列非空时优先用于未加密残留。 */
export function decryptChromiumCookieValue(
  encryptedValue: Uint8Array | Buffer,
  plaintextFallback: string,
  aesKey: Buffer,
  decryptGcm: (key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer) => Buffer,
): string {
  const buf = Buffer.isBuffer(encryptedValue) ? encryptedValue : Buffer.from(encryptedValue ?? []);

  if (buf.length === 0) {
    if (plaintextFallback) return plaintextFallback;
    throw new ChromiumDecryptError("Cookie 密文为空");
  }

  const prefix = buf.subarray(0, 3).toString("utf8");
  if (prefix === "v20") {
    throw new ChromiumABEError();
  }
  if (prefix !== "v10" && prefix !== "v11") {
    if (plaintextFallback) return plaintextFallback;
    throw new ChromiumDecryptError(`不支持的 Cookie 加密前缀：${prefix || "(empty)"}`);
  }
  // v10/v11：3 字节前缀 + 12 字节 nonce + 密文 + 16 字节 GCM tag
  if (buf.length < 3 + 12 + 16) {
    throw new ChromiumDecryptError("Cookie 密文长度不足");
  }
  const nonce = buf.subarray(3, 15);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(15, buf.length - 16);
  return decryptGcm(aesKey, nonce, ciphertext, tag).toString("utf8");
}

/** Local State 里 os_crypt.encrypted_key：base64 → 去掉 DPAPI 前缀后的密文。 */
export function extractDpapiWrappedKey(encryptedKeyBase64: string): Buffer {
  const raw = Buffer.from(encryptedKeyBase64, "base64");
  const marker = Buffer.from("DPAPI", "utf8");
  if (raw.length <= marker.length) {
    throw new ChromiumDecryptError("浏览器加密密钥格式不正确");
  }
  if (!raw.subarray(0, marker.length).equals(marker)) {
    // 个别构建不带前缀，整段按 DPAPI 密文处理
    return raw;
  }
  return raw.subarray(marker.length);
}
