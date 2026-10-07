import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { GitHubProfile } from "../../shared/github";

/**
 * GitHub 凭据与同步指针落盘（docs/design/36 §4）。
 * token 经 safeStorage（Windows DPAPI）加密；profile/gistId 明文但不含密钥。
 * 不进 settings.json：凭据与配置分离，且必须整文件加密 token 字段。
 */
interface GitHubAuthFile {
  /** safeStorage.encryptString(token) 的 base64。 */
  encryptedToken: string | null;
  profile: GitHubProfile | null;
  scopes: string[];
  gistId: string | null;
  lastSyncAt: number | null;
  lastSyncDeviceName: string | null;
  lastSyncDirection: "push" | "pull" | null;
}

const EMPTY: GitHubAuthFile = {
  encryptedToken: null,
  profile: null,
  scopes: [],
  gistId: null,
  lastSyncAt: null,
  lastSyncDeviceName: null,
  lastSyncDirection: null,
};

let cache: GitHubAuthFile | null = null;

function authFilePath(): string {
  return path.join(app.getPath("userData"), "github-auth.json");
}

function readFile(): GitHubAuthFile {
  if (cache) return cache;
  let loaded: Partial<GitHubAuthFile> = {};
  try {
    loaded = JSON.parse(fs.readFileSync(authFilePath(), "utf8")) as Partial<GitHubAuthFile>;
  } catch {
    // 首次或损坏：走空档案
  }
  cache = {
    encryptedToken: typeof loaded.encryptedToken === "string" ? loaded.encryptedToken : null,
    profile: loaded.profile ?? null,
    scopes: Array.isArray(loaded.scopes)
      ? loaded.scopes.filter((s): s is string => typeof s === "string")
      : [],
    gistId: typeof loaded.gistId === "string" ? loaded.gistId : null,
    lastSyncAt:
      typeof loaded.lastSyncAt === "number" && Number.isFinite(loaded.lastSyncAt)
        ? loaded.lastSyncAt
        : null,
    lastSyncDeviceName:
      typeof loaded.lastSyncDeviceName === "string" ? loaded.lastSyncDeviceName : null,
    lastSyncDirection:
      loaded.lastSyncDirection === "push" || loaded.lastSyncDirection === "pull"
        ? loaded.lastSyncDirection
        : null,
  };
  return cache;
}

function writeFile(next: GitHubAuthFile): void {
  cache = next;
  const file = authFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
}

/** 读取档案与同步指针（不含 token）。 */
export function getAuthMeta(): Omit<GitHubAuthFile, "encryptedToken"> {
  const { encryptedToken: _token, ...rest } = readFile();
  return rest;
}

/**
 * 读取解密后的 token；safeStorage 不可用或解密失败返回 null。
 * 仅主进程内部使用，禁止经 IPC 暴露。
 */
export function readToken(): string | null {
  const { encryptedToken } = readFile();
  if (!encryptedToken) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encryptedToken, "base64"));
  } catch {
    return null;
  }
}

/**
 * 保存 token + profile。safeStorage 不可用时拒绝写入并抛错，
 * 避免明文落盘（docs/design/36 §11.5）。
 */
export function saveAuth(input: {
  token: string;
  scopes: string[];
  profile: GitHubProfile | null;
}): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统凭据加密不可用，无法安全保存 GitHub 登录状态");
  }
  const encrypted = safeStorage.encryptString(input.token);
  writeFile({
    ...readFile(),
    encryptedToken: encrypted.toString("base64"),
    scopes: input.scopes,
    profile: input.profile,
  });
}

export function setProfile(profile: GitHubProfile | null): void {
  writeFile({ ...readFile(), profile });
}

export function setGistId(gistId: string | null): void {
  writeFile({ ...readFile(), gistId });
}

export function setLastSync(info: {
  at: number;
  deviceName: string | null;
  direction: "push" | "pull";
}): void {
  writeFile({
    ...readFile(),
    lastSyncAt: info.at,
    lastSyncDeviceName: info.deviceName,
    lastSyncDirection: info.direction,
  });
}

/** 退出登录：清 token、profile、gist 指针。 */
export function clearAuth(): void {
  writeFile({ ...EMPTY });
}
