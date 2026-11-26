import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ManagedSkillInstaller } from "../extensions/pi-codex-skills/installer.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("managed installation writes only under codex-managed and records hashes", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir: join(home, "agent"), extensionVersion: "test" });
		const plan = installer.plan("install", "plugin-creator", []);
		assert.equal(plan.canApply, true);
		assert.match(plan.target, /skills[\\/]codex-managed[\\/]plugin-creator$/);
		await installer.apply(plan);
		const manifest = installer.readManifest();
		assert.equal(manifest.skills.length, 1);
		assert.ok(manifest.skills[0]?.files.some((file) => file.relativePath === "SKILL.md"));
		const installed = await readFile(join(plan.target, "SKILL.md"), "utf8");
		assert.match(installed, /name:\s*plugin-creator/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("installer refuses a Pi command collision and preserves user modifications", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir: join(home, "agent"), extensionVersion: "test" });
		const collision = installer.plan("install", "plugin-creator", [{ name: "skill:plugin-creator", path: join(home, "other", "SKILL.md") }]);
		assert.equal(collision.canApply, false);
		const install = installer.plan("install", "plugin-creator", []);
		await installer.apply(install);
		await writeFile(join(install.target, "SKILL.md"), "changed", "utf8");
		const update = installer.plan("update", "plugin-creator", []);
		assert.equal(update.canApply, false);
		assert.match(update.diagnostics.map((item) => item.message).join("\n"), /modified/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("uninstall preserves a modified directory and records it as orphaned", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir: join(home, "agent"), extensionVersion: "test" });
		const install = installer.plan("install", "plugin-creator", []);
		await installer.apply(install);
		await writeFile(join(install.target, "SKILL.md"), "user content", "utf8");
		const uninstall = installer.plan("uninstall", "plugin-creator", []);
		assert.equal(uninstall.canApply, true);
		await installer.apply(uninstall);
		const manifest = installer.readManifest();
		assert.equal(manifest.skills[0]?.state, "orphaned-user-modified");
		assert.equal(await readFile(join(install.target, "SKILL.md"), "utf8"), "user content");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("installer rejects a manifest that tries to target outside codex-managed", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const agentDir = join(home, "agent");
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir, extensionVersion: "test" });
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "codex-skills-manifest.json"),
			JSON.stringify({ schemaVersion: 1, extensionVersion: "test", piMinimumVersion: "0.80.10", codexResearchBaseline: "0.144.5", bridgeMode: "disabled", managedRoot: join(agentDir, "skills", "codex-managed"), skills: [{ name: "plugin-creator", source: "bundle", compatibility: "ready", canonicalTarget: home, files: [], installedAt: "now", lastLoaderResult: "pending" }] }),
			"utf8",
		);
		assert.throws(() => installer.readManifest(), /escapes managed root/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("installer rejects a manifest target that is inside codex-managed but belongs to another skill", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const agentDir = join(home, "agent");
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir, extensionVersion: "test" });
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "codex-skills-manifest.json"),
			JSON.stringify({ schemaVersion: 1, extensionVersion: "test", piMinimumVersion: "0.80.10", codexResearchBaseline: "0.144.5", bridgeMode: "disabled", managedRoot: join(agentDir, "skills", "codex-managed"), skills: [{ name: "plugin-creator", source: "bundle", compatibility: "ready", canonicalTarget: join(agentDir, "skills", "codex-managed", "other-skill"), files: [], installedAt: "now", lastLoaderResult: "pending" }] }),
			"utf8",
		);
		assert.throws(() => installer.readManifest(), /does not match its name/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("installer never replaces an unmanaged target and update rejects a missing target", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir: join(home, "agent"), extensionVersion: "test" });
		const unmanagedTarget = join(home, "agent", "skills", "codex-managed", "plugin-creator");
		await mkdir(unmanagedTarget, { recursive: true });
		await writeFile(join(unmanagedTarget, "SKILL.md"), "unmanaged", "utf8");
		const blockedInstall = installer.plan("install", "plugin-creator", []);
		assert.equal(blockedInstall.canApply, false);
		assert.match(blockedInstall.diagnostics.map((item) => item.message).join("\n"), /unmanaged target/);

		await rm(unmanagedTarget, { recursive: true, force: true });
		const install = installer.plan("install", "plugin-creator", []);
		await installer.apply(install);
		await rm(install.target, { recursive: true, force: true });
		const update = installer.plan("update", "plugin-creator", []);
		assert.equal(update.canApply, false);
		assert.match(update.diagnostics.map((item) => item.message).join("\n"), /cannot be updated/);
		const repair = installer.plan("repair", "plugin-creator", []);
		assert.equal(repair.canApply, true);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("repair refuses to overwrite a user-modified managed file", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir: join(home, "agent"), extensionVersion: "test" });
		const install = installer.plan("install", "plugin-creator", []);
		await installer.apply(install);
		await writeFile(join(install.target, "SKILL.md"), "user content", "utf8");
		const repair = installer.plan("repair", "plugin-creator", []);
		assert.equal(repair.canApply, false);
		assert.match(repair.diagnostics.map((item) => item.message).join("\n"), /cannot be repaired/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("installer rejects a linked managed root", async (context) => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const agentDir = join(home, "agent");
		const managedRoot = join(agentDir, "skills", "codex-managed");
		const linkedDestination = join(home, "outside");
		await mkdir(join(agentDir, "skills"), { recursive: true });
		await mkdir(linkedDestination);
		try {
			await symlink(linkedDestination, managedRoot, process.platform === "win32" ? "junction" : "dir");
		} catch (error) {
			const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown error";
			context.skip(`Cannot create directory links in this environment: ${code}`);
			return;
		}
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir, extensionVersion: "test" });
		assert.throws(() => installer.plan("install", "plugin-creator", []), /Managed root must not be a symbolic link/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("reload failures are persistable manifest state", async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-"));
	try {
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir: join(home, "agent"), extensionVersion: "test" });
		const plan = installer.plan("install", "plugin-creator", []);
		await installer.apply(plan);
		await installer.recordLoaderResult("plugin-creator", "reload-failed");
		assert.equal(installer.readManifest().skills[0]?.lastLoaderResult, "reload-failed");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
