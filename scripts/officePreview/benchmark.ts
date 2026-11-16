import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "vite";
import { measureOfficePreview } from "./measure.ts";
import { checkOfficePreview } from "./regression.ts";
import { checkOfficeSearch } from "./searchRegression.ts";

const require = createRequire(import.meta.url);
const root = path.resolve("temp/office-benchmark");
const typescript = require.resolve("typescript/bin/tsc");
function nodeTask(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Command exited ${code}: ${args.join(" ")}`)),
    );
  });
}

const label = process.argv[2] ?? "current";
const runs = Number(process.env.OFFICE_BENCH_RUNS ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 10)
  throw new Error("OFFICE_BENCH_RUNS must be between 1 and 10");
if (!existsSync("temp/office-preview/corpus/manifest.json"))
  await nodeTask(["scripts/officePreview/generateFixtures.ts"]);
try {
  const response = await fetch("http://127.0.0.1:9388/json/list");
  if (response.ok)
    throw new Error("Benchmark port 9388 is already in use. Close the previous benchmark first.");
} catch (error) {
  if (error instanceof Error && error.message.includes("already in use")) throw error;
}
await nodeTask([typescript, "-p", "tsconfig.main.json"]);
await build({ configFile: "scripts/officePreview/benchmark/vite.config.ts" });
await mkdir(path.join(root, "host"), { recursive: true });
await writeFile(path.join(root, "host/package.json"), '{"private":true,"type":"commonjs"}\n');
await nodeTask([
  typescript,
  "--module",
  "commonjs",
  "--target",
  "ES2022",
  "--outDir",
  path.join(root, "host"),
  "--skipLibCheck",
  "--esModuleInterop",
  "--types",
  "node",
  "scripts/officePreview/benchmark/electron.ts",
  "scripts/officePreview/benchmark/preload.ts",
]);
const electron = spawn(require("electron") as string, [path.join(root, "host/electron.js")], {
  stdio: "inherit",
});
try {
  const deadline = Date.now() + 20_000;
  let ready = false;
  while (Date.now() < deadline && electron.exitCode === null) {
    try {
      const response = await fetch("http://127.0.0.1:9388/json/list");
      const targets = (await response.json()) as { type: string }[];
      if (targets.some((target) => target.type === "page")) {
        ready = true;
        break;
      }
    } catch {
      /* Electron is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Benchmark Electron did not start");
  await measureOfficePreview(label, runs);
  await checkOfficePreview();
  await checkOfficeSearch();
} finally {
  // Ask this isolated instance to close normally so its renderer and workers are reaped too.
  try {
    const { connectBenchmark } = await import("./benchmarkCdp.ts");
    const cdp = await connectBenchmark();
    await cdp.evaluate("officeBenchmark.close()").catch(() => {});
    cdp.close();
    if (electron.exitCode === null)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        electron.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
  } catch {
    /* The instance may have exited after an error. */
  }
  if (electron.exitCode === null) electron.kill();
}
console.log(`Benchmark saved to ${path.join(root, `${label}.json`)}`);
