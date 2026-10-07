/**
 * PiDesk 打包脚本：一条命令产出 Windows 安装包（NSIS）exe。
 *
 * 编排风格与 dev.mjs 一致——用 Node 内置能力自行编排，零新增依赖：
 * 1. 预检：打包图标（build/icon.ico|png）与 node-pty 的 Windows prebuilds 必须在位
 * 2. 清空产物目录 release/
 * 3. 复用与 `pnpm run build` 相同的两步：tsc 编译主进程/预加载 → vite 构建渲染层
 * 4. electron-builder --win 打包（NSIS，配置见 electron-builder.yml）。
 *    显式 --publish=never：发布交给 CI 的 gh release 步骤，避免构建机上残留
 *    GH_TOKEN 时 electron-builder 自动创建 draft release 造成双重发布
 * 5. 为全部 exe 生成 SHA-256 校验和（release/SHASUMS256.txt，`shasum -a 256 -c` 可验）
 *
 * 用法：pnpm dist
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

const projectRoot = path.resolve(import.meta.dirname, "..");
/** 打包产物目录，与 electron-builder.yml 的 directories.output 对应。 */
const releaseDir = path.join(projectRoot, "release");

// 与 dev.mjs 相同的解析方式：用 process.execPath 跑 js bin，规避 Windows 上 .cmd 需要 shell 的问题。
const binOf = (pkg, rel) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), rel);
const tscBin = binOf("typescript", "bin/tsc");
const viteBin = binOf("vite", "bin/vite.js");
const electronBuilderBin = binOf("electron-builder", "cli.js");

const log = (message) => console.log(`\u001b[35m[dist]\u001b[0m ${message}`);
const fail = (message) => {
  console.error(`\u001b[35m[dist]\u001b[0m ${message}`);
  process.exit(1);
};

/** 运行一个本地 js bin，非零退出码直接终止打包。 */
function run(bin, args) {
  return new Promise((resolve) => {
    log(`${["node", path.relative(projectRoot, bin), ...args].join(" ")}`);
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code !== 0) fail(`上一步退出码 ${code}，打包中止`);
      resolve();
    });
  });
}

/** 预检：缺任何一项都直接失败并给出修复指引，避免打包到一半才发现资产缺失。 */
function preflight() {
  if (!existsSync(path.join(projectRoot, "build", "icon.ico"))) {
    fail("缺少 build/icon.ico，请先运行 pnpm run gen:app-icon（见 build/README.md）");
  }
  if (!existsSync(path.join(projectRoot, "build", "icon.png"))) {
    fail("缺少 build/icon.png，请先运行 pnpm run gen:app-icon（见 build/README.md）");
  }
  // node-pty 的 win32 prebuilds 是 N-API（跨 Node/Electron ABI 通用），electron-builder.yml
  // 因此关掉了重建步骤；这里兜底确认它们真的在位，缺失时让 pnpm install 重跑而不是打出一个起不来的包。
  const prebuildsDir = path.join(projectRoot, "node_modules", "node-pty", "prebuilds", "win32-x64");
  if (!existsSync(prebuildsDir)) {
    fail(`缺少 ${path.relative(projectRoot, prebuildsDir)}，请重新运行 pnpm install`);
  }
}

/** 收集 release/ 下的 exe 产物，写入标准 `shasum -a 256` 格式的校验和文件。 */
function writeChecksums() {
  const exes = readdirSync(releaseDir).filter((name) => name.endsWith(".exe"));
  if (exes.length === 0) fail("release/ 下没有 exe 产物，electron-builder 可能静默失败");

  const lines = exes.map((name) => {
    const hash = createHash("sha256")
      .update(readFileSync(path.join(releaseDir, name)))
      .digest("hex");
    return `${hash}  ${name}`;
  });
  const checksumFile = path.join(releaseDir, "SHASUMS256.txt");
  writeFileSync(checksumFile, `${lines.join("\n")}\n`);
  return { exes, checksumFile };
}

async function main() {
  preflight();

  log("清理产物目录 release/");
  rmSync(releaseDir, { recursive: true, force: true });

  log("编译主进程 / 预加载（tsc）");
  await run(tscBin, ["-p", "tsconfig.main.json"]);

  log("构建渲染层（vite build）");
  await run(viteBin, ["build"]);

  log("electron-builder 打包（NSIS 安装包）…");
  await run(electronBuilderBin, ["--win", "--publish=never"]);

  const { exes, checksumFile } = writeChecksums();
  log("打包完成，产物：");
  for (const name of exes) {
    const sizeMb = (statSync(path.join(releaseDir, name)).size / 1024 / 1024).toFixed(1);
    console.log(`  release/${name}  (${sizeMb} MB)`);
  }
  // electron-updater 必需元数据（docs/design/35）：CI 发 Release 时需一并上传
  const updateMeta = readdirSync(releaseDir).filter(
    (name) => name === "latest.yml" || name.endsWith(".blockmap"),
  );
  for (const name of updateMeta) {
    console.log(`  release/${name}`);
  }
  if (!updateMeta.includes("latest.yml")) {
    fail(
      "缺少 release/latest.yml，electron-updater 无法发现该版本（检查 electron-builder publish 配置）",
    );
  }
  console.log(`  ${path.relative(projectRoot, checksumFile)}`);
}

main().catch((error) => fail(String(error)));
