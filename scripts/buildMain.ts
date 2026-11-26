import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
// tsc does not remove outputs for deleted sources; retired executors must not ship in ASAR.
for (const directory of ["main", "preload", "shared"])
  rmSync(path.join(root, "dist", directory), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.main.json"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
