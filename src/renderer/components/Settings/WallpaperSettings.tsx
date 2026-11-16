import { useRef, useState } from "react";
import { wallpaperFileName, wallpaperKindFromPath } from "../../../shared/wallpaper";
import { useT } from "../../hooks/useT";
import { wallpaperService } from "../../services/wallpaperService";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/** 壁纸选择与保存串行完成，主进程确认后才让背景组件请求新媒体。 */
export function WallpaperSettings() {
  const t = useT();
  const { wallpaperPath, wallpaperDim, hydrated, dispatch, showToast } = useUiStore();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const changeWallpaper = async (choose: boolean): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    let stage: "pick" | "save" = choose ? "pick" : "save";
    try {
      const picked = choose ? await wallpaperService.pick() : null;
      if (choose && picked === null) return;
      if (picked && !wallpaperKindFromPath(picked)) {
        showToast(t("settings.personalization.wallpaper.unsupported"));
        return;
      }
      stage = "save";
      const saved = await wallpaperService.save(picked);
      dispatch({ type: "setWallpaperPath", path: saved });
    } catch (error) {
      showToast(
        t(
          stage === "pick"
            ? "settings.personalization.wallpaper.pickFailed"
            : "settings.personalization.wallpaper.saveFailed",
          { error: error instanceof Error ? error.message : String(error) },
        ),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
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
          <div className={styles.wallpaperActions} aria-busy={busy}>
            <Button disabled={!hydrated || busy} onClick={() => void changeWallpaper(true)}>
              {wallpaperPath
                ? t("settings.personalization.wallpaper.change")
                : t("settings.personalization.wallpaper.choose")}
            </Button>
            {wallpaperPath ? (
              <Button disabled={!hydrated || busy} onClick={() => void changeWallpaper(false)}>
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
  );
}
