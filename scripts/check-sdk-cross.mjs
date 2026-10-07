/**
 * Cross-repo View SDK regression gate (docs/design/20 O5).
 *
 * `@pidesk/view-sdk` is consumed by three extensions over a `file:` dependency,
 * and nothing in this repo used to notice when the SDK broke them: four red
 * consumer tests sat across three commits undetected (§1.2). This is the local
 * stand-in for the CI the repo deliberately does not have — one command, both
 * repos, one table.
 *
 * Usage:
 *   pnpm check:sdk-cross                  # full gate
 *   pnpm check:sdk-cross -- --quick       # tests only (skip tsc + biome)
 *
 * Consumer root defaults to ../MyPiExtension; override with PIDESK_CONSUMER_ROOT.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pideskRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumerRoot = resolve(
  process.env.PIDESK_CONSUMER_ROOT ?? join(pideskRoot, "..", "MyPiExtension"),
);
const quick = process.argv.includes("--quick");

/**
 * Resolve local binaries and spawn them without a shell.
 *
 * `npx` through `spawnSync(..., { shell: true })` reported exit code 1 for the
 * view-sdk step on Windows even with all 154 tests passing — cmd.exe does not
 * reliably propagate the shim's status. A gate whose verdict is wrong is worse
 * than no gate, so every step now invokes its real entry point directly.
 */
const nm = join(pideskRoot, "node_modules");

/** Same call shape as before, but no shell and no `.cmd` shim in the path. */
function npx(cmd, ...args) {
  if (cmd === "vitest")
    return {
      cmd: process.execPath,
      args: [join(nm, "vitest", "vitest.mjs"), ...args],
      shell: false,
    };
  if (cmd === "tsc")
    return {
      cmd: process.execPath,
      args: [join(nm, "typescript", "bin", "tsc"), ...args],
      shell: false,
    };
  // Biome ships a platform-specific binary behind an npm shim; going through
  // `npx` (as `pnpm lint` does) is the only invocation that resolves it on
  // every platform, so this one step keeps the shell.
  if (cmd === "biome") return { cmd: "npx", args: [cmd, ...args], shell: true };
  throw new Error(`check-sdk-cross: unmapped command ${cmd}`);
}

function repoScript(name, ...args) {
  return {
    cmd: process.execPath,
    args: [join(pideskRoot, "scripts", name), ...args],
    shell: false,
  };
}

const steps = [
  {
    group: "pidesk",
    label: "view-types lockstep",
    cwd: pideskRoot,
    ...repoScript("sync-view-sdk-types.mjs", "--check"),
  },
  {
    group: "pidesk",
    label: "build view-sdk",
    cwd: pideskRoot,
    ...npx("tsc", "-p", "packages/view-sdk/tsconfig.build.json"),
  },
  {
    group: "pidesk",
    label: "sdk consumer check",
    cwd: pideskRoot,
    ...repoScript("check-sdk-consumer.mjs"),
  },
  // Absolute report paths: vitest resolves --outputFile against each config's
  // own `root`, which differs per package.
  {
    group: "pidesk",
    label: "view-sdk tests",
    cwd: pideskRoot,
    outFile: join(pideskRoot, ".cross-sdk.json"),
    ...npx("vitest", "run", "--config", "packages/view-sdk/vitest.config.ts"),
  },
  {
    group: "pidesk",
    label: "main tests",
    cwd: pideskRoot,
    outFile: join(pideskRoot, ".cross-main.json"),
    ...npx("vitest", "run", "--config", "src/main/vitest.config.ts"),
  },
  {
    group: "pidesk",
    label: "renderer tests",
    cwd: pideskRoot,
    outFile: join(pideskRoot, ".cross-renderer.json"),
    ...npx("vitest", "run", "--config", "src/renderer/vitest.config.ts"),
  },
];

if (!quick) {
  steps.push(
    { group: "pidesk", label: "biome check", cwd: pideskRoot, ...npx("biome", "check", ".") },
    {
      group: "pidesk",
      label: "tsc main",
      cwd: pideskRoot,
      ...npx("tsc", "-p", "tsconfig.main.json", "--noEmit"),
    },
    {
      group: "pidesk",
      label: "tsc renderer+shared",
      cwd: pideskRoot,
      ...npx("tsc", "-p", "tsconfig.json", "--noEmit"),
    },
    {
      group: "pidesk",
      label: "tsc view-sdk",
      cwd: pideskRoot,
      ...npx("tsc", "-p", "packages/view-sdk/tsconfig.json", "--noEmit"),
    },
  );
}

/**
 * Direct consumers of the SDK, named explicitly rather than globbed: a new
 * consumer has to be added here on purpose, or the gate silently under-covers.
 * `pi-telegram-main` runs node:test, not vitest, so it needs its own kind.
 */
const consumers = [
  {
    label: "yoki-plan desktop",
    dir: "packages/yoki-plan",
    kind: "vitest",
    target: "desktop-view.test.ts",
  },
  {
    label: "yoki-ask-user-question desktop",
    dir: "packages/yoki-ask-user-question",
    kind: "vitest",
    target: "desktop-view.test.ts",
  },
  {
    label: "pi-telegram-main desktop",
    dir: "packages/pi-telegram-main",
    kind: "node-test",
    target: "tests/desktop-view.test.ts",
  },
];

for (const consumer of consumers) {
  steps.push({
    group: "consumer",
    label: consumer.label,
    cwd: join(consumerRoot, consumer.dir),
    cmd: process.execPath,
    shell: false,
    args:
      consumer.kind === "vitest"
        ? [join(consumerRoot, "node_modules", "vitest", "vitest.mjs"), "run", consumer.target]
        : ["--experimental-strip-types", "--test", "--test-reporter=dot", consumer.target],
  });
}

const results = [];
for (const step of steps) {
  if (!existsSync(step.cwd) || (step.group === "consumer" && !existsSync(consumerRoot))) {
    results.push({ ...step, status: "skip", detail: "path missing" });
    continue;
  }
  const args = step.outFile
    ? [...step.args, "--reporter=json", "--outputFile", step.outFile]
    : step.args;
  const started = Date.now();
  const run = spawnSync(step.cmd, args, {
    cwd: step.cwd,
    encoding: "utf8",
    shell: step.shell ?? process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  results.push({
    ...step,
    status: run.status === 0 ? "pass" : "fail",
    durationMs: Date.now() - started,
    counts: step.outFile ? countVitestResults(step.outFile) : null,
    detail: run.status === 0 ? "" : tail(run.stderr || run.stdout || ""),
  });
}

/** Test totals from a vitest `--reporter=json` file, or null when absent. */
function countVitestResults(file) {
  if (!existsSync(file)) return null;
  try {
    const report = JSON.parse(readFileSync(file, "utf8"));
    let passed = 0;
    let failed = 0;
    for (const suite of report.testResults ?? []) {
      for (const assertion of suite.assertionResults ?? []) {
        if (assertion.status === "passed") passed += 1;
        else if (assertion.status === "failed") failed += 1;
      }
    }
    return { passed, failed };
  } catch {
    return null;
  }
}

function tail(text) {
  return text.split(/\r?\n/).filter(Boolean).slice(-4).join(" / ");
}

console.log("\ncheck:sdk-cross — View SDK gate (pidesk + consumers)\n");
console.log(
  `${"group".padEnd(10)}${"step".padEnd(32)}${"result".padEnd(8)}${"tests".padEnd(22)}ms`,
);
console.log("".padEnd(84, "-"));
let failures = 0;
for (const result of results) {
  if (result.status === "fail") failures += 1;
  const counts = result.counts ? `${result.counts.passed} pass / ${result.counts.failed} fail` : "";
  console.log(
    `${result.group.padEnd(10)}${result.label.padEnd(32)}${result.status.padEnd(8)}${counts.padEnd(22)}${result.durationMs ?? ""}`,
  );
  if (result.detail) console.log(`           ↳ ${result.detail}`);
}
console.log("".padEnd(84, "-"));
console.log(`${failures === 0 ? "GATE GREEN" : `GATE RED: ${failures} failing step(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
