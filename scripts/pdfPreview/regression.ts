import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, createServer, loadConfigFromFile } from "vite";
import { pdfFixtures } from "./fixtures.ts";

const require = createRequire(import.meta.url);
const root = path.resolve("temp/pdf-preview");
const output = path.join(root, "离线 preview", "dist");
await mkdir(path.join(root, "styles"), { recursive: true });
// The application asset plugins read shared styles relative to Vite's root.
await Promise.all(
  ["tokens.css", "remoteAuthCallback.css"].map((name) =>
    copyFile(path.resolve("src/renderer/styles", name), path.join(root, "styles", name)),
  ),
);
const csp = (await readFile("src/renderer/index.html", "utf8")).match(
  /content="(default-src[^"]+)"/,
)?.[1];
assert(csp, "Application CSP must be present");
await writeFile(
  path.join(root, "index.html"),
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><script type="module" src="./entry.ts"></script></body></html>`,
);
await writeFile(path.join(root, "entry.ts"), 'import "../../scripts/pdfPreview/renderer.ts";\n');
const fontData = await readFile(
  require.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
);
await writeFile(path.join(root, "fixtures.json"), JSON.stringify(pdfFixtures(fontData)));

function run(command: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...extraEnv };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`PDF regression exited ${code}`)),
    );
  });
}

await run(process.execPath, [
  require.resolve("typescript/bin/tsc"),
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
  "scripts/pdfPreview/electron.ts",
]);
await writeFile(path.join(root, "host/package.json"), '{"type":"commonjs"}\n');
const loaded = await loadConfigFromFile({ command: "build", mode: "production" });
assert(loaded, "Vite configuration must load");
await build({
  ...loaded.config,
  configFile: false,
  logLevel: "warn",
  root,
  build: {
    outDir: output,
    emptyOutDir: true,
    rollupOptions: { input: path.join(root, "index.html") },
  },
});
const electron = require("electron") as string;
const host = path.join(root, "host/electron.js");
async function check(label: string, url: string): Promise<void> {
  const report = path.join(root, `${label}.json`);
  await run(electron, [host], {
    PIDESK_PDF_REGRESSION: JSON.stringify({
      url,
      fixtures: path.join(root, "fixtures.json"),
      report,
    }),
  });
  const result = JSON.parse(await readFile(report, "utf8")) as { requests: string[] };
  for (const resource of [
    "UniGB-UCS2-H.bcmap",
    "UniCNS-UCS2-H.bcmap",
    "UniJIS-UCS2-H.bcmap",
    "UniKS-UCS2-H.bcmap",
    "FoxitSymbol.pfb",
    "FoxitDingbats.pfb",
    "openjpeg.wasm",
  ]) {
    assert(
      result.requests.some((url) => url.endsWith(resource)),
      `${label}: resource was never loaded: ${resource}`,
    );
  }
  console.log(`PDF regression passed: ${label}`);
}
await check("production", pathToFileURL(path.join(output, "index.html")).href);
// Exercise the same local paths from an ASAR, as used by the installer.
const electronBuilderRequire = createRequire(require.resolve("electron-builder/package.json"));
const builderRequire = createRequire(
  electronBuilderRequire.resolve("app-builder-lib/package.json"),
);
const asar = builderRequire("@electron/asar") as {
  createPackage(source: string, target: string): Promise<void>;
};
const archive = path.join(root, "离线 preview", "app.asar");
await asar.createPackage(output, archive);
await check("asar", pathToFileURL(path.join(archive, "index.html")).href);
const server = await createServer({
  ...loaded.config,
  configFile: false,
  root,
  server: { port: 0, open: false },
});
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  assert(url, "Dev server must expose a local URL");
  await check("development", url);
  const { version } = require("pdfjs-dist/package.json") as { version: string };
  const missing = await fetch(new URL(`pdfjs/${version}/cmaps/not-present.bcmap`, url));
  assert.equal(missing.status, 404, "Missing resources must not return the application HTML");
} finally {
  await server.close();
}
