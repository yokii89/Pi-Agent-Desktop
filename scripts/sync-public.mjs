/**
 * 同步 PiDesk 当前 main 快照到公开镜像仓库（yokii89/Pi-Agent-Desktop）。
 *
 * 镜像仓库与本地仓库历史独立（镜像从 "Initial public commit" 单提交起步，
 * 不携带 PiDesk 的内部提交历史），因此同步不是分支推送，而是：
 *
 *   1. fetch 镜像 main 的最新提交，作为父提交；
 *   2. 取 PiDesk HEAD 的目录树，仅改写 electron-builder.yml 的发布源
 *      （repo: PiDesk → repo: Pi-Agent-Desktop，保证镜像构建的安装包
 *      其 electron-updater 指向镜像自己的 Releases）；
 *   3. 用 git commit-tree 把「改写后的树 + 镜像父提交」生成一个同步提交并推送。
 *
 * 同步的是已提交的 HEAD，工作区未提交改动不会进入镜像；产物是快照式线性
 * 历史（每个同步提交含相对镜像上一提交的全部差异），已发布的 tag 不受影响。
 *
 * `--fresh` 用于把镜像历史重写为「单一初始提交」：镜像上累积的若干同步提交
 * 会被折叠掉，main 只剩一个无父提交、内容等于当前 HEAD 快照的根提交（因此
 * 必须 force push）。已发布的 tag / Release 不受影响。
 *
 * 用法：
 *   pnpm sync:public                     # 同步 main 快照
 *   pnpm sync:public -- --tag 0.4.2      # 同步并在镜像上推 v0.4.2 tag 触发发版
 *   pnpm sync:public -- --dry-run        # 生成提交但不推送，预览差异
 *   pnpm sync:public -- --fresh          # 把镜像 main 重写为单一初始提交
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const PUBLIC_URL = "https://github.com/yokii89/Pi-Agent-Desktop.git";
const PUBLIC_BRANCH = "main";
/** 镜像与主仓库唯一的预期内容差异：electron-builder.yml 的更新源指向镜像自身。 */
const PUBLISH_REPO_REWRITE = [[/^(\s*repo:\s*)PiDesk\s*$/m, "$1Pi-Agent-Desktop"]];
/** `x.y.z` 或 `x.y.z-<pre>`；不接受 v 前缀（tag 才加 v），与 release.mjs 同一口径。 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** `--fresh` 重写出的根提交信息，与镜像最初的初始提交保持同一口径。 */
const FRESH_MESSAGE = "Initial public commit";

const log = (message) => console.log(`[sync-public] ${message}`);
const fail = (message) => {
  console.error(`[sync-public] ${message}`);
  process.exit(1);
};

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    ...opts,
  }).trim();
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const fresh = argv.includes("--fresh");
  let tag = null;
  const tagIdx = argv.indexOf("--tag");
  if (tagIdx !== -1) {
    tag = (argv[tagIdx + 1] ?? "").trim().replace(/^v/i, "");
    if (!SEMVER_RE.test(tag)) {
      fail(`非法版本号「${argv[tagIdx + 1] ?? ""}」，应形如 0.4.2 或 0.4.2-beta.1`);
    }
  }

  const headTree = git(["rev-parse", "HEAD^{tree}"]);
  const headSha = git(["rev-parse", "--short=12", "HEAD"]);
  const { version } = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8"),
  );

  log(`拉取镜像 ${PUBLIC_URL} 的 ${PUBLIC_BRANCH}…`);
  git(["fetch", "-q", PUBLIC_URL, PUBLIC_BRANCH]);
  const publicTip = git(["rev-parse", "FETCH_HEAD^{commit}"]);

  // 临时索引：读入 HEAD 树 → 改写 electron-builder.yml → 写出新树。
  // 不动真实 index，工作区不受影响。
  const indexFile = path.join(tmpdir(), "pidesk-sync-public-index");
  process.on("exit", () => rmSync(indexFile, { force: true }));
  const gitIdx = (args, opts = {}) =>
    git(args, { ...opts, env: { ...process.env, GIT_INDEX_FILE: indexFile } });
  gitIdx(["read-tree", headTree]);
  const builderYml = git(["cat-file", "blob", "HEAD:electron-builder.yml"]);
  const rewritten = PUBLISH_REPO_REWRITE.reduce(
    (text, [pattern, to]) => text.replace(pattern, to),
    builderYml,
  );
  if (rewritten === builderYml) {
    fail("electron-builder.yml 未匹配到「repo: PiDesk」，发布源改写规则需要随配置更新");
  }
  const blob = git(["hash-object", "-w", "--stdin"], { input: rewritten });
  gitIdx(["update-index", "--cacheinfo", `100644,${blob},electron-builder.yml`]);
  const newTree = gitIdx(["write-tree"]);

  // 幂等判断：普通同步看内容是否一致即可；--fresh 还要看镜像是否已只有一个根提交——
  // 内容一致但历史里还堆着同步提交时，正是需要折叠的情况，不能被内容相等拦下。
  const tipTree = git(["rev-parse", `${publicTip}^{tree}`]);
  const upToDate = fresh
    ? git(["rev-list", "--count", publicTip]) === "1" && newTree === tipTree
    : newTree === tipTree;

  let target = publicTip;
  if (!upToDate) {
    // fresh：无父提交（根提交），历史被折叠；否则以镜像当前 main 为父追加快照提交。
    const message = fresh ? FRESH_MESSAGE : `Sync PiDesk@${headSha} (v${version})`;
    const parents = fresh ? [] : ["-p", publicTip];
    target = git(["commit-tree", newTree, ...parents, "-m", message]);
    log(
      fresh
        ? `生成根提交 ${target.slice(0, 12)}（force push，镜像历史折叠为单一提交）`
        : `生成同步提交 ${target.slice(0, 12)}（父提交 ${publicTip.slice(0, 12)}）`,
    );
    if (dryRun) {
      log("dry-run：相对镜像当前 main 的差异：");
      console.log(git(["diff", "--stat", `${publicTip}..${target}`]) || "（无文件差异）");
      log("dry-run 结束，未推送");
      return;
    }
    const force = fresh ? ["--force"] : [];
    git(["push", ...force, PUBLIC_URL, `${target}:refs/heads/${PUBLIC_BRANCH}`]);
    log(`已推送镜像 ${PUBLIC_BRANCH}`);
  } else if (dryRun) {
    log(
      fresh
        ? "镜像已是单一初始提交且内容一致，dry-run 结束，未推送"
        : "镜像与主仓库内容一致，dry-run 结束，未推送",
    );
    return;
  } else {
    log(fresh ? "镜像已是单一初始提交且内容一致，无需重写" : "镜像与主仓库内容一致，无需同步");
  }

  if (tag) {
    git(["push", PUBLIC_URL, `${target}:refs/tags/v${tag}`]);
    log(`已在镜像推送 v${tag}，Release workflow 将自动构建发布`);
  }
}

main();
