import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const packageRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = require("pdfjs-dist/package.json") as { version: string };
const assetBase = `pdfjs/${version}/`;
const directories = ["cmaps", "standard_fonts", "wasm", "iccs"] as const;

async function resourceFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>([["LICENSE", path.join(packageRoot, "LICENSE")]]);
  for (const directory of directories) {
    for (const entry of await readdir(path.join(packageRoot, directory), { withFileTypes: true })) {
      if (entry.isFile())
        files.set(`${directory}/${entry.name}`, path.join(packageRoot, directory, entry.name));
    }
  }
  return files;
}

/** Keep PDF.js filenames intact: its worker resolves CMaps, fonts and decoders by name. */
export function pdfAssets(): Plugin {
  return {
    name: "pidesk:pdf-assets",
    config() {
      return { define: { __PIDESK_PDF_ASSET_BASE__: JSON.stringify(assetBase) } };
    },
    async configureServer(server) {
      const files = await resourceFiles();
      const base = server.config.base === "./" ? "/" : server.config.base;
      const prefix = `${base}${assetBase}`;
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0] ?? "";
        if (!pathname.startsWith(prefix)) return next();
        const file = files.get(pathname.slice(prefix.length));
        if (!file || (request.method !== "GET" && request.method !== "HEAD")) {
          response.statusCode = 404;
          response.end();
          return;
        }
        void readFile(file).then((data) => {
          const type = file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream";
          response.setHeader("Content-Type", type);
          response.setHeader("Cache-Control", "no-cache");
          response.end(request.method === "HEAD" ? undefined : data);
        }, next);
      });
    },
    async generateBundle() {
      for (const [name, file] of await resourceFiles()) {
        this.emitFile({
          type: "asset",
          fileName: `${assetBase}${name}`,
          source: await readFile(file),
        });
      }
    },
  };
}
