/**
 * 把本地 main 快照同步到发布仓库（yokii89/Pi-Agent-Desktop）。
 *
 * 发布仓库与本地仓库历史独立（它从 "Initial public commit" 单提交起步，
 * 不携带本地提交历史），因此同步不是分支推送，而是：
 *
 *   1. fetch 发布仓库 main 的最新提交，作为父提交；
 *   2. 取本地 HEAD 的目录树——内容与本地完全一致，electron-builder.yml 的
 *      发布源已直接写 Pi-Agent-Desktop，不再需要改写；
 *   3. 用 git commit-tree 把「该树 + 发布仓库父提交」生成一个同步提交并推送。
 *
 * 同步的是已提交的 HEAD，工作区未提交改动不会进入发布仓库；产物是快照式线性
 * 历史（每个同步提交含相对上一提交的全部差异），已发布的 tag 不受影响。
 *
 * `--fresh` 用于把发布仓库历史重写为「单一初始提交」：累积的若干同步提交会被
 * 折叠掉，main 只剩一个无父提交、内容等于当前 HEAD 快照的根提交（因此必须
 * force push）。已发布的 tag / Release 不受影响。
 *
 * 用法：
 *   pnpm sync:public                     # 同步 main 快照
 *   pnpm sync:public -- --tag 0.4.2      # 同步并推 v0.4.2 tag 触发 CI 发版
 *   pnpm sync:public -- --dry-run        # 生成提交但不推送，预览差异
 *   pnpm sync:public -- --fresh          # 把发布仓库 main 重写为单一初始提交
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const PUBLIC_URL = "https://github.com/yokii89/Pi-Agent-Desktop.git";
const PUBLIC_BRANCH = "main";
/** `x.y.z` 或 `x.y.z-<pre>`；不接受 v 前缀（tag 才加 v），与 release.mjs 同一口径。 */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** `--fresh` 重写出的根提交信息，与发布仓库最初的初始提交保持同一口径。 */
const FRESH_MESSAGE = "Initial public commit";

const log = (message) => console.log(`[sync-public] ${message}`);
const fail = (message) => {
  console.error(`[sync-public] ${message}`);
  process.exit(1);
};

function git(args) {
  return execFileSync("git", args, {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
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

  log(`拉取发布仓库 ${PUBLIC_URL} 的 ${PUBLIC_BRANCH}…`);
  git(["fetch", "-q", PUBLIC_URL, PUBLIC_BRANCH]);
  const publicTip = git(["rev-parse", "FETCH_HEAD^{commit}"]);

  // 快照内容与本地 HEAD 逐字节一致（发布源直接写在 electron-builder.yml 里），
  // 不再改写任何文件，因此 HEAD 的树就是要提交的树，无需临时索引。
  const newTree = headTree;

  // 幂等判断：普通同步看内容是否一致即可；--fresh 还要看发布仓库是否已只有一个根提交——
  // 内容一致但历史里还堆着同步提交时，正是需要折叠的情况，不能被内容相等拦下。
  const tipTree = git(["rev-parse", `${publicTip}^{tree}`]);
  const upToDate = fresh
    ? git(["rev-list", "--count", publicTip]) === "1" && newTree === tipTree
    : newTree === tipTree;

  let target = publicTip;
  if (!upToDate) {
    // fresh：无父提交（根提交），历史被折叠；否则以发布仓库当前 main 为父追加快照提交。
    const message = fresh ? FRESH_MESSAGE : `Sync PiDesk@${headSha} (v${version})`;
    const parents = fresh ? [] : ["-p", publicTip];
    target = git(["commit-tree", newTree, ...parents, "-m", message]);
    log(
      fresh
        ? `生成根提交 ${target.slice(0, 12)}（force push，发布仓库历史折叠为单一提交）`
        : `生成同步提交 ${target.slice(0, 12)}（父提交 ${publicTip.slice(0, 12)}）`,
    );
    if (dryRun) {
      log("dry-run：相对发布仓库当前 main 的差异：");
      console.log(git(["diff", "--stat", `${publicTip}..${target}`]) || "（无文件差异）");
      log("dry-run 结束，未推送");
      return;
    }
    const force = fresh ? ["--force"] : [];
    git(["push", ...force, PUBLIC_URL, `${target}:refs/heads/${PUBLIC_BRANCH}`]);
    log(`已推送发布仓库 ${PUBLIC_BRANCH}`);
  } else if (dryRun) {
    log(
      fresh
        ? "发布仓库已是单一初始提交且内容一致，dry-run 结束，未推送"
        : "发布仓库与本地内容一致，dry-run 结束，未推送",
    );
    return;
  } else {
    log(
      fresh ? "发布仓库已是单一初始提交且内容一致，无需重写" : "发布仓库与本地内容一致，无需同步",
    );
  }

  if (tag) {
    git(["push", PUBLIC_URL, `${target}:refs/tags/v${tag}`]);
    log(`已在发布仓库推送 v${tag}，Release workflow 将自动构建发布`);
  }
}

main();
