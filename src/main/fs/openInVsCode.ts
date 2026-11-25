import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../shared/i18n";

const VS_CODE_EXE_CANDIDATES = [
  "LOCALAPPDATA/Programs/Microsoft VS Code/Code.exe",
  "ProgramFiles/Microsoft VS Code/Code.exe",
  "ProgramFiles(x86)/Microsoft VS Code/Code.exe",
] as const;

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findVsCodeExe(): string | null {
  for (const candidate of VS_CODE_EXE_CANDIDATES) {
    const sep = candidate.indexOf("/");
    const base = process.env[candidate.slice(0, sep)];
    if (!base) continue;
    const exe = path.join(base, candidate.slice(sep + 1));
    if (isFile(exe)) return exe;
  }
  return null;
}

function findCodeOnPath(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("where.exe", ["code"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve(null);
        return;
      }
      // VS Code 的 bin 同时包含无扩展名的 bash shim，Windows 只使用可执行形态。
      const shims = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /\.(cmd|exe|bat)$/i.test(line));
      resolve(shims[0] ?? null);
    });
  });
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

function launchCodeShim(shim: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 经环境变量只展开一层，保留路径里的 %NAME%；关闭延迟展开以保留 !。
    // 这里必须等 shim 退出：cmd.exe 启动成功不代表 code.cmd 执行成功。
    execFile(
      "cmd.exe",
      ["/d", "/v:off", "/s", "/c", '""%PIDESK_CODE_COMMAND%" "%PIDESK_CODE_TARGET%""'],
      {
        windowsHide: true,
        windowsVerbatimArguments: true,
        timeout: 15000,
        env: {
          ...process.env,
          PIDESK_CODE_COMMAND: shim,
          PIDESK_CODE_TARGET: target,
        },
      },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

/** 用 VS Code 打开工作目录；优先直接启动 Code.exe，PATH 脚本须成功退出才算打开成功。 */
export async function openInVsCode(target: string): Promise<void> {
  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(target).isDirectory();
  } catch {
    throw new Error(t("session.workspace.pathUnavailable"));
  }
  if (!isDirectory) throw new Error(t("session.workspace.notDirectory"));

  const dir = path.resolve(target);
  let exe = findVsCodeExe();
  const shim = exe ? null : await findCodeOnPath();
  if (!exe && shim) {
    if (path.extname(shim).toLowerCase() === ".exe") {
      exe = shim;
    } else {
      const siblingExe = path.join(path.dirname(path.dirname(shim)), "Code.exe");
      if (isFile(siblingExe)) exe = siblingExe;
    }
  }
  if (!exe && !shim) throw new Error(t("session.workspace.vsCodeNotFound"));

  try {
    if (exe) await spawnDetached(exe, dir);
    else if (shim) await launchCodeShim(shim, dir);
  } catch {
    throw new Error(t("session.workspace.vsCodeLaunchFailed"));
  }
}
