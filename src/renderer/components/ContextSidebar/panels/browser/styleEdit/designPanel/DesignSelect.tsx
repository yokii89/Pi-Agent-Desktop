import { useMemo } from "react";
import { Select } from "../../../../../ui/Select";
import styles from "./designPanel.module.css";

/**
 * 设计面板下拉（Figma 检查器观感）：描边圆角外壳 + 随开合翻转的 caret。
 * 外壳留在站点 CSS，控件本体用 ui/Select 的透明触发器，手感与其他下拉一致。
 * 选项由调用方给出；当前值不在列表时保留为第一项。
 */

export interface DesignSelectProps {
  value: string;
  options: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  /** 读屏用途：外壳左侧没有可关联的文字标签时传入。 */
  ariaLabel?: string;
  onChange: (value: string) => void;
}

export function DesignSelect({
  value,
  options,
  placeholder = "—",
  disabled,
  ariaLabel,
  onChange,
}: DesignSelectProps) {
  // 当前值不在候选表里（页面手写值）时仍要读得出来，所以补成一项而不是退回占位
  const items = useMemo(() => {
    const list = options.map((option) => ({ value: option, label: option }));
    if (value && !list.some((item) => item.value === value)) {
      list.unshift({ value, label: value });
    }
    return list;
  }, [options, value]);

  return (
    <div className={styles.selectShell}>
      <Select
        className={styles.selectInput}
        rootClassName={styles.selectShellRoot}
        value={value}
        options={items}
        disabled={disabled}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        onChange={onChange}
      />
    </div>
  );
}
