import fs from "node:fs";
import path from "node:path";
import type { ContributionDiagnostic } from "../../shared/contribution";
import {
  DURABLE_EXTENSION_LIMIT,
  type DurableExtensionSpec,
  isDurableExtensionSpec,
} from "../../shared/durableExtension";
import { t } from "../../shared/i18n";
import type { PiPackageEntry } from "../../shared/ipc";
import { listPackageEntries } from "./packageStore";

export interface DurableExtensionDiscovery {
  extensions: DurableExtensionSpec[];
  diagnostics: ContributionDiagnostic[];
  errors: string[];
}

/** Inspect enabled package metadata without importing any extension code. */
export function inspectDurablePackages(
  entries: readonly PiPackageEntry[],
  scope: "user" | "project",
): DurableExtensionDiscovery {
  const result: DurableExtensionDiscovery = { extensions: [], diagnostics: [], errors: [] };
  for (const entry of entries) {
    if (!entry.enabled || !entry.installed || !entry.installPath) continue;
    const diagnose = (key: "legacy" | "invalid") => {
      const message = t(
        key === "legacy" ? "session.durable.extensionLegacy" : "session.durable.extensionInvalid",
        { name: entry.name },
      );
      result.diagnostics.push({ packageId: entry.name, scope, field: "pidesk.runtime", message });
      if (key === "invalid") result.errors.push(message);
    };
    let manifest: Record<string, unknown>;
    try {
      const file = path.join(entry.installPath, "package.json");
      if (fs.statSync(entry.installPath).isFile()) {
        if (entry.resourceItems.extensions.some((item) => item.enabled)) diagnose("legacy");
        continue;
      }
      if (fs.statSync(file).size > 256 * 1024) throw new Error();
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      manifest = parsed as Record<string, unknown>;
    } catch (error) {
      if (entry.resourceItems.extensions.some((item) => item.enabled))
        diagnose((error as NodeJS.ErrnoException).code === "ENOENT" ? "legacy" : "invalid");
      continue;
    }
    const pidesk = manifest.pidesk;
    const runtime =
      typeof pidesk === "object" && pidesk !== null && "runtime" in pidesk
        ? pidesk.runtime
        : undefined;
    if (runtime === undefined) {
      if (entry.resourceItems.extensions.some((item) => item.enabled)) diagnose("legacy");
      continue;
    }
    if (typeof runtime !== "object" || runtime === null || Array.isArray(runtime)) {
      diagnose("invalid");
      continue;
    }
    const value = runtime as Record<string, unknown>;
    const nativeEntry = typeof value.entry === "string" ? value.entry : undefined;
    const packageRoot = entry.installPath;
    if (nativeEntry !== undefined) {
      const resource = entry.resourceItems.extensions.find(
        (item) => path.resolve(item.path) === path.resolve(packageRoot, nativeEntry),
      );
      if (resource && !resource.enabled) continue;
    }
    const spec = {
      id: value.id,
      root: entry.installPath,
      entry: typeof value.entry === "string" ? path.resolve(entry.installPath, value.entry) : null,
      scope,
      capabilities: value.capabilities,
      ...(value.hosts === undefined ? {} : { hosts: value.hosts }),
    };
    if (
      value.engine !== "durable" ||
      value.apiVersion !== 1 ||
      !isDurableExtensionSpec(spec) ||
      typeof value.entry !== "string" ||
      path.isAbsolute(value.entry) ||
      !/\.(?:js|mjs)$/.test(value.entry) ||
      (scope === "project" && spec.hosts?.some((host) => host !== "session")) ||
      (spec.hosts?.some((host) => host !== "session") && !spec.capabilities?.includes("views"))
    ) {
      diagnose("invalid");
      continue;
    }
    try {
      const root = fs.realpathSync(spec.root);
      const file = fs.realpathSync(spec.entry);
      const relative = path.relative(root, file);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !fs.statSync(file).isFile()
      )
        throw new Error();
      result.extensions.push({ ...spec, root, entry: file });
    } catch {
      diagnose("invalid");
    }
  }
  return result;
}

/** Snapshot scope at open; changes take effect after the existing session is closed. */
export function discoverDurableExtensions(
  cwd: string | null,
  hostScope: "session" | "app" | "settings" = "session",
): DurableExtensionSpec[] {
  const entries = listPackageEntries(cwd);
  const user = inspectDurablePackages(entries.user, "user");
  const project = inspectDurablePackages(entries.project, "project");
  const extensions = [...user.extensions, ...project.extensions].filter((spec) =>
    (spec.hosts ?? ["session"]).includes(hostScope),
  );
  if (user.errors.length || project.errors.length)
    throw new Error([...user.errors, ...project.errors].join("\n"));
  if (
    extensions.length > DURABLE_EXTENSION_LIMIT ||
    new Set(extensions.map((item) => item.id)).size !== extensions.length
  )
    throw new Error(t("session.durable.extensionConflict"));
  return extensions;
}
