import { Check, Desktop } from "@phosphor-icons/react";
import type { AccentColorPreference } from "../../../shared/accentColor";
import styles from "./AccentSwatch.module.css";

interface AccentSwatchProps {
  /** 主题色偏好：固定色、应用默认或跟随系统。 */
  color: AccentColorPreference;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: (color: AccentColorPreference) => void;
}

/** 单个主题色选择按钮：圆点预览 + 选中角标，与伙伴/样式选择同一套表达。 */
export function AccentSwatch({ color, label, selected, disabled, onSelect }: AccentSwatchProps) {
  const system = color === "system";
  return (
    <button
      type="button"
      className={`${styles.swatch} ${system ? styles.swatchSystem : ""} ${selected ? styles.swatchSelected : ""}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onSelect(color)}
    >
      {system ? (
        <>
          <Desktop size={16} weight="regular" aria-hidden />
          <span>{label}</span>
        </>
      ) : (
        <span
          className={color ? styles.preview : `${styles.preview} ${styles.previewDefault}`}
          style={color ? { background: color } : undefined}
        />
      )}
      {selected && (
        <span className={styles.check} aria-hidden>
          <Check size={16} weight="regular" />
        </span>
      )}
    </button>
  );
}
