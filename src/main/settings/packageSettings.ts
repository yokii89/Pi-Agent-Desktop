import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sourceFromSettingsItem } from "../extension/packageSource";

/** Read the shared package registry without replacing damaged user or project settings. */
export function readPackageSettings(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    if ("packages" in parsed && !Array.isArray(parsed.packages)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("Package settings are invalid; repair the file before changing packages.");
  }
}

/** Atomic writes stay in the settings module; callers merge against the latest file. */
export function writePackageSettings(file: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Replace a source while retaining per-resource filters and unrelated preferences. */
export function registerPackageSource(
  file: string,
  source: string,
  sameIdentity: (source: string) => boolean,
): void {
  const settings = readPackageSettings(file);
  let found = false;
  const packages: unknown[] = [];
  for (const item of (settings.packages ?? []) as unknown[]) {
    const previous = sourceFromSettingsItem(item);
    if (!previous || !sameIdentity(previous)) {
      packages.push(item);
      continue;
    }
    if (found) continue;
    found = true;
    packages.push(typeof item === "object" && item !== null ? { ...item, source } : source);
  }
  if (!found) packages.push(source);
  writePackageSettings(file, { ...settings, packages });
}

/** Only remove the requested registration; another version may still own its files. */
export function unregisterPackageSource(file: string, source: string): void {
  const settings = readPackageSettings(file);
  const packages = (settings.packages ?? []) as unknown[];
  if (!packages.some((item) => sourceFromSettingsItem(item) === source))
    throw new Error("Package is no longer registered.");
  writePackageSettings(file, {
    ...settings,
    packages: packages.filter((item) => sourceFromSettingsItem(item) !== source),
  });
}
