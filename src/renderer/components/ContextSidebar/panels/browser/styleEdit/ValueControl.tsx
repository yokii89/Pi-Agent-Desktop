import { useT } from "../../../../../hooks/useT";
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
  onChange,
}: {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const known = options.includes(value);
  return (
    <select
      className={styles.enumSelect}
      value={known ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {!known && value ? (
        <option value={value}>{value}</option>
      ) : (
        <option value="" disabled>
          {t("browser.styles.enumPlaceholder")}
        </option>
      )}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
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
      <EnumSelect value={value} options={meta.options} disabled={disabled} onChange={onChange} />
    );
  }
  if (meta.kind === "length" && !compact) {
    return (
      <LengthInput
        value={value}
        disabled={disabled}
        compact={compact}
        defaultUnit={meta.defaultUnit ?? ""}
        onChange={onChange}
        onLive={onLive}
      />
    );
  }
  return <TextInput value={value} disabled={disabled} onChange={onChange} />;
}
