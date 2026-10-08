import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ChromiumDecryptError } from "./chromiumCrypto";

/**
 * 读取 Chromium Cookie 库字节（docs/design/09 / 42 §6.7 共用）。
 *
 * Chrome 运行中常对 Cookies 独占锁（新版有意防窃取）。三级退让：
 * 1. 直接 readFile（浏览器已退出，或库允许共享读）；
 * 2. PowerShell FileStream（FileShare.ReadWrite|Delete），偶尔能绕过 Node 的默认打开方式；
 * 3. 仍失败则抛出可操作错误，引导关浏览器或改用手动粘贴。
 */

const execFileAsync = promisify(execFile);

/**
 * 读取 Chromium Cookies 库字节。
 * Chrome 运行中常对 Cookies 独占锁（新版有意防窃取）：
 * 1. 直接 readFile
 * 2. PowerShell FileStream（FileShare.ReadWrite|Delete）
 * 3. 仍失败则抛出可操作错误，引导关浏览器或手动粘贴
 */
export async function readCookieDbBytes(src: string): Promise<Buffer> {
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
