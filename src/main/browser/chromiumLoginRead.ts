import { execFile } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import initSqlJs from "sql.js";
import type { BrowserLoginSource } from "../../shared/ipc";
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

const execFileAsync = promisify(execFile);

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

/**
 * 读取 Chromium Cookies 库字节。
 * Chrome 运行中常对 Cookies 独占锁（新版有意防窃取）：
 * 1. 直接 readFile
 * 2. PowerShell FileStream（FileShare.ReadWrite|Delete）
 * 3. 仍失败则抛出可操作错误，引导关浏览器或手动粘贴
 */
async function readCookieDbBytes(src: string): Promise<Buffer> {
  try {
    return await readFile(src);
  } catch (readErr) {
    const viaPs = await tryPowerShellSharedCopy(src);
    if (viaPs) return viaPs;
    const readDetail = readErr instanceof Error ? readErr.message : String(readErr);
    throw new ChromiumDecryptError(
      `无法读取 Cookie 数据库（浏览器运行时可能独占锁定）。请完全退出该浏览器后重试，或改用手动粘贴。详情：${readDetail}`,
    );
  }
}

/** PowerShell FileStream + FileShare.ReadWrite|Delete，偶尔能绕过 Node 的默认打开方式。 */
async function tryPowerShellSharedCopy(src: string): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), "pidesk-cookie-"));
  const dest = join(dir, "Cookies");
  const script = `$ErrorActionPreference='Stop'; $fs=[System.IO.File]::Open($env:S,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite); $out=[System.IO.File]::Create($env:D); $fs.CopyTo($out); $out.Dispose(); $fs.Dispose()`;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      timeout: 15_000,
      env: { ...process.env, S: src, D: dest },
    });
    return await readFile(dest);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
 * 从指定 Chromium Profile 读取并解密匹配 host 的 Cookie（docs/design/09 M2）。
 * value 只留在主进程；不在磁盘留明文副本。
 */
export async function readChromiumLoginCookies(
  source: BrowserLoginSource,
  rawHost: string,
): Promise<ReadChromiumCookiesResult> {
  const host = normalizeCookieHost(rawHost);
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
      if (!row.name || !cookieDomainMatches(row.host_key, host)) continue;
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
