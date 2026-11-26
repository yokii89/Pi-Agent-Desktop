import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionResources } from "../../agentRuntime/resources/sessionResources";
import type { ManagedSkillOperation } from "../../shared/managedSkills";
import { managedHash } from "../settings/managedSkillsStore";

const fixture = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("../session/piInfo", () => ({ getPiAgentDir: () => fixture.agentDir }));

import { discoverDurableResources } from "./durableResources";
import { ManagedSkills } from "./managedSkills";

let root: string;
let sourceRoot: string;
let project: string;
let home: string;
let manager: ManagedSkills;
function file(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function source(name: string, suffix = ""): void {
  file(
    path.join(sourceRoot, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: >\n  A native Pi skill\n  for testing.\n---\n\nDo the work.${suffix}\n`,
  );
  file(path.join(sourceRoot, name, "references", "guide.md"), "Reference content.\n");
}
function apply(operation: ManagedSkillOperation, name = "plugin-creator") {
  const plan = manager.plan({ operation, name, projectDir: project });
  expect(plan.canApply, JSON.stringify(plan.diagnostics)).toBe(true);
  return manager.apply(plan.id);
}
function target(name = "plugin-creator") {
  return path.join(manager.store.managedRoot, name);
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "pidesk-managed-skills-"));
  fixture.agentDir = path.join(root, "agent");
  sourceRoot = path.join(root, "bundled");
  project = path.join(root, "workspace");
  home = path.join(root, "home");
  fs.mkdirSync(project);
  source("plugin-creator");
  source("skill-creator");
  manager = new ManagedSkills({
    agentDir: fixture.agentDir,
    sourceRoot,
    version: "test",
    discover: (cwd) => discoverDurableResources(cwd, home),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("native managed skill maintenance", () => {
  it("keeps discovery, Doctor, manifest reads and plan previews read-only", () => {
    expect(manager.snapshot(project).items).toHaveLength(2);
    expect(
      manager.plan({ operation: "install", name: "plugin-creator", projectDir: project }).files,
    ).toEqual([
      { path: "SKILL.md", change: "add" },
      { path: "references/guide.md", change: "add" },
    ]);
    expect(fs.existsSync(fixture.agentDir)).toBe(false);
  });

  it("installs regular files, retains hashes and exposes the native /skill: command", async () => {
    expect(apply("install")).toEqual({ preserved: false, reopenRequired: true });
    const manifest = manager.store.read();
    expect(manifest.skills[0].canonicalTarget).toBe(target());
    expect(manifest.skills[0].lastLoaderResult).toBe("pending");
    for (const entry of manifest.skills[0].files) {
      expect(entry.installedHash).toBe(
        managedHash(fs.readFileSync(path.join(target(), entry.relativePath))),
      );
      expect(entry.sourceHash).toBe(entry.installedHash);
    }
    const resources = await loadSessionResources(project, discoverDurableResources(project, home));
    expect(resources.commands.map((entry) => entry.name)).toEqual(["skill:plugin-creator"]);
    expect(resources.commands[0].expand("args")).toContain("Do the work.");
    expect(manager.snapshot(project).items[0].available).toBe(true);
    expect(manager.snapshot(project).items[0].diagnostics).toEqual([]);
  });

  it("updates changed sources and removes obsolete owned files", () => {
    apply("install");
    source("plugin-creator", " Updated.");
    fs.rmSync(path.join(sourceRoot, "plugin-creator/references"), { recursive: true });
    expect(manager.snapshot(project).items[0].updateAvailable).toBe(true);
    const plan = manager.plan({ operation: "update", name: "plugin-creator", projectDir: project });
    expect(plan.files).toContainEqual({ path: "references/guide.md", change: "remove" });
    manager.apply(plan.id);
    expect(fs.readFileSync(path.join(target(), "SKILL.md"), "utf8")).toContain("Updated.");
    expect(fs.existsSync(path.join(target(), "references/guide.md"))).toBe(false);
    expect(manager.snapshot(project).items[0].updateAvailable).toBe(false);
  });

  it("repairs missing files and a missing directory, while update requires an intact installation", () => {
    apply("install");
    fs.rmSync(path.join(target(), "references/guide.md"));
    expect(
      manager.plan({ operation: "update", name: "plugin-creator", projectDir: project }).canApply,
    ).toBe(false);
    apply("repair");
    expect(fs.readFileSync(path.join(target(), "references/guide.md"), "utf8")).toBe(
      "Reference content.\n",
    );
    fs.rmSync(target(), { recursive: true });
    apply("repair");
    expect(fs.existsSync(path.join(target(), "SKILL.md"))).toBe(true);
  });

  it.each(["update", "repair"] as const)(
    "blocks %s from overwriting modified files or extra content",
    (operation) => {
      apply("install");
      const document = path.join(target(), "SKILL.md");
      fs.appendFileSync(document, "User changes.");
      expect(
        manager.plan({ operation, name: "plugin-creator", projectDir: project }).canApply,
      ).toBe(false);
      expect(fs.readFileSync(document, "utf8")).toContain("User changes.");
      fs.writeFileSync(document, fs.readFileSync(path.join(sourceRoot, "plugin-creator/SKILL.md")));
      fs.mkdirSync(path.join(target(), "extra-empty-directory"));
      const plan = manager.plan({ operation, name: "plugin-creator", projectDir: project });
      expect(plan.canApply).toBe(false);
      expect(plan.diagnostics.some((entry) => entry.code === "extra")).toBe(true);
    },
  );

  it("uninstalls an intact owned skill without needing its bundled source", () => {
    apply("install");
    fs.rmSync(sourceRoot, { recursive: true });
    expect(apply("uninstall").preserved).toBe(false);
    expect(fs.existsSync(target())).toBe(false);
    expect(manager.store.read().skills).toEqual([]);
  });

  it("removes missing installations from the manifest", () => {
    apply("install");
    fs.rmSync(target(), { recursive: true });
    apply("uninstall");
    expect(manager.store.read().skills).toEqual([]);
  });

  it("retains user changes, extras and ownership on uninstall", () => {
    apply("install");
    file(path.join(target(), "notes.txt"), "User notes.");
    const plan = manager.plan({
      operation: "uninstall",
      name: "plugin-creator",
      projectDir: project,
    });
    expect(plan.preservesFiles).toBe(true);
    expect(plan.files.every((entry) => entry.change === "keep")).toBe(true);
    expect(manager.apply(plan.id).preserved).toBe(true);
    expect(fs.readFileSync(path.join(target(), "notes.txt"), "utf8")).toBe("User notes.");
    expect(manager.store.read().skills[0].state).toBe("orphaned-user-modified");
  });

  it("never adopts an unmanaged target", () => {
    file(path.join(target(), "SKILL.md"), "Existing user content.");
    const plan = manager.plan({
      operation: "install",
      name: "plugin-creator",
      projectDir: project,
    });
    expect(plan.canApply).toBe(false);
    expect(() => manager.apply(plan.id)).toThrow("PIDESK_SKILLS:stale");
    expect(fs.existsSync(manager.store.manifestPath)).toBe(false);
  });

  it.each(["source", "target", "manifest", "collision"] as const)(
    "invalidates a confirmed plan when %s changes",
    (changed) => {
      apply("install");
      const plan = manager.plan({
        operation: "repair",
        name: "plugin-creator",
        projectDir: project,
      });
      if (changed === "source") source("plugin-creator", " Source changed.");
      if (changed === "target") fs.appendFileSync(path.join(target(), "SKILL.md"), "Local change.");
      if (changed === "manifest") {
        const manifest = manager.store.read();
        manifest.extensionVersion = "changed";
        manager.store.write(manifest);
      }
      if (changed === "collision")
        file(
          path.join(fixture.agentDir, "skills/other/SKILL.md"),
          "---\nname: plugin-creator\ndescription: Collision\n---\nOther skill.\n",
        );
      expect(() => manager.apply(plan.id)).toThrow("PIDESK_SKILLS:stale");
    },
  );

  it("uses single-use expiring preview tokens", () => {
    const plan = manager.plan({
      operation: "install",
      name: "plugin-creator",
      projectDir: project,
    });
    manager.apply(plan.id);
    expect(() => manager.apply(plan.id)).toThrow("PIDESK_SKILLS:stale");
    const next = manager.plan({ operation: "install", name: "skill-creator", projectDir: project });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(() => manager.apply(next.id)).toThrow("PIDESK_SKILLS:stale");
    expect(fs.existsSync(target("skill-creator"))).toBe(false);
  });

  it("reports metadata errors, disabled resources and project overrides through Doctor", () => {
    apply("install");
    file(
      path.join(fixture.agentDir, "settings.json"),
      JSON.stringify({ skills: ["-skills/codex-managed/plugin-creator/SKILL.md"] }),
    );
    expect(
      manager.snapshot(project).items[0].diagnostics.some((entry) => entry.code === "disabled"),
    ).toBe(true);
    file(
      path.join(project, ".pi/skills/override/SKILL.md"),
      "---\nname: plugin-creator\ndescription: Project override\n---\nProject work.\n",
    );
    expect(manager.snapshot(project).items[0].diagnostics).toContainEqual(
      expect.objectContaining({ code: "collision", severity: "warning" }),
    );
    file(path.join(target(), "SKILL.md"), "---\nname: [invalid]\n---\nBody\n");
    expect(
      manager.snapshot(project).items[0].diagnostics.some((entry) => entry.code === "invalid"),
    ).toBe(true);
  });

  it("blocks same-scope name collisions", () => {
    file(
      path.join(fixture.agentDir, "skills/other/SKILL.md"),
      "---\nname: plugin-creator\ndescription: Other skill\n---\nOther.\n",
    );
    const plan = manager.plan({
      operation: "install",
      name: "plugin-creator",
      projectDir: project,
    });
    expect(plan.canApply).toBe(false);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "collision", severity: "error" }),
    );
  });

  it("rolls files and ownership back if the final manifest write fails", () => {
    apply("install");
    const before = fs.readFileSync(path.join(target(), "SKILL.md"), "utf8");
    const owned = manager.store.read().skills;
    source("plugin-creator", " New bundle.");
    const plan = manager.plan({ operation: "update", name: "plugin-creator", projectDir: project });
    const write = manager.store.write.bind(manager.store);
    let writes = 0;
    vi.spyOn(manager.store, "write").mockImplementation((manifest) => {
      if (++writes === 2) throw new Error("Simulated disk failure");
      write(manifest);
    });
    expect(() => manager.apply(plan.id)).toThrow("Simulated disk failure");
    expect(fs.readFileSync(path.join(target(), "SKILL.md"), "utf8")).toBe(before);
    expect(manager.store.read().skills).toEqual(owned);
    expect(manager.snapshot(project).diagnostics.some((entry) => entry.code === "recovery")).toBe(
      true,
    );
    expect(fs.readdirSync(manager.store.managedRoot).some((name) => name.startsWith("."))).toBe(
      false,
    );
  });

  it("rejects malformed manifests, escaped ownership paths, duplicate entries and unsafe file paths", () => {
    apply("install");
    const valid = manager.store.read();
    for (const modify of [
      (value: typeof valid) => {
        value.skills[0].canonicalTarget = root;
      },
      (value: typeof valid) => {
        value.skills.push(value.skills[0]);
      },
      (value: typeof valid) => {
        value.skills[0].files[0].relativePath = "../outside";
      },
      (value: typeof valid) => {
        value.skills[0].files[0].relativePath = "C:/outside";
      },
      (value: typeof valid) => {
        value.skills[0].files[0].installedHash = "invalid";
      },
    ]) {
      const invalid = structuredClone(valid);
      modify(invalid);
      file(manager.store.manifestPath, JSON.stringify(invalid));
      expect(manager.snapshot(project).diagnostics[0].code).toBe("manifest");
      expect(() =>
        manager.plan({ operation: "uninstall", name: "plugin-creator", projectDir: project }),
      ).toThrow();
    }
    file(manager.store.manifestPath, "{broken");
    expect(manager.snapshot(project).manifest).toBeNull();
  });

  it("preserves ownership from the original manifest without a migration write", () => {
    apply("install");
    const legacy = manager.store.read();
    delete legacy.skills[0].state;
    legacy.skills[0].lastLoaderResult = "loaded";
    manager.store.write(legacy);
    const before = fs.readFileSync(manager.store.manifestPath, "utf8");
    expect(manager.snapshot(project).manifest).toEqual(legacy);
    expect(fs.readFileSync(manager.store.manifestPath, "utf8")).toBe(before);
    apply("install", "skill-creator");
    expect(manager.store.read().skills.find((entry) => entry.name === "plugin-creator")).toEqual(
      legacy.skills[0],
    );
  });

  it("installs the actual shipped assets and exposes both skills through the native loader", async () => {
    const bundled = fileURLToPath(new URL("../../../assets/skills", import.meta.url));
    manager = new ManagedSkills({
      agentDir: fixture.agentDir,
      sourceRoot: bundled,
      version: "test",
      discover: (cwd) => discoverDurableResources(cwd, home),
    });
    apply("install");
    apply("install", "skill-creator");
    const result = await loadSessionResources(project, discoverDurableResources(project, home));
    expect(result.commands.map((entry) => entry.name).sort()).toEqual([
      "skill:plugin-creator",
      "skill:skill-creator",
    ]);
    expect(fs.existsSync(path.join(target(), "references/durable-extension.md"))).toBe(true);
    const expanded = await result.commands
      .find((entry) => entry.name === "skill:plugin-creator")
      ?.expand("");
    expect(expanded).toContain("PiDesk Durable extension creator");
    expect(expanded).toContain("pidesk.runtime");
    expect(expanded).not.toContain("Use Pi's `ExtensionAPI`");
    expect(manager.snapshot(project).diagnostics).toEqual([]);
    expect(manager.snapshot(project).items.every((item) => item.diagnostics.length === 0)).toBe(
      true,
    );
  });

  it("rechecks user files after staging and leaves concurrent edits intact", () => {
    apply("install");
    source("plugin-creator", " New version.");
    const plan = manager.plan({ operation: "update", name: "plugin-creator", projectDir: project });
    const copy = fs.copyFileSync;
    let changed = false;
    vi.spyOn(fs, "copyFileSync").mockImplementation((from, to, mode) => {
      copy(from, to, mode);
      if (!changed) {
        changed = true;
        fs.appendFileSync(path.join(target(), "SKILL.md"), "Concurrent edit.");
      }
    });
    expect(() => manager.apply(plan.id)).toThrow("PIDESK_SKILLS:stale");
    expect(fs.readFileSync(path.join(target(), "SKILL.md"), "utf8")).toContain("Concurrent edit.");
    expect(manager.store.read().recovery).toBeUndefined();
    expect(fs.readdirSync(manager.store.managedRoot).some((name) => name.startsWith("."))).toBe(
      false,
    );
  });

  it("never follows a linked managed ancestor or bundled source", () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.mkdirSync(fixture.agentDir);
    fs.symlinkSync(outside, path.join(fixture.agentDir, "skills"), "junction");
    expect(manager.snapshot(project).manifest).toBeNull();
    expect(() =>
      manager.plan({ operation: "install", name: "plugin-creator", projectDir: project }),
    ).toThrow();
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(path.join(fixture.agentDir, "skills"));
    fs.rmSync(path.join(sourceRoot, "plugin-creator"), { recursive: true });
    fs.symlinkSync(outside, path.join(sourceRoot, "plugin-creator"), "junction");
    expect(
      manager.plan({ operation: "install", name: "plugin-creator", projectDir: project }).canApply,
    ).toBe(false);
  });

  it("retains linked installed descendants and never deletes their destinations", () => {
    apply("install");
    const outside = path.join(root, "outside");
    file(path.join(outside, "important.txt"), "Do not delete.");
    fs.rmSync(path.join(target(), "references"), { recursive: true });
    fs.symlinkSync(outside, path.join(target(), "references"), "junction");
    expect(
      manager.plan({ operation: "repair", name: "plugin-creator", projectDir: project }).canApply,
    ).toBe(false);
    expect(apply("uninstall").preserved).toBe(true);
    expect(fs.readFileSync(path.join(outside, "important.txt"), "utf8")).toBe("Do not delete.");
  });
});
