import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { hashContent } from "./manifest.ts";
import type { BundledSkill, CompatibilityAudit, DoctorDiagnostic, ManagedFile, SkillCommand, SkillsManifest } from "./types.ts";

export const BUNDLED_SKILLS: readonly BundledSkill[] = [
	{
		name: "plugin-creator",
		compatibility: "ready",
		reason: "Creates Pi extension packages and explicitly excludes Codex plugin and marketplace semantics.",
		smokeCase: "Install into a clean Pi home, verify /skill:plugin-creator, and request a minimal Pi extension package plan.",
	},
	{
		name: "skill-creator",
		compatibility: "ready",
		reason: "Targets Pi skill paths and validates Pi-compatible frontmatter without hidden system deployment paths.",
		smokeCase: "Install into a clean Pi home, verify /skill:skill-creator, and request a project-local Pi skill outline.",
	},
];

export const CODEX_SOURCE_AUDIT: readonly CompatibilityAudit[] = [
	{ name: "plugin-creator", status: "ready", toolMapping: "Creates Pi extension packages only; Codex plugin/marketplace semantics are excluded.", permissionModel: "Writes require user confirmation for package scaffolding paths.", relativeResourceCheck: "Scripts use package-relative paths only.", smokeCase: "Clean Pi home: /skill:plugin-creator produces a Pi extension package plan." },
	{ name: "skill-creator", status: "ready", toolMapping: "Creates and validates Pi skills under project-local skill paths.", permissionModel: "Writes require user confirmation for skill scaffolding paths.", relativeResourceCheck: "Retained helpers are package-relative; no CODEX_HOME deployment path.", smokeCase: "Clean Pi home: /skill:skill-creator outlines a project-local Pi skill." },
];

export function bundledSkillDirectory(packageRoot: string, name: string): string {
	const entry = BUNDLED_SKILLS.find((skill) => skill.name === name && skill.compatibility === "ready");
	if (!entry) throw new Error(`Skill is not installable: ${name}`);
	return resolve(packageRoot, "skills", name);
}

export function collectFiles(root: string): ManagedFile[] {
	const files: ManagedFile[] = [];
	function visit(dir: string, prefix: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) throw new Error(`Hidden bundled file is not allowed: ${entry.name}`);
			const fullPath = join(dir, entry.name);
			const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				visit(fullPath, relativePath);
			} else if (entry.isFile()) {
				files.push({ relativePath, sourceHash: hashContent(readFileSync(fullPath)), installedHash: "" });
			} else {
				throw new Error(`Bundled skill must not contain a link or special file: ${fullPath}`);
			}
		}
	}
	visit(root, "");
	return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function validatePiSkillSource(root: string): DoctorDiagnostic[] {
	const file = join(root, "SKILL.md");
	const diagnostics: DoctorDiagnostic[] = [];
	if (!existsSync(file)) {
		return [{ category: "frontmatter", severity: "error", message: "SKILL.md is missing.", nextStep: "Add a Pi-compatible SKILL.md.", path: file }];
	}
	const stat = lstatSync(file);
	if (stat.isSymbolicLink() || !stat.isFile()) {
		return [{ category: "frontmatter", severity: "error", message: "SKILL.md must be a regular file.", nextStep: "Replace the link with a regular file.", path: file }];
	}
	const content = readFileSync(file, "utf8");
	const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
	const name = frontmatter?.[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
	const disableModelInvocation = frontmatter?.[1].match(/^disable-model-invocation:\s*(.+)$/m)?.[1]?.trim();
	if (!frontmatter || !description) {
		diagnostics.push({ category: "frontmatter", severity: "error", message: "Pi requires YAML frontmatter with description.", nextStep: "Add a non-empty description field.", path: file });
	}
	if (description && description.length > 1024) diagnostics.push({ category: "frontmatter", severity: "warning", message: "Description exceeds Codex's 1024-character compatibility limit.", nextStep: "Shorten the description before treating this as Codex-compatible.", path: file });
	if (name && (!/^[A-Za-z0-9_-]+$/.test(name) || name.length > 64)) diagnostics.push({ category: "frontmatter", severity: "warning", message: "Name is outside Codex's compatible 64-character identifier format.", nextStep: "Use a 64-character-or-shorter letter, number, underscore, or hyphen name.", path: file });
	if (disableModelInvocation && disableModelInvocation !== "true" && disableModelInvocation !== "false") diagnostics.push({ category: "frontmatter", severity: "warning", message: "disable-model-invocation must be true or false when present.", nextStep: "Use a YAML boolean value.", path: file });
	if (existsSync(join(root, "agents", "openai.yaml"))) diagnostics.push({ category: "frontmatter", severity: "info", message: "Codex openai.yaml metadata is present but is not interpreted by Pi.", nextStep: "Do not rely on openai.yaml for Pi UI, dependency, or policy behavior.", path: join(root, "agents", "openai.yaml") });
	return diagnostics;
}

export function doctor(manifest: SkillsManifest, commands: SkillCommand[]): DoctorDiagnostic[] {
	const diagnostics: DoctorDiagnostic[] = [{
		category: "discovery",
		severity: "info",
		message: `Pi currently exposes ${commands.length} loaded skill command${commands.length === 1 ? "" : "s"}.`,
		nextStep: "Use Browse to prefill only a command Pi has actually loaded.",
	}];
	for (const audit of CODEX_SOURCE_AUDIT.filter((item) => item.status !== "ready")) {
		diagnostics.push({ category: "compatibility", severity: audit.status === "blocked" ? "warning" : "info", message: `${audit.name}: ${audit.status}. ${audit.toolMapping}`, nextStep: audit.smokeCase });
	}
	for (const skill of manifest.skills) {
		if (!existsSync(skill.canonicalTarget)) {
			diagnostics.push({ category: "manifest-drift", severity: "warning", message: `${skill.name} managed target is missing.`, nextStep: "Use /skills repair to restore the missing target.", path: skill.canonicalTarget });
		} else {
			diagnostics.push(...validatePiSkillSource(skill.canonicalTarget));
			for (const file of skill.files) {
				const installedPath = join(skill.canonicalTarget, file.relativePath);
				if (!existsSync(installedPath) || lstatSync(installedPath).isSymbolicLink()) {
					diagnostics.push({ category: "manifest-drift", severity: "warning", message: `${skill.name} has a missing or linked managed file: ${file.relativePath}.`, nextStep: "Restore the expected regular file before updating.", path: installedPath });
				} else if (hashContent(readFileSync(installedPath)) !== file.installedHash) {
					diagnostics.push({ category: "manifest-drift", severity: "warning", message: `${skill.name} has a user-modified managed file: ${file.relativePath}.`, nextStep: "Keep the user change or restore the manifest hash before updating.", path: installedPath });
				}
			}
		}
		const command = commands.find((item) => item.name === `skill:${skill.name}`);
		if (!command) diagnostics.push({ category: "command-state", severity: "warning", message: `${skill.name} is managed but not loaded by Pi.`, nextStep: "Run /reload and inspect Pi diagnostics.", path: skill.canonicalTarget });
		else if (resolve(command.path) !== resolve(skill.canonicalTarget, "SKILL.md")) diagnostics.push({ category: "collision", severity: "error", message: `${skill.name} is shadowed by another Pi skill.`, nextStep: "Rename or remove the colliding skill before updating.", path: command.path });
	}
	return diagnostics;
}
