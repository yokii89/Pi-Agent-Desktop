/**
 * Git 提交作者头像（docs/design/36 P2 前置 / 用户拍板 2026）：
 *
 * 1. **登录 + GitHub remote**：用 OAuth token 拉取该仓库 commits 的
 *    `author.email → avatar_url`，再下载为 data URL（CSP 只允许 self/data:）；
 * 2. **其余情况不猜测**：不解析 noreply、不发 Gravatar，
 *    渲染层直接用「用户名首字母」色块兜底。
 *
 * 主进程收口：CSP、超时、按 URL 去重、避免渲染层外链。
 */

const FETCH_TIMEOUT_MS = 5000;
/** 头像字节上限；超过说明响应不可信。 */
const MAX_BYTES = 256 * 1024;
/** 向 GitHub 要的最近提交页数（100/页）；覆盖图谱 maxCount 常见量级。 */
const COMMIT_PAGES = 2;

/** 远程 URL → GitHub owner/repo；非 GitHub 返回 null。 */
export function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const raw = remoteUrl.trim();
  if (!raw) return null;
  // git@github.com:owner/repo.git | ssh://git@github.com/owner/repo.git
  const ssh = /^(?:ssh:\/\/)?git@github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i.exec(raw);
  if (ssh?.[1] && ssh[2]) {
    return { owner: ssh[1], repo: ssh[2].replace(/\.git$/i, "") };
  }
  // https://github.com/owner/repo(.git) | git://github.com/...
  const https = /^(?:https?|git):\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i.exec(raw);
  if (https?.[1] && https[2]) {
    return { owner: https[1], repo: https[2].replace(/\.git$/i, "") };
  }
  return null;
}

/**
 * 拉取任意图片 URL 转 data URL（CSP img-src 只有 self/data:）。
 * 非图片 / 超时 / 过大返回 null。
 */
export async function fetchImageDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`image http ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) throw new Error(`not image: ${contentType}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("image size异常");
    return `data:${contentType.split(";")[0] ?? "image/png"};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/** URL → data URL 缓存（含失败），会话内每张图只拉一次。 */
const imageCache = new Map<string, string | null>();
const imageInflight = new Map<string, Promise<string | null>>();

function fetchImageDataUrlCached(url: string): Promise<string | null> {
  const cached = imageCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = imageInflight.get(url);
  if (existing) return existing;
  const task = fetchImageDataUrl(url).then((result) => {
    imageCache.set(url, result);
    imageInflight.delete(url);
    return result;
  });
  imageInflight.set(url, task);
  return task;
}

interface GitHubCommitListItem {
  sha?: string;
  author?: { avatar_url?: string | null; login?: string | null } | null;
  commit?: {
    author?: { name?: string | null; email?: string | null } | null;
    committer?: { name?: string | null; email?: string | null } | null;
  } | null;
}

/**
 * 按仓库最近提交建立 `authorEmail → avatar data URL` 映射。
 * 只收集 `emails` 中出现的作者；拿不到头像的邮箱不会写入 map。
 */
export async function fetchGitHubAuthorAvatars(options: {
  token: string;
  owner: string;
  repo: string;
  /** 需要解析的作者邮箱（原始大小写均可，内部统一小写比较）。 */
  emails: string[];
}): Promise<Map<string, string>> {
  const wanted = new Set(options.emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const result = new Map<string, string>();
  if (wanted.size === 0) return result;

  /** email(lower) → avatar_url */
  const urlByEmail = new Map<string, string>();
  for (let page = 1; page <= COMMIT_PAGES; page += 1) {
    if (urlByEmail.size >= wanted.size) break;
    const res = await fetch(
      `https://api.github.com/repos/${options.owner}/${options.repo}/commits?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${options.token}`,
          "User-Agent": "PiDesk",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS * 2),
      },
    );
    if (!res.ok) break;
    const list = (await res.json()) as GitHubCommitListItem[];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const item of list) {
      const avatarUrl = item.author?.avatar_url;
      if (!avatarUrl) continue;
      const emails = [item.commit?.author?.email, item.commit?.committer?.email];
      for (const email of emails) {
        if (!email) continue;
        const key = email.trim().toLowerCase();
        if (wanted.has(key) && !urlByEmail.has(key)) {
          urlByEmail.set(key, avatarUrl);
        }
      }
    }
  }

  await Promise.all(
    [...urlByEmail.entries()].map(async ([email, url]) => {
      const dataUrl = await fetchImageDataUrlCached(url);
      if (dataUrl) result.set(email, dataUrl);
    }),
  );
  return result;
}
