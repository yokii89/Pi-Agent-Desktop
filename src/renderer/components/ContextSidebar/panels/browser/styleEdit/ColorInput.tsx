import { useEffect, useState } from "react";
import { useT } from "../../../../../hooks/useT";
import styles from "./styleEdit.module.css";

/**
 * 颜色控件（UI 重设计）：棋盘格底上的色块 + hex 输入，铺满 `.field`。
 * MVP 用系统取色器（零新依赖）；非法 hex 失焦时保留原文，由 store 校验。
 */

export interface ColorInputProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** 把 CSS 颜色粗转为 `#rrggbb` 供 `<input type=color>`；失败返回 null。 */
function toHexColor(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    const [, r, g, b] = text;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{8}$/i.test(text)) return text.slice(0, 7);
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (rgb) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
  }
  return null;
}

export function ColorInput({ value, disabled, onChange }: ColorInputProps) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const hex = toHexColor(draft);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (next: string): void => {
    if (!next.trim()) {
      setDraft(value);
      return;
    }
    setDraft(next);
    onChange(next);
  };

  return (
    <div className={styles.colorRoot}>
      <div className={styles.colorSwatchWrap} title={hex ?? t("browser.styles.colorUnparsed")}>
        <input
          type="color"
          className={styles.colorSwatch}
          value={hex ?? "#000000"}
          disabled={disabled || !hex}
          aria-label={t("browser.styles.pickColor")}
          onChange={(event) => commit(event.target.value)}
        />
      </div>
      <input
        className={styles.textInput}
        value={draft}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
          }
        }}
      />
    </div>
  );
}
