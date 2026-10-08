import { Check } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { RailStyle } from "../../../shared/railStyles";
import railStyles from "../SessionArea/QuestionRail.module.css";
import styles from "./RailStyleSwatch.module.css";

/**
 * 与 QuestionRail 同款形状变体类——直接复用其 CSS Module，
 * 保证设置里的迷你预览与会话流实际渲染完全一致（不重复维护几何）。
 */
const SHAPE_CLASS: Record<RailStyle, string> = {
  line: railStyles.mLine,
  dot: railStyles.mDot,
  tick: railStyles.mTick,
  pill: railStyles.mPill,
  diamond: railStyles.mDiamond,
  bar: railStyles.mBar,
  ring: railStyles.mRing,
};

/** 预览里中间标记的峰值缩放（贴近真实激活档，便于辨识形状）。 */
const PREVIEW_PEAK_SCALE = 2.2;

interface RailStyleSwatchProps {
  style: RailStyle;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: (style: RailStyle) => void;
}

/** 单个样式选择按钮：内联渲染该样式的迷你预览（中间标记呈激活态）。 */
export function RailStyleSwatch({
  style,
  label,
  selected,
  disabled,
  onSelect,
}: RailStyleSwatchProps) {
  const shape = SHAPE_CLASS[style];
  const dim = { "--seg-scale": 1, opacity: 0.5 } as CSSProperties;
  const peak = {
    "--seg-scale": PREVIEW_PEAK_SCALE,
    opacity: 1,
  } as CSSProperties;
  return (
    <button
      type="button"
      className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onSelect(style)}
    >
      <span className={styles.preview}>
        <span className={`${railStyles.marker} ${shape}`} style={dim} />
        <span className={`${railStyles.marker} ${shape} ${railStyles.markerFocus}`} style={peak} />
        <span className={`${railStyles.marker} ${shape}`} style={dim} />
      </span>
      {selected && (
        <span className={styles.check} aria-hidden>
          <Check size={10} weight="bold" />
        </span>
      )}
    </button>
  );
}
