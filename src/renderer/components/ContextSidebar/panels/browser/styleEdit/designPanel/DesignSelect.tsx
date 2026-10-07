import { CaretDown } from "@phosphor-icons/react";
import styles from "./designPanel.module.css";

/**
 * 设计面板下拉（Figma 检查器观感）：圆角外壳 + 右侧 caret。
 * 选项由调用方给出；当前值不在列表时保留为第一项。
 */

export interface DesignSelectProps {
  value: string;
  options: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function DesignSelect({
  value,
  options,
  placeholder = "—",
  disabled,
  onChange,
}: DesignSelectProps) {
  const known = options.includes(value);
  return (
    <div className={styles.selectShell}>
      <select
        className={styles.selectInput}
        value={known ? value : value ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {!known && value ? (
          <option value={value}>{value}</option>
        ) : (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <CaretDown size={12} weight="bold" className={styles.selectCaret} />
    </div>
  );
}
