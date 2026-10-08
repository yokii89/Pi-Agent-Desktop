import { X } from "@phosphor-icons/react";
import type { StylePatchDeclaration } from "../../../../../../shared/ipc";
import { useT } from "../../../../../hooks/useT";
import styles from "./styleEdit.module.css";
import { ValueControl } from "./ValueControl";

/**
 * 调整卡片单行（UI 重设计）：
 * 左勾选开关 · 上名称下值控件 · 悬停露出 !important / 删除。
 * 未启用整行划线；!important 用角标而不是抢按钮位。
 */

export interface PropertyRowProps {
  decl: StylePatchDeclaration;
  compact?: boolean;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onToggleImportant: (name: string, important: boolean) => void;
  onValueChange: (name: string, value: string) => void;
  onValueLive?: (name: string, value: string) => void;
  onRemove: (name: string) => void;
}

export function PropertyRow({
  decl,
  compact,
  onToggleEnabled,
  onToggleImportant,
  onValueChange,
  onValueLive,
  onRemove,
}: PropertyRowProps) {
  const t = useT();
  return (
    <div className={[styles.row, decl.enabled ? "" : styles.rowDisabled].join(" ")}>
      <input
        type="checkbox"
        className={styles.rowToggle}
        checked={decl.enabled}
        title={decl.enabled ? t("browser.styles.toggleOff") : t("browser.styles.toggleOn")}
        aria-label={`${decl.enabled ? t("browser.styles.toggleOffLabel") : t("browser.styles.toggleOnLabel")} ${decl.name}`}
        onChange={(event) => onToggleEnabled(decl.name, event.target.checked)}
      />
      <div className={styles.rowName}>
        <span className={styles.rowNameText} title={decl.name}>
          {decl.name}
        </span>
        <span className={styles.rowColon}>:</span>
        {decl.important && (
          <span className={styles.impBadge} title="!important">
            imp
          </span>
        )}
      </div>
      <div className={styles.rowValueWrap}>
        <div className={[styles.field, decl.enabled ? "" : styles.fieldDisabled].join(" ")}>
          <ValueControl
            name={decl.name}
            value={decl.value}
            disabled={!decl.enabled}
            compact={compact}
            onChange={(value) => onValueChange(decl.name, value)}
            onLive={onValueLive ? (value) => onValueLive(decl.name, value) : undefined}
          />
        </div>
      </div>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={[styles.rowIcon, decl.important ? styles.rowIconOn : ""].join(" ")}
          title={
            decl.important ? t("browser.styles.importantOff") : t("browser.styles.importantOn")
          }
          aria-pressed={decl.important}
          onClick={() => onToggleImportant(decl.name, !decl.important)}
        >
          !
        </button>
        <button
          type="button"
          className={[styles.rowIcon, styles.rowIconDanger].join(" ")}
          title={t("browser.styles.removeDecl")}
          onClick={() => onRemove(decl.name)}
        >
          <X size={13} weight="regular" />
        </button>
      </div>
    </div>
  );
}
