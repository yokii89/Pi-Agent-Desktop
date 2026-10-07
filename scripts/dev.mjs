/**
 * PiDesk 开发态启动器：一条命令拉起「渲染层 HMR + 主进程/预加载热重启」。
 *
 * 为什么不用 electron-vite / vite-plugin-electron：
 * 两者都要新增依赖、并把构建产物布局收归自己的约定（本项目主进程走 tsc → dist/main，
 * 渲染层走 vite → dist/renderer）。收益只是省掉下面这点编排，代价是构建链路被第三方接管，
 * 因此这里用 Node 内置能力自行编排，零新增依赖。
 *
 * 链路：
 * 1. 先跑一次 tsc 编译主进程/预加载；失败直接退出，避免拉起一个连 preload 都没有的空壳窗口
 * 2. 用 Vite 的 Node API 启动 dev server，拿 resolvedUrls 里的真实地址
 *    （首选端口见 vite.config.ts server.port；被占用时 Vite 会自增，所以不写死）
 * 3. 以 PIDESK_DEV_SERVER_URL 拉起 Electron，主进程据此 loadURL 而非 loadFile
 * 4. 监听 src/main、src/preload、src/shared：变更 → 重新 tsc → 重启 Electron
 * 5. 不监听 src/renderer：Vite 原生 HMR 已覆盖，改组件/样式只热替换模块，不重启窗口
 * 6. 过滤 Electron stderr 里 DevTools 自身的报错（见 devtools-noise-filter.mjs），
 *    其余日志一律原样透传
 *
 * 用法：pnpm dev（Ctrl+C 或关闭应用窗口结束整条链路）；
 * 额外参数透传给 Electron，如 `pnpm dev -- --inspect=9229`。
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { createServer } from "vite";
import { createDevtoolsNoiseFilter } from "./devtools-noise-filter.mjs";

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(import.meta.dirname, "..");
/** electron 包在 Node 环境下的默认导出就是可执行文件路径。 */
const electronBin = require("electron");
/** 用 process.execPath 跑 tsc，规避 Windows 上 .cmd 需要 shell 的问题。 */
const tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");

/** 需要「改了就重启 Electron」的源码目录，路径相对 projectRoot。 */
const MAIN_WATCH_DIRS = ["src/main", "src/preload", "src/shared"];
/**
 * 透传给 Electron 的额外参数，如 `pnpm dev -- --inspect=9229`。
 * 必须滤掉裸分隔符 `--`：实测 pnpm v12 会把它本身也传下来，而 Chromium 遇到裸 `--`
 * 会停止解析后续开关，导致 `--inspect`、`--user-data-dir` 等静默失效。
 */
const passthroughArgs = process.argv.slice(2).filter((arg) => arg !== "--");
/**
 * 默认给 Electron 的参数（放在用户透传参数之前，用户仍可覆盖）。
 *
 * `--lang=en-US`：Electron 只打包 en-US 的 DevTools 文案；进程 locale 为 zh-CN 时，
 * DevTools 会构造 `language-mismatch` Visual-Element 上下文并在 stderr 刷
 * `Unknown VE context` 报错（见 devtools-noise-filter.mjs）。对齐 locale 后该路径不再触发。
 */
const defaultElectronArgs = ["--lang=en-US"];
/** 合并短时间内的连续文件事件（编辑器保存常触发多次 rename/change）。 */
const REBUILD_DEBOUNCE_MS = 150;
/** 重启前等待旧进程退出的上限，超时就不再等，防止卡住整条链路。 */
const EXIT_TIMEOUT_MS = 3000;

/** @type {import("node:child_process").ChildProcess | null} */
let electronChild = null;
/** @type {import("vite").ViteDevServer | null} */
let viteServer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let rebuildTimer = null;
/** @type {import("node:fs").FSWatcher[]} */
const watchers = [];
/** 整个开发会话是否正在收尾。 */
let quitting = false;
/** 当前这次子进程退出是否由我们主动重启触发。 */
let restarting = false;

const log = (message) => console.log(`\u001b[36m[dev]\u001b[0m ${message}`);

/** 运行一次主进程/预加载的类型编译，返回是否成功。 */
function compileMain() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tscBin, "-p", "tsconfig.main.json"], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

/** 结束 Electron 进程树：Windows 下必须 /T，否则渲染进程与 node-pty 子 shell 会变孤儿。 */
function killElectronTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function spawnElectron(rendererUrl) {
  // stderr 单独走管道，用于滤掉 DevTools 自身报错（见 devtools-noise-filter.mjs）；
  // stdout 保持 inherit，应用自己的日志不受影响。
  // PIDESK_SHOW_DEVTOOLS_NOISE=1 时不做过滤，便于排查 DevTools 相关问题。
  const noiseFilter = process.env.PIDESK_SHOW_DEVTOOLS_NOISE ? null : createDevtoolsNoiseFilter();

  // 透传参数见 passthroughArgs：--inspect=9229 / --disable-gpu /
  // --user-data-dir=<dir>（后者用于和另一份正在运行的 PiDesk 隔离 profile，避免争抢缓存目录）
  // defaultElectronArgs 在前，用户透传参数可覆盖同名开关。
  const child = spawn(electronBin, [".", ...defaultElectronArgs, ...passthroughArgs], {
    cwd: projectRoot,
    stdio: ["inherit", "inherit", noiseFilter ? "pipe" : "inherit"],
    env: { ...process.env, PIDESK_DEV_SERVER_URL: rendererUrl },
  });

  if (noiseFilter && child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const text = noiseFilter.feed(chunk);
      if (text) process.stderr.write(text);
    });
    child.stderr.on("end", () => {
      const rest = noiseFilter.flush();
      if (rest) process.stderr.write(rest);
    });
    // 过滤掉的条数要对用户可见——静默吞日志会让人怀疑「日志链路坏了」
    child.on("exit", () => {
      const dropped = noiseFilter.dropped();
      if (dropped > 0) {
        log(
          `已过滤 ${dropped} 行 DevTools 自身报错（Autofill CDP 域未实现 / DevTools 界面语言不匹配）；` +
            "要看原始输出设 PIDESK_SHOW_DEVTOOLS_NOISE=1",
        );
      }
    });
  }

  child.on("exit", () => {
    if (electronChild === child) electronChild = null;
    if (restarting || quitting) return;
    // 用户关掉了应用窗口：不再需要 dev server，整条链路一起退出
    log("Electron 已退出，关闭开发会话");
    void shutdown(0);
  });

  electronChild = child;
  return child;
}

/** 停掉当前 Electron 并等它真正退出（或超时兜底），再拉起新的实例。 */
async function restartElectron(rendererUrl) {
  if (quitting) return;
  restarting = true;

  const child = electronChild;
  if (child) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    killElectronTree(child);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, EXIT_TIMEOUT_MS))]);
  }
  electronChild = null;
  restarting = false;

  if (quitting) return;
  log("重启 Electron");
  spawnElectron(rendererUrl);
}

/** 防抖后重编译主进程；编译失败则保留当前实例，避免陷入「打开即报错」的重启循环。 */
function scheduleRebuild(rendererUrl) {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null;
    log("主进程侧代码变更，重新编译…");
    const ok = await compileMain();
    if (!ok) {
      console.error("[dev] 编译失败，已保留当前运行中的 Electron 实例");
      return;
    }
    await restartElectron(rendererUrl);
  }, REBUILD_DEBOUNCE_MS);
}

function startWatching(rendererUrl) {
  for (const dir of MAIN_WATCH_DIRS) {
    const watcher = watch(path.join(projectRoot, dir), { recursive: true }, (_event, filename) => {
      // filename 为 null 时（Windows 偶发）宁可多编译一次也不漏更新
      if (filename && !filename.endsWith(".ts")) return;
      scheduleRebuild(rendererUrl);
    });
    watchers.push(watcher);
  }
}

async function shutdown(code) {
  if (quitting) return;
  quitting = true;

  if (rebuildTimer) clearTimeout(rebuildTimer);
  for (const watcher of watchers) watcher.close();
  watchers.length = 0;

  killElectronTree(electronChild);
  electronChild = null;

  if (viteServer) await viteServer.close().catch(() => {});

  process.exit(code);
}

async function main() {
  log("编译主进程 / 预加载…");
  if (!(await compileMain())) {
    console.error("[dev] 主进程编译失败，请先修掉上面的类型错误");
    process.exit(1);
  }

  viteServer = await createServer({
    configFile: path.join(projectRoot, "vite.config.ts"),
    mode: "development",
  });
  await viteServer.listen();

  const rendererUrl = viteServer.resolvedUrls?.local?.[0];
  if (!rendererUrl) {
    console.error("[dev] 未拿到 Vite dev server 地址，无法启动 Electron");
    await viteServer.close();
    process.exit(1);
  }
  log(`渲染层 HMR：${rendererUrl}`);

  spawnElectron(rendererUrl);
  startWatching(rendererUrl);

  log(
    `监听 ${MAIN_WATCH_DIRS.join(" / ")}（主进程变更自动重启）；` +
      "src/renderer 走原生 HMR。Ctrl+C 退出。",
  );
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

main().catch(async (error) => {
  console.error("[dev] 启动失败：", error);
  await shutdown(1);
});
