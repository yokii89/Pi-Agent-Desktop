import { SpeakerHigh } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_SCENARIO_HINT_KEYS,
  NOTIFICATION_SCENARIO_LABEL_KEYS,
  NOTIFICATION_SOUNDS,
  type NotificationFocusPolicy,
  type NotificationScenarioConfig,
  type NotificationScenarioId,
  type NotificationSettings,
  type NotificationSoundId,
  normalizeNotificationSettings,
} from "../../../shared/notification";
import { useT } from "../../hooks/useT";
import { notificationService } from "../../services/notificationService";
import { settingsService } from "../../services/settingsService";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

const SCENARIO_ORDER: NotificationScenarioId[] = [
  "completed",
  "failed",
  "needsAttention",
  "interrupted",
  "terminalExit",
  "custom",
];

const FOCUS_POLICY_OPTIONS: {
  value: NotificationFocusPolicy;
  labelKey: string;
  hintKey: string;
}[] = [
  {
    value: "muteActiveFocused",
    labelKey: "notification.focusPolicy.muteActiveFocused",
    hintKey: "notification.focusPolicyHint.muteActiveFocused",
  },
  {
    value: "muteWhenFocused",
    labelKey: "notification.focusPolicy.muteWhenFocused",
    hintKey: "notification.focusPolicyHint.muteWhenFocused",
  },
  {
    value: "always",
    labelKey: "notification.focusPolicy.always",
    hintKey: "notification.focusPolicyHint.always",
  },
];

/**
 * 设置 → 通知：系统提示音（docs/design/18）+ 桌面 toast 开关（docs/design/24）。
 * 全局开关 / 音量 / 焦点策略 / 分场景音色与试听。
 */
export function NotificationsPanel() {
  const t = useT();
  const [settings, setSettings] = useState<NotificationSettings>(() => ({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    scenarios: { ...DEFAULT_NOTIFICATION_SETTINGS.scenarios },
  }));
  const [ready, setReady] = useState(false);

  const soundLabel = useCallback(
    (sound: NotificationSoundId) => t("notification.panel.soundLabel", { id: sound }),
    [t],
  );

  useEffect(() => {
    let cancelled = false;
    void settingsService.get().then((loaded) => {
      if (cancelled) return;
      const next = normalizeNotificationSettings(loaded?.notification);
      setSettings(next);
      notificationService.applySettings(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: NotificationSettings): Promise<void> => {
    setSettings(next);
    notificationService.applySettings(next);
    await settingsService.set({ notification: next });
  }, []);

  const patchRoot = useCallback(
    async (patch: Partial<NotificationSettings>): Promise<void> => {
      await persist({ ...settings, ...patch });
    },
    [persist, settings],
  );

  const patchScenario = useCallback(
    async (
      id: NotificationScenarioId,
      patch: Partial<NotificationScenarioConfig>,
    ): Promise<void> => {
      const current = settings.scenarios[id];
      await persist({
        ...settings,
        scenarios: {
          ...settings.scenarios,
          [id]: { ...current, ...patch },
        },
      });
    },
    [persist, settings],
  );

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.notifications")}</h2>
      <p className={styles.panelHint}>{t("notification.panel.hint")}</p>

      <SettingsSection title={t("notification.panel.group.sound")}>
        <SettingRow
          label={t("notification.panel.enable")}
          description={t("notification.panel.enable.description")}
          control={
            <Toggle
              checked={settings.enabled}
              disabled={!ready}
              onChange={(next) => void patchRoot({ enabled: next })}
              aria-label={t("notification.panel.enable")}
            />
          }
        />
        <SettingRow
          label={t("notification.panel.volume")}
          description={`${Math.round(settings.volume * 100)}%`}
          control={
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.volume * 100)}
              disabled={!ready || !settings.enabled}
              aria-label={t("notification.panel.volume")}
              onChange={(event) => {
                const volume = Number(event.target.value) / 100;
                setSettings((prev) => ({ ...prev, volume }));
              }}
              onPointerUp={(event) => {
                const volume = Number((event.target as HTMLInputElement).value) / 100;
                void patchRoot({ volume });
              }}
              onKeyUp={(event) => {
                const volume = Number((event.target as HTMLInputElement).value) / 100;
                void patchRoot({ volume });
              }}
            />
          }
        />
        <SettingRow
          label={t("notification.panel.focusPolicy")}
          description={
            FOCUS_POLICY_OPTIONS.find((o) => o.value === settings.focusPolicy)
              ? t(
                  FOCUS_POLICY_OPTIONS.find((o) => o.value === settings.focusPolicy)?.hintKey ??
                    "notification.focusPolicyHint.always",
                )
              : t("notification.panel.focusPolicy")
          }
          control={
            <select
              className={styles.selectLike}
              value={settings.focusPolicy}
              disabled={!ready}
              aria-label={t("notification.panel.focusPolicy")}
              onChange={(event) =>
                void patchRoot({ focusPolicy: event.target.value as NotificationFocusPolicy })
              }
            >
              {FOCUS_POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          }
        />
        <SettingRow
          label={t("notification.panel.critical")}
          description={t("notification.panel.critical.description")}
          control={
            <Toggle
              checked={settings.criticalIgnoresFocus}
              disabled={!ready || !settings.enabled}
              onChange={(next) => void patchRoot({ criticalIgnoresFocus: next })}
              aria-label={t("notification.panel.critical")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("notification.panel.group.toast")}>
        <SettingRow
          label={t("notification.panel.systemToast")}
          description={t("notification.panel.systemToast.description")}
          control={
            <Toggle
              checked={settings.systemToast}
              disabled={!ready}
              onChange={(next) => void patchRoot({ systemToast: next })}
              aria-label={t("notification.panel.systemToast")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("notification.panel.group.scenarios")}>
        <p className={styles.panelHint}>{t("notification.panel.scenarioNote")}</p>
        {SCENARIO_ORDER.map((id) => {
          const cfg = settings.scenarios[id];
          const name = t(NOTIFICATION_SCENARIO_LABEL_KEYS[id]);
          return (
            <SettingRow
              key={id}
              label={name}
              description={t(NOTIFICATION_SCENARIO_HINT_KEYS[id])}
              control={
                <div className={styles.controlWithBadge}>
                  {/* 场景开关同时门禁声音与桌面 toast，不随提示音总开关禁用 */}
                  <Toggle
                    checked={cfg.enabled}
                    disabled={!ready}
                    onChange={(next) => void patchScenario(id, { enabled: next })}
                    aria-label={t("notification.panel.scenarioEnable", { name })}
                  />
                  <select
                    className={styles.selectLike}
                    value={cfg.sound}
                    disabled={!ready}
                    aria-label={t("notification.panel.scenarioSound", { name })}
                    onChange={(event) =>
                      void patchScenario(id, {
                        sound: event.target.value as NotificationSoundId,
                      })
                    }
                  >
                    {NOTIFICATION_SOUNDS.map((sound) => (
                      <option key={sound} value={sound}>
                        {soundLabel(sound)}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => notificationService.preview(cfg.sound)} disabled={!ready}>
                    <SpeakerHigh size={16} weight="regular" />
                    {t("notification.panel.preview")}
                  </Button>
                </div>
              }
            />
          );
        })}
      </SettingsSection>

      <SettingsSection title={t("notification.panel.group.sound")}>
        <SettingRow
          label={t("notification.panel.soundLabel", { id: "1–5" })}
          description={t("notification.panel.sdkNote")}
          control={
            <div className={styles.controlWithBadge}>
              {NOTIFICATION_SOUNDS.map((sound) => (
                <Button key={sound} onClick={() => notificationService.preview(sound)}>
                  <SpeakerHigh size={16} weight="regular" />
                  {soundLabel(sound)}
                </Button>
              ))}
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}
