import { ArrowClockwise, ArrowUp, Check, Copy, SignOut, User } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GitHubAuthState,
  GitHubDeviceStatus,
  GitHubSyncPreview,
} from "../../../shared/github";
import { getI18nLocale } from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import { githubService } from "../../services/githubService";
import { Button } from "../ui/Button";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

function formatTime(ms: number | null): string {
  if (!ms) return "—";
  const locale = getI18nLocale() === "zh-CN" ? "zh-CN" : "en-US";
  try {
    return new Date(ms).toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

/** 同步错误码 → 文案；其余原样展示。 */
function syncErrorText(t: ReturnType<typeof useT>, text: string): string {
  if (text === "remote-older") return t("settings.profile.syncRemoteOlder");
  if (text === "no-gist") return t("settings.profile.syncNoGist");
  return text;
}

/**
 * 设置 → 个人资料：GitHub Device Flow 登录（身份展示）+ 偏好同步（docs/design/36）。
 * P1：登录后自动 pull；手动下载前展示差异预览。
 */
export function ProfilePanel() {
  const t = useT();
  const [auth, setAuth] = useState<GitHubAuthState | null>(null);
  const [device, setDevice] = useState<GitHubDeviceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState<"preview" | "push" | "pull" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteOlder, setRemoteOlder] = useState(false);
  const [preview, setPreview] = useState<GitHubSyncPreview | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const deviceRef = useRef<GitHubDeviceStatus | null>(null);
  deviceRef.current = device;

  const refreshAuth = useCallback(async () => {
    const next = await githubService.getAuth();
    setAuth(next);
    return next;
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    return githubService.onDeviceStatus((status) => {
      setDevice(status);
      if (status.phase === "authorized") {
        void refreshAuth();
        setBusy(false);
        setPreview(null);
        if (status.autoSync) {
          setMessage(
            t("settings.profile.autoSyncDone", {
              count: String(status.autoSync.keys.length),
            }),
          );
        } else {
          setMessage(t("settings.profile.loginSuccess"));
        }
        setError(null);
      } else if (status.phase === "failed" || status.phase === "expired") {
        setBusy(false);
        setError(status.error ?? t("settings.profile.loginFailed"));
        setMessage(null);
      } else if (status.phase === "cancelled") {
        setBusy(false);
        setMessage(null);
      }
    });
  }, [refreshAuth, t]);

  // 验证码倒计时
  useEffect(() => {
    if (device?.phase !== "pending" || !device.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [device?.phase, device?.expiresAt]);

  const secondsLeft = useMemo(() => {
    if (device?.phase !== "pending" || !device.expiresAt) return 0;
    return Math.max(0, Math.ceil((device.expiresAt - now) / 1000));
  }, [device?.expiresAt, device?.phase, now]);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    setCopied(false);
    setPreview(null);
    try {
      await githubService.deviceStart();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const cancelLogin = useCallback(() => {
    void githubService.deviceCancel();
    setDevice(null);
    setBusy(false);
  }, []);

  const copyCode = useCallback(async () => {
    const code = deviceRef.current?.userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("settings.profile.copyFailed"));
    }
  }, [t]);

  const openVerify = useCallback(() => {
    const uri = deviceRef.current?.verificationUriComplete ?? deviceRef.current?.verificationUri;
    if (!uri) return;
    void window.pidesk?.window.openExternal(uri);
  }, []);

  const logout = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    setPreview(null);
    const next = await githubService.logout();
    setAuth(next);
    setBusy(false);
  }, []);

  const runPush = useCallback(async () => {
    setSyncBusy("push");
    setError(null);
    setMessage(null);
    setPreview(null);
    setRemoteOlder(false);
    try {
      const result = await githubService.syncPush();
      await refreshAuth();
      setMessage(
        t("settings.profile.syncPushDone", {
          time: formatTime(result.syncedAt),
        }),
      );
    } catch (err) {
      setError(syncErrorText(t, err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncBusy(null);
    }
  }, [refreshAuth, t]);

  /** 点「下载」：先拉差异预览，不写本地。 */
  const openPullPreview = useCallback(async () => {
    setSyncBusy("preview");
    setError(null);
    setMessage(null);
    setRemoteOlder(false);
    try {
      const next = await githubService.syncPreview();
      setPreview(next);
      if (!next.remoteWasNewer) setRemoteOlder(true);
    } catch (err) {
      setPreview(null);
      setError(syncErrorText(t, err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncBusy(null);
    }
  }, [t]);

  const confirmPull = useCallback(
    async (force: boolean) => {
      setSyncBusy("pull");
      setError(null);
      setMessage(null);
      try {
        const result = await githubService.syncPull({ force });
        setPreview(null);
        setRemoteOlder(false);
        await refreshAuth();
        setMessage(
          t("settings.profile.syncPullDone", {
            count: String(result.keys.length),
          }),
        );
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        if (text === "remote-older") {
          setRemoteOlder(true);
          setError(t("settings.profile.syncRemoteOlder"));
        } else {
          setError(syncErrorText(t, text));
        }
      } finally {
        setSyncBusy(null);
      }
    },
    [refreshAuth, t],
  );

  const profile = auth?.profile ?? null;
  const signedIn = auth?.status === "authenticated";
  const pending = device?.phase === "pending";
  const configError = auth?.configError;

  return (
    <div className={styles.panel}>
      <SettingsSection title={t("settings.profile.identity")}>
        {signedIn ? (
          <div className={styles.profileIdentity}>
            {profile?.avatarDataUrl ? (
              <img
                className={styles.profileAvatar}
                src={profile.avatarDataUrl}
                alt=""
                width={56}
                height={56}
              />
            ) : (
              <span className={styles.profileAvatarFallback} aria-hidden="true">
                {(profile?.login ?? "?").slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className={styles.profileIdentityText}>
              <div className={styles.authId}>
                {profile?.name || profile?.login || t("settings.profile.signedIn")}
              </div>
              {profile ? <div className={styles.authMeta}>@{profile.login}</div> : null}
              {profile?.bio ? <div className={styles.rowDescription}>{profile.bio}</div> : null}
            </div>
            <div className={styles.profileIdentityActions}>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  void logout();
                }}
              >
                <SignOut size={16} weight="regular" /> {t("settings.profile.logout")}
              </Button>
            </div>
          </div>
        ) : pending ? (
          <div className={styles.authFormCard}>
            <p className={styles.authFormTitle}>{t("settings.profile.deviceWaiting")}</p>
            <p className={styles.rowDescription}>{t("settings.profile.deviceHint")}</p>
            <div className={styles.deviceCodeRow}>
              <code className={styles.deviceCode}>{device.userCode}</code>
              <Button onClick={() => void copyCode()}>
                {copied ? (
                  <Check size={16} weight="regular" />
                ) : (
                  <Copy size={16} weight="regular" />
                )}{" "}
                {copied ? t("common.copied") : t("settings.profile.copyCode")}
              </Button>
            </div>
            <p className={styles.rowDescription}>
              {t("settings.profile.deviceExpiry", {
                seconds: String(secondsLeft),
              })}
            </p>
            <div className={styles.authFormActions}>
              <Button variant="primary" onClick={openVerify}>
                {t("settings.profile.openVerify")}
              </Button>
              <Button onClick={cancelLogin}>{t("settings.profile.cancel")}</Button>
            </div>
          </div>
        ) : (
          <SettingRow
            label={t("settings.profile.signInLabel")}
            description={configError ?? t("settings.profile.signInDescription")}
            control={
              <Button
                variant="primary"
                disabled={busy || Boolean(configError)}
                onClick={() => {
                  void startLogin();
                }}
              >
                <User size={16} weight="regular" /> {t("settings.profile.signIn")}
              </Button>
            }
          />
        )}
      </SettingsSection>

      {signedIn ? (
        <SettingsSection title={t("settings.profile.sync")}>
          <p className={styles.panelHint}>{t("settings.profile.syncHint")}</p>
          <SettingRow
            label={t("settings.profile.syncPush")}
            description={t("settings.profile.syncPushHint")}
            control={
              <Button
                disabled={syncBusy !== null}
                onClick={() => {
                  void runPush();
                }}
              >
                <ArrowUp size={16} weight="regular" />{" "}
                {syncBusy === "push"
                  ? t("settings.profile.syncing")
                  : t("settings.profile.syncPush")}
              </Button>
            }
          />
          <SettingRow
            label={t("settings.profile.syncPull")}
            description={t("settings.profile.syncPullHint")}
            control={
              <Button
                disabled={syncBusy !== null}
                onClick={() => {
                  void openPullPreview();
                }}
              >
                <ArrowClockwise size={16} weight="regular" />{" "}
                {syncBusy === "preview" || syncBusy === "pull"
                  ? t("settings.profile.syncing")
                  : t("settings.profile.syncPull")}
              </Button>
            }
          />

          {preview ? (
            <div className={styles.syncPreviewCard}>
              <p className={styles.authFormTitle}>{t("settings.profile.previewTitle")}</p>
              <p className={styles.rowDescription}>
                {t("settings.profile.previewMeta", {
                  time: formatTime(preview.remoteUpdatedAt),
                  device: preview.remoteDeviceName,
                })}
              </p>
              {preview.changes.length === 0 ? (
                <p className={styles.rowDescription}>{t("settings.profile.previewSame")}</p>
              ) : (
                <ul className={styles.syncPreviewList}>
                  {preview.changes.map((change) => (
                    <li key={change.key} className={styles.syncPreviewItem}>
                      <span className={styles.syncPreviewKey}>{change.key}</span>
                      <span className={styles.syncPreviewValues}>
                        {change.local} → {change.remote}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.authFormActions}>
                <Button
                  variant="primary"
                  disabled={syncBusy !== null || preview.changes.length === 0}
                  onClick={() => {
                    void confirmPull(!preview.remoteWasNewer);
                  }}
                >
                  {preview.remoteWasNewer
                    ? t("settings.profile.previewConfirm")
                    : t("settings.profile.syncPullForced")}
                </Button>
                <Button
                  disabled={syncBusy !== null}
                  onClick={() => {
                    setPreview(null);
                    setRemoteOlder(false);
                  }}
                >
                  {t("settings.profile.cancel")}
                </Button>
              </div>
            </div>
          ) : null}

          <p className={styles.panelHint}>
            {t("settings.profile.lastSyncLabel")}{" "}
            {t("settings.profile.lastSyncHint", {
              time: formatTime(auth?.lastSyncAt ?? null),
              device: auth?.lastSyncDeviceName ?? "—",
              direction:
                auth?.lastSyncDirection === "push"
                  ? t("settings.profile.directionPush")
                  : auth?.lastSyncDirection === "pull"
                    ? t("settings.profile.directionPull")
                    : "—",
            })}
          </p>
          {!preview && remoteOlder ? (
            <div className={styles.authFormActions}>
              <Button
                disabled={syncBusy !== null}
                onClick={() => {
                  void confirmPull(true);
                }}
              >
                {t("settings.profile.syncPullForced")}
              </Button>
            </div>
          ) : null}
        </SettingsSection>
      ) : null}

      {message ? <p className={styles.panelHint}>{message}</p> : null}
      {error ? <p className={styles.updateStatusError}>{error}</p> : null}
    </div>
  );
}
