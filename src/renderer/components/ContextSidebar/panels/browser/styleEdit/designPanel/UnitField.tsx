import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./designPanel.module.css";

/**
 * 设计面板的「值 + 静态单位」输入（Figma 观感）。
 * 只维护本地草稿；Enter / 失焦提交，Esc 回退。拖拽横滑步进数字（Shift ×10）。
 */

export interface UnitFieldProps {
  value: string;
  /** 单位后缀（px / deg / %），空串表示纯数字。 */
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 值已被热更（左侧 accent 点）。 */
  adjusted?: boolean;
  /** 前缀文字（Size 等）。 */
  label?: string;
  /** 前缀图标（Padding 水平/垂直）。 */
  icon?: ReactNode;
  onChange: (value: string) => void;
  onLive?: (value: string) => void;
}

function stepNumber(text: string, delta: number): string {
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  return String(Math.round((num + delta) * 100) / 100);
}

export function UnitField({
  value,
  unit,
  placeholder,
  disabled,
  adjusted,
  label,
  icon,
  onChange,
  onLive,
}: UnitFieldProps) {
  const [draft, setDraft] = useState(value);
  const dragRef = useRef<{ x: number; base: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (next: string): void => {
    const trimmed = next.trim();
    if (!trimmed) {
      setDraft(value);
      return;
    }
    setDraft(trimmed);
    onChange(trimmed);
  };

  return (
    <div
      className={[
        styles.unitField,
        adjusted ? styles.unitFieldAdjusted : "",
        disabled ? styles.unitFieldDisabled : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-dragging={dragging ? "1" : undefined}
    >
      {icon ? <span className={styles.unitIcon}>{icon}</span> : null}
      {label ? <span className={styles.unitLabel}>{label}</span> : null}
      <span className={styles.unitDot} aria-hidden="true" />
      <input
        className={styles.unitInput}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
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
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const delta = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1);
            const next = stepNumber(draft, delta);
            setDraft(next);
            onLive?.(next);
            onChange(next);
          }
        }}
        onWheel={(event) => {
          if (disabled || document.activeElement !== event.currentTarget) return;
          event.preventDefault();
          const delta = event.deltaY < 0 ? 1 : -1;
          const next = stepNumber(draft, delta);
          setDraft(next);
          onLive?.(next);
          onChange(next);
        }}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          if (
            event.target === event.currentTarget &&
            event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
          ) {
            return;
          }
          dragRef.current = { x: event.clientX, base: draft };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const session = dragRef.current;
          if (!session) return;
          const dx = Math.round(event.clientX - session.x);
          const base = Number(session.base);
          if (!Number.isFinite(base)) return;
          const stepped = Math.round((base + dx * (event.shiftKey ? 10 : 1)) * 100) / 100;
          setDraft(String(stepped));
          onLive?.(String(stepped));
        }}
        onPointerUp={(event) => {
          if (!dragRef.current) return;
          dragRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          commit(draft);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      />
      {unit ? <span className={styles.unitSuffix}>{unit}</span> : null}
    </div>
  );
}
