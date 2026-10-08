import { useEffect, useState } from "react";
import styles from "./designPanel.module.css";

/**
 * 失焦/Enter 才提交的文本输入（box-shadow / filter 等复合值）。
 * 外观对齐设计面板其它字段（32px / 圆角 6）。
 */

export interface CommitTextFieldProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onClear?: () => void;
}

export function CommitTextField({
  value,
  placeholder,
  disabled,
  onChange,
  onClear,
}: CommitTextFieldProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (): void => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      onClear?.();
      return;
    }
    if (next !== value) onChange(next);
  };

  return (
    <input
      className={styles.textInput}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
        }
      }}
    />
  );
}
