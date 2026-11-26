import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPackageSettings, writePackageSettings } from "../settings/packageSettings";
import type { PackageCommand } from "./packageCommand";
import { DesktopPackageManager } from "./packageManager";
import { parsePackageSource, resolveInstallPath } from "./packageSource";

let root: string;
let agent: string;
let project: string;
async function json(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "pidesk-packages-"));
  agent = path.join(root, "agent");
  project = path.join(root, "project");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
function target(source: string, local = false) {
  return resolveInstallPath(parsePackageSource(source), {
    agentDir: agent,
    local,
    cwd: project,
  }) as string;
}
function fakeInstall(extra?: (cwd: string) => Promise<void>) {
  return vi.fn<PackageCommand>(async (_program, args, cwd) => {
    const spec = args.at(-1) as string;
    const name = spec.startsWith("@") ? spec.slice(0, spec.lastIndexOf("@")) : spec.split("@")[0];
    await json(path.join(cwd, "node_modules", name, "package.json"), {
      name,
      version: "2.0.0",
      pi: { skills: ["SKILL.md"] },
    });
    await fs.writeFile(path.join(cwd, "node_modules", name, "SKILL.md"), "skill source");
    await fs.mkdir(path.join(cwd, "node_modules", "helper"), { recursive: true });
    await fs.writeFile(
      path.join(cwd, "node_modules", "helper", "index.js"),
      "module.exports = 42;",
    );
    await extra?.(cwd);
  });
}

describe("desktop-owned package management", () => {
  it("registers local packages in both scopes without subprocesses and retains sources on removal", async () => {
    const directory = path.join(root, "local source");
    await json(path.join(directory, "package.json"), { name: "local" });
    const run = vi.fn<PackageCommand>();
    const manager = new DesktopPackageManager(() => agent, run);
    await manager.install({ source: directory });
    await manager.install({ source: directory, local: true, cwd: project });
    expect(readPackageSettings(path.join(agent, "settings.json")).packages).toEqual([directory]);
    expect(readPackageSettings(path.join(project, ".pi", "settings.json")).packages).toEqual([
      directory,
    ]);
    await manager.remove({ source: directory });
    await manager.remove({ source: directory, local: true, cwd: project });
    expect(await fs.readFile(path.join(directory, "package.json"), "utf8")).toContain("local");
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects standalone entries and old agent-only packages while allowing declarative resources", async () => {
    const directory = path.join(root, "retired");
    await json(path.join(directory, "package.json"), {
      name: "retired",
      pi: { extensions: ["index.ts"] },
    });
    const entry = path.join(directory, "index.ts");
    await fs.writeFile(entry, "throw Error('must not execute');");
    const run = vi.fn<PackageCommand>();
    const manager = new DesktopPackageManager(() => agent, run);
    await expect(manager.install({ source: entry })).rejects.toThrow("Standalone agent entries");
    await expect(manager.install({ source: directory })).rejects.toThrow("retired pi agent");
    expect(readPackageSettings(path.join(agent, "settings.json")).packages).toBeUndefined();
    await fs.mkdir(path.join(directory, "skills"));
    await manager.install({ source: directory });
    expect(readPackageSettings(path.join(agent, "settings.json")).packages).toEqual([directory]);
    expect(run).not.toHaveBeenCalled();
  });

  it("installs scoped npm packages into staging, preserves resource toggles, and promotes dependencies together", async () => {
    const previous = "npm:@test/extension@1.0.0";
    const source = "npm:@test/extension@2.0.0";
    writePackageSettings(path.join(agent, "settings.json"), {
      theme: "custom",
      packages: [{ source: previous, skills: ["-SKILL.md"] }],
    });
    const run = fakeInstall();
    const manager = new DesktopPackageManager(() => agent, run);
    await manager.install({ source });
    expect(run.mock.calls[0][0]).toBe("pnpm");
    expect(run.mock.calls[0][1]).toEqual(
      expect.arrayContaining(["--ignore-scripts", "--ignore-workspace", "@test/extension@2.0.0"]),
    );
    expect(readPackageSettings(path.join(agent, "settings.json"))).toEqual({
      theme: "custom",
      packages: [{ source, skills: ["-SKILL.md"] }],
    });
    expect(await fs.readFile(path.join(target(source), "SKILL.md"), "utf8")).toBe("skill source");
    expect(
      await fs.readFile(path.join(target(source), "node_modules", "helper", "index.js"), "utf8"),
    ).toContain("42");
    await manager.remove({ source });
    await expect(fs.stat(target(source))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("leaves the previous install and registry intact on acquisition failure, and releases the operation lock", async () => {
    const source = "npm:extension@2.0.0";
    const file = path.join(agent, "settings.json");
    writePackageSettings(file, { packages: ["npm:extension@1.0.0"] });
    await json(path.join(target(source), "package.json"), { version: "1.0.0" });
    const run = vi.fn<PackageCommand>().mockRejectedValueOnce(new Error("offline"));
    const manager = new DesktopPackageManager(() => agent, run);
    await expect(manager.install({ source })).rejects.toThrow("offline");
    expect(readPackageSettings(file).packages).toEqual(["npm:extension@1.0.0"]);
    expect(
      JSON.parse(await fs.readFile(path.join(target(source), "package.json"), "utf8")).version,
    ).toBe("1.0.0");
    expect(await fs.readdir(path.dirname(target(source)))).toEqual(["extension"]);
    await manager.remove({ source: "npm:extension@1.0.0" });
  });
  it("rolls back promoted files when the current registry becomes invalid instead of clobbering it", async () => {
    const source = "npm:extension@2.0.0";
    const file = path.join(agent, "settings.json");
    writePackageSettings(file, { packages: ["npm:extension@1.0.0"] });
    await json(path.join(target(source), "package.json"), { version: "1.0.0" });
    const manager = new DesktopPackageManager(
      () => agent,
      fakeInstall(async () => fs.writeFile(file, "damaged")),
    );
    await expect(manager.install({ source })).rejects.toThrow("settings");
    expect(await fs.readFile(file, "utf8")).toBe("damaged");
    expect(
      JSON.parse(await fs.readFile(path.join(target(source), "package.json"), "utf8")).version,
    ).toBe("1.0.0");
  });
  it("rejects concurrent mutations, traversal sources and a junction inside managed storage", async () => {
    let finish!: () => void;
    const run = vi.fn<PackageCommand>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const manager = new DesktopPackageManager(() => agent, run);
    const installing = manager.install({ source: "npm:extension" });
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
    await expect(manager.remove({ source: "npm:extension" })).rejects.toThrow("already running");
    finish();
    await expect(installing).rejects.toThrow();
    for (const source of [
      "npm:../../outside",
      "npm:--option",
      "git:github.com/a/../outside",
      "git:github.com/a/repo@--exec=bad",
    ]) {
      await expect(manager.install({ source })).rejects.toThrow();
    }
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.mkdir(agent, { recursive: true });
    await fs.rm(path.join(agent, "npm"), { recursive: true });
    await fs.symlink(outside, path.join(agent, "npm"), "junction");
    await expect(manager.install({ source: "npm:extension" })).rejects.toThrow("symbolic links");
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it("uses Git clone/checkout and pnpm for a pinned project package", async () => {
    const source = "git:github.com/example/extension@release";
    const run = vi.fn<PackageCommand>(async (program, args, cwd) => {
      if (program === "git" && args[0] === "clone")
        await json(path.join(args.at(-1) as string, "package.json"), { name: "git-extension" });
      if (program === "pnpm") expect(cwd).toContain(".pidesk-stage-");
    });
    const manager = new DesktopPackageManager(() => agent, run);
    await manager.install({ source, local: true, cwd: project });
    expect(run.mock.calls.map(([program, args]) => [program, args[0]])).toEqual([
      ["git", "clone"],
      ["git", "checkout"],
      ["pnpm", "install"],
    ]);
    expect(readPackageSettings(path.join(project, ".pi", "settings.json")).packages).toEqual([
      source,
    ]);
    await manager.remove({ source, local: true, cwd: project });
  });
});
