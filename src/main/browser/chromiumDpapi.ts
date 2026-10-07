import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChromiumDecryptError } from "./chromiumCrypto";

const execFileAsync = promisify(execFile);

/**
 * Windows DPAPI（CurrentUser）解密。主进程无内置 DPAPI，
 * 走 PowerShell System.Security，避免引入 native 模块（docs/design/09 M2）。
 * 只用于解出 Chromium 的 AES 主密钥，不接触 Cookie 明文。
 */
export async function dpapiUnprotectCurrentUser(cipher: Buffer): Promise<Buffer> {
  if (cipher.length === 0) {
    throw new ChromiumDecryptError("DPAPI 密文为空");
  }
  const b64 = cipher.toString("base64");
  // 必须整行一条语句：用分号拼接会把 Unprotect( 拆坏
  const script = `Add-Type -AssemblyName System.Security; $data = [Convert]::FromBase64String('${b64}'); $clear = [Security.Cryptography.ProtectedData]::Unprotect($data, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); Write-Output ([Convert]::ToBase64String($clear))`;

  let stdout: string;
  try {
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
      },
    );
    stdout = result.stdout;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ChromiumDecryptError(`DPAPI 解密失败：${detail}`);
  }

  const line = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!line) {
    throw new ChromiumDecryptError("DPAPI 未返回结果");
  }
  try {
    return Buffer.from(line, "base64");
  } catch {
    throw new ChromiumDecryptError("DPAPI 返回格式不正确");
  }
}
