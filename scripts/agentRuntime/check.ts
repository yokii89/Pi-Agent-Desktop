import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "../..");
const output = path.join(
  projectRoot,
  "temp/agent-runtime-check",
  process.argv.includes("--newapi")
    ? "newapi"
    : process.argv.includes("--extensions")
      ? "extensions"
      : "",
);
const hostOutput = path.join(projectRoot, "dist/runtimeCheck");
const tsc = require.resolve("typescript/bin/tsc");
const electron = require("electron") as string;
const live = process.argv.includes("--live");
const hostEntry = path.join(hostOutput, "scripts/agentRuntime/electron.js");
assert(existsSync(electron), "Electron binary missing; rerun its installation script.");

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_PATH;
    const child = spawn(command, args, { cwd: projectRoot, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with ${code ?? signal}`));
    });
  });
}

await mkdir(output, { recursive: true });
try {
  if (!process.argv.includes("--reuse-build")) {
    await run(process.execPath, [path.join(projectRoot, "scripts/buildMain.ts")]);
    await run(process.execPath, [path.join(projectRoot, "scripts/buildRuntime.ts")]);
    await run(process.execPath, [
      path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js"),
      "build",
    ]);
  }
  await run(process.execPath, [
    tsc,
    "--module",
    "commonjs",
    "--target",
    "ES2022",
    "--rootDir",
    projectRoot,
    "--outDir",
    hostOutput,
    "--strict",
    "--skipLibCheck",
    "--esModuleInterop",
    "--types",
    "node",
    path.join(projectRoot, "scripts/agentRuntime/electron.ts"),
  ]);

  const developmentRoot = path.join(output, "development");
  await mkdir(developmentRoot, { recursive: true });
  await writeFile(
    path.join(developmentRoot, "package.json"),
    JSON.stringify({ name: "pidesk-runtime-check", main: hostEntry }),
  );
  for (const directory of ["dist", "node_modules", "assets"]) {
    const link = path.join(developmentRoot, directory);
    if (!existsSync(link)) await symlink(path.join(projectRoot, directory), link, "junction");
  }
  const developmentReport = path.join(output, "development.json");
  await rm(developmentReport, { force: true });
  await run(electron, [developmentRoot], {
    PIDESK_RUNTIME_CHECK_REPORT: developmentReport,
    PIDESK_RUNTIME_CHECK_LIVE_AUTH: live ? path.join(homedir(), ".pi/agent/auth.json") : "",
    PIDESK_RUNTIME_CHECK_EXTENSIONS_ONLY: process.argv.includes("--extensions") ? "1" : "",
    PIDESK_RUNTIME_CHECK_NEWAPI_ONLY: process.argv.includes("--newapi") ? "1" : "",
  });
  console.log("Electron utility process verification:", await readFile(developmentReport, "utf8"));

  // Reuse the real production dependency collector, ASAR rules and Electron distribution.
  // Only the entry point and output directory change; no publishing or installer execution.
  // Keep the executable outside the checkout so a missing packaged dependency cannot resolve
  // from the project's node_modules. Spaces and Unicode also exercise archive/resource paths.
  const packageOutput = await mkdtemp(path.join(tmpdir(), "pidesk runtime 包验证-"));
  await run(process.execPath, [
    require.resolve("electron-builder/cli.js"),
    "--win",
    "--x64",
    "--dir",
    "--publish=never",
    `-c.directories.output=${packageOutput}`,
    "-c.extraMetadata.main=dist/runtimeCheck/scripts/agentRuntime/electron.js",
    `-c.electronDist=${path.dirname(electron)}`,
  ]);
  const packagedReport = path.join(output, "packaged.json");
  await rm(packagedReport, { force: true });
  await run(path.join(packageOutput, "win-unpacked/PiDesk.exe"), [], {
    PIDESK_RUNTIME_CHECK_REPORT: packagedReport,
    PIDESK_RUNTIME_CHECK_LIVE_AUTH: "",
    PIDESK_RUNTIME_CHECK_EXTENSIONS_ONLY: process.argv.includes("--extensions") ? "1" : "",
    PIDESK_RUNTIME_CHECK_NEWAPI_ONLY: process.argv.includes("--newapi") ? "1" : "",
  });
  const report = JSON.parse(await readFile(packagedReport, "utf8")) as { packaged?: boolean };
  assert.equal(report.packaged, true);
  console.log(
    "Packaged Electron ASAR + SQLite verification:",
    await readFile(packagedReport, "utf8"),
  );
} finally {
  await rm(hostOutput, { recursive: true, force: true });
}
