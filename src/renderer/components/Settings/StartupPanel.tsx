import { type ChangeEvent, useEffect, useRef, useState } from "react";
import type { PideskSettings } from "../../../shared/ipc";
import {
  DEFAULT_SPLASH_FONT_PRESET,
  DEFAULT_SPLASH_LOGO_SIZE,
  DEFAULT_SPLASH_SPEED,
  DEFAULT_SPLASH_TEXT_EN,
  DEFAULT_SPLASH_TEXT_SUB,
  DEFAULT_SPLASH_TEXT_ZH,
  isSplashFontPreset,
  isSplashLogoDataUrl,
  SPLASH_FONT_PRESETS,
  SPLASH_LOGO_MAX_BYTES,
  SPLASH_PREVIEW_EVENT,
  type SplashFontPreset,
} from "../../../shared/splash";
import { useT } from "../../hooks/useT";
import { settingsService } from "../../services/settingsService";
import { useUiStore } from "../../stores/uiStore";
import { PiMark } from "../Splash/PiMark";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/** 设置页可选的动画速度档（覆盖 0.35 – 3 常用档位与两端）。 */
const SPEED_OPTIONS = [0.35, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

interface SplashDraft {
  enabled: boolean;
  logoImage: string;
  logoSize: number;
  fontPreset: SplashFontPreset;
  textZh: string;
  textEn: string;
  textSub: string;
  speed: number;
}

function defaultDraft(): SplashDraft {
  return {
    enabled: true,
    logoImage: "",
    logoSize: DEFAULT_SPLASH_LOGO_SIZE,
    fontPreset: DEFAULT_SPLASH_FONT_PRESET,
    textZh: DEFAULT_SPLASH_TEXT_ZH,
    textEn: DEFAULT_SPLASH_TEXT_EN,
    textSub: DEFAULT_SPLASH_TEXT_SUB,
    speed: DEFAULT_SPLASH_SPEED,
  };
}

function draftFromSettings(settings: PideskSettings): SplashDraft {
  return {
    enabled: settings.splashEnabled !== false,
    logoImage: settings.splashLogoImage,
    logoSize: settings.splashLogoSize,
    fontPreset: settings.splashFontPreset,
    textZh: settings.splashTextZh,
    textEn: settings.splashTextEn,
    textSub: settings.splashTextSub,
    speed: settings.splashSpeed,
  };
}

function patchFromDraft(draft: SplashDraft): Partial<PideskSettings> {
  return {
    splashEnabled: draft.enabled,
    splashLogoImage: draft.logoImage,
    splashLogoSize: draft.logoSize,
    splashFontPreset: draft.fontPreset,
    splashTextZh: draft.textZh,
    splashTextEn: draft.textEn,
    splashTextSub: draft.textSub,
    splashSpeed: draft.speed,
  };
}

/**
 * 设置 → 启动动画：开关、标识、三行文案、字体与速度。
 * 面板用草稿态，保存后写 settings.json；「立即预览」先保存再广播预览事件。
 */
export function StartupPanel() {
  const t = useT();
  const { showToast } = useUiStore();
  const [draft, setDraft] = useState<SplashDraft>(defaultDraft);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void settingsService.get().then((settings) => {
      if (cancelled) return;
      if (settings) setDraft(draftFromSettings(settings));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = (next: Partial<SplashDraft>): void => {
    setDraft((prev) => ({ ...prev, ...next }));
  };

  const persist = async (next: SplashDraft, notify = true): Promise<boolean> => {
    setSaving(true);
    const saved = await settingsService.set(patchFromDraft(next));
    setSaving(false);
    if (!saved) {
      showToast(t("settings.startup.saveFailed"));
      return false;
    }
    setDraft(next);
    if (notify) showToast(t("settings.startup.saved"));
    return true;
  };

  const chooseLogo = (): void => fileRef.current?.click();

  const onLogoFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(?:png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      showToast(t("settings.startup.logo.invalidType"));
      return;
    }
    if (file.size > SPLASH_LOGO_MAX_BYTES) {
      showToast(t("settings.startup.logo.tooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      if (!isSplashLogoDataUrl(url)) {
        showToast(t("settings.startup.logo.readFailed"));
        return;
      }
      patch({ logoImage: url });
    };
    reader.onerror = () => showToast(t("settings.startup.logo.readFailed"));
    reader.readAsDataURL(file);
  };

  const preview = async (): Promise<void> => {
    // 预览前先落盘（静默），SplashGate 会重新读取最新设置
    if (await persist(draft, false)) window.dispatchEvent(new Event(SPLASH_PREVIEW_EVENT));
  };

  const reset = async (): Promise<void> => {
    const next = defaultDraft();
    setDraft(next);
    await persist(next);
  };

  const disabled = !ready || saving;

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.startup")}</h2>

      <SettingsSection title={t("settings.startup.group.play")}>
        <SettingRow
          label={t("settings.startup.enabled")}
          description={t("settings.startup.enabled.description")}
          control={
            <Toggle
              checked={draft.enabled}
              disabled={disabled}
              aria-label={t("settings.startup.enabled")}
              onChange={(enabled) => patch({ enabled })}
            />
          }
        />
        <SettingRow
          label={t("settings.startup.speed")}
          description={t("settings.startup.speed.description")}
          control={
            <Select
              className={styles.selectLike}
              value={String(draft.speed)}
              disabled={disabled}
              ariaLabel={t("settings.startup.speed")}
              options={SPEED_OPTIONS.map((speed) => ({
                value: String(speed),
                label: `${speed}×`,
              }))}
              onChange={(value) => patch({ speed: Number(value) })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.startup.group.logo")}>
        <SettingRow
          stack
          label={t("settings.startup.logo")}
          description={t("settings.startup.logo.description")}
          control={
            <div className={styles.splashLogoRow}>
              <div className={styles.splashLogoBox}>
                {draft.logoImage ? <img src={draft.logoImage} alt="" /> : <PiMark />}
              </div>
              <div className={styles.splashLogoActions}>
                <input
                  ref={fileRef}
                  className={styles.hiddenFile}
                  type="file"
                  accept="image/svg+xml,image/png,image/jpeg,image/webp"
                  onChange={onLogoFile}
                />
                <Button disabled={disabled} onClick={chooseLogo}>
                  {t("settings.startup.logo.choose")}
                </Button>
                {draft.logoImage ? (
                  <Button disabled={disabled} onClick={() => patch({ logoImage: "" })}>
                    {t("settings.startup.logo.reset")}
                  </Button>
                ) : null}
              </div>
            </div>
          }
        />
        <SettingRow
          label={t("settings.startup.logoSize")}
          description={t("settings.startup.logoSize.description")}
          control={
            <div className={styles.splashSizeControl}>
              <input
                className={styles.splashSizeRange}
                type="range"
                min={64}
                max={240}
                step={1}
                value={draft.logoSize}
                disabled={disabled}
                aria-label={t("settings.startup.logoSize")}
                onChange={(event) => patch({ logoSize: Number(event.target.value) })}
              />
              <span className={styles.valueText}>{draft.logoSize} px</span>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.startup.group.text")}>
        <SettingRow
          stack
          label={t("settings.startup.text")}
          description={t("settings.startup.text.description")}
          control={
            <div className={styles.splashTextFields}>
              <label className={styles.splashTextField}>
                <span className={styles.splashTextFieldLabel}>{t("settings.startup.textZh")}</span>
                <input
                  className={styles.splashTextInput}
                  type="text"
                  maxLength={64}
                  value={draft.textZh}
                  disabled={disabled}
                  onChange={(event) => patch({ textZh: event.target.value })}
                />
              </label>
              <label className={styles.splashTextField}>
                <span className={styles.splashTextFieldLabel}>{t("settings.startup.textEn")}</span>
                <input
                  className={styles.splashTextInput}
                  type="text"
                  maxLength={64}
                  value={draft.textEn}
                  disabled={disabled}
                  onChange={(event) => patch({ textEn: event.target.value })}
                />
              </label>
              <label className={styles.splashTextField}>
                <span className={styles.splashTextFieldLabel}>{t("settings.startup.textSub")}</span>
                <input
                  className={styles.splashTextInput}
                  type="text"
                  maxLength={64}
                  value={draft.textSub}
                  disabled={disabled}
                  onChange={(event) => patch({ textSub: event.target.value })}
                />
              </label>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.startup.group.font")}>
        <SettingRow
          label={t("settings.startup.fontPreset")}
          description={t("settings.startup.fontPreset.description")}
          control={
            <Select
              className={styles.selectLike}
              value={draft.fontPreset}
              disabled={disabled}
              ariaLabel={t("settings.startup.fontPreset")}
              options={SPLASH_FONT_PRESETS.map((preset) => ({
                value: preset,
                label: t(`settings.startup.fontPreset.${preset}`),
              }))}
              onChange={(value) => {
                if (isSplashFontPreset(value)) patch({ fontPreset: value });
              }}
            />
          }
        />
      </SettingsSection>

      <div className={styles.splashActions}>
        <Button variant="primary" disabled={disabled} onClick={() => void persist(draft)}>
          {saving ? t("settings.startup.saving") : t("settings.startup.save")}
        </Button>
        <Button disabled={disabled} onClick={() => void preview()}>
          {t("settings.startup.preview")}
        </Button>
        <Button disabled={disabled} onClick={() => void reset()}>
          {t("settings.startup.reset")}
        </Button>
      </div>
    </div>
  );
}
