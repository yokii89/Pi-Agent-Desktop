import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Main-process pure protocol tests (no Electron). */
const root = fileURLToPath(new URL(".", import.meta.url));
// shared 目录在 root 之外，用绝对 pattern（统一 / 分隔，避免 Windows 反斜杠被当转义）
const sharedDir = fileURLToPath(new URL("../shared", import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  root,
  test: {
    include: [
      "view/**/*.test.ts",
      "browser/**/*.test.ts",
      "session/**/*.test.ts",
      "proc/**/*.test.ts",
      "extension/**/*.test.ts",
      "git/**/*.test.ts",
      "fs/**/*.test.ts",
      "mcp/**/*.test.ts",
      "usage/**/*.test.ts",
      `${sharedDir}/**/*.test.ts`,
    ],
  },
});
