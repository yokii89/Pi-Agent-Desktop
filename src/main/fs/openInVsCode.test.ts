import * as childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { envelopeAsync } from "../ipc/envelope";
import { openInVsCode } from "./openInVsCode";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

const systemDirectory = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
let root: string;
let bin: string;
let target: string;
let output: string;

beforeEach(async () => {
  vi.mocked(childProcess.spawn).mockReset();
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pidesk-open-vscode-")));
  bin = path.join(root, "bin %PIDESK_VSCODE_TEST_EXPAND% & ^ ! (shim)");
  target = path.join(root, "%PIDESK_VSCODE_TEST_EXPAND% & ^ ! (workspace) 中文");
  output = path.join(root, "args.json");
  await mkdir(bin);
  await mkdir(target);
  vi.stubEnv("LOCALAPPDATA", root);
  vi.stubEnv("ProgramFiles", root);
  vi.stubEnv("ProgramFiles(x86)", root);
  vi.stubEnv("PATH", `${bin};${systemDirectory}`);
  vi.stubEnv("PATHEXT", ".COM;.EXE;.BAT;.CMD");
  vi.stubEnv("PIDESK_VSCODE_TEST_EXPAND", "incorrect-expanded-path");
  vi.stubEnv("PIDESK_VSCODE_TEST_NODE", process.execPath);
  vi.stubEnv("PIDESK_VSCODE_TEST_OUTPUT", output);
  vi.stubEnv("PIDESK_VSCODE_TEST_EXIT", "0");
  vi.stubEnv("PIDESK_VSCODE_TEST_RELEASE", "");
  vi.stubEnv("PIDESK_VSCODE_TEST_STARTED", path.join(root, "started"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function script(extension: "cmd" | "bat"): Promise<void> {
  const probe = path.join(root, "probe.cjs");
  await writeFile(
    probe,
    `const fs = require("node:fs");
const finish = () => {
  fs.writeFileSync(process.env.PIDESK_VSCODE_TEST_OUTPUT, JSON.stringify(process.argv.slice(2)));
  process.exit(Number(process.env.PIDESK_VSCODE_TEST_EXIT));
};
fs.writeFileSync(process.env.PIDESK_VSCODE_TEST_STARTED, "started");
const release = process.env.PIDESK_VSCODE_TEST_RELEASE;
if (release) {
  setInterval(() => { if (fs.existsSync(release)) finish(); }, 10);
} else finish();
`,
    "utf8",
  );
  vi.stubEnv("PIDESK_VSCODE_TEST_PROBE", probe);
  await writeFile(
    path.join(bin, `code.${extension}`),
    '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%PIDESK_VSCODE_TEST_NODE%" "%PIDESK_VSCODE_TEST_PROBE%" %*\r\nexit /b %errorlevel%\r\n',
  );
  // VS Code also ships an extensionless POSIX launcher; it must never be sent to cmd.
  await writeFile(path.join(bin, "code"), "#!/bin/sh\nexit 1\n");
}

describe.skipIf(process.platform !== "win32")("VS Code directory launching on Windows", () => {
  it.each(["cmd", "bat"] as const)(
    "preserves literal percent variables, shell characters and Unicode through code.%s",
    async (extension) => {
      await script(extension);
      await openInVsCode(target);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual([target]);
    },
  );

  it("waits for the command script to finish before reporting success", async () => {
    await script("cmd");
    const release = path.join(root, "release");
    vi.stubEnv("PIDESK_VSCODE_TEST_RELEASE", release);
    let settled = false;
    const opening = openInVsCode(target).finally(() => {
      settled = true;
    });
    try {
      await vi.waitFor(() => expect(existsSync(path.join(root, "started"))).toBe(true));
      expect(settled).toBe(false);
    } finally {
      await writeFile(release, "release");
      await opening;
    }
    expect(settled).toBe(true);
  });

  it("returns a nonzero script exit through the IPC error envelope", async () => {
    await script("cmd");
    vi.stubEnv("PIDESK_VSCODE_TEST_EXIT", "23");
    expect(await envelopeAsync(() => openInVsCode(target))).toEqual({
      ok: false,
      error: t("session.workspace.vsCodeLaunchFailed"),
    });
  });

  it("launches an executable found on PATH directly with the original argument", async () => {
    const executable = path.join(bin, "code.exe");
    await writeFile(executable, "fixture executable");
    const child = new childProcess.ChildProcess();
    const spawn = vi.mocked(childProcess.spawn).mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    await openInVsCode(target);
    expect(spawn).toHaveBeenCalledWith(executable, [target], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  });

  it("rejects missing directories and missing VS Code installations", async () => {
    await expect(openInVsCode(path.join(root, "missing"))).rejects.toThrow(
      t("session.workspace.pathMissing"),
    );
    await expect(openInVsCode(target)).rejects.toThrow(t("session.workspace.vsCodeNotFound"));
  });
});
