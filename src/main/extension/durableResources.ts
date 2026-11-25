import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  DURABLE_RESOURCE_LIMIT,
  type DurableResourceSpec,
  durableResourceError,
} from "../../shared/durableResources";
import type { PiPackageEntry } from "../../shared/ipc";
import { listLocalResourceDirs, listLocalResourcePath } from "./localResources";
import { listPackageEntries } from "./packageStore";

/** Resolve enabled declarative resources without loading legacy extension code. */
export function discoverDurableResources(
  cwd: string,
  homeDir: string = homedir(),
): DurableResourceSpec[] {
  const entries = listPackageEntries(cwd);
  const resources: DurableResourceSpec[] = [];
  const add = (
    kind: "skill" | "prompt",
    root: string,
    target: string,
    scope: "user" | "project",
    local = false,
  ) => {
    try {
      const file = fs.statSync(target).isDirectory() ? path.join(target, "SKILL.md") : target;
      // Local resource links are explicit user configuration. Package resources remain inside their package.
      const canonical = fs.realpathSync(file);
      const canonicalRoot = local ? path.dirname(canonical) : fs.realpathSync(root);
      const relative = path.relative(canonicalRoot, canonical);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw durableResourceError("invalid", path.basename(file));
      resources.push({ kind, root: canonicalRoot, file: canonical, scope });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PIDESK_RESOURCE:")) throw error;
      throw durableResourceError("load", path.basename(target));
    }
  };
  const packages = (items: readonly PiPackageEntry[], scope: "user" | "project") => {
    for (const item of items) {
      if (!item.enabled || !item.installed || !item.installPath) continue;
      for (const [key, kind] of [
        ["skills", "skill"],
        ["prompts", "prompt"],
      ] as const)
        for (const resource of item.resourceItems[key])
          if (resource.enabled) add(kind, item.installPath, resource.path, scope);
    }
  };
  packages(entries.user, "user");
  packages(entries.project, "project");
  for (const scope of ["user", "project"] as const) {
    const agentDir = scope === "user" ? entries.agentDir : path.join(cwd, ".pi");
    const settings = scope === "user" ? entries.userSettings : entries.projectSettings;
    const home = scope === "user" ? homeDir : cwd;
    for (const directory of listLocalResourceDirs(agentDir, settings, home, [
      "skills",
      "sharedSkills",
      "prompts",
    ])) {
      const kind = directory.kind === "prompts" ? "prompt" : "skill";
      for (const item of directory.items)
        if (item.enabled) add(kind, directory.path, item.path, scope, true);
    }
    for (const key of ["skills", "prompts"] as const) {
      const configured = settings?.[key];
      if (!Array.isArray(configured)) continue;
      for (const raw of configured) {
        if (typeof raw !== "string" || !raw.trim() || /^[!+-]/.test(raw.trim())) continue;
        const value = raw.trim();
        if (/[*?]/.test(value)) throw durableResourceError("invalid", path.basename(value));
        const target =
          value === "~"
            ? homeDir
            : /^~[/\\\\]/.test(value)
              ? path.resolve(homeDir, value.slice(2))
              : path.resolve(agentDir, value);
        try {
          for (const item of listLocalResourcePath(key, target, agentDir, settings))
            if (item.enabled)
              add(key === "skills" ? "skill" : "prompt", target, item.path, scope, true);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("PIDESK_RESOURCE:")) throw error;
          throw durableResourceError("load", path.basename(target));
        }
      }
    }
  }
  const unique = [
    ...new Map(
      resources.map((item) => {
        const file = process.platform === "win32" ? item.file.toLowerCase() : item.file;
        return [`${item.scope}:${item.kind}:${file}`, item] as const;
      }),
    ).values(),
  ];
  if (unique.length > DURABLE_RESOURCE_LIMIT) throw durableResourceError("tooLarge", "catalog");
  return unique;
}
