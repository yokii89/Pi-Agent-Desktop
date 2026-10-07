import { execFile } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserLoginSource } from "../../shared/ipc";
import { readChromiumLoginCookies } from "./chromiumLoginRead";

const execFileAsync = promisify(execFile);

/** 用当前用户 DPAPI 加密 AES 主密钥，模拟 Chrome Local State。 */
async function dpapiProtect(clear: Buffer): Promise<Buffer> {
  const b64 = clear.toString("base64");
  const script = `Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String('${b64}'); $enc=[Security.Cryptography.ProtectedData]::Protect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); Write-Output ([Convert]::ToBase64String($enc))`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15_000 },
  );
  return Buffer.from(stdout.trim().split(/\r?\n/).pop() ?? "", "base64");
}

function encryptV10(plain: string, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10", "utf8"), nonce, enc, cipher.getAuthTag()]);
}

describe("readChromiumLoginCookies (synthetic profile)", () => {
  let dir: string;
  let source: BrowserLoginSource;
  const aesKey = randomBytes(32);
  const sessionValue = "integration-session-token";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "pidesk-login-it-"));
    const wrapped = await dpapiProtect(aesKey);
    const localState = {
      os_crypt: {
        encrypted_key: Buffer.concat([Buffer.from("DPAPI", "utf8"), wrapped]).toString("base64"),
      },
    };
    await writeFile(join(dir, "Local State"), JSON.stringify(localState));

    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
    const db = new SQL.Database();
    db.exec(`CREATE TABLE cookies (
      creation_utc INTEGER NOT NULL,
      host_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      last_access_utc INTEGER NOT NULL,
      has_expires INTEGER NOT NULL DEFAULT 1,
      is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      encrypted_value BLOB NOT NULL,
      samesite INTEGER NOT NULL DEFAULT -1
    );`);
    const enc = encryptV10(sessionValue, aesKey);
    // 注入：用 sql.js exec 无法直接绑 blob，改用 prepared 内存导出
    const stmt = db.prepare(
      "INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc, is_secure, is_httponly, last_access_utc, has_expires, is_persistent, priority, encrypted_value, samesite) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    stmt.run([0, ".example.com", "sid", "", "/", 0, 1, 1, 0, 0, 0, 1, enc, 1]);
    stmt.run([0, "other.com", "nope", "", "/", 0, 0, 0, 0, 0, 0, 1, encryptV10("x", aesKey), -1]);
    stmt.free();
    const data = db.export();
    await writeFile(join(dir, "Cookies"), Buffer.from(data));
    db.close();

    source = {
      id: "chrome:Default",
      browserId: "chrome",
      browserLabel: "Google Chrome",
      profileDir: "Default",
      profileLabel: "Default",
      userDataDir: dir,
      cookieDbPath: join(dir, "Cookies"),
      isDefaultBrowser: true,
    };
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("decrypts matching host cookies and skips others", async () => {
    const result = await readChromiumLoginCookies(source, "www.example.com");
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]?.name).toBe("sid");
    expect(result.cookies[0]?.value).toBe(sessionValue);
    expect(result.cookies[0]?.httpOnly).toBe(true);
    expect(result.cookies[0]?.secure).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns empty for unmatched host", async () => {
    const result = await readChromiumLoginCookies(source, "nomatch.test");
    expect(result.cookies).toHaveLength(0);
  });
});
