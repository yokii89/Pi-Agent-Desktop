/**
 * PiDesk 本地发版脚本（docs/design/35）：bump package.json 版本 → commit → 打 tag。
 *
 * **不自动 push**，避免误推共享分支；脚本会打印下一步命令，由维护者确认后执行。
 * 把 main 与 `v*` tag 推到发布仓库 Pi-Agent-Desktop 后，由其
 * `.github/workflows/release.yml` 构建 NSIS 安装包并挂到 GitHub Release
 * （含 latest.yml / blockmap，供 electron-updater 发现与差量更新）。
 *
 * 更新日志来自 `release-notes/v<版本>.md`（双语，英文在前）：CI 用 `--notes-file`
 * 直接把它作为 Release 正文。这里在动手改版本前先校验该文件存在且非空——
 * tag 一旦推上去，缺正文只会在 CI 里失败，云端留下一个没有 Release 的 tag。
 *
 * 用法：node scripts/release.mjs 0.3.0
 *       pnpm release 0.3.0
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJsonPath = path.join(projectRoot, "package.json");

const log = (message) => console.log(`[release] ${message}`);
const fail = (message) => {
  console.error(`[release] ${message}`);
  process.exit(1);
};

/** `x.y.z` 或 `x.y.z-<pre>`；不接受 v 前缀（tag 才加 v）。 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function git(args) {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function main() {
  const version = (process.argv[2] ?? "").trim().replace(/^v/i, "");
  if (!SEMVER_RE.test(version)) {
    fail(`非法版本号「${process.argv[2] ?? ""}」，应形如 0.3.0 或 0.3.0-beta.1`);
  }

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const current = pkg.version;
  if (current === version) {
    fail(`package.json 已是 ${version}，无需发版`);
  }
  log(`版本 ${current} -> ${version}`);

  // 工作区必须干净，避免把无关改动打进 release commit
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    fail(`工作区不干净，请先提交或贮藏改动：\n${dirty}`);
  }

  const tag = `v${version}`;
  try {
    git(["rev-parse", tag]);
    fail(`tag ${tag} 已存在`);
  } catch {
    // tag 不存在才继续
  }

  // 正文先于版本号：CI 从 tag 的树里读这个文件，缺了就发不出带说明的 Release
  const notesPath = path.join(projectRoot, "release-notes", `${tag}.md`);
  const notes = existsSync(notesPath) ? readFileSync(notesPath, "utf8").trim() : "";
  if (!notes) {
    fail(
      `缺少更新日志 release-notes/${tag}.md（不存在或为空）。` +
        `写好它并单独提交——工作区干净、文件在 tag 里可读，是 CI 出正文的前提。`,
    );
  }
  log(`更新日志 release-notes/${tag}.md（${notes.length} 字符）`);

  pkg.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  log("已写入 package.json");

  git(["add", "package.json"]);
  git(["commit", "-m", `chore(release): v${version}`]);
  git(["tag", tag]);
  log(`已提交并打上 tag ${tag}`);

  console.log("");
  log("下一步（确认无误后手动执行）：");
  console.log("  git push origin main");
  console.log(`  git push origin ${tag}`);
  console.log("");
  log("推送 tag 后，发布仓库的 CI 将构建安装包并创建 GitHub Release。");
}

main();
