import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("../session/piInfo", () => ({ getPiAgentDir: () => fixture.agentDir }));

import { discoverDurableResources } from "./durableResources";
import { setPackageResourceEnabled } from "./packageStore";

let root: string;
let project: string;
let home: string;
async function file(name: string, content = "Skill content") {
  await mkdir(path.dirname(name), { recursive: true });
  await writeFile(name, content);
  return name;
}
async function json(name: string, value: unknown) {
  return file(name, JSON.stringify(value));
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pidesk-resource-discovery-"));
  fixture.agentDir = path.join(root, "agent");
  project = path.join(root, "workspace");
  home = path.join(root, "home");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Durable resource discovery", () => {
  it("uses enabled package, local and shared resources at both scopes without importing extensions", async () => {
    const pkg = path.join(root, "package");
    await json(path.join(pkg, "package.json"), {
      name: "resources",
      pi: { skills: ["skills/direct", "standalone.md"], prompts: ["prompts"] },
    });
    const skill = await file(path.join(pkg, "skills/direct/SKILL.md"));
    const standalone = await file(path.join(pkg, "standalone.md"));
    const prompt = await file(path.join(pkg, "prompts/review.md"));
    await file(path.join(pkg, "index.ts"), `throw Error('must not import');`);
    const user = await file(path.join(fixture.agentDir, "skills/local/SKILL.md"));
    await file(path.join(fixture.agentDir, "skills/disabled/SKILL.md"));
    const shared = await file(path.join(home, ".agents/skills/shared/SKILL.md"));
    const local = await file(path.join(project, ".pi/prompts/project.md"));
    const projectShared = await file(path.join(project, ".agents/skills/project/SKILL.md"));
    await json(path.join(fixture.agentDir, "settings.json"), {
      packages: [pkg],
      skills: ["-skills/disabled/SKILL.md"],
    });
    const result = discoverDurableResources(project, home);
    expect(result.map((item) => item.file).sort()).toEqual(
      [skill, standalone, prompt, user, shared, local, projectShared].sort(),
    );
    expect(result.find((item) => item.file === projectShared)?.scope).toBe("project");
    expect(existsSync(path.join(root, "imported"))).toBe(false);
    setPackageResourceEnabled({
      source: pkg,
      scope: "user",
      kind: "skills",
      relativePath: "skills/direct",
      enabled: false,
    });
    expect(discoverDurableResources(project, home).map((item) => item.file)).not.toContain(skill);
    await json(path.join(fixture.agentDir, "settings.json"), {
      packages: [{ source: pkg, extensions: [], skills: [], prompts: [], themes: [] }],
      skills: ["-skills/disabled/SKILL.md"],
    });
    expect(discoverDurableResources(project, home).some((item) => item.root === pkg)).toBe(false);
  });

  it("deduplicates a package listed twice and follows explicit local links without looping", async () => {
    const pkg = path.join(root, "package");
    await json(path.join(pkg, "package.json"), { name: "resources" });
    const skill = await file(path.join(pkg, "skills/linked/SKILL.md"));
    await json(path.join(fixture.agentDir, "settings.json"), { packages: [pkg, pkg] });
    await mkdir(path.join(fixture.agentDir, "skills"), { recursive: true });
    await symlink(
      path.join(pkg, "skills/linked"),
      path.join(fixture.agentDir, "skills/alias"),
      "junction",
    );
    await symlink(
      path.join(fixture.agentDir, "skills"),
      path.join(fixture.agentDir, "skills/loop"),
      "junction",
    );
    expect(discoverDurableResources(project, home).map((item) => item.file)).toEqual([skill]);
  });

  it("loads explicit paths relative to their settings scope and applies overrides", async () => {
    const custom = await file(path.join(home, "custom/alpha/SKILL.md"));
    await file(path.join(home, "custom/disabled/SKILL.md"));
    const prompt = await file(path.join(project, "templates/check.md"));
    await json(path.join(fixture.agentDir, "settings.json"), {
      skills: ["~/custom", `-${path.join(home, "custom/disabled/SKILL.md").replaceAll("\\", "/")}`],
    });
    await json(path.join(project, ".pi/settings.json"), { prompts: ["../templates/check.md"] });
    const result = discoverDurableResources(project, home);
    expect(result.map((item) => item.file).sort()).toEqual([custom, prompt].sort());
    expect(result.find((item) => item.file === prompt)?.scope).toBe("project");
  });

  it("rejects a package resource escaping its package through a junction", async () => {
    const pkg = path.join(root, "package");
    const outside = path.join(root, "outside");
    await file(path.join(outside, "escape.md"));
    await json(path.join(pkg, "package.json"), { name: "resources", pi: { prompts: ["link"] } });
    await symlink(outside, path.join(pkg, "link"), "junction");
    await json(path.join(fixture.agentDir, "settings.json"), { packages: [pkg] });
    expect(() => discoverDurableResources(project, home)).toThrow("PIDESK_RESOURCE:invalid");
  });
});
