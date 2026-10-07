import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * 开发态放宽 CSP。
 *
 * src/renderer/index.html 里那份 CSP 是按生产环境写的严格策略，但 dev server 下：
 * - @vitejs/plugin-react 会往 HTML 注入内联的 React Refresh preamble（script-src 需要 'unsafe-inline'）；
 * - HMR 客户端要连 ws:// 回 dev server（connect-src 需要放行 ws）。
 * 不做替换的话，窗口会白屏并在控制台报大量 CSP 拦截错误。
 *
 * 刻意不写 'unsafe-eval'：Vite 6 + React Refresh 走原生 ESM/HMR，不需要 eval；
 * 一旦写入，Electron 启动时会在渲染层刷
 * `Security Warning (Insecure Content-Security-Policy)`，开发态控制台长期挂一条警告。
 * 若日后某依赖确实要 eval，先确认再加回来，并同步评估这条警告的取舍。
 *
 * 只作用于 serve 阶段：`vite build` 产物里的 CSP 保持仓库中那份严格版本不变。
 */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
].join("; ");

function devCsp(): Plugin {
  return {
    name: "pidesk:dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
        `$1${DEV_CSP}$2`,
      );
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), devCsp()],
  // 类名只由路径决定、不含内容哈希：改 CSS 属性不会让 contenteditable
  // 里已插入的芯片类名失效（Composer 侧另有 className 回写兜底）。
  css: {
    modules: {
      generateScopedName: "[folder]-[name]-[local]",
    },
  },
  server: {
    // 避开 Vite 默认的 5173（本机常被其它 dev 工具占用）。
    // strictPort=false：被占用时自增，dev.mjs 仍从 resolvedUrls 取真实地址。
    port: 5273,
    strictPort: false,
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "src/renderer/index.html"),
        inspector: path.resolve(__dirname, "src/renderer/inspector.html"),
      },
      output: {
        // 按路径切分：包名数组在 pnpm 下经常拆不干净（react 会漏进主 chunk）
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[/\\]node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) {
            return "react-vendor";
          }
          if (/[/\\]node_modules[/\\](@xterm[/\\]xterm|@xterm[/\\]addon-fit)/.test(id)) {
            return "xterm";
          }
          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("node_modules/remark-") ||
            id.includes("node_modules/mdast-") ||
            id.includes("node_modules/micromark") ||
            id.includes("node_modules/hast-") ||
            id.includes("node_modules/unist-")
          ) {
            return "markdown";
          }
          // 只拆 shiki 核心/引擎/主题；语言文法走动态 import，让 Vite 按需分包
          if (/[/\\]node_modules[/\\](@shikijs|shiki)[/\\]/.test(id)) {
            if (/[/\\](langs|themes)[/\\]/.test(id)) return undefined;
            return "shiki";
          }
          return undefined;
        },
      },
    },
  },
});
