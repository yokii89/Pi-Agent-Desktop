import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Renderer pure tests (no DOM)：stores 状态机 + utils 纯函数 + fileIcons 解析 + 会话区 Markdown 切分纯函数。 */
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  test: {
    include: [
      "stores/**/*.test.ts",
      "utils/**/*.test.ts",
      "components/**/*.test.ts",
      "actions/**/*.test.ts",
      "fileIcons/**/*.test.ts",
    ],
  },
});
