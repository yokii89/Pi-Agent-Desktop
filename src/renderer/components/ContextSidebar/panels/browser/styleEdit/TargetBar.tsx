import { Check, Copy, Crosshair, Eraser, Sparkle } from "@phosphor-icons/react";
import { useT } from "../../../../../hooks/useT";
import styles from "./styleEdit.module.css";

/**
 * 样式 tab 目标栏（UI 重设计）：检查目标 + 热更改状态 + 全局动作。
 * 把「在改谁 / 改了多少 / 怎么带走」收进一眼可见的一行。
 */

export interface TargetBarProps {
  label: string;
  selector: string;
  totalEnabled: number;
  navCleared: boolean;
  /** 写路径进行中（debounce 合并后的 IPC 窗口）。 */
  applying?: boolean;
  onCopyCss: () => void;
  onClearAll: () => void;
  onDismissNav: () => void;
}

export function TargetBar({
  label,
  selector,
  totalEnabled,
  navCleared,
  applying,
  onCopyCss,
  onClearAll,
  onDismissNav,
}: TargetBarProps) {
  const t = useT();
  const hasLabel = Boolean(label || selector);
  const chipText = label || selector || t("browser.styles.targetEmpty");
  const badgeClass = [
    styles.liveBadge,
    navCleared ? styles.liveBadgeWarn : "",
    !navCleared && totalEnabled === 0 ? styles.liveBadgeIdle : "",
    applying ? styles.liveBadgeApplying : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={styles.targetBar}>
      <div
        className={[styles.targetChip, hasLabel ? "" : styles.targetChipEmpty].join(" ")}
        title={selector || label}
      >
        <Crosshair size={14} weight="regular" />
        <span className={styles.targetLabel}>{chipText}</span>
      </div>

      <span className={badgeClass} title={t("browser.styles.liveBadgeTitle")}>
        {navCleared ? (
          <>
            <Sparkle size={11} weight="regular" />
            {t("browser.styles.cleared")}
          </>
        ) : (
          <>
            <span className={styles.liveDot} />
            {totalEnabled > 0
              ? applying
                ? t("browser.styles.applying")
                : t("browser.styles.liveCount", { count: totalEnabled })
              : applying
                ? t("browser.styles.applying")
                : t("browser.styles.noLive")}
          </>
        )}
      </span>

      <div className={styles.targetActions}>
        {navCleared ? (
          <button
            type="button"
            className={styles.iconBtn}
            title={t("browser.styles.gotIt")}
            onClick={onDismissNav}
          >
            <Check size={14} weight="regular" />
          </button>
        ) : (
          <>
            <button
              type="button"
              className={styles.iconBtn}
              title={t("browser.styles.copyAsCss")}
              disabled={totalEnabled === 0}
              onClick={onCopyCss}
            >
              <Copy size={14} weight="regular" />
            </button>
            <button
              type="button"
              className={[styles.iconBtn, styles.iconBtnDanger].join(" ")}
              title={t("browser.styles.clearAll")}
              disabled={totalEnabled === 0}
              onClick={onClearAll}
            >
              <Eraser size={14} weight="regular" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
