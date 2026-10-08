import { ipcMain } from "electron";
import type {
  GitHubAuthState,
  GitHubDeviceStart,
  GitHubProfile,
  GitHubSyncPreview,
  GitHubSyncResult,
} from "../../shared/github";
import { GITHUB_IPC } from "../../shared/github";
import type { IpcResult } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { clearAuth, getAuthMeta, readToken, setProfile } from "./authStore";
import { getGitHubClientId } from "./config";
import { cancelDeviceFlow, resetDeviceFlow, startDeviceFlow } from "./deviceFlow";
import { fetchGitHubProfile } from "./githubApi";
import { previewPullSettings, pullSettings, pushSettings } from "./settingsSync";

/** 旧缓存档案可能缺 avatarDataUrl（CSP 不能挂外链）；缺则补拉一次并回写。 */
async function ensureAvatar(profile: GitHubProfile | null): Promise<GitHubProfile | null> {
  if (!profile || profile.avatarDataUrl) return profile;
  const token = readToken();
  if (!token) return profile;
  try {
    const fresh = await fetchGitHubProfile(token);
    setProfile(fresh);
    return fresh;
  } catch {
    return profile;
  }
}

function buildAuthState(profile: GitHubProfile | null): GitHubAuthState {
  const meta = getAuthMeta();
  const hasToken = readToken() != null;
  const configError = getGitHubClientId() ? null : "未配置 GitHub OAuth client_id，无法登录";
  return {
    status: hasToken ? "authenticated" : "signed-out",
    profile,
    gistId: meta.gistId,
    lastSyncAt: meta.lastSyncAt,
    lastSyncDeviceName: meta.lastSyncDeviceName,
    lastSyncDirection: meta.lastSyncDirection,
    configError,
  };
}

/** GitHub 登录 / 设置同步 IPC（docs/design/36 §7）。 */
export function registerGitHubIpc(): void {
  ipcMain.handle(
    GITHUB_IPC.deviceStart,
    (): Promise<IpcResult<GitHubDeviceStart>> => envelopeAsync(async () => startDeviceFlow()),
  );

  ipcMain.handle(GITHUB_IPC.deviceCancel, (): IpcResult<null> => {
    cancelDeviceFlow("cancelled");
    return { ok: true, data: null };
  });

  ipcMain.handle(
    GITHUB_IPC.getAuth,
    (): Promise<IpcResult<GitHubAuthState>> =>
      envelopeAsync(async () => {
        const meta = getAuthMeta();
        const profile = await ensureAvatar(meta.profile);
        return buildAuthState(profile);
      }),
  );

  ipcMain.handle(GITHUB_IPC.logout, (): IpcResult<GitHubAuthState> => {
    resetDeviceFlow();
    clearAuth();
    return { ok: true, data: buildAuthState(null) };
  });

  ipcMain.handle(
    GITHUB_IPC.syncPush,
    (): Promise<IpcResult<GitHubSyncResult>> => envelopeAsync(async () => pushSettings()),
  );

  ipcMain.handle(
    GITHUB_IPC.syncPull,
    (_event, options?: { force?: boolean }): Promise<IpcResult<GitHubSyncResult>> =>
      envelopeAsync(async () => pullSettings(options?.force === true)),
  );

  ipcMain.handle(
    GITHUB_IPC.syncPreview,
    (): Promise<IpcResult<GitHubSyncPreview>> => envelopeAsync(async () => previewPullSettings()),
  );
}
