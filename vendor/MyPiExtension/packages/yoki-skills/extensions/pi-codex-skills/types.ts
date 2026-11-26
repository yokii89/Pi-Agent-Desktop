export type CompatibilityStatus = "ready" | "needs-adapter" | "blocked";
export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DoctorDiagnostic {
	category: "discovery" | "frontmatter" | "collision" | "manifest-drift" | "compatibility" | "command-state";
	severity: DiagnosticSeverity;
	message: string;
	nextStep: string;
	path?: string;
}

export interface ManagedFile {
	relativePath: string;
	sourceHash: string;
	installedHash: string;
}

export interface ManagedSkill {
	name: string;
	source: "bundle";
	compatibility: "ready";
	canonicalTarget: string;
	files: ManagedFile[];
	installedAt: string;
	lastLoaderResult: "pending" | "loaded" | "missing-command" | "reload-failed";
	state?: "installed" | "orphaned-user-modified";
}

export interface RecoveryRecord {
	operation: "install" | "update" | "repair" | "uninstall";
	skill: string;
	stage: string;
	message: string;
	at: string;
}

export interface SkillsManifest {
	schemaVersion: 1;
	extensionVersion: string;
	piMinimumVersion: "0.80.10";
	codexResearchBaseline: "0.144.5";
	bridgeMode: "disabled";
	managedRoot: string;
	skills: ManagedSkill[];
	recovery?: RecoveryRecord;
}

export interface BundledSkill {
	name: string;
	compatibility: CompatibilityStatus;
	reason: string;
	smokeCase: string;
}

export interface CompatibilityAudit {
	name: string;
	status: CompatibilityStatus;
	toolMapping: string;
	permissionModel: string;
	relativeResourceCheck: string;
	smokeCase: string;
}

export interface SkillCommand {
	name: string;
	description?: string;
	path: string;
	sourceInfo?: {
		source: string;
		scope: "user" | "project" | "temporary";
		origin: "package" | "top-level";
	};
}

export interface InstallPlan {
	operation: "install" | "update" | "repair" | "uninstall";
	skill: string;
	target: string;
	files: ManagedFile[];
	diagnostics: DoctorDiagnostic[];
	canApply: boolean;
}
