import { useMemo } from "react";
import { useT } from "../../../../../hooks/useT";
import { Select } from "../../../../ui/Select";
import { ColorInput } from "./ColorInput";
import { LengthInput } from "./LengthInput";
import { resolvePropertyMeta } from "./propertyCatalog";
import styles from "./styleEdit.module.css";

/**
 * 值控件分发（22 §4.2）：按属性目录选择长度 / 颜色 / 枚举 / 文本。
 * 控件本体铺满 `.field` 容器（外框圆角/焦点环在 PropertyRow 统一处理）。
 * compact 时长度/枚举降级为文本（窄侧栏）。
 */

export interface ValueControlProps {
  name: string;
  value: string;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onLive?: (value: string) => void;
}

export function EnumSelect({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  /** 读屏用途：行上方的属性名就是它的标签，但没有 form label 关联。 */
  ariaLabel?: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  // 当前值不在枚举表里（页面自带的手写值）时，像原生 select 那样把它留成一项，不能吞掉
  const items = useMemo(() => {
    const list = options.map((option) => ({ value: option, label: option }));
    if (value && !list.some((item) => item.value === value)) {
      list.unshift({ value, label: value });
    }
    return list;
  }, [options, value]);

  return (
    <Select
      className={styles.enumSelect}
      rootClassName={styles.enumSelectRoot}
      value={value}
      options={items}
      disabled={disabled}
      ariaLabel={ariaLabel}
      placeholder={t("browser.styles.enumPlaceholder")}
      onChange={onChange}
    />
  );
}

export function TextInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className={styles.textInput}
      value={value}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ValueControl({
  name,
  value,
  disabled,
  compact,
  onChange,
  onLive,
}: ValueControlProps) {
  const meta = resolvePropertyMeta(name);
  if (meta.kind === "color") {
    return <ColorInput value={value} disabled={disabled} onChange={onChange} />;
  }
  if (meta.kind === "enum" && meta.options && !compact) {
    return (
      <EnumSelect
        value={value}
        options={meta.options}
        disabled={disabled}
        ariaLabel={name}
        onChange={onChange}
      />
    );
  }
  if (meta.kind === "length" && !compact) {
    return (
      <LengthInput
        value={value}
        disabled={disabled}
        compact={compact}
        defaultUnit={meta.defaultUnit ?? ""}
        ariaLabel={name}
        onChange={onChange}
        onLive={onLive}
      />
    );
  }
  return <TextInput value={value} disabled={disabled} onChange={onChange} />;
}
