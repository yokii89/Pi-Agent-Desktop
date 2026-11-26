import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  MANAGED_SKILL_OPERATIONS,
  type ManagedSkillFile,
  type ManagedSkillsManifest,
} from "../../shared/managedSkills";

export const MANAGED_SKILL_NAME = /^[a-z0-9-]{1,64}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export function sameManagedPath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

export function managedHash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function managedRelativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.startsWith(".") ||
          [...part].some((character) => character.charCodeAt(0) < 32) ||
          /[\\<>:"|?*]/.test(part) ||
          /[. ]$/.test(part),
      )
  );
}

/** Missing paths are allowed; every existing component must remain a real directory. */
export function assertManagedDirectories(agentDir: string, directory: string): void {
  const root = path.resolve(agentDir);
  const relative = path.relative(root, path.resolve(directory));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("Managed path escapes the agent directory.");
  const chain = [root];
  for (const part of relative.split(path.sep).filter(Boolean))
    chain.push(path.join(chain[chain.length - 1], part));
  for (const entry of chain) {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      !sameManagedPath(fs.realpathSync(entry), entry)
    )
      throw new Error("Managed directories must not contain links or special files.");
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, limit = 256): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= limit && !value.includes("\0")
  );
}
function validFiles(value: unknown): value is ManagedSkillFile[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) return false;
  const names = new Set<string>();
  return (
    value.every((file: unknown) => {
      if (
        !object(file) ||
        !managedRelativePath(file.relativePath) ||
        !text(file.sourceHash) ||
        !HASH.test(file.sourceHash) ||
        !text(file.installedHash) ||
        !HASH.test(file.installedHash)
      )
        return false;
      const name = file.relativePath.toLowerCase();
      if (names.has(name)) return false;
      names.add(name);
      return true;
    }) && names.has("skill.md")
  );
}

function validateManifest(value: unknown, root: string): asserts value is ManagedSkillsManifest {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    !text(value.extensionVersion) ||
    value.piMinimumVersion !== "0.80.10" ||
    value.codexResearchBaseline !== "0.144.5" ||
    value.bridgeMode !== "disabled" ||
    !text(value.managedRoot, 32768) ||
    !path.isAbsolute(value.managedRoot) ||
    !sameManagedPath(value.managedRoot, root) ||
    !Array.isArray(value.skills) ||
    value.skills.length > 256
  )
    throw new Error("Invalid managed-skills manifest.");
  const names = new Set<string>();
  for (const entry of value.skills) {
    if (
      !object(entry) ||
      !text(entry.name) ||
      !MANAGED_SKILL_NAME.test(entry.name) ||
      names.has(entry.name) ||
      entry.source !== "bundle" ||
      entry.compatibility !== "ready" ||
      !text(entry.canonicalTarget, 32768) ||
      !path.isAbsolute(entry.canonicalTarget) ||
      !sameManagedPath(entry.canonicalTarget, path.join(root, entry.name)) ||
      !validFiles(entry.files) ||
      !text(entry.installedAt) ||
      !["pending", "loaded", "missing-command", "reload-failed"].includes(
        String(entry.lastLoaderResult),
      ) ||
      (entry.state !== undefined &&
        entry.state !== "installed" &&
        entry.state !== "orphaned-user-modified")
    )
      throw new Error("Invalid managed-skills ownership entry.");
    names.add(entry.name);
  }
  if (value.recovery !== undefined) {
    const recovery = value.recovery;
    if (
      !object(recovery) ||
      !MANAGED_SKILL_OPERATIONS.some((op) => op === recovery.operation) ||
      !text(recovery.skill) ||
      !MANAGED_SKILL_NAME.test(recovery.skill) ||
      !text(recovery.stage) ||
      !text(recovery.message, 4096) ||
      !text(recovery.at)
    )
      throw new Error("Invalid managed-skills recovery record.");
  }
}

/** Owns the legacy manifest path; reading never creates directories or changes ownership. */
export class ManagedSkillsStore {
  readonly agentDir: string;
  readonly managedRoot: string;
  readonly manifestPath: string;
  constructor(
    agentDir: string,
    private readonly version: string,
  ) {
    this.agentDir = path.resolve(agentDir);
    this.managedRoot = path.join(this.agentDir, "skills", "codex-managed");
    this.manifestPath = path.join(this.agentDir, "codex-skills-manifest.json");
  }

  read(): ManagedSkillsManifest {
    assertManagedDirectories(this.agentDir, this.managedRoot);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(this.manifestPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        schemaVersion: 1,
        extensionVersion: this.version,
        piMinimumVersion: "0.80.10",
        codexResearchBaseline: "0.144.5",
        bridgeMode: "disabled",
        managedRoot: this.managedRoot,
        skills: [],
      };
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_MANIFEST_BYTES)
      throw new Error("Unsafe managed-skills manifest.");
    const value: unknown = JSON.parse(fs.readFileSync(this.manifestPath, "utf8"));
    validateManifest(value, this.managedRoot);
    return value;
  }

  write(manifest: ManagedSkillsManifest): void {
    validateManifest(manifest, this.managedRoot);
    assertManagedDirectories(this.agentDir, this.managedRoot);
    // Reject a manifest replaced with a link after previewing the operation.
    if (fs.existsSync(this.manifestPath) && !fs.lstatSync(this.manifestPath).isFile())
      throw new Error("Unsafe managed-skills manifest.");
    fs.mkdirSync(this.agentDir, { recursive: true });
    const staged = `${this.manifestPath}.staging-${randomUUID()}`;
    try {
      fs.writeFileSync(staged, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      fs.renameSync(staged, this.manifestPath);
    } finally {
      fs.rmSync(staged, { force: true });
    }
  }
}
