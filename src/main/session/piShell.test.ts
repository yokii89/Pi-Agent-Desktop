import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  settings: { executionShellPath: null as string | null },
  update: vi.fn(),
  exec: vi.fn(),
}));
vi.mock("../settings/settings", () => ({
  getSettings: () => host.settings,
  updateSettings: host.update,
}));
vi.mock("node:child_process", () => ({ execFileSync: host.exec }));

import { probePiShell, setPiShellPath } from "./piShell";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "pidesk-native-shell-"));
  host.settings.executionShellPath = null;
  vi.resetAllMocks();
  host.exec.mockImplementation((_file: string, args: string[]) =>
    args[0] === "--version" ? "GNU bash, version 5.2" : "",
  );
  host.update.mockImplementation((patch: { executionShellPath: string | null }) =>
    Object.assign(host.settings, patch),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("desktop-owned execution shell", () => {
  it("validates and saves the override only through desktop settings", () => {
    const shell = path.join(root, "bash.exe");
    fs.writeFileSync(shell, "fixture");
    const probe = setPiShellPath(shell);
    expect(host.update).toHaveBeenCalledExactlyOnceWith({ executionShellPath: shell });
    expect(probe.resolved?.path).toBe(shell);
    expect(probe.resolved?.source).toBe("settings");
    setPiShellPath(null);
    expect(host.settings.executionShellPath).toBeNull();
  });

  it("ignores old agent shell preferences and leaves their files unchanged", () => {
    const file = path.join(root, "settings.json");
    const text = JSON.stringify({ shellPath: "retired-agent-shell.exe", defaultModel: "retired" });
    fs.writeFileSync(file, text);
    vi.stubEnv("PI_CODING_AGENT_DIR", root);
    expect(probePiShell().shellPath).toBeNull();
    setPiShellPath(null);
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    expect(host.exec.mock.calls.some(([file]) => file === "retired-agent-shell.exe")).toBe(false);
  });

  it("does not persist an invalid executable", () => {
    expect(() => setPiShellPath(path.join(root, "missing.exe"))).toThrow();
    expect(host.update).not.toHaveBeenCalled();
  });
});
