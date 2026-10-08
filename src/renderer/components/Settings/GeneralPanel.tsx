import { useEffect, useState } from "react";
import {
  LOCALE_IDS,
  type LocaleId,
  type LocalePreference,
  normalizeLocalePreference,
} from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import { projectService } from "../../services/projectService";
import { settingsService } from "../../services/settingsService";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/**
 * 常规：应用级通用偏好。
 * 主题/侧边栏归外观；pi 与终端归配置/环境。语言切换写入 settings.locale 并即时生效。
 * 访问模式已改造为扩展注册槽（docs/design/14），无内建门控。
 */
export function GeneralPanel() {
  const t = useT();
  const { browserEnabled, welcomeRecentsEnabled, localePreference, dispatch, showToast } =
    useUiStore();
  const [defaultProjectDir, setDefaultProjectDir] = useState<string | null>(null);
  const [showInTray, setShowInTray] = useState(false);
  const [maxParallelSessions, setMaxParallelSessions] = useState(8);
  const [sessionPrefetchEnabled, setSessionPrefetchEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settingsService.get().then((settings) => {
      if (cancelled) return;
      setDefaultProjectDir(settings?.defaultProjectDir ?? null);
      setShowInTray(settings?.showInTray ?? false);
      setMaxParallelSessions(settings?.maxParallelSessions ?? 8);
      setSessionPrefetchEnabled(settings?.sessionPrefetchEnabled === true);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickDefaultProjectDir = async (): Promise<void> => {
    const dir = await projectService.pickDirectory(defaultProjectDir);
    if (!dir) return;
    const normalized = dir.replace(/[\\/]+$/, "");
    setDefaultProjectDir(normalized);
    await settingsService.set({ defaultProjectDir: normalized });
    showToast(t("settings.general.defaultProjectDir.updated"));
  };

  const clearDefaultProjectDir = async (): Promise<void> => {
    setDefaultProjectDir(null);
    await settingsService.set({ defaultProjectDir: null });
    showToast(t("settings.general.defaultProjectDir.cleared"));
  };

  const changeLocale = (raw: string): void => {
    dispatch({ type: "setLocalePreference", preference: normalizeLocalePreference(raw) });
  };

  const changeShowInTray = async (next: boolean): Promise<void> => {
    setShowInTray(next);
    await settingsService.set({ showInTray: next });
  };

  const changeBrowserEnabled = (next: boolean): void => {
    dispatch({ type: "setBrowserEnabled", enabled: next });
  };

  const changeWelcomeRecents = (next: boolean): void => {
    dispatch({ type: "setWelcomeRecentsEnabled", enabled: next });
  };

  const changeMaxParallel = async (raw: string): Promise<void> => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 32) return;
    setMaxParallelSessions(n);
    await settingsService.set({ maxParallelSessions: n });
  };

  const changeSessionPrefetch = async (next: boolean): Promise<void> => {
    setSessionPrefetchEnabled(next);
    await settingsService.set({ sessionPrefetchEnabled: next });
  };

  const defaultDirDescription = defaultProjectDir
    ? t("settings.general.defaultProjectDir.current", { path: defaultProjectDir })
    : t("settings.general.defaultProjectDir.fallback");

  const localeOptions: Array<{ value: LocalePreference; label: string }> = [
    { value: "system", label: t("common.language.system") },
    ...LOCALE_IDS.map((id: LocaleId) => ({
      value: id,
      label: t(`common.language.${id}`),
    })),
  ];

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.general")}</h2>
      <SettingsSection title={t("settings.general.group.general")}>
        <SettingRow
          label={t("settings.general.defaultProjectDir")}
          description={defaultDirDescription}
          control={
            <div className={styles.controlWithBadge}>
              <Button onClick={() => pickDefaultProjectDir()}>
                {defaultProjectDir ? t("common.change") : t("common.selectDirectory")}
              </Button>
              {defaultProjectDir && (
                <Button onClick={() => clearDefaultProjectDir()}>{t("common.reset")}</Button>
              )}
            </div>
          }
        />
        <SettingRow
          label={t("settings.general.language")}
          description={t("settings.general.language.description")}
          control={
            <select
              className={styles.selectLike}
              value={localePreference}
              aria-label={t("settings.general.language")}
              onChange={(e) => changeLocale(e.target.value)}
            >
              {localeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          label={t("settings.general.showInTray")}
          description={t("settings.general.showInTray.description")}
          control={
            <Toggle
              checked={showInTray}
              disabled={!ready}
              onChange={changeShowInTray}
              aria-label={t("settings.general.showInTray")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.general.group.session")}>
        <SettingRow
          label={t("settings.general.welcomeRecents")}
          description={t("settings.general.welcomeRecents.description")}
          control={
            <Toggle
              checked={welcomeRecentsEnabled}
              onChange={changeWelcomeRecents}
              aria-label={t("settings.general.welcomeRecents")}
            />
          }
        />
        <SettingRow
          label={t("settings.general.maxParallelSessions")}
          description={t("settings.general.maxParallelSessions.description")}
          control={
            <select
              className={styles.selectLike}
              value={String(maxParallelSessions)}
              disabled={!ready}
              aria-label={t("settings.general.maxParallelSessions")}
              onChange={(e) => void changeMaxParallel(e.target.value)}
            >
              {[1, 2, 4, 6, 8, 12, 16, 24, 32].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          label={t("settings.general.sessionPrefetch")}
          description={t("settings.general.sessionPrefetch.description")}
          control={
            <Toggle
              checked={sessionPrefetchEnabled}
              disabled={!ready}
              onChange={changeSessionPrefetch}
              aria-label={t("settings.general.sessionPrefetch")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.general.group.browser")}>
        <SettingRow
          label={t("settings.general.browserEnabled")}
          description={t("settings.general.browserEnabled.description")}
          control={
            <Toggle
              checked={browserEnabled}
              onChange={changeBrowserEnabled}
              aria-label={t("settings.general.browserEnabled")}
            />
          }
        />
      </SettingsSection>
    </div>
  );
}
