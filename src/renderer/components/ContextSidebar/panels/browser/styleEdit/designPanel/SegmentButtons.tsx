import type { ReactNode } from "react";
import { Segmented } from "../../../../../ui/Segmented";
import styles from "./designPanel.module.css";

/**
 * 设计面板图标分段按钮（Flow / 对齐方式）。
 * bare：无外框，选中浅底（设计图 Flow / 对齐观感）；bordered：带壳。
 */

export interface SegmentOption<T extends string> {
  value: T;
  title: string;
  icon: ReactNode;
  disabled?: boolean;
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
      <Segmented
        ariaLabel={ariaLabel}
        className={[styles.segmentSeg, bare ? "" : styles.segmentSegBordered].join(" ")}
        semantics="radio"
        size="sm"
        disabled={disabled}
        value={value}
        items={options.map((option) => ({
          value: option.value,
          label: null,
          icon: option.icon,
          title: option.title,
          disabled: option.disabled,
        }))}
        onChange={(next) => onChange(next)}
      />
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
