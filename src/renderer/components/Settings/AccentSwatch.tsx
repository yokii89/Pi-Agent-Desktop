import { Check } from "@phosphor-icons/react";
import styles from "./AccentSwatch.module.css";

interface AccentSwatchProps {
  /** 主题色 hex；null 表示「默认」（跟随主题蓝，预览直接吃 --color-accent）。 */
  color: string | null;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: (color: string | null) => void;
}

/** 单个主题色选择按钮：圆点预览 + 选中角标，与伙伴/样式选择同一套表达。 */
export function AccentSwatch({ color, label, selected, disabled, onSelect }: AccentSwatchProps) {
  return (
    <button
      type="button"
      className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onSelect(color)}
    >
      <span
        className={color ? styles.preview : `${styles.preview} ${styles.previewDefault}`}
        style={color ? { background: color } : undefined}
      />
      {selected && (
        <span className={styles.check} aria-hidden>
          <Check size={10} weight="bold" />
        </span>
      )}
    </button>
  );
}
