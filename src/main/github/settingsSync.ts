import os from "node:os";
import { app } from "electron";
import type { GitHubSyncPreview, GitHubSyncResult } from "../../shared/github";
import type { PideskSettings } from "../../shared/ipc";
import {
  diffSyncableSettings,
  parseSettingsSyncEnvelope,
  pickSyncableSettings,
  SETTINGS_GIST_DESCRIPTION,
  SETTINGS_GIST_FILENAME,
  type SettingsSyncEnvelope,
  SYNCABLE_SETTINGS_KEYS,
  type SyncableSettings,
} from "../../shared/settingsSync";
import { onPrefetchSettingChanged } from "../session/speculativePrefetch";
import { getSettings, updateSettings } from "../settings/settings";
import { applyTrayEnabled } from "../window/tray";
import { getAuthMeta, readToken, setGistId, setLastSync } from "./authStore";
import {
  createSecretGist,
  findGistByFilename,
  getGist,
  readGistFile,
  updateGistFile,
} from "./githubApi";

function deviceName(): string {
  return os.hostname() || "PiDesk";
}

function appVersion(): string {
  return app.getVersion();
}

function buildEnvelope(): SettingsSyncEnvelope {
  return {
    format: 1,
    updatedAt: Date.now(),
    appVersion: appVersion(),
    deviceName: deviceName(),
    settings: pickSyncableSettings(getSettings()),
  };
}

function requireToken(): string {
  const token = readToken();
  if (!token) {
    throw new Error("未登录 GitHub，无法同步设置");
  }
  return token;
}

/** 解析或定位 Settings Gist；返回 null 表示云端还没有。 */
async function resolveGist(token: string): Promise<string | null> {
  const { gistId } = getAuthMeta();
  if (gistId) {
    try {
      await getGist(token, gistId);
      return gistId;
    } catch {
      // 本地指针失效，回退按文件名查找
      setGistId(null);
    }
  }
  const found = await findGistByFilename(token, SETTINGS_GIST_FILENAME);
  if (found) {
    setGistId(found.id);
    return found.id;
  }
  return null;
}

function applyPulledSettings(settings: SyncableSettings): string[] {
  const patch: Partial<PideskSettings> = {};
  const keys: string[] = [];
  for (const key of SYNCABLE_SETTINGS_KEYS) {
    if (!(key in settings)) continue;
    (patch as Record<string, unknown>)[key] = settings[key];
    keys.push(key);
  }
  const next = updateSettings(patch);
  // 与 settingsIpc.set 同源副作用（托盘 / 预热），避免 pull 后行为与 UI 脱节
  applyTrayEnabled(next.showInTray);
  if ("sessionPrefetchEnabled" in patch) {
    onPrefetchSettingChanged(next.sessionPrefetchEnabled === true);
  }
  return keys;
}

interface RemoteEnvelope {
  gistId: string;
  envelope: SettingsSyncEnvelope;
  remoteWasNewer: boolean;
}

/** 读取云端信封；无 Gist / 坏文件抛稳定错误码（见 pull / preview）。 */
async function loadRemoteEnvelope(token: string): Promise<RemoteEnvelope> {
  const gistId = await resolveGist(token);
  if (!gistId) {
    throw new Error("no-gist");
  }
  const gist = await getGist(token, gistId);
  const raw = await readGistFile(token, gist, SETTINGS_GIST_FILENAME);
  if (raw == null) {
    throw new Error("Gist 中找不到 pidesk-settings.json");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gist 中的设置文件不是合法 JSON");
  }
  const envelope = parseSettingsSyncEnvelope(parsed);
  if (!envelope) {
    throw new Error("远端设置格式不受支持，未覆盖本地");
  }
  const { lastSyncAt } = getAuthMeta();
  const remoteWasNewer = lastSyncAt == null || envelope.updatedAt > lastSyncAt;
  return { gistId, envelope, remoteWasNewer };
}

/** 本地偏好 → Secret Gist（last-write-wins）。 */
export async function pushSettings(): Promise<GitHubSyncResult> {
  const token = requireToken();
  const envelope = buildEnvelope();
  const content = JSON.stringify(envelope, null, 2);
  const existingId = await resolveGist(token);
  const gist = existingId
    ? await updateGistFile(
        token,
        existingId,
        SETTINGS_GIST_FILENAME,
        content,
        SETTINGS_GIST_DESCRIPTION,
      )
    : await createSecretGist(token, SETTINGS_GIST_FILENAME, content, SETTINGS_GIST_DESCRIPTION);
  setGistId(gist.id);
  const syncedAt = Date.now();
  const name = deviceName();
  setLastSync({ at: syncedAt, deviceName: name, direction: "push" });
  return {
    direction: "push",
    gistId: gist.id,
    syncedAt,
    deviceName: name,
    keys: [...SYNCABLE_SETTINGS_KEYS],
    remoteUpdatedAt: envelope.updatedAt,
    remoteWasNewer: true,
    forced: false,
  };
}

/**
 * 下载前差异预览（不写本地，docs/design/36 P1）。
 * 无 Gist 抛 `no-gist`；其余内容问题抛原文。
 */
export async function previewPullSettings(): Promise<GitHubSyncPreview> {
  const token = requireToken();
  const { gistId, envelope, remoteWasNewer } = await loadRemoteEnvelope(token);
  const local = pickSyncableSettings(getSettings());
  return {
    gistId,
    remoteUpdatedAt: envelope.updatedAt,
    remoteDeviceName: envelope.deviceName || "unknown",
    remoteWasNewer,
    changes: diffSyncableSettings(local, envelope.settings).map((c) => ({
      key: c.key,
      local: c.local,
      remote: c.remote,
    })),
  };
}

/**
 * Secret Gist → 本地白名单键。
 * `force`：远端较旧时仍拉取（UI 确认后调用）。
 */
export async function pullSettings(force = false): Promise<GitHubSyncResult> {
  const token = requireToken();
  const { gistId, envelope, remoteWasNewer } = await loadRemoteEnvelope(token);
  if (!remoteWasNewer && !force) {
    // 稳定错误码，渲染层据此展示「强制下载」而不是把原文当文案
    throw new Error("remote-older");
  }
  const keys = applyPulledSettings(envelope.settings);
  const syncedAt = Date.now();
  setLastSync({
    at: syncedAt,
    deviceName: envelope.deviceName || null,
    direction: "pull",
  });
  return {
    direction: "pull",
    gistId,
    syncedAt,
    deviceName: envelope.deviceName || "unknown",
    keys,
    remoteUpdatedAt: envelope.updatedAt,
    remoteWasNewer,
    forced: force && !remoteWasNewer,
  };
}

/**
 * 登录成功后的自动拉取（P1）：只在非 force 可完成时同步，
 * 无 Gist / 远端较旧 / 网络失败一律吞掉返回 null，不打断登录。
 */
export async function tryAutoPullAfterLogin(): Promise<GitHubSyncResult | null> {
  try {
    return await pullSettings(false);
  } catch {
    return null;
  }
}
