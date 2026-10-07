import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type {
  ExtensionPushMessage,
  PiPackageInstallRequest,
  PiPackageRemoveRequest,
} from "../../shared/ipc";
import { EXTENSION_IPC } from "../../shared/ipc";
import { resolvePiCommand } from "../session/piLauncher";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";

/**
 * spawn `pi install` / `pi remove`，日志经 EXTENSION_IPC.output 推送。
 * 参数数组调用，禁止 shell 拼接；同一时刻只允许一个包操作。
 */

let activeChild: ChildProcessWithoutNullStreams | null = null;

function push(message: ExtensionPushMessage): void {
  getMainWindow()?.webContents.send(EXTENSION_IPC.output, message);
}

function runPiPackageCommand(args: string[], cwd: string | null): Promise<void> {
  if (activeChild) {
    return Promise.reject(new Error("已有安装/卸载任务在进行中，请稍候再试"));
  }
  const configured = getSettings().piExecutablePath;
  const command = resolvePiCommand(configured);

  return new Promise((resolve, reject) => {
    const child = spawn(command.file, [...command.args, ...args], {
      cwd: cwd || undefined,
      windowsHide: true,
      env: process.env,
    });
    activeChild = child;

    let settled = false;
    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      activeChild = null;
      if (err) reject(err);
      else resolve();
    };

    const onChunk = (buf: Buffer): void => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) push({ type: "log", payload: line });
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);

    child.on("error", (err) => {
      push({ type: "error", payload: err.message });
      finish(err);
    });

    child.on("close", (code) => {
      const ok = code === 0;
      push({ type: "exit", payload: { code, ok } });
      if (ok) finish();
      else finish(new Error(`pi 命令退出码 ${code ?? "null"}`));
    });
  });
}

export function installPackage(req: PiPackageInstallRequest): Promise<void> {
  const source = (req.source ?? "").trim();
  if (!source) return Promise.reject(new Error("请填写包来源"));
  const args = ["install", source];
  if (req.local) args.push("-l");
  return runPiPackageCommand(args, req.cwd ?? null);
}

export function removePackage(req: PiPackageRemoveRequest): Promise<void> {
  const source = (req.source ?? "").trim();
  if (!source) return Promise.reject(new Error("缺少包来源"));
  const args = ["remove", source];
  if (req.local) args.push("-l");
  return runPiPackageCommand(args, req.cwd ?? null);
}
