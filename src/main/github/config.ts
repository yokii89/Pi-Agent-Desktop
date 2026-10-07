/**
 * GitHub OAuth App 配置（Device Flow 只需公开 client_id，docs/design/36 §3）。
 * client_id 可公开入库；client_secret 不得写进仓库。开发期可用
 * PIDESK_GITHUB_CLIENT_ID 覆盖。
 */
const FALLBACK_CLIENT_ID = "Ov23liviGyBFJmcx2N2x";

export function getGitHubClientId(): string | null {
  const fromEnv = process.env.PIDESK_GITHUB_CLIENT_ID?.trim();
  if (fromEnv) return fromEnv;
  if (FALLBACK_CLIENT_ID.startsWith("YOUR_") || FALLBACK_CLIENT_ID.length === 0) {
    return null;
  }
  return FALLBACK_CLIENT_ID;
}

export function requireGitHubClientId(): string {
  const id = getGitHubClientId();
  if (!id) {
    throw new Error(
      "未配置 GitHub OAuth client_id（src/main/github/config.ts 或环境变量 PIDESK_GITHUB_CLIENT_ID）",
    );
  }
  return id;
}

/** Device Flow 授权 scope：Gist 读写 + 只读档案（docs/design/36 §9）。 */
export const GITHUB_OAUTH_SCOPES = "gist read:user";
