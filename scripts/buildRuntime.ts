import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const localRequire = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const tscBin = path.join(
  path.dirname(localRequire.resolve("typescript/package.json")),
  "bin",
  "tsc",
);

const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.runtime.json"], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const outputDirectory = path.join(projectRoot, "dist", "agentRuntime");
const runtimeDirectory = path.join(outputDirectory, "agentRuntime");
mkdirSync(runtimeDirectory, { recursive: true });
// NodeNext emits shared/ as CommonJS and agentRuntime/ as ESM, matching the source package scopes.
writeFileSync(path.join(outputDirectory, "package.json"), '{"type":"commonjs"}\n');
copyFileSync(
  path.join(projectRoot, "src", "agentRuntime", "package.json"),
  path.join(runtimeDirectory, "package.json"),
);
