import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.argv[2] ?? "../../MyPiExtension");
const target = path.resolve("vendor/MyPiExtension");
const revision = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const tracked = execFileSync("git", ["-C", source, "ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const files: { path: string; sha256: string }[] = [];
const omitted: { path: string; reason: string }[] = [];
for (const name of tracked) {
  if (!/^(packages\/|docs\/|LICENSE$|README(?:\.[\w-]+)?\.md$|roadmap\.md$)/.test(name)) continue;
  const reason =
    /(^|\/)(?:\.env[^/]*|[^/]*(?:credentials|secrets)[^/]*|node_modules|dist|coverage)(\/|$)/i.test(
      name,
    )
      ? "private or generated file"
      : /^packages\/(?:yoki-ui|yoki-test-utils)\//.test(name) ||
          /\/(?:view|state\/key-router\.ts|title-spinner\.ts|panel\.ts|skills-panel\.ts|skills-plan-panel\.ts|panel-style\.ts)/.test(
            name,
          )
        ? "terminal UI or legacy UI test harness"
        : /\.(?:mjs|cjs|js|py|ps1|sh)$/.test(name)
          ? "legacy scripts; not part of the desktop runtime"
          : undefined;
  if (reason) {
    omitted.push({ path: name, reason });
    continue;
  }
  const input = path.join(source, name);
  if (!(await stat(input)).isFile()) continue;
  const content = await readFile(input);
  if (
    /\.(?:ts|tsx)$/.test(name) &&
    /(?:from\s*|import\s*\()["']@(?:earendil-works|mariozechner)\/pi-tui/.test(
      content.toString("utf8"),
    )
  ) {
    omitted.push({ path: name, reason: "direct terminal UI dependency" });
    continue;
  }
  const output = path.join(target, name);
  await mkdir(path.dirname(output), { recursive: true });
  // Refuse to overwrite a locally adapted source snapshot.
  try {
    const existing = await readFile(output);
    if (!existing.equals(content)) throw new Error(`Snapshot already differs: ${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeFile(output, content);
  }
  files.push({ path: name, sha256: createHash("sha256").update(content).digest("hex") });
}
await mkdir(target, { recursive: true });
await writeFile(
  path.join(target, "import-manifest.json"),
  `${JSON.stringify({ upstream: "MyPiExtension", revision, files, omitted }, null, 2)}\n`,
);
console.log(JSON.stringify({ copied: files.length, omitted: omitted.length, revision, target }));
