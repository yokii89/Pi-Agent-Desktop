import { Check, CircleDashed } from "@phosphor-icons/react";
import type { InputBuddyKind } from "../../../shared/inputBuddy";
import { BuddyArt } from "../SessionArea/InputBuddy/BuddyArt";
import styles from "./BuddySwatch.module.css";

/** 「无」档的占位图形尺寸：与会话区伙伴的空槽位视觉重量对齐，不抢小动物的焦点。 */
const EMPTY_ICON_SIZE = 24;

interface BuddySwatchProps {
  kind: InputBuddyKind;
  /** 读屏与悬停说明（形名只在提示里出现，控件本身不排文字）。 */
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: (kind: InputBuddyKind) => void;
}

/**
 * 单个伙伴形象选择按钮：直接渲染该形象的默认姿态，取代原来的文字分段条。
 *
 * 预览与会话区实际出现的伙伴同源——复用同一批 SVG 组件与 InputBuddy.module.css 的
 * `--buddy-*` 配色，因此设置里看到的就是输入栏上会出现的那个小家伙，无需另维护一套缩略图。
 */
export function BuddySwatch({ kind, label, selected, disabled, onSelect }: BuddySwatchProps) {
  return (
    <button
      type="button"
      className={`${styles.swatch} ${selected ? styles.swatchSelected : ""}`}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onSelect(kind)}
    >
      <span className={styles.preview}>
        <BuddyArt kind={kind} pose="idle" animated={false} />
        {kind === "none" && (
          <CircleDashed size={EMPTY_ICON_SIZE} weight="regular" className={styles.empty} />
        )}
      </span>
      {selected && (
        <span className={styles.check} aria-hidden>
          <Check size={16} weight="regular" />
        </span>
      )}
    </button>
  );
}
