import { Check } from "@phosphor-icons/react";
import type { ThinkingAnimation } from "../../../shared/thinkingAnimation";
import { ThinkingAnimationMark } from "../SessionArea/ThinkingAnimationMark";
import styles from "./ThinkingAnimationSwatch.module.css";

interface ThinkingAnimationSwatchProps {
  animation: ThinkingAnimation;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: (animation: ThinkingAnimation) => void;
}

/** A live, compact preview for one selectable running-session animation. */
export function ThinkingAnimationSwatch({
  animation,
  label,
  selected,
  disabled,
  onSelect,
}: ThinkingAnimationSwatchProps) {
  return (
    <button
      type="button"
      className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onSelect(animation)}
    >
      <span className={styles.preview}>
        <ThinkingAnimationMark animation={animation} size={24} />
      </span>
      <span className={styles.label}>{label}</span>
      {selected && (
        <span className={styles.check} aria-hidden="true">
          <Check size={12} weight="regular" />
        </span>
      )}
    </button>
  );
}
