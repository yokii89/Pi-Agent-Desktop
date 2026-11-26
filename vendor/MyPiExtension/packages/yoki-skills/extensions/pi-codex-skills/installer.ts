import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { bundledSkillDirectory, collectFiles, validatePiSkillSource } from "./catalog.ts";
import { ensureContainedPath, hashContent, readManifest, validateManagedFiles, writeManifest } from "./manifest.ts";
import type { DoctorDiagnostic, InstallPlan, ManagedSkill, SkillCommand, SkillsManifest } from "./types.ts";

export interface InstallerOptions {
	packageRoot: string;
	agentDir: string;
	extensionVersion: string;
}

export class ManagedSkillInstaller {
	readonly managedRoot: string;
	readonly manifestPath: string;
	private readonly options: InstallerOptions;

	constructor(options: InstallerOptions) {
		this.options = options;
		this.managedRoot = join(options.agentDir, "skills", "codex-managed");
		this.manifestPath = join(options.agentDir, "codex-skills-manifest.json");
	}

	readManifest(): SkillsManifest {
		return readManifest(this.manifestPath, this.managedRoot, this.options.extensionVersion);
	}

	plan(operation: InstallPlan["operation"], name: string, commands: SkillCommand[]): InstallPlan {
		const manifest = this.readManifest();
		const source = bundledSkillDirectory(this.options.packageRoot, name);
		const files = collectFiles(source).map((file) => ({ ...file, installedHash: file.sourceHash }));
		const target = this.targetFor(name);
		validateManagedFiles(files);
		const diagnostics = validatePiSkillSource(source);
		const existing = manifest.skills.find((skill) => skill.name === name);
		const command = commands.find((item) => item.name === `skill:${name}`);
		if (existsSync(target) && !existing) {
			diagnostics.push({
				category: "manifest-drift",
				severity: "error",
				message: `${name} already has an unmanaged target directory.`,
				nextStep: "Move or remove the unmanaged directory before installing this managed skill.",
				path: target,
			});
		}
		if (command && (!existing || resolve(command.path) !== resolve(target, "SKILL.md"))) {
			diagnostics.push({ category: "collision", severity: "error", message: `Pi already loads ${name} from ${command.path}.`, nextStep: "Rename or remove the colliding skill before installing.", path: command.path });
		}
		if (operation === "uninstall" && !existing) {
			diagnostics.push({ category: "manifest-drift", severity: "error", message: `${name} is not managed by this extension.`, nextStep: "Choose an installed managed skill.", path: target });
		}
		if ((operation === "update" || operation === "repair") && !existing) {
			diagnostics.push({ category: "manifest-drift", severity: "error", message: `${name} has no managed installation to ${operation}.`, nextStep: "Install it first.", path: target });
		}
		if (existing) {
			const drift = this.driftDiagnostics(existing);
			diagnostics.push(...drift);
			if ((operation === "update" || operation === "repair") && drift.some((item) => item.severity === "error" || (operation === "update" && item.severity === "warning"))) {
				const operationLabel = operation === "repair" ? "repaired" : "updated";
				diagnostics.push({
					category: "manifest-drift",
					severity: "error",
					message: `${name} cannot be ${operationLabel} until its installed files exactly match the manifest.`,
					nextStep: "Resolve user changes before replacing this managed skill.",
					path: existing.canonicalTarget,
				});
			}
		}
		const blockingDiagnostics = diagnostics.filter(
			(item) => item.severity === "error" && !(operation === "uninstall" && item.category === "manifest-drift"),
		);
		return { operation, skill: name, target, files, diagnostics, canApply: blockingDiagnostics.length === 0 };
	}

	private driftDiagnostics(skill: ManagedSkill): DoctorDiagnostic[] {
		const diagnostics: DoctorDiagnostic[] = [];
		if (!existsSync(skill.canonicalTarget)) return [{ category: "manifest-drift", severity: "warning", message: `${skill.name} target is missing.`, nextStep: "Use repair to restore the managed files.", path: skill.canonicalTarget }];
		if (lstatSync(skill.canonicalTarget).isSymbolicLink()) {
			return [{ category: "manifest-drift", severity: "error", message: `${skill.name} target is a symbolic link.`, nextStep: "Remove the link before managing this skill.", path: skill.canonicalTarget }];
		}
		for (const file of skill.files) {
			const path = join(skill.canonicalTarget, file.relativePath);
			if (!existsSync(path) || lstatSync(path).isSymbolicLink()) {
				diagnostics.push({ category: "manifest-drift", severity: "error", message: `${file.relativePath} is missing or linked.`, nextStep: "Restore the directory manually or remove it before repair.", path });
				continue;
			}
			if (hashFileSync(path) !== file.installedHash) diagnostics.push({ category: "manifest-drift", severity: "error", message: `${file.relativePath} was modified.`, nextStep: "Keep the user change or restore the expected file before updating.", path });
		}
		if (diagnostics.length === 0 && hasUnexpectedFiles(skill.canonicalTarget, new Set(skill.files.map((file) => file.relativePath)))) diagnostics.push({ category: "manifest-drift", severity: "error", message: "Managed directory has extra files or an unsafe linked entry.", nextStep: "Move or remove extra files before updating.", path: skill.canonicalTarget });
		return diagnostics;
	}

	async apply(plan: InstallPlan): Promise<void> {
		if (!plan.canApply) throw new Error("Cannot apply an unsafe skill plan");
		mkdirSync(this.managedRoot, { recursive: true });
		if (lstatSync(this.managedRoot).isSymbolicLink()) throw new Error(`Managed root must not be a symbolic link: ${this.managedRoot}`);
		ensureContainedPath(this.managedRoot, plan.target);
		const manifest = this.readManifest();
		manifest.recovery = { operation: plan.operation, skill: plan.skill, stage: "started", message: "Write operation started.", at: new Date().toISOString() };
		await writeManifest(this.manifestPath, manifest);
		try {
			if (plan.operation === "uninstall") this.uninstall(plan, manifest);
			else this.install(plan, manifest);
			manifest.recovery = undefined;
			await writeManifest(this.manifestPath, manifest);
		} catch (error) {
			manifest.recovery = { operation: plan.operation, skill: plan.skill, stage: "failed", message: error instanceof Error ? error.message : "Unknown write failure", at: new Date().toISOString() };
			await writeManifest(this.manifestPath, manifest);
			throw error;
		}
	}

	async recordLoaderResult(name: string, result: ManagedSkill["lastLoaderResult"]): Promise<void> {
		const manifest = this.readManifest();
		const skill = manifest.skills.find((item) => item.name === name);
		if (!skill) return;
		skill.lastLoaderResult = result;
		await writeManifest(this.manifestPath, manifest);
	}

	private targetFor(name: string): string {
		if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unsafe skill name: ${name}`);
		const root = resolve(this.managedRoot);
		if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error(`Managed root must not be a symbolic link: ${root}`);
		const target = resolve(root, name);
		const rel = relative(root, target);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Target escapes managed root: ${target}`);
		return target;
	}

	private install(plan: InstallPlan, manifest: SkillsManifest): void {
		mkdirSync(this.managedRoot, { recursive: true });
		const source = bundledSkillDirectory(this.options.packageRoot, plan.skill);
		const stage = join(this.managedRoot, `.${plan.skill}.staging-${process.pid}`);
		const backup = join(this.managedRoot, `.${plan.skill}.backup-${process.pid}`);
		if (existsSync(stage) || existsSync(backup)) throw new Error("Stale staging or backup directory exists; inspect recovery state first.");
		cpSync(source, stage, { recursive: true, dereference: false, errorOnExist: true });
		for (const file of plan.files) {
			const staged = join(stage, file.relativePath);
			if (!existsSync(staged) || lstatSync(staged).isSymbolicLink() || hashFileSync(staged) !== file.sourceHash) throw new Error(`Staging verification failed: ${file.relativePath}`);
		}
		const sourceDiagnostics = validatePiSkillSource(stage);
		if (sourceDiagnostics.some((item) => item.severity === "error")) throw new Error(sourceDiagnostics.map((item) => item.message).join(" "));
		if (existsSync(plan.target)) {
			const current = manifest.skills.find((item) => item.name === plan.skill);
			if (!current || resolve(current.canonicalTarget) !== resolve(plan.target) || this.driftDiagnostics(current).length > 0) {
				throw new Error("Refusing to replace an unmanaged or modified skill directory.");
			}
			renameSync(plan.target, backup);
		}
		try {
			renameSync(stage, plan.target);
			rmSync(backup, { recursive: true, force: true });
		} catch (error) {
			if (existsSync(backup) && !existsSync(plan.target)) renameSync(backup, plan.target);
			throw error;
		} finally {
			rmSync(stage, { recursive: true, force: true });
		}
		const entry: ManagedSkill = { name: plan.skill, source: "bundle", compatibility: "ready", canonicalTarget: plan.target, files: plan.files, installedAt: new Date().toISOString(), lastLoaderResult: "pending", state: "installed" };
		manifest.skills = [...manifest.skills.filter((item) => item.name !== plan.skill), entry];
	}

	private uninstall(plan: InstallPlan, manifest: SkillsManifest): void {
		const entry = manifest.skills.find((item) => item.name === plan.skill);
		if (!entry) throw new Error("Managed skill is missing from manifest");
		const drift = this.driftDiagnostics(entry);
		if (drift.length > 0) {
			entry.state = "orphaned-user-modified";
			manifest.skills = [...manifest.skills.filter((item) => item.name !== plan.skill), entry];
			return;
		}
		rmSync(entry.canonicalTarget, { recursive: true, force: false });
		manifest.skills = manifest.skills.filter((item) => item.name !== plan.skill);
	}
}

function hashFileSync(path: string): string {
	return hashContent(readFileSync(path));
}

function hasUnexpectedFiles(root: string, expected: Set<string>): boolean {
	const found: string[] = [];
	function walk(dir: string, prefix: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const child = prefix ? `${prefix}/${entry.name}` : entry.name;
			const path = join(dir, entry.name);
			if (entry.isSymbolicLink()) found.push(child);
			else if (entry.isDirectory()) walk(path, child);
			else found.push(child);
		}
	}
	walk(root, "");
	return found.some((file) => !expected.has(file));
}
