import { Check } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { AppIconId } from "../../../shared/appIcon";
import { APP_ICON_IDS, DEFAULT_APP_ICON_ID } from "../../../shared/appIcon";
import bluePreview from "../../assets/app-icon/preview/blue.png";
// 设置页只展示 52px 方块：用 128px 缩略图（pnpm run gen:app-icon 生成），别把 1024 母版打进包
import classicPreview from "../../assets/app-icon/preview/classic.png";
import greenPreview from "../../assets/app-icon/preview/green.png";
import pinkPreview from "../../assets/app-icon/preview/pink.png";
import yellowPreview from "../../assets/app-icon/preview/yellow.png";
import { useT } from "../../hooks/useT";
import { settingsService } from "../../services/settingsService";
import { useUiStore } from "../../stores/uiStore";
import styles from "./AppIconSettings.module.css";

const ICON_PREVIEWS: Record<AppIconId, string> = {
  classic: classicPreview,
  blue: bluePreview,
  green: greenPreview,
  pink: pinkPreview,
  yellow: yellowPreview,
};

/** 内置应用图标选择：保存即就地应用（窗口 / 任务栏 / 托盘 / 快捷方式），无需重启。 */
export function AppIconSettings() {
  const t = useT();
  const { showToast } = useUiStore();
  const [selected, setSelected] = useState<AppIconId>(DEFAULT_APP_ICON_ID);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const saving = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void settingsService.get().then((settings) => {
      if (cancelled) return;
      if (settings) setSelected(settings.appIcon ?? DEFAULT_APP_ICON_ID);
      setReady(true);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);

  async function choose(icon: AppIconId) {
    if (!ready || saving.current || icon === selected) return;
    saving.current = true;
    setBusy(true);
    const result = await settingsService.applyAppIcon(icon);
    saving.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (!result) {
      showToast(t("settings.personalization.appIcon.saveFailed"));
      return;
    }
    setSelected(result.settings.appIcon);
    showToast(
      t(
        result.shortcutUpdateFailed
          ? "settings.personalization.appIcon.savedShortcutFailed"
          : "settings.personalization.appIcon.saved",
      ),
    );
  }

  return (
    <fieldset
      className={styles.grid}
      aria-label={t("settings.personalization.appIcon")}
      aria-busy={!ready || busy}
    >
      {APP_ICON_IDS.map((icon) => {
        const label = t(`settings.personalization.appIcon.option.${icon}`);
        const isSelected = selected === icon;
        return (
          <button
            key={icon}
            type="button"
            className={`${styles.swatch} ${isSelected ? styles.selected : ""}`}
            aria-pressed={isSelected}
            aria-label={label}
            title={label}
            disabled={!ready || busy}
            onClick={() => void choose(icon)}
          >
            <img className={styles.preview} src={ICON_PREVIEWS[icon]} alt="" draggable={false} />
            <span className={styles.label}>{label}</span>
            {isSelected && (
              <span className={styles.check} aria-hidden>
                <Check size={16} weight="regular" />
              </span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
