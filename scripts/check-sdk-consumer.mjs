/**
 * Publishability check for `@pidesk/view-sdk` (docs/design/20 O6).
 *
 * 准则 §13.2's last item: verify package contents, exports, types and actual
 * loading from an *independent consumer directory* before calling a package
 * publishable — and never claim a TypeScript source entry loads natively.
 *
 * Builds the package, packs it, unpacks the tarball into a throwaway
 * `node_modules` (no registry round-trip), then from that isolated consumer:
 *   1. loads the public entry with plain Node — no bundler, no jiti;
 *   2. type-checks a consumer file against the shipped `.d.ts`;
 *   3. asserts deep `src/*` imports are refused (internals are not surface);
 *   4. asserts test-only hooks are absent from the public export list.
 *
 * Run: `pnpm check:sdk-consumer`
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "packages", "view-sdk");
const repoRoot = resolve(pkgRoot, "..", "..");
const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { encoding: "utf8", cwd, shell: process.platform === "win32" });
}

const checks = [];
function check(label, ok, detail = "") {
  checks.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

console.log("check:sdk-consumer — independent install + native load of @pidesk/view-sdk\n");

run("npx", ["tsc", "-p", "packages/view-sdk/tsconfig.build.json"], repoRoot);
const builtJs = join(pkgRoot, "dist", "index.js");
check("dist/index.js built", existsSync(builtJs), "run `pnpm build:view-sdk`");
if (!existsSync(builtJs)) process.exit(1);

const manifest = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
const entry = manifest.exports?.["."];
check(
  "exports['.'] points at built JS, not TS source",
  Boolean(entry?.default?.endsWith(".js") && !entry.default.includes("/src/")),
  JSON.stringify(entry),
);
check(
  "files[] ships built output only",
  Array.isArray(manifest.files) && !manifest.files.includes("src"),
  JSON.stringify(manifest.files),
);
check("exports map has no ./testing (harness needs Host code)", !manifest.exports["./testing"]);

const work = mkdtempSync(join(tmpdir(), "pidesk-sdk-consumer-"));
try {
  const target = join(work, "node_modules", "@pidesk", "view-sdk");
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  // --pack-destination only prints the filename; --pack-destination is enough.
  const pack = run("npm", ["pack", "--json", "--pack-destination", work], pkgRoot);
  let tgz = null;
  try {
    tgz = JSON.parse(pack.stdout ?? "[]")[0]?.filename ?? null;
  } catch {
    tgz = null;
  }
  check("npm pack produced a tarball", Boolean(tgz), tgz ?? (pack.stderr ?? "").slice(-200));
  if (!tgz) throw new Error("nothing packed");
  // --force-local: Git Bash's tar otherwise reads the drive letter in C:\... as
  // a remote host and fails with "Cannot connect to C:".
  const unpack = run("tar", ["--force-local", "-xzf", join(work, tgz), "-C", work], work);
  check("tarball unpacks", unpack.status === 0, (unpack.stderr ?? "").slice(-200));
  if (unpack.status !== 0) throw new Error("unpack failed");
  // npm pack writes package/; place it in a consumer's node_modules layout.
  const packed = join(work, "package");
  mkdirSync(join(work, "node_modules", "@pidesk"), { recursive: true });
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  renameSync(packed, target);
  check(
    "package present at node_modules/@pidesk/view-sdk",
    existsSync(join(target, "dist", "index.js")),
  );
  check("no src/ directory leaked into the tarball", !existsSync(join(target, "src", "index.ts")));

  const loader = join(work, "load.mjs");
  writeFileSync(
    loader,
    `import * as sdk from "@pidesk/view-sdk";
const needed = ["connectDesktopView","DesktopViewClient","createViewFrameScheduler","VIEW_LIMITS","supportsTable","openPanelResult","tableView","measureViewTree","playNotification","superviseSlot"];
const missing = needed.filter(n => !(n in sdk));
if (missing.length) { console.error("MISSING:" + missing.join(",")); process.exit(1); }
const leaked = Object.keys(sdk).filter(n => n.includes("ForTests"));
if (leaked.length) { console.error("LEAKED:" + leaked.join(",")); process.exit(1); }
console.log("OK " + Object.keys(sdk).length + " exports");
`,
  );
  const load = run(process.execPath, [loader], work);
  check(
    "native node import of the public entry works",
    load.status === 0,
    (load.stderr || load.stdout).trim(),
  );

  const deep = join(work, "deep.mjs");
  writeFileSync(deep, `await import("@pidesk/view-sdk/src/client.js");\n`);
  const deepRun = run(process.execPath, [deep], work);
  // Must be refused by the exports map — not merely unresolvable, which would
  // also "pass" if the package itself had failed to install.
  check(
    "deep import of src/* is refused by the exports map",
    deepRun.status !== 0 && /ERR_PACKAGE_PATH_NOT_EXPORTED/.test(deepRun.stderr ?? ""),
    (deepRun.stderr ?? "").split(/\r?\n/)[1]?.trim() ?? "",
  );

  const consumerTs = join(work, "use.ts");
  writeFileSync(
    consumerTs,
    `import { VIEW_LIMITS, measureViewTree, supportsTable, type ViewNode } from "@pidesk/view-sdk";\n` +
      `const root: ViewNode = { type: "text", content: "hi" };\n` +
      `export const nodes = measureViewTree(root, VIEW_LIMITS).nodes;\n` +
      `export const table = supportsTable(null);\n`,
  );
  const types = run(
    process.execPath,
    [
      tsc,
      "--strict",
      "--noEmit",
      "--target",
      "ES2022",
      "--module",
      "nodenext",
      "--moduleResolution",
      "nodenext",
      consumerTs,
    ],
    work,
  );
  check(
    "shipped .d.ts type-checks a consumer",
    types.status === 0,
    (types.stdout || types.stderr || "").trim().split(/\r?\n/).slice(0, 4).join(" / "),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log(
  `\n${failed.length === 0 ? "CONSUMER CHECK GREEN" : `CONSUMER CHECK RED: ${failed.length} failing`}`,
);
process.exit(failed.length === 0 ? 0 : 1);
