import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PiPackageInstallRequest, PiPackageRemoveRequest } from "../../shared/ipc";
import {
  readPackageSettings,
  registerPackageSource,
  unregisterPackageSource,
} from "../settings/packageSettings";
import { type PackageCommand, runPackageCommand } from "./packageCommand";
import {
  gitPackageLocation,
  parsePackageSource,
  resolveInstallPath,
  sourceFromSettingsItem,
} from "./packageSource";

const PNPM_FLAGS = [
  "--ignore-scripts",
  "--ignore-workspace",
  "--config.manage-package-manager-versions=false",
  "--config.node-linker=hoisted",
  "--config.package-import-method=copy",
];

/** Owns package acquisition, scope registration and filesystem rollback; never launches an agent CLI. */
export class DesktopPackageManager {
  private active = false;
  constructor(
    private readonly agentDir: () => string,
    private readonly run: PackageCommand = runPackageCommand,
    private readonly log: (line: string) => void = () => {},
  ) {}

  install(request: PiPackageInstallRequest): Promise<void> {
    return this.exclusive(async () => {
      const { root, file, cwd, source, parsed, target } = this.location(request, true);
      readPackageSettings(file);
      if (parsed.kind === "local" && !/\.(tgz|tar\.gz)$/i.test(parsed.identity)) {
        if (!(await fs.stat(target)).isDirectory())
          throw new Error(
            "Select a Durable package directory or .tgz archive. Standalone agent entries are unsupported.",
          );
        await this.readManifest(target);
        registerPackageSource(file, source, (previous) =>
          this.samePackage(previous, parsed, root, cwd),
        );
        this.log("Registered local package.");
        return;
      }
      await this.assertManaged(root, target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const stage = await fs.mkdtemp(path.join(path.dirname(target), ".pidesk-stage-"));
      const backup = `${target}.pidesk-backup-${randomUUID()}`;
      let backedUp = false;
      let stagedRoot = stage;
      let promoted = false;
      let registered = false;
      try {
        if (parsed.kind === "git") {
          const location = gitPackageLocation(source);
          await this.run("git", ["clone", "--", location.url, stage], root, this.log);
          if (location.ref)
            await this.run("git", ["checkout", "--detach", location.ref, "--"], stage, this.log);
          await this.readManifest(stage);
          await this.run(
            "pnpm",
            ["install", "--prod", "--no-frozen-lockfile", ...PNPM_FLAGS],
            stage,
            this.log,
          );
        } else {
          await fs.writeFile(
            path.join(stage, "package.json"),
            JSON.stringify({ private: true, name: "pidesk-extension-install", version: "0.0.0" }),
          );
          const spec =
            parsed.kind === "npm" ? source.replace(/^npm:/i, "") : `file:${parsed.identity}`;
          await this.run(
            "pnpm",
            ["add", "--prod", "--save-exact", ...PNPM_FLAGS, "--", spec],
            stage,
            this.log,
          );
          const wrapper = await this.readManifest(stage);
          const dependencies = wrapper.dependencies;
          const name =
            parsed.kind === "npm"
              ? parsed.identity
              : dependencies && typeof dependencies === "object"
                ? Object.keys(dependencies)[0]
                : undefined;
          if (!name || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name))
            throw new Error("Invalid installed package name.");
          const payload = path.join(stage, "node_modules", name);
          await this.readManifest(payload);
          stagedRoot = path.join(stage, ".pidesk-content");
          await fs.mkdir(stagedRoot);
          await fs.cp(path.join(stage, "node_modules"), path.join(stagedRoot, "node_modules"), {
            recursive: true,
            dereference: false,
          });
          // Package-local dependency versions override the hoisted carrier dependencies.
          for (const entry of await fs.readdir(payload)) {
            if (entry === ".git") continue;
            await fs.cp(path.join(payload, entry), path.join(stagedRoot, entry), {
              recursive: true,
              dereference: false,
            });
          }
        }
        await this.readManifest(stagedRoot);
        await this.assertManaged(root, target);
        try {
          await fs.rename(target, backup);
          backedUp = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await fs.rename(stagedRoot, target);
        promoted = true;
        registerPackageSource(file, source, (previous) =>
          this.samePackage(previous, parsed, root, cwd),
        );
        registered = true;
        this.log("Package installed and registered.");
      } catch (error) {
        if (promoted && !registered) await fs.rm(target, { recursive: true, force: true });
        if (backedUp && !registered) await fs.rename(backup, target);
        throw error;
      } finally {
        await fs.rm(stage, { recursive: true, force: true });
        if (registered && backedUp)
          await fs
            .rm(backup, { recursive: true, force: true })
            .catch(() => this.log("Previous package files will need manual cleanup."));
      }
    });
  }

  remove(request: PiPackageRemoveRequest): Promise<void> {
    return this.exclusive(async () => {
      const { root, file, source, parsed, target, cwd } = this.location(request, false);
      const settings = readPackageSettings(file);
      const packages = (settings.packages ?? []) as unknown[];
      if (!packages.some((item) => sourceFromSettingsItem(item) === source))
        throw new Error("Package is no longer registered.");
      const shared = packages.some((item) => {
        const previous = sourceFromSettingsItem(item);
        return previous && previous !== source && this.samePackage(previous, parsed, root, cwd);
      });
      const local = parsed.kind === "local" && !/\.(tgz|tar\.gz)$/i.test(parsed.identity);
      if (local || shared) {
        unregisterPackageSource(file, source);
        this.log("Package registration removed; source files retained.");
        return;
      }
      await this.assertManaged(root, target);
      const trash = `${target}.pidesk-remove-${randomUUID()}`;
      let moved = false;
      try {
        await fs.rename(target, trash);
        moved = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        unregisterPackageSource(file, source);
      } catch (error) {
        if (moved) await fs.rename(trash, target);
        throw error;
      }
      if (moved)
        await fs
          .rm(trash, { recursive: true, force: true })
          .catch(() => this.log("Package unregistered; remaining files need manual cleanup."));
      this.log("Package removed.");
    });
  }

  private location(request: PiPackageInstallRequest, installing: boolean) {
    const cwd = request.cwd ? path.resolve(request.cwd) : null;
    if (request.local && !cwd)
      throw new Error("Select a project before installing project packages.");
    const root = request.local ? path.join(cwd as string, ".pi") : path.resolve(this.agentDir());
    let source = request.source.trim();
    let parsed = parsePackageSource(source);
    if (installing && parsed.kind === "local") {
      source = path.resolve(cwd ?? process.cwd(), parsed.identity);
      parsed = parsePackageSource(source);
    }
    const target = resolveInstallPath(parsed, {
      agentDir: this.agentDir(),
      local: request.local === true,
      cwd,
    });
    if (!target) throw new Error("Cannot resolve package destination.");
    return { root, cwd, file: path.join(root, "settings.json"), source, parsed, target };
  }

  private samePackage(
    source: string,
    parsed: ReturnType<typeof parsePackageSource>,
    root: string,
    _cwd: string | null,
  ): boolean {
    try {
      const other = parsePackageSource(source);
      if (other.kind !== parsed.kind) return false;
      if (parsed.kind !== "local") return other.identity === parsed.identity;
      return path.resolve(root, other.identity) === path.resolve(root, parsed.identity);
    } catch {
      return false;
    }
  }

  private async readManifest(root: string): Promise<Record<string, unknown>> {
    const file = path.join(root, "package.json");
    if ((await fs.stat(file)).size > 256 * 1024)
      throw new Error("Package manifest exceeds the size limit.");
    const value: unknown = JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid package manifest.");
    const manifest = value as Record<string, unknown>;
    const pi =
      typeof manifest.pi === "object" && manifest.pi !== null
        ? (manifest.pi as Record<string, unknown>)
        : undefined;
    const desktop =
      typeof manifest.pidesk === "object" && manifest.pidesk !== null
        ? (manifest.pidesk as Record<string, unknown>)
        : undefined;
    if (Array.isArray(pi?.extensions) && pi.extensions.length && !desktop?.runtime) {
      const resources = await Promise.all(
        ["skills", "prompts"].map(
          async (kind) =>
            (Array.isArray(pi?.[kind]) && (pi[kind] as unknown[]).length > 0) ||
            (await fs.stat(path.join(root, kind)).catch(() => null))?.isDirectory(),
        ),
      );
      if (!resources.some(Boolean))
        throw new Error(
          "This package only provides retired pi agent extensions. A pidesk.runtime Durable entry is required.",
        );
    }
    return manifest;
  }

  private async assertManaged(root: string, target: string): Promise<void> {
    const relative = path.relative(root, target);
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !["npm", "git", "archives"].includes(relative.split(path.sep)[0])
    )
      throw new Error("Package destination is outside managed storage.");
    await fs.mkdir(root, { recursive: true });
    const canonical = await fs.realpath(root);
    let current = root;
    for (const part of relative.split(path.sep)) {
      current = path.join(current, part);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink())
          throw new Error("Managed package paths cannot be symbolic links.");
        const resolved = path.relative(canonical, await fs.realpath(current));
        if (resolved.startsWith("..") || path.isAbsolute(resolved))
          throw new Error("Package path escapes managed storage.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        break;
      }
    }
  }

  private async exclusive(operation: () => Promise<void>): Promise<void> {
    if (this.active) throw new Error("A package operation is already running.");
    this.active = true;
    try {
      await operation();
    } finally {
      this.active = false;
    }
  }
}
