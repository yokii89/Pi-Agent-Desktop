import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import initSqlJs from "sql.js";
import type { BrowserLoginSource } from "../../shared/ipc";
import { readCookieDbBytes } from "./chromiumCookieDb";
import {
  ChromiumDecryptError,
  chromeTimeToUnixSeconds,
  cookieDomainMatches,
  decryptChromiumCookieValue,
  extractDpapiWrappedKey,
  mapChromeSameSite,
} from "./chromiumCrypto";
import { dpapiUnprotectCurrentUser } from "./chromiumDpapi";
import { normalizeCookieHost } from "./loginImportParse";

export interface DecryptedLoginCookie {
  name: string;
  value: string;
  /** Cookie 的 host_key（可能带前导点）。 */
  hostKey: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

export interface ReadChromiumCookiesResult {
  /** 命中目标 host 的 Cookie（含 value，仅主进程内存使用）。 */
  cookies: DecryptedLoginCookie[];
  /** 解密失败条数（含 v20）。 */
  failed: number;
  /** 人类可读警告（不包含 Cookie 值）。 */
  warnings: string[];
}

function aesGcmDecrypt(key: Buffer, nonce: Buffer, ciphertext: Buffer, tag: Buffer): Buffer {
  if (key.length !== 32) {
    throw new ChromiumDecryptError(`AES 密钥长度异常：${key.length}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function loadAesKey(userDataDir: string): Promise<Buffer> {
  const localStatePath = join(userDataDir, "Local State");
  let encryptedKeyB64: string;
  try {
    const raw = await readFile(localStatePath, "utf8");
    const parsed = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
    encryptedKeyB64 = parsed.os_crypt?.encrypted_key ?? "";
  } catch (err) {
    throw new ChromiumDecryptError(
      `无法读取浏览器 Local State：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!encryptedKeyB64) {
    throw new ChromiumDecryptError("浏览器 Local State 中没有加密密钥");
  }
  const wrapped = extractDpapiWrappedKey(encryptedKeyB64);
  const key = await dpapiUnprotectCurrentUser(wrapped);
  if (key.length < 32) {
    throw new ChromiumDecryptError("DPAPI 解出的密钥长度不足");
  }
  return key.subarray(0, 32);
}

interface CookieRow {
  host_key: string;
  name: string;
  value: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  encrypted_value: Uint8Array;
  samesite: number;
}

function rowsFromExec(result: { columns: string[]; values: unknown[][] }[]): CookieRow[] {
  const block = result[0];
  if (!block) return [];
  const idx = Object.fromEntries(block.columns.map((c, i) => [c, i]));
  const need = [
    "host_key",
    "name",
    "value",
    "path",
    "expires_utc",
    "is_secure",
    "is_httponly",
    "encrypted_value",
    "samesite",
  ] as const;
  for (const col of need) {
    if (!(col in idx)) throw new ChromiumDecryptError(`Cookie 表缺少列 ${col}`);
  }
  return block.values.map((row) => {
    const enc = row[idx.encrypted_value];
    return {
      host_key: String(row[idx.host_key] ?? ""),
      name: String(row[idx.name] ?? ""),
      value: String(row[idx.value] ?? ""),
      path: String(row[idx.path] ?? "/") || "/",
      expires_utc: Number(row[idx.expires_utc] ?? 0),
      is_secure: Number(row[idx.is_secure] ?? 0),
      is_httponly: Number(row[idx.is_httponly] ?? 0),
      encrypted_value:
        enc instanceof Uint8Array
          ? enc
          : enc
            ? new Uint8Array(enc as ArrayLike<number>)
            : new Uint8Array(),
      samesite: Number(row[idx.samesite] ?? -1),
    };
  });
}

/**
 * 从指定 Chromium Profile 读取并解密 Cookie（docs/design/09 M2）。
 * value 只留在主进程；不在磁盘留明文副本。
 *
 * `host` 为 undefined 时不做 host 过滤，返回该 Profile 的**全部** Cookie（§6.6 的全量导入
 * 路径）：只搬「当前站点能匹配到的几条」会漏掉 SSO 链路里的第三方域 Cookie。
 */
async function readChromiumCookies(
  source: BrowserLoginSource,
  host: string | undefined,
): Promise<ReadChromiumCookiesResult> {
  const key = await loadAesKey(source.userDataDir);
  const fileBuf = await readCookieDbBytes(source.cookieDbPath);
  const warnings: string[] = [];
  let failed = 0;
  let sawAbe = false;

  const SQL = await initSqlJs({
    locateFile: (file) => {
      try {
        return require.resolve(`sql.js/dist/${file}`);
      } catch {
        return file;
      }
    },
  });
  const db = new SQL.Database(fileBuf);
  try {
    const execResult = db.exec(
      `SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly, encrypted_value, samesite
       FROM cookies`,
    );
    const rows = rowsFromExec(execResult);
    const cookies: DecryptedLoginCookie[] = [];

    for (const row of rows) {
      if (!row.name) continue;
      if (host !== undefined && !cookieDomainMatches(row.host_key, host)) continue;
      try {
        const value = decryptChromiumCookieValue(
          row.encrypted_value,
          row.value,
          key,
          aesGcmDecrypt,
        );
        const expirationDate = chromeTimeToUnixSeconds(row.expires_utc);
        cookies.push({
          name: row.name,
          value,
          hostKey: row.host_key,
          path: row.path || "/",
          secure: row.is_secure === 1,
          httpOnly: row.is_httponly === 1,
          expirationDate,
          sameSite: mapChromeSameSite(row.samesite),
        });
      } catch (err) {
        failed += 1;
        if (err instanceof Error && err.name === "ChromiumABEError") sawAbe = true;
      }
    }

    if (sawAbe) {
      warnings.push(
        "部分 Cookie 使用应用绑定加密（v20）无法解密；若导入后仍需登录，请改用手动粘贴。",
      );
    } else if (failed > 0) {
      warnings.push(`有 ${failed} 条 Cookie 解密失败，已跳过。`);
    }

    return { cookies, failed, warnings };
  } finally {
    db.close();
  }
}

/** 读取匹配 host 的 Cookie（docs/design/09 按站点导入）。 */
export function readChromiumLoginCookies(
  source: BrowserLoginSource,
  rawHost: string,
): Promise<ReadChromiumCookiesResult> {
  return readChromiumCookies(source, normalizeCookieHost(rawHost));
}

/**
 * 读取该 Profile 的全部 Cookie（docs/design/42 §6.6 全量导入）。
 *
 * 只对 `v10`（旧格式 / 非 App-Bound）有效：Chrome 127+ 在 Windows 上把 Cookie 换成
 * `v20` App-Bound 加密，第三方进程解不开，那条路径必须交给浏览器本体
 * （`chromiumHelperRead.ts`）。
 */
export function readChromiumAllLoginCookies(
  source: BrowserLoginSource,
): Promise<ReadChromiumCookiesResult> {
  return readChromiumCookies(source, undefined);
}
