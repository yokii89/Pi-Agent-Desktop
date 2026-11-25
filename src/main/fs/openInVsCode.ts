import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../shared/i18n";

const VS_CODE_EXE_CANDIDATES = [
  "LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe",
  "ProgramFiles/Microsoft VS Code/Code.exe",
  "ProgramFiles(x86)/Microsoft VS Code/Code.exe",
] as const;

function findVsCodeExe(): string | null {
  for (const candidate of VS_CODE_EXE_CANDIDATES) {
    const separator = candidate.indexOf("/");
    const base = process.env[candidate.slice(0, separator)];
    if (!base) continue;
    const executable = path.join(base, candidate.slice(separator + 1));
    if (fs.existsSync(executable)) return executable;
  }
  return null;
}

function spawnDetached(command: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function findCodeOnPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("where.exe", ["code"], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const entries = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /\.(cmd|exe|bat)$/i.test(line));
      resolve(entries[0] ?? null);
    });
  });
}

function runCodeScript(script: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // cmd expands these placeholders once; percent signs inside their values stay literal.
    // Disable delayed expansion so exclamation marks in either path also survive.
    execFile(
      "cmd.exe",
      ["/d", "/v:off", "/s", "/c", '""%PIDESK_VSCODE_SCRIPT%" "%PIDESK_VSCODE_TARGET%""'],
      {
        windowsHide: true,
        windowsVerbatimArguments: true,
        env: {
          ...process.env,
          PIDESK_VSCODE_SCRIPT: script,
          PIDESK_VSCODE_TARGET: target,
        },
      },
      (error) => {
        if (error) reject(new Error(t("session.workspace.vsCodeLaunchFailed")));
        else resolve();
      },
    );
  });
}

/** Open a directory in VS Code, waiting for a CLI script's successful exit before accepting it. */
export async function openInVsCode(target: string): Promise<void> {
  try {
    fs.statSync(target);
  } catch {
    throw new Error(t("session.workspace.pathMissing"));
  }

  const installed = findVsCodeExe();
  const entry = installed ?? (await findCodeOnPath());
  if (!entry) throw new Error(t("session.workspace.vsCodeNotFound"));

  let executable = /\.exe$/i.test(entry) ? entry : null;
  if (!executable) {
    const adjacent = path.join(path.dirname(path.dirname(entry)), "Code.exe");
    if (fs.existsSync(adjacent)) executable = adjacent;
  }

  try {
    if (executable) await spawnDetached(executable, target);
    else await runCodeScript(entry, target);
  } catch {
    throw new Error(t("session.workspace.vsCodeLaunchFailed"));
  }
}
