import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DURABLE_RESOURCE_NAME, type DurableResourceSpec } from "../../shared/durableResources";
import {
  MANAGED_SKILL_OPERATIONS,
  type ManagedSkillApplyResult,
  type ManagedSkillDiagnostic,
  type ManagedSkillEntry,
  type ManagedSkillFile,
  type ManagedSkillItem,
  type ManagedSkillPlan,
  type ManagedSkillPlanRequest,
  type ManagedSkillsSnapshot,
} from "../../shared/managedSkills";
import { parseResourceDocument } from "../../shared/resourceDocument";
import {
  assertManagedDirectories,
  MANAGED_SKILL_NAME,
  ManagedSkillsStore,
  managedHash,
  managedRelativePath,
  sameManagedPath,
} from "../settings/managedSkillsStore";

const BUNDLED_SKILLS = ["plugin-creator", "skill-creator"] as const;
const PLAN_LIFETIME = 5 * 60 * 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TREE_BYTES = 16 * 1024 * 1024;
interface TreeEntry {
  path: string;
  kind: "file" | "directory" | "unsafe";
  hash?: string;
}
interface Tree {
  exists: boolean;
  entries: TreeEntry[];
}
interface CatalogEntry {
  name: string;
  scope: string;
  file: string;
  hash: string;
}
interface Catalog {
  entries: CatalogEntry[];
  diagnostics: ManagedSkillDiagnostic[];
}
interface Source {
  files: ManagedSkillFile[];
  description: string;
  diagnostics: ManagedSkillDiagnostic[];
}
interface Options {
  agentDir: string;
  sourceRoot: string;
  version: string;
  discover(cwd: string): DurableResourceSpec[];
}

function issue(
  code: ManagedSkillDiagnostic["code"],
  skill?: string,
  file?: string,
  severity: ManagedSkillDiagnostic["severity"] = "error",
): ManagedSkillDiagnostic {
  return { code, severity, ...(skill ? { skill } : {}), ...(file ? { path: file } : {}) };
}

/** Inspect every entry without following links, including unexpected and empty directories. */
function tree(root: string): Tree {
  const entries: TreeEntry[] = [];
  let bytes = 0;
  const visit = (file: string, relative: string): void => {
    const stat = fs.lstatSync(file);
    if (entries.length >= 512) throw new Error("Managed skill has too many entries.");
    if (stat.isSymbolicLink() || (relative && !managedRelativePath(relative))) {
      entries.push({ path: relative, kind: "unsafe" });
    } else if (stat.isDirectory()) {
      if (relative) entries.push({ path: relative, kind: "directory" });
      for (const name of fs.readdirSync(file).sort())
        visit(path.join(file, name), relative ? `${relative}/${name}` : name);
    } else if (stat.isFile() && relative && stat.size <= MAX_FILE_BYTES) {
      bytes += stat.size;
      if (bytes > MAX_TREE_BYTES) throw new Error("Managed skill exceeds its file budget.");
      entries.push({ path: relative, kind: "file", hash: managedHash(fs.readFileSync(file)) });
    } else entries.push({ path: relative, kind: "unsafe" });
  };
  try {
    fs.lstatSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, entries };
    throw error;
  }
  visit(root, "");
  return { exists: true, entries };
}

function drift(
  name: string,
  target: string,
  current: Tree,
  entry?: ManagedSkillEntry,
): ManagedSkillDiagnostic[] {
  if (!entry) return current.exists ? [issue("notManaged", name, target)] : [];
  if (!current.exists) return [issue("missing", name, target, "warning")];
  const expected = new Map(entry.files.map((file) => [file.relativePath, file.installedHash]));
  const directories = new Set(
    entry.files.flatMap((file) => {
      const parts = file.relativePath.split("/");
      return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    }),
  );
  const diagnostics: ManagedSkillDiagnostic[] = [];
  const actual = new Map(current.entries.map((file) => [file.path, file]));
  for (const [relative, hash] of expected) {
    const file = actual.get(relative);
    if (!file) diagnostics.push(issue("missing", name, path.join(target, relative), "warning"));
    else if (file.kind !== "file")
      diagnostics.push(issue("unsafe", name, path.join(target, relative)));
    else if (hash !== file.hash)
      diagnostics.push(issue("modified", name, path.join(target, relative)));
  }
  for (const file of current.entries) {
    if (file.kind === "unsafe")
      diagnostics.push(issue("unsafe", name, path.join(target, file.path)));
    else if (!expected.has(file.path) && !(file.kind === "directory" && directories.has(file.path)))
      diagnostics.push(issue("extra", name, path.join(target, file.path)));
  }
  return diagnostics;
}

function metadata(file: string): { name: string; description: string } {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("Invalid skill document.");
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  if (text.includes("\0")) throw new Error("Invalid skill document.");
  const parsed = parseResourceDocument(text, path.basename(file));
  const name =
    parsed.name ??
    (path.basename(file) === "SKILL.md"
      ? path.basename(path.dirname(file))
      : path.basename(file, path.extname(file)));
  const description = (
    parsed.description ??
    parsed.body.split("\n").find((line) => line.trim()) ??
    name
  )
    .replace(/\s+/g, " ")
    .trim();
  if (
    !DURABLE_RESOURCE_NAME.test(name) ||
    !parsed.body.trim() ||
    !description ||
    description.length > 1024
  )
    throw new Error("Invalid skill metadata.");
  return { name, description };
}

/** File-only skill maintenance. No legacy CLI, extension imports, shell commands, or network access. */
export class ManagedSkills {
  readonly store: ManagedSkillsStore;
  private readonly plans = new Map<
    string,
    {
      request: ManagedSkillPlanRequest;
      fingerprint: string;
      expires: number;
    }
  >();
  constructor(private readonly options: Options) {
    this.store = new ManagedSkillsStore(options.agentDir, options.version);
  }

  private source(name: string): Source {
    if (!BUNDLED_SKILLS.some((item) => item === name))
      return { files: [], description: "", diagnostics: [issue("source", name)] };
    const directory = path.join(this.options.sourceRoot, name);
    try {
      assertManagedDirectories(this.options.sourceRoot, directory);
      const current = tree(directory);
      if (!current.exists || current.entries.some((file) => file.kind === "unsafe"))
        throw new Error("Unsafe bundled skill.");
      const info = metadata(path.join(directory, "SKILL.md"));
      if (info.name !== name) throw new Error("Bundled name mismatch.");
      return {
        description: info.description,
        files: current.entries
          .filter((file) => file.kind === "file")
          .map((file) => ({
            relativePath: file.path,
            sourceHash: file.hash as string,
            installedHash: file.hash as string,
          })),
        diagnostics: [],
      };
    } catch {
      return { files: [], description: "", diagnostics: [issue("source", name, directory)] };
    }
  }

  private catalog(cwd: string): Catalog {
    const result: Catalog = { entries: [], diagnostics: [] };
    try {
      for (const spec of this.options.discover(cwd)) {
        if (spec.kind !== "skill") continue;
        try {
          const info = metadata(spec.file);
          result.entries.push({
            ...info,
            file: spec.file,
            scope: spec.scope,
            hash: managedHash(fs.readFileSync(spec.file)),
          });
        } catch {
          result.diagnostics.push(issue("invalid", undefined, spec.file));
        }
      }
    } catch {
      result.diagnostics.push(issue("invalid"));
    }
    result.entries.sort((a, b) => `${a.scope}:${a.file}`.localeCompare(`${b.scope}:${b.file}`));
    const names = new Set<string>();
    for (const entry of result.entries) {
      const identity = `${entry.scope}:${entry.name}`;
      if (names.has(identity)) result.diagnostics.push(issue("collision", entry.name, entry.file));
      names.add(identity);
    }
    return result;
  }

  private commandDiagnostics(
    name: string,
    target: string,
    catalog: Catalog,
  ): ManagedSkillDiagnostic[] {
    return catalog.entries
      .filter(
        (entry) =>
          entry.name === name && !sameManagedPath(entry.file, path.join(target, "SKILL.md")),
      )
      .map((entry) =>
        issue("collision", name, entry.file, entry.scope === "project" ? "warning" : "error"),
      );
  }

  snapshot(projectDir: string): ManagedSkillsSnapshot {
    const result: ManagedSkillsSnapshot = {
      manifestPath: this.store.manifestPath,
      managedRoot: this.store.managedRoot,
      manifest: null,
      items: [],
      diagnostics: [],
    };
    try {
      result.manifest = this.store.read();
    } catch {
      result.diagnostics.push(issue("manifest", undefined, this.store.manifestPath));
      return result;
    }
    const catalog = this.catalog(projectDir);
    result.diagnostics.push(...catalog.diagnostics);
    if (result.manifest.recovery)
      result.diagnostics.push(
        issue("recovery", result.manifest.recovery.skill, this.store.manifestPath, "warning"),
      );
    if (fs.existsSync(this.store.managedRoot)) {
      for (const name of fs.readdirSync(this.store.managedRoot).sort())
        if (/^\..+\.(?:staging|backup)-/.test(name))
          result.diagnostics.push(
            issue("recovery", undefined, path.join(this.store.managedRoot, name), "warning"),
          );
    }
    const names = [
      ...new Set<string>([...BUNDLED_SKILLS, ...result.manifest.skills.map((entry) => entry.name)]),
    ];
    for (const name of names) {
      const target = path.join(this.store.managedRoot, name);
      const managed = result.manifest.skills.find((entry) => entry.name === name) ?? null;
      const source = this.source(name);
      let current: Tree = { exists: false, entries: [] };
      const diagnostics = [...source.diagnostics];
      try {
        current = tree(target);
        diagnostics.push(...drift(name, target, current, managed ?? undefined));
      } catch {
        diagnostics.push(issue("unsafe", name, target));
      }
      if (current.exists && !current.entries.some((entry) => entry.kind === "unsafe")) {
        try {
          metadata(path.join(target, "SKILL.md"));
        } catch {
          diagnostics.push(issue("invalid", name, path.join(target, "SKILL.md")));
        }
      }
      diagnostics.push(...this.commandDiagnostics(name, target, catalog));
      const available = catalog.entries.some(
        (entry) =>
          entry.name === name && sameManagedPath(entry.file, path.join(target, "SKILL.md")),
      );
      if (managed && current.exists && !available)
        diagnostics.push(issue("disabled", name, target, "warning"));
      const item: ManagedSkillItem = {
        name,
        target,
        description: source.description,
        bundled: BUNDLED_SKILLS.some((item) => item === name),
        managed,
        available,
        diagnostics,
        updateAvailable:
          !!managed &&
          source.files.length > 0 &&
          JSON.stringify(
            managed.files.map((file) => [file.relativePath, file.sourceHash]).sort(),
          ) !==
            JSON.stringify(source.files.map((file) => [file.relativePath, file.sourceHash]).sort()),
      };
      result.items.push(item);
    }
    return result;
  }

  private prepare(request: ManagedSkillPlanRequest) {
    if (
      !MANAGED_SKILL_OPERATIONS.includes(request.operation) ||
      !MANAGED_SKILL_NAME.test(request.name)
    )
      throw new Error("PIDESK_SKILLS:invalid");
    const manifest = this.store.read();
    const name = request.name;
    const target = path.join(this.store.managedRoot, name);
    const existing = manifest.skills.find((entry) => entry.name === name);
    const current = tree(target);
    const source = request.operation === "uninstall" ? undefined : this.source(name);
    const catalog =
      request.operation === "uninstall"
        ? undefined
        : this.catalog(request.projectDir ?? this.store.agentDir);
    const changes = drift(name, target, current, existing);
    const preservesFiles =
      request.operation === "uninstall" &&
      changes.some((entry) => ["unsafe", "modified", "extra"].includes(entry.code));
    const diagnostics = [
      ...(source?.diagnostics ?? []),
      ...(catalog?.diagnostics ?? []),
      ...(catalog ? this.commandDiagnostics(name, target, catalog) : []),
      ...changes,
    ];
    if (request.operation === "install" && existing)
      diagnostics.push(issue("alreadyManaged", name, target));
    if (request.operation !== "install" && !existing)
      diagnostics.push(issue("notManaged", name, target));
    const blocking = diagnostics.filter((diagnostic) => {
      if (request.operation === "uninstall" && existing) return false;
      if (request.operation === "repair" && diagnostic.code === "missing") return false;
      return diagnostic.severity === "error" || diagnostic.code === "missing";
    });
    const expected = new Map(
      (source?.files ?? []).map((file) => [file.relativePath, file.sourceHash]),
    );
    const actual = new Map(
      current.entries
        .filter((file) => file.kind !== "directory")
        .map((file) => [file.path, file.hash]),
    );
    const files: ManagedSkillPlan["files"] = [...new Set([...actual.keys(), ...expected.keys()])]
      .sort()
      .map((file) => ({
        path: file || name,
        change: preservesFiles
          ? "keep"
          : !expected.has(file)
            ? "remove"
            : !actual.has(file)
              ? "add"
              : actual.get(file) === expected.get(file)
                ? "keep"
                : "replace",
      }));
    const plan: ManagedSkillPlan = {
      id: "",
      operation: request.operation,
      name,
      target,
      files,
      diagnostics,
      canApply: blocking.length === 0,
      preservesFiles,
    };
    return {
      manifest,
      existing,
      current,
      source,
      plan,
      fingerprint: managedHash(
        JSON.stringify({ request, manifest, current, source, catalog, plan }),
      ),
    };
  }

  plan(request: ManagedSkillPlanRequest): ManagedSkillPlan {
    for (const [id, plan] of this.plans) if (plan.expires <= Date.now()) this.plans.delete(id);
    const prepared = this.prepare(request);
    const id = randomUUID();
    if (prepared.plan.canApply) {
      if (this.plans.size >= 64) this.plans.delete(this.plans.keys().next().value as string);
      this.plans.set(id, {
        request: { ...request },
        fingerprint: prepared.fingerprint,
        expires: Date.now() + PLAN_LIFETIME,
      });
    }
    return { ...prepared.plan, id };
  }

  apply(id: string): ManagedSkillApplyResult {
    const token = this.plans.get(id);
    this.plans.delete(id);
    if (!token || token.expires <= Date.now()) throw new Error("PIDESK_SKILLS:stale");
    const prepared = this.prepare(token.request);
    if (!prepared.plan.canApply || prepared.fingerprint !== token.fingerprint)
      throw new Error("PIDESK_SKILLS:stale");
    const { manifest, existing, current, source, plan } = prepared;
    if (plan.preservesFiles && existing) {
      existing.state = "orphaned-user-modified";
      this.store.write(manifest);
      return { preserved: true, reopenRequired: true };
    }
    assertManagedDirectories(this.store.agentDir, this.store.managedRoot);
    fs.mkdirSync(this.store.managedRoot, { recursive: true });
    const transaction = randomUUID();
    const stage = path.join(this.store.managedRoot, `.${plan.name}.staging-${transaction}`);
    const backup = path.join(this.store.managedRoot, `.${plan.name}.backup-${transaction}`);
    const previous = structuredClone(manifest);
    let backedUp = false;
    let installed = false;
    let journaled = false;
    try {
      if (source) {
        fs.mkdirSync(stage);
        for (const file of source.files) {
          const destination = path.join(stage, file.relativePath);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(
            path.join(this.options.sourceRoot, plan.name, file.relativePath),
            destination,
            fs.constants.COPYFILE_EXCL,
          );
        }
        const staged = tree(stage);
        if (
          staged.entries.some((file) => file.kind === "unsafe") ||
          source.files.some(
            (file) =>
              staged.entries.find((entry) => entry.path === file.relativePath)?.hash !==
              file.sourceHash,
          )
        )
          throw new Error("PIDESK_SKILLS:source");
      }
      // Staging may take time; recheck ownership and user edits immediately before replacement.
      const latest = this.prepare(token.request);
      if (!latest.plan.canApply || latest.fingerprint !== token.fingerprint)
        throw new Error("PIDESK_SKILLS:stale");
      manifest.recovery = {
        operation: plan.operation,
        skill: plan.name,
        stage: "started",
        message: `Transaction ${transaction}`,
        at: new Date().toISOString(),
      };
      this.store.write(manifest);
      journaled = true;
      if (current.exists) {
        fs.renameSync(plan.target, backup);
        backedUp = true;
      }
      if (source) {
        fs.renameSync(stage, plan.target);
        installed = true;
      }
      manifest.skills = manifest.skills.filter((entry) => entry.name !== plan.name);
      if (source)
        manifest.skills.push({
          name: plan.name,
          source: "bundle",
          compatibility: "ready",
          canonicalTarget: plan.target,
          files: source.files,
          installedAt: new Date().toISOString(),
          lastLoaderResult: "pending",
          state: "installed",
        });
      manifest.extensionVersion = this.options.version;
      delete manifest.recovery;
      this.store.write(manifest);
    } catch (error) {
      try {
        if (installed) fs.rmSync(plan.target, { recursive: true });
        if (backedUp) fs.renameSync(backup, plan.target);
        if (journaled) {
          previous.recovery = {
            operation: plan.operation,
            skill: plan.name,
            stage: "rolled-back",
            message: `Transaction ${transaction}`,
            at: new Date().toISOString(),
          };
          this.store.write(previous);
        }
      } catch {
        throw new Error("PIDESK_SKILLS:recovery");
      }
      throw error;
    } finally {
      // A backup survives failed rollback. Doctor exposes it for recovery without deleting user data.
      fs.rmSync(stage, { recursive: true, force: true });
    }
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch {
      // The committed manifest is authoritative; Doctor reports any retained backup.
    }
    return { preserved: false, reopenRequired: true };
  }
}
