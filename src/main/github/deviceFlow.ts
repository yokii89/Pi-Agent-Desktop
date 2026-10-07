import { BrowserWindow } from "electron";
import type { GitHubDeviceStart, GitHubDeviceStatus, GitHubProfile } from "../../shared/github";
import { GITHUB_IPC } from "../../shared/github";
import { saveAuth, setProfile } from "./authStore";
import { GITHUB_OAUTH_SCOPES, requireGitHubClientId } from "./config";
import { fetchGitHubProfile } from "./githubApi";
import { tryAutoPullAfterLogin } from "./settingsSync";

interface DevicePollState {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  timer: NodeJS.Timeout | null;
  cancelled: boolean;
}

let active: DevicePollState | null = null;

function broadcast(status: GitHubDeviceStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(GITHUB_IPC.deviceStatus, status);
  }
}

function clearActive(): void {
  if (active?.timer) clearTimeout(active.timer);
  active = null;
}

/**
 * 启动 Device Flow：申请 user_code 并开始轮询（docs/design/36 §5）。
 * 同一时刻只允许一个进行中的流程；重复调用会取消旧的。
 */
export async function startDeviceFlow(): Promise<GitHubDeviceStart> {
  cancelDeviceFlow("cancelled");
  const clientId = requireGitHubClientId();
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "PiDesk",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: GITHUB_OAUTH_SCOPES,
    }),
  });
  if (!res.ok) {
    throw new Error(`申请 GitHub 设备码失败（HTTP ${res.status}）`);
  }
  const body = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };
  const intervalMs = Math.max(2000, (body.interval ?? 5) * 1000);
  const expiresAt = Date.now() + body.expires_in * 1000;
  const start: GitHubDeviceStart = {
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete:
      body.verification_uri_complete ?? `${body.verification_uri}?user_code=${body.user_code}`,
    expiresAt,
    intervalMs,
  };
  active = {
    deviceCode: body.device_code,
    intervalMs,
    expiresAt,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    verificationUriComplete: start.verificationUriComplete,
    timer: null,
    cancelled: false,
  };
  broadcast({
    phase: "pending",
    userCode: start.userCode,
    verificationUri: start.verificationUri,
    verificationUriComplete: start.verificationUriComplete,
    expiresAt,
    error: null,
  });
  schedulePoll(active);
  return start;
}

function schedulePoll(state: DevicePollState): void {
  state.timer = setTimeout(() => {
    void pollOnce(state);
  }, state.intervalMs);
}

async function pollOnce(state: DevicePollState): Promise<void> {
  if (state.cancelled || active !== state) return;
  if (Date.now() >= state.expiresAt) {
    clearActive();
    broadcast({ phase: "expired", error: "设备码已过期，请重新登录" });
    return;
  }
  const clientId = requireGitHubClientId();
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "PiDesk",
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: state.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    if (!res.ok) {
      clearActive();
      broadcast({ phase: "failed", error: `轮询令牌失败（HTTP ${res.status}）` });
      return;
    }
    const body = (await res.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (body.access_token) {
      const token = body.access_token;
      const scopes = (body.scope ?? GITHUB_OAUTH_SCOPES).split(/[,\s]+/).filter(Boolean);
      let profile: GitHubProfile | null = null;
      try {
        profile = await fetchGitHubProfile(token);
      } catch {
        // 档案拉取失败仍保存登录，Profile 面板可稍后重试
        profile = null;
      }
      saveAuth({ token, scopes, profile });
      if (profile) setProfile(profile);
      clearActive();
      // P1：登录成功后自动 pull（非 force）；失败静默，不挡登录
      const autoSync = await tryAutoPullAfterLogin();
      broadcast({ phase: "authorized", profile, autoSync, error: null });
      return;
    }
    if (body.error === "authorization_pending" || body.error === "slow_down") {
      if (body.error === "slow_down") {
        state.intervalMs = Math.min(state.intervalMs + 2000, 30_000);
      }
      schedulePoll(state);
      return;
    }
    clearActive();
    const message = body.error_description ?? body.error ?? "GitHub 授权未完成";
    broadcast({ phase: "failed", error: message });
  } catch (err) {
    clearActive();
    broadcast({
      phase: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 取消进行中的 Device Flow（用户点取消或再次登录）。 */
export function cancelDeviceFlow(phase: "cancelled" | "idle" = "cancelled"): void {
  if (!active) return;
  const userCode = active.userCode;
  clearActive();
  broadcast({
    phase,
    userCode,
    error: phase === "cancelled" ? null : undefined,
  });
}

/** 当前是否有进行中的 Device Flow（供 IPC 查询，P0 由推送驱动 UI 即可）。 */
export function hasActiveDeviceFlow(): boolean {
  return active !== null;
}

/** 退出登录时同步清理轮询。 */
export function resetDeviceFlow(): void {
  clearActive();
}
