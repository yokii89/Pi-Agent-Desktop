import { useEffect, useId, useState } from "react";
import styles from "./designPanel.module.css";

/** 背景色：仅色块（设计图背景行），系统取色器。 */

export interface SwatchOnlyProps {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  title?: string;
}

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

export function SwatchOnly({ value, disabled, onChange, title }: SwatchOnlyProps) {
  const inputId = useId();
  const [draft, setDraft] = useState(value);
  const hex = toHexColor(draft);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <label className={styles.swatchOnly} title={title ?? draft}>
      <span className={styles.swatchOnlyFill} style={{ background: draft || "transparent" }} />
      <input
        id={inputId}
        type="color"
        className={styles.swatchOnlyInput}
        value={hex ?? "#000000"}
        disabled={disabled || !hex}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
      />
    </label>
  );
}
