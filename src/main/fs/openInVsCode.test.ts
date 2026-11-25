import type { ExecFileOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { openInVsCode } from "./openInVsCode";

const processes = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        command: string,
        args: readonly string[],
        options: ExecFileOptions,
        callback: (error: Error | null, stdout: string) => void,
      ) => void
    >(),
  spawn: vi.fn(),
}));
vi.mock("node:child_process", () => processes);

let root: string;
let target: string;
let child: EventEmitter & { unref: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(os.tmpdir(), "pidesk-vscode-"));
  target = path.join(root, "项目 space & %PIDESK_TEST_VALUE%! #");
  await mkdir(target);
  vi.stubEnv("LOCALAPPDATA", path.join(root, "app data"));
  vi.stubEnv("ProgramFiles", path.join(root, "program files"));
  vi.stubEnv("ProgramFiles(x86)", path.join(root, "program files x86"));
  vi.stubEnv("PIDESK_TEST_VALUE", "expanded");
  processes.execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(new Error("not found"), "");
  });
  child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  processes.spawn.mockImplementation(() => {
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function executable(file: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "");
  return file;
}

function onPath(shim: string): void {
  processes.execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, `${path.join(path.dirname(shim), "code")}\r\n${shim}\r\n`);
  });
}

describe("VS Code workspace opening", () => {
  it("rejects missing paths and files before attempting to launch an app", async () => {
    await expect(openInVsCode(path.join(root, "missing"))).rejects.toThrow(
      t("session.workspace.pathUnavailable"),
    );
    const file = await executable(path.join(root, "file.txt"));
    await expect(openInVsCode(file)).rejects.toThrow(t("session.workspace.notDirectory"));
    expect(processes.execFile).not.toHaveBeenCalled();
    expect(processes.spawn).not.toHaveBeenCalled();
  });

  it("opens a known installation without a shell and preserves special path characters", async () => {
    const exe = await executable(
      path.join(process.env.LOCALAPPDATA ?? "", "Programs/Microsoft VS Code/Code.exe"),
    );
    await openInVsCode(target);
    expect(processes.spawn).toHaveBeenCalledWith(exe, [target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(child.unref).toHaveBeenCalledOnce();
    expect(processes.execFile).not.toHaveBeenCalled();
  });

  it("finds a system installation after skipping a directory named Code.exe", async () => {
    await mkdir(path.join(process.env.LOCALAPPDATA ?? "", "Programs/Microsoft VS Code/Code.exe"), {
      recursive: true,
    });
    const exe = await executable(
      path.join(process.env.ProgramFiles ?? "", "Microsoft VS Code/Code.exe"),
    );
    await openInVsCode(target);
    expect(processes.spawn).toHaveBeenCalledWith(exe, [target], expect.any(Object));
  });

  it("resolves the real Code.exe from a custom installation's PATH shim", async () => {
    const exe = await executable(path.join(root, "custom installation", "Code.exe"));
    onPath(path.join(path.dirname(exe), "bin", "code.cmd"));
    await openInVsCode(target);
    expect(processes.spawn).toHaveBeenCalledWith(exe, [target], expect.any(Object));
    expect(processes.execFile).toHaveBeenCalledOnce();
  });

  it("launches a PATH executable directly instead of sending it through cmd.exe", async () => {
    const exe = path.join(root, "portable code", "code.EXE");
    onPath(exe);
    await openInVsCode(target);
    expect(processes.spawn).toHaveBeenCalledWith(exe, [target], expect.any(Object));
    expect(processes.execFile).toHaveBeenCalledOnce();
  });

  it("reports missing VS Code for failed PATH lookup or a bash-only shim", async () => {
    await expect(openInVsCode(target)).rejects.toThrow(t("session.workspace.vsCodeNotFound"));
    onPath(path.join(root, "bin", "code"));
    await expect(openInVsCode(target)).rejects.toThrow(t("session.workspace.vsCodeNotFound"));
    expect(processes.spawn).not.toHaveBeenCalled();
  });

  it("reports launch failures separately from a missing installation", async () => {
    await executable(
      path.join(process.env.LOCALAPPDATA ?? "", "Programs/Microsoft VS Code/Code.exe"),
    );
    processes.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("access denied")));
      return child;
    });
    await expect(openInVsCode(target)).rejects.toThrow(t("session.workspace.vsCodeLaunchFailed"));
    expect(child.unref).not.toHaveBeenCalled();
  });

  it("waits for a shim's completion and rejects its nonzero exit", async () => {
    const shim = path.join(root, "custom shim", "code.cmd");
    let finish: ((error: Error | null, stdout: string) => void) | undefined;
    processes.execFile.mockImplementation((command, _args, _options, callback) => {
      if (command === "where.exe") callback(null, shim);
      else finish = callback;
    });
    let settled = false;
    const opening = openInVsCode(target).finally(() => {
      settled = true;
    });
    const rejected = expect(opening).rejects.toThrow(t("session.workspace.vsCodeLaunchFailed"));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(finish).toBeTypeOf("function");
    finish?.(new Error("exit code 7"), "");
    await rejected;
    expect(processes.spawn).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== "win32")(
    "passes literal percent, ampersand, exclamation and Unicode paths through real cmd.exe",
    async () => {
      const shim = path.join(root, "shim %PIDESK_TEST_VALUE% & space!", "code.cmd");
      await mkdir(path.dirname(shim), { recursive: true });
      await writeFile(shim, '@echo off\r\nchcp 65001 >nul\r\necho "%~1"\r\nexit /b 0\r\n');
      const actual =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      let received = "";
      processes.execFile.mockImplementation((command, args, options, callback) => {
        if (command === "where.exe") callback(null, shim);
        else {
          actual.execFile(command, args, { ...options, encoding: "utf8" }, (error, stdout) => {
            received = stdout.trim();
            callback(error, stdout);
          });
        }
      });
      await openInVsCode(target);
      expect(received).toBe(`"${target}"`);
      expect(processes.spawn).not.toHaveBeenCalled();
    },
  );
});
