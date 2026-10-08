import fs from "node:fs";
import os from "node:os";
import { app } from "electron";
import type { IPty } from "node-pty";
import { spawn } from "node-pty";
import type { TerminalPushMessage } from "../../shared/ipc";
import { TERMINAL_IPC } from "../../shared/ipc";
import { resolveBashForTerminal } from "../session/piShell";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";

interface TerminalEntry {
  pty: IPty;
  /** 待合批发送的 stdout 缓冲。 */
  outBuf: string;
  /** 合批定时器；null 表示当前无待发数据。 */
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const terminals = new Map<string, TerminalEntry>();
let terminalSeq = 0;

/** pty 输出合批窗口（ms）：高速刷屏时合并 IPC。 */
const OUTPUT_BATCH_MS = 16;

function push(message: TerminalPushMessage): void {
  getMainWindow()?.webContents.send(TERMINAL_IPC.output, message);
}

function flushTerminalOutput(id: string, entry: TerminalEntry): void {
  if (entry.flushTimer !== null) {
    clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
  }
  if (!entry.outBuf) return;
  const payload = entry.outBuf;
  entry.outBuf = "";
  push({ id, type: "data", payload });
}

/**
 * 终端 Shell 启动参数。中文 Windows 下 PowerShell/CMD 默认 GBK 代码页，
 * 固定先切换到 UTF-8（65001），避免 xterm 按 UTF-8 渲染出现乱码。
 * Git Bash 原生 UTF-8，无需 chcp；解析顺序见 resolveBashForTerminal。
 */
function resolveShell(): { file: string; args: string[]; fallbackNotice?: string } {
  if (getSettings().terminalShell === "cmd") {
    return { file: "cmd.exe", args: ["/d", "/k", "chcp 65001 >nul"] };
  }
  if (getSettings().terminalShell === "gitbash") {
    const bash = resolveBashForTerminal();
    if (bash) {
      // --login 加载 Git Bash profile，得到彩色提示符；env 透传 process.env
      return { file: bash, args: ["--login"] };
    }
    return {
      file: "powershell.exe",
      args: ["-NoLogo", "-NoExit", "-Command", "chcp 65001 >$null"],
      fallbackNotice: "\r\n\x1b[33m[PiDesk] 未找到 Git Bash，已回退到 PowerShell\x1b[0m\r\n\r\n",
    };
  }
  return { file: "powershell.exe", args: ["-NoLogo", "-NoExit", "-Command", "chcp 65001 >$null"] };
}

/** 新建终端实例，返回实例 id。cwd 不存在时回落到用户主目录。 */
export function createTerminal(cwd?: string): string {
  const id = `term-${++terminalSeq}`;
  const shell = resolveShell();
  const workdir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  // 回退提示要在 pty 数据之前送达，否则用户看不到开头的那行说明
  if (shell.fallbackNotice) {
    push({ id, type: "data", payload: shell.fallbackNotice });
  }
  const pty = spawn(shell.file, shell.args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: workdir,
    env: process.env as Record<string, string>,
  });
  const entry: TerminalEntry = { pty, outBuf: "", flushTimer: null };
  pty.onData((data) => {
    entry.outBuf += data;
    if (entry.flushTimer === null) {
      entry.flushTimer = setTimeout(() => {
        entry.flushTimer = null;
        flushTerminalOutput(id, entry);
      }, OUTPUT_BATCH_MS);
    }
  });
  pty.onExit(({ exitCode }) => {
    flushTerminalOutput(id, entry);
    terminals.delete(id);
    push({ id, type: "exit", payload: exitCode });
  });
  terminals.set(id, entry);
  return id;
}

export function writeTerminal(id: string, data: string): void {
  terminals.get(id)?.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const entry = terminals.get(id);
  if (!entry) return;
  entry.pty.resize(cols, rows);
}

export function disposeTerminal(id: string): void {
  const entry = terminals.get(id);
  if (!entry) return;
  terminals.delete(id);
  flushTerminalOutput(id, entry);
  try {
    entry.pty.kill();
  } catch {
    // 进程已退出时忽略
  }
}

/** 应用退出时回收所有 pty（index.ts will-quit 调用）。 */
export function disposeAllTerminals(): void {
  for (const id of [...terminals.keys()]) {
    disposeTerminal(id);
  }
}

export function registerTerminalLifecycle(): void {
  app.on("will-quit", () => {
    disposeAllTerminals();
  });
}
