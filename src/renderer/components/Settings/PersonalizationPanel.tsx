import type { FontMonoPreset, FontUiPreset } from "../../../shared/fontPresets";
import { FONT_MONO_PRESETS, FONT_UI_PRESETS } from "../../../shared/fontPresets";
import { INPUT_BUDDY_KINDS } from "../../../shared/inputBuddy";
import { RAIL_STYLES } from "../../../shared/railStyles";
import { wallpaperFileName, wallpaperKindFromPath } from "../../../shared/wallpaper";
import { useT } from "../../hooks/useT";
import { wallpaperService } from "../../services/wallpaperService";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
import { BuddySwatch } from "./BuddySwatch";
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
    inputBuddy,
    wallpaperPath,
    wallpaperDim,
    hydrated,
    dispatch,
    showToast,
  } = useUiStore();

  const chooseWallpaper = async (): Promise<void> => {
    const picked = await wallpaperService.pick();
    if (!picked) return;
    if (!wallpaperKindFromPath(picked)) {
      showToast(t("settings.personalization.wallpaper.unsupported"));
      return;
    }
    dispatch({ type: "setWallpaperPath", path: picked });
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.personalization")}</h2>
      <p className={styles.panelHint}>{t("settings.personalization.hint")}</p>

      <SettingsSection title={t("settings.personalization.group.wallpaper")}>
        <SettingRow
          label={t("settings.personalization.wallpaper")}
          description={
            wallpaperPath
              ? `${t("settings.personalization.wallpaper.description")} ${t(
                  "settings.personalization.wallpaper.current",
                  { name: wallpaperFileName(wallpaperPath) },
                )}`
              : t("settings.personalization.wallpaper.description")
          }
          control={
            <div className={styles.wallpaperActions}>
              <Button disabled={!hydrated} onClick={() => void chooseWallpaper()}>
                {wallpaperPath
                  ? t("settings.personalization.wallpaper.change")
                  : t("settings.personalization.wallpaper.choose")}
              </Button>
              {wallpaperPath ? (
                <Button
                  disabled={!hydrated}
                  onClick={() => dispatch({ type: "setWallpaperPath", path: null })}
                >
                  {t("settings.personalization.wallpaper.remove")}
                </Button>
              ) : null}
            </div>
          }
        />
        <SettingRow
          label={t("settings.personalization.wallpaperDim")}
          description={t("settings.personalization.wallpaperDim.description")}
          control={
            <div className={styles.splashSizeControl}>
              <input
                className={styles.splashSizeRange}
                type="range"
                min={0}
                max={100}
                step={1}
                value={wallpaperDim}
                disabled={!hydrated || !wallpaperPath}
                aria-label={t("settings.personalization.wallpaperDim")}
                onChange={(event) =>
                  dispatch({ type: "setWallpaperDim", dim: Number(event.target.value) })
                }
              />
              <span className={styles.valueText}>{wallpaperDim}%</span>
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.personalization.group.font")}>
        <SettingRow
          label={t("settings.personalization.fontUi")}
          description={t("settings.personalization.fontUi.description")}
          control={
            <Select
              className={styles.selectLike}
              value={fontUiPreset}
              disabled={!hydrated}
              ariaLabel={t("settings.personalization.fontUi")}
              options={FONT_UI_PRESETS.map((preset) => ({
                value: preset,
                label: t(`settings.personalization.fontUi.preset.${preset}`),
              }))}
              onChange={(next) =>
                dispatch({ type: "setFontUiPreset", preset: next as FontUiPreset })
              }
            />
          }
        />
        <SettingRow
          label={t("settings.personalization.fontMono")}
          description={t("settings.personalization.fontMono.description")}
          control={
            <Select
              className={styles.selectLike}
              value={fontMonoPreset}
              disabled={!hydrated}
              ariaLabel={t("settings.personalization.fontMono")}
              options={FONT_MONO_PRESETS.map((preset) => ({
                value: preset,
                label: t(`settings.personalization.fontMono.preset.${preset}`),
              }))}
              onChange={(next) =>
                dispatch({ type: "setFontMonoPreset", preset: next as FontMonoPreset })
              }
            />
          }
        />
        <SettingRow
          label={t("settings.personalization.streamFont")}
          description={t("settings.personalization.streamFont.description")}
          control={
            <Segmented
              ariaLabel={t("settings.personalization.streamFont")}
              value={String(sessionStreamFontPx)}
              items={FONT_SIZE_OPTIONS.map((option) => ({
                value: String(option.px),
                label: t(option.labelKey),
                disabled: !hydrated,
              }))}
              onChange={(next) => dispatch({ type: "setSessionStreamFont", px: Number(next) })}
            />
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

      <SettingsSection title={t("settings.personalization.group.buddy")}>
        <SettingRow
          // 形象比名字更好认：每一格直接给默认姿态的 SVG，形名只留在读屏与悬停提示里。
          // 档位会随新形象增加而变宽（已 5 款），故不像其余条目那样贴在右侧控件列。
          stack
          label={t("settings.personalization.buddy")}
          description={t("settings.personalization.buddy.description")}
          control={
            <div className={styles.buddySwatches}>
              {INPUT_BUDDY_KINDS.map((kind) => (
                <BuddySwatch
                  key={kind}
                  kind={kind}
                  label={t(`settings.personalization.buddy.option.${kind}`)}
                  selected={inputBuddy === kind}
                  disabled={!hydrated}
                  onSelect={(next) => dispatch({ type: "setInputBuddy", kind: next })}
                />
              ))}
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
}
