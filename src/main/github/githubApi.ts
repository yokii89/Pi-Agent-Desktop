import type { GitHubProfile } from "../../shared/github";
import { fetchImageDataUrl } from "../git/gitAvatar";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

async function githubFetch(
  token: string,
  pathName: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API}${pathName}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      Authorization: `Bearer ${token}`,
      "User-Agent": "PiDesk",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function readError(res: Response, fallback: string): Promise<Error> {
  let detail = fallback;
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) detail = `${fallback}: ${body.message}`;
  } catch {
    // 保留 fallback
  }
  return new GitHubApiError(detail, res.status);
}

/** GET /user → 档案白名单字段；头像在主进程转 data URL（CSP 挡外链）。 */
export async function fetchGitHubProfile(token: string): Promise<GitHubProfile> {
  const res = await githubFetch(token, "/user");
  if (!res.ok) throw await readError(res, "获取 GitHub 用户信息失败");
  const body = (await res.json()) as {
    id: number;
    login: string;
    name: string | null;
    bio: string | null;
    avatar_url: string;
    html_url: string;
  };
  // s=112 覆盖 56px @2x；失败时 avatarDataUrl 为 null，UI 回退字母占位
  const avatarDataUrl = body.avatar_url
    ? await fetchImageDataUrl(`${body.avatar_url}${body.avatar_url.includes("?") ? "&" : "?"}s=112`)
    : null;
  return {
    id: body.id,
    login: body.login,
    name: body.name ?? null,
    bio: body.bio ?? null,
    avatarUrl: body.avatar_url,
    avatarDataUrl,
    htmlUrl: body.html_url,
  };
}

export interface GistFileContent {
  content: string;
}

export interface GistSummary {
  id: string;
  htmlUrl: string;
  files: Record<string, { filename?: string; content?: string; raw_url?: string }>;
}

function toSummary(body: {
  id: string;
  html_url?: string;
  files?: Record<string, { filename?: string; content?: string; raw_url?: string }>;
}): GistSummary {
  return {
    id: body.id,
    htmlUrl: body.html_url ?? `https://gist.github.com/${body.id}`,
    files: body.files ?? {},
  };
}

/** 在用户 Gist 列表中按文件名查找（分页最多 100 条，足够 P0）。 */
export async function findGistByFilename(
  token: string,
  filename: string,
): Promise<GistSummary | null> {
  const res = await githubFetch(token, "/gists?per_page=100");
  if (!res.ok) throw await readError(res, "读取 GitHub Gist 列表失败");
  const list = (await res.json()) as Array<{
    id: string;
    html_url?: string;
    files?: Record<string, { filename?: string; content?: string; raw_url?: string }>;
  }>;
  for (const item of list) {
    const names = Object.keys(item.files ?? {});
    if (names.includes(filename) || item.files?.[filename]) {
      return toSummary(item);
    }
  }
  return null;
}

export async function getGist(token: string, gistId: string): Promise<GistSummary> {
  const res = await githubFetch(token, `/gists/${gistId}`);
  if (!res.ok) throw await readError(res, "读取 GitHub Gist 失败");
  return toSummary((await res.json()) as Parameters<typeof toSummary>[0]);
}

/** 读取 Gist 中指定文件内容；GitHub 列表 API 可能截断 content，必要时走 raw_url。 */
export async function readGistFile(
  token: string,
  gist: GistSummary,
  filename: string,
): Promise<string | null> {
  const file = gist.files[filename];
  if (!file) return null;
  if (typeof file.content === "string" && file.content.length > 0) {
    return file.content;
  }
  if (file.raw_url) {
    const res = await fetch(file.raw_url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "PiDesk",
      },
    });
    if (!res.ok) throw await readError(res, "下载 Gist 文件失败");
    return await res.text();
  }
  return null;
}

export async function createSecretGist(
  token: string,
  filename: string,
  content: string,
  description: string,
): Promise<GistSummary> {
  const res = await githubFetch(token, "/gists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      public: false,
      files: { [filename]: { content } },
    }),
  });
  if (!res.ok) throw await readError(res, "创建 GitHub Gist 失败");
  return toSummary((await res.json()) as Parameters<typeof toSummary>[0]);
}

export async function updateGistFile(
  token: string,
  gistId: string,
  filename: string,
  content: string,
  description: string,
): Promise<GistSummary> {
  const res = await githubFetch(token, `/gists/${gistId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description,
      files: { [filename]: { content } },
    }),
  });
  if (!res.ok) throw await readError(res, "更新 GitHub Gist 失败");
  return toSummary((await res.json()) as Parameters<typeof toSummary>[0]);
}
