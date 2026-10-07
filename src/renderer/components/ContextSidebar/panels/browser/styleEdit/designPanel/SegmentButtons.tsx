import type { ReactNode } from "react";
import styles from "./designPanel.module.css";

/**
 * 设计面板图标分段按钮（Flow / 对齐方式）。
 * bare：无外框，选中浅底（设计图 Flow / 对齐观感）；bordered：带壳。
 */

export interface SegmentOption<T extends string> {
  value: T;
  title: string;
  icon: ReactNode;
}

export interface SegmentButtonsProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  aside?: ReactNode;
  ariaLabel: string;
  /** true = 无外框（默认）；false = 带边框壳。 */
  bare?: boolean;
}

export function SegmentButtons<T extends string>({
  options,
  value,
  onChange,
  disabled,
  aside,
  ariaLabel,
  bare = true,
}: SegmentButtonsProps<T>) {
  return (
    <div className={styles.segmentRow}>
      <fieldset
        className={[styles.segment, bare ? "" : styles.segmentBordered].join(" ")}
        aria-label={ariaLabel}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={[styles.segmentBtn, selected ? styles.segmentBtnOn : ""].join(" ")}
              title={option.title}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option.value)}
            >
              {option.icon}
            </button>
          );
        })}
      </fieldset>
      {aside ? <div className={styles.segmentAside}>{aside}</div> : null}
    </div>
  );
}

export function SegmentIconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.asideBtn}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
