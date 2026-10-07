import type { FontMonoPreset, FontUiPreset } from "../../../shared/fontPresets";
import { FONT_MONO_PRESETS, FONT_UI_PRESETS } from "../../../shared/fontPresets";
import { RAIL_STYLES } from "../../../shared/railStyles";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { RailStyleSwatch } from "./RailStyleSwatch";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/** 可选对话流字号档（px）；默认 16 对齐 tokens 的 --session-stream-font-md。 */
const FONT_SIZE_OPTIONS = [
  { px: 14, labelKey: "settings.personalization.fontSize.small" },
  { px: 16, labelKey: "settings.personalization.fontSize.standard" },
  { px: 18, labelKey: "settings.personalization.fontSize.large" },
  { px: 20, labelKey: "settings.personalization.fontSize.xlarge" },
] as const;

/**
 * 个性化：字体等外观微调。
 * 对话流字号与界面/等宽字体预设经 uiStore 水合/回写 settings，
 * 并写入根元素 CSS 变量即时生效。
 */
export function PersonalizationPanel() {
  const t = useT();
  const {
    sessionStreamFontPx,
    fontUiPreset,
    fontMonoPreset,
    questionRailStyle,
    hydrated,
    dispatch,
  } = useUiStore();

  const uiFontItems: MenuItem[] = FONT_UI_PRESETS.map((preset: FontUiPreset) => ({
    key: preset,
    label: t(`settings.personalization.fontUi.preset.${preset}`),
    hint: fontUiPreset === preset ? t("settings.personalization.font.selected") : undefined,
    onSelect: () => dispatch({ type: "setFontUiPreset", preset }),
  }));

  const monoFontItems: MenuItem[] = FONT_MONO_PRESETS.map((preset: FontMonoPreset) => ({
    key: preset,
    label: t(`settings.personalization.fontMono.preset.${preset}`),
    hint: fontMonoPreset === preset ? t("settings.personalization.font.selected") : undefined,
    onSelect: () => dispatch({ type: "setFontMonoPreset", preset }),
  }));

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.personalization")}</h2>
      <p className={styles.panelHint}>{t("settings.personalization.hint")}</p>

      <SettingsSection title={t("settings.personalization.group.font")}>
        <SettingRow
          label={t("settings.personalization.fontUi")}
          description={t("settings.personalization.fontUi.description")}
          control={
            <Menu
              align="right"
              trigger={({ onClick }) => (
                <Button onClick={onClick} disabled={!hydrated}>
                  {t(`settings.personalization.fontUi.preset.${fontUiPreset}`)}
                </Button>
              )}
              items={uiFontItems}
            />
          }
        />
        <SettingRow
          label={t("settings.personalization.fontMono")}
          description={t("settings.personalization.fontMono.description")}
          control={
            <Menu
              align="right"
              trigger={({ onClick }) => (
                <Button onClick={onClick} disabled={!hydrated}>
                  {t(`settings.personalization.fontMono.preset.${fontMonoPreset}`)}
                </Button>
              )}
              items={monoFontItems}
            />
          }
        />
        <SettingRow
          label={t("settings.personalization.streamFont")}
          description={t("settings.personalization.streamFont.description")}
          control={
            <div className={styles.segmented}>
              {FONT_SIZE_OPTIONS.map((option) => (
                <button
                  key={option.px}
                  type="button"
                  aria-pressed={sessionStreamFontPx === option.px}
                  className={[
                    styles.segment,
                    sessionStreamFontPx === option.px ? styles.segmentActive : "",
                  ]
                    .join(" ")
                    .trim()}
                  disabled={!hydrated}
                  onClick={() => dispatch({ type: "setSessionStreamFont", px: option.px })}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          }
        />
        <SettingRow
          label={t("settings.personalization.preview")}
          description={t("settings.personalization.preview.description", {
            md: sessionStreamFontPx,
            sm: sessionStreamFontPx - 2,
          })}
          control={
            <span className={styles.streamFontPreview}>
              {t("settings.personalization.preview.sample")}
            </span>
          }
        />
        <SettingRow
          label={t("settings.personalization.monoPreview")}
          description={t("settings.personalization.monoPreview.description")}
          control={
            <span className={styles.monoFontPreview}>
              {t("settings.personalization.monoPreview.sample")}
            </span>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.personalization.group.rail")}>
        <div className={styles.railStyleGrid}>
          {RAIL_STYLES.map((style) => (
            <RailStyleSwatch
              key={style}
              style={style}
              label={t(`settings.personalization.railStyle.style.${style}`)}
              selected={questionRailStyle === style}
              disabled={!hydrated}
              onSelect={(next) => dispatch({ type: "setQuestionRailStyle", style: next })}
            />
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}
