import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { ManagedFile, SkillsManifest } from "./types.ts";

export const MANIFEST_FILENAME = "codex-skills-manifest.json";

export function hashContent(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

export async function hashFile(path: string): Promise<string> {
	return hashContent(await readFile(path));
}

export function defaultManifest(managedRoot: string, extensionVersion: string): SkillsManifest {
	return { schemaVersion: 1, extensionVersion, piMinimumVersion: "0.80.10", codexResearchBaseline: "0.144.5", bridgeMode: "disabled", managedRoot, skills: [] };
}

export function readManifest(path: string, managedRoot: string, extensionVersion: string): SkillsManifest {
	if (!existsSync(path)) return defaultManifest(managedRoot, extensionVersion);
	const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!isManifest(parsed)) throw new Error(`Invalid managed-skills manifest: ${path}`);
	validateManifestPaths(parsed, managedRoot);
	return parsed;
}

function isManifest(value: unknown): value is SkillsManifest {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SkillsManifest>;
	return candidate.schemaVersion === 1
		&& typeof candidate.extensionVersion === "string"
		&& candidate.piMinimumVersion === "0.80.10"
		&& candidate.codexResearchBaseline === "0.144.5"
		&& candidate.bridgeMode === "disabled"
		&& typeof candidate.managedRoot === "string"
		&& Array.isArray(candidate.skills);
}

function validateManifestPaths(manifest: SkillsManifest, managedRoot: string): void {
	const root = resolve(managedRoot);
	if (resolve(manifest.managedRoot) !== root) throw new Error("Manifest managed root does not match this Pi agent directory");
	for (const skill of manifest.skills) {
		if (!/^[a-z0-9-]+$/.test(skill.name)) throw new Error(`Unsafe manifest skill name: ${skill.name}`);
		const target = resolve(skill.canonicalTarget);
		const rel = relative(root, target);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Manifest skill target escapes managed root: ${skill.canonicalTarget}`);
		if (target !== resolve(root, skill.name)) throw new Error(`Manifest skill target does not match its name: ${skill.canonicalTarget}`);
		validateManagedFiles(skill.files);
	}
}

export async function writeManifest(path: string, manifest: SkillsManifest): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const staged = `${path}.staging-${process.pid}`;
	const backup = `${path}.backup-${process.pid}`;
	await writeFile(staged, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	try {
		if (existsSync(path)) await rename(path, backup);
		await rename(staged, path);
		await rm(backup, { force: true });
	} catch (error) {
		if (existsSync(backup) && !existsSync(path)) await rename(backup, path);
		throw error;
	} finally {
		await rm(staged, { force: true });
	}
}

export function ensureContainedPath(root: string, target: string): string {
	if (!existsSync(root)) throw new Error(`Managed root does not exist: ${root}`);
	const resolvedRoot = realpathSync(root);
	const resolvedTarget = resolve(target);
	const rel = relative(resolvedRoot, resolvedTarget);
	if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || resolve(resolvedRoot, rel) !== resolvedTarget) {
		throw new Error(`Target escapes managed root: ${target}`);
	}
	return resolvedTarget;
}

export function validateManagedFiles(files: ManagedFile[]): void {
	for (const file of files) {
		if (!file.relativePath) throw new Error("Managed file path is empty");
		const normalized = file.relativePath.replaceAll("\\", "/");
		if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
			throw new Error(`Unsafe managed relative path: ${file.relativePath}`);
		}
	}
}
