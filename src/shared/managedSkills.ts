import type { IpcResult } from "./ipc";

export const MANAGED_SKILL_OPERATIONS = ["install", "update", "repair", "uninstall"] as const;
export type ManagedSkillOperation = (typeof MANAGED_SKILL_OPERATIONS)[number];
export type ManagedSkillIssue =
  | "manifest"
  | "recovery"
  | "unsafe"
  | "missing"
  | "modified"
  | "extra"
  | "source"
  | "invalid"
  | "collision"
  | "disabled"
  | "notManaged"
  | "alreadyManaged";

export interface ManagedSkillDiagnostic {
  code: ManagedSkillIssue;
  severity: "info" | "warning" | "error";
  skill?: string;
  path?: string;
}
export interface ManagedSkillFile {
  relativePath: string;
  sourceHash: string;
  installedHash: string;
}
export interface ManagedSkillEntry {
  name: string;
  source: "bundle";
  compatibility: "ready";
  canonicalTarget: string;
  files: ManagedSkillFile[];
  installedAt: string;
  lastLoaderResult: "pending" | "loaded" | "missing-command" | "reload-failed";
  state?: "installed" | "orphaned-user-modified";
}
/** Keep the original manifest and deployment paths so existing installations retain ownership. */
export interface ManagedSkillsManifest {
  schemaVersion: 1;
  extensionVersion: string;
  piMinimumVersion: "0.80.10";
  codexResearchBaseline: "0.144.5";
  bridgeMode: "disabled";
  managedRoot: string;
  skills: ManagedSkillEntry[];
  recovery?: {
    operation: ManagedSkillOperation;
    skill: string;
    stage: string;
    message: string;
    at: string;
  };
}
export interface ManagedSkillItem {
  name: string;
  description: string;
  target: string;
  bundled: boolean;
  managed: ManagedSkillEntry | null;
  updateAvailable: boolean;
  available: boolean;
  diagnostics: ManagedSkillDiagnostic[];
}
export interface ManagedSkillsSnapshot {
  manifestPath: string;
  managedRoot: string;
  manifest: ManagedSkillsManifest | null;
  items: ManagedSkillItem[];
  diagnostics: ManagedSkillDiagnostic[];
}
export interface ManagedSkillPlanRequest {
  operation: ManagedSkillOperation;
  name: string;
  projectDir?: string | null;
}
export interface ManagedSkillPlan {
  id: string;
  operation: ManagedSkillOperation;
  name: string;
  target: string;
  files: { path: string; change: "add" | "replace" | "remove" | "keep" }[];
  diagnostics: ManagedSkillDiagnostic[];
  canApply: boolean;
  preservesFiles: boolean;
}
export interface ManagedSkillApplyResult {
  preserved: boolean;
  reopenRequired: true;
}
export const MANAGED_SKILLS_IPC = {
  list: "pidesk:managedSkills:list",
  plan: "pidesk:managedSkills:plan",
  apply: "pidesk:managedSkills:apply",
} as const;
export interface ManagedSkillsDesktopApi {
  list(projectDir?: string | null): Promise<IpcResult<ManagedSkillsSnapshot>>;
  plan(request: ManagedSkillPlanRequest): Promise<IpcResult<ManagedSkillPlan>>;
  apply(id: string): Promise<IpcResult<ManagedSkillApplyResult>>;
}
