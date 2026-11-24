import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePackageSource, resolveInstallPath } from "./packageSource";

describe("resolveInstallPath local sources", () => {
  it("resolves global relative paths from the agent settings directory", () => {
    const agentDir = path.resolve("test-home", ".pi", "agent");
    const packageDir = path.resolve("test-home", "WebstormProjects", "MyPiExtension");
    const source = path.relative(agentDir, packageDir);

    expect(
      resolveInstallPath(parsePackageSource(source), {
        agentDir,
        local: false,
        cwd: null,
      }),
    ).toBe(packageDir);
  });

  it("resolves project relative paths from the project .pi settings directory", () => {
    const projectDir = path.resolve("workspace", "PiDesk");
    const settingsDir = path.join(projectDir, ".pi");
    const packageDir = path.resolve("workspace", "MyPiExtension");
    const source = path.relative(settingsDir, packageDir);

    expect(
      resolveInstallPath(parsePackageSource(source), {
        agentDir: path.resolve("test-home", ".pi", "agent"),
        local: true,
        cwd: projectDir,
      }),
    ).toBe(packageDir);
  });

  it("keeps absolute local paths independent of scope", () => {
    const packageDir = path.resolve("workspace", "MyPiExtension");
    const parsed = parsePackageSource(packageDir);

    expect(
      resolveInstallPath(parsed, {
        agentDir: path.resolve("test-home", ".pi", "agent"),
        local: false,
        cwd: null,
      }),
    ).toBe(packageDir);
    expect(
      resolveInstallPath(parsed, {
        agentDir: path.resolve("test-home", ".pi", "agent"),
        local: true,
        cwd: path.resolve("workspace", "PiDesk"),
      }),
    ).toBe(packageDir);
  });

  it("normalizes tilde and file URL local sources like pi", () => {
    expect(parsePackageSource(`~${path.sep}MyPiExtension`).identity).toBe(
      path.join(os.homedir(), "MyPiExtension"),
    );

    const packageDir = path.resolve("workspace", "MyPiExtension");
    expect(parsePackageSource(pathToFileURL(packageDir).href).identity).toBe(packageDir);
  });

  it.skipIf(process.platform !== "win32")("normalizes Windows shell drive paths like pi", () => {
    expect(parsePackageSource("/c/Users/test/MyPiExtension").identity).toBe(
      path.win32.normalize("C:/Users/test/MyPiExtension"),
    );
  });

  it("cannot resolve project-relative paths without a project directory", () => {
    expect(
      resolveInstallPath(parsePackageSource("../MyPiExtension"), {
        agentDir: path.resolve("test-home", ".pi", "agent"),
        local: true,
        cwd: null,
      }),
    ).toBeNull();
  });
});
