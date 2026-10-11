import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../../../../hooks/useT";
import { Select, type SelectOption } from "../../../../ui/Select";
import styles from "./styleEdit.module.css";

/**
 * 长度值控件（UI 重设计）：数字拖拽/滚轮步进 + 单位后缀，铺满 `.field`。
 * 只维护本地字符串；失焦 / Enter 上抛完整 `12px` 形态，拖拽过程走 onLive。
 */

const UNITS = ["px", "rem", "em", "%", "vh", "vw", "ch", "auto", ""] as const;

export interface LengthInputProps {
  value: string;
  disabled?: boolean;
  compact?: boolean;
  /** 无单位数字提交时补上的默认单位（如 px）；flex-grow 等传 ""。 */
  defaultUnit?: string;
  /** 读屏用途：单位下拉嵌在数值框右端，自身没有伴随的文字标签。 */
  ariaLabel?: string;
  onChange: (value: string) => void;
  onLive?: (value: string) => void;
}

interface ParsedLength {
  num: string;
  unit: string;
}

function parseLength(raw: string, defaultUnit: string): ParsedLength {
  const text = raw.trim();
  if (!text || text === "auto" || text === "inherit" || text === "unset") {
    return { num: text === "auto" ? "auto" : text || "", unit: text === "auto" ? "auto" : "" };
  }
  const match = /^([+-]?\d*\.?\d+)([a-z%]*)$/i.exec(text);
  if (!match) return { num: text, unit: "" };
  return { num: match[1], unit: match[2] ?? defaultUnit };
}

function joinLength(num: string, unit: string): string {
  const n = num.trim();
  if (!n) return "";
  if (n === "auto" || n === "inherit" || n === "unset") return n;
  const u = unit === "auto" ? "" : unit;
  return `${n}${u}`;
}

function stepValue(num: string, delta: number): string {
  const parsed = Number(num);
  if (!Number.isFinite(parsed)) return num;
  return String(Math.round((parsed + delta) * 100) / 100);
}

export function LengthInput({
  value,
  disabled,
  compact,
  defaultUnit = "",
  ariaLabel,
  onChange,
  onLive,
}: LengthInputProps) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const dragRef = useRef<{ x: number; num: string; unit: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const parsed = parseLength(draft, defaultUnit);
  const unit = parsed.unit || (parsed.num === "auto" ? "auto" : "");
  // 表外单位（如 1.5pt）也要显示得出来，否则触发器只剩占位，读不出当前值
  const unitOptions = useMemo(() => {
    const list: SelectOption[] = UNITS.map((item) => ({
      value: item,
      label: item === "" ? "—" : item,
    }));
    if (unit && !list.some((item) => item.value === unit)) {
      list.unshift({ value: unit, label: unit });
    }
    return list;
  }, [unit]);

  const commit = (next: string): void => {
    if (!next.trim()) {
      setDraft(value);
      return;
    }
    setDraft(next);
    onChange(next);
  };

  const emitLive = (next: string): void => {
    setDraft(next);
    onLive?.(next);
  };

  if (compact) {
    return (
      <input
        className={styles.textInput}
        value={draft}
        disabled={disabled}
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
    );
  }

  return (
    <div
      className={[styles.lengthRoot, dragging ? styles.lengthDragging : ""].join(" ")}
      title={t("browser.styles.lengthHint")}
    >
      <input
        className={styles.lengthNum}
        value={parsed.num}
        disabled={disabled}
        inputMode="decimal"
        onChange={(event) => {
          setDraft(joinLength(event.target.value, parsed.unit));
        }}
        onBlur={() => commit(joinLength(parsed.num, parsed.unit))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(joinLength(parsed.num, parsed.unit));
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
          }
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const delta = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 10 : 1);
            const next = joinLength(stepValue(parsed.num, delta), parsed.unit);
            emitLive(next);
            commit(next);
          }
        }}
        onWheel={(event) => {
          if (disabled || document.activeElement !== event.currentTarget) return;
          event.preventDefault();
          const delta = event.deltaY < 0 ? 1 : -1;
          const next = joinLength(stepValue(parsed.num, delta), parsed.unit);
          emitLive(next);
          commit(next);
        }}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          dragRef.current = { x: event.clientX, num: parsed.num, unit: parsed.unit };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const session = dragRef.current;
          if (!session) return;
          const dx = Math.round(event.clientX - session.x);
          const base = Number(session.num);
          if (!Number.isFinite(base)) return;
          const stepped = Math.round((base + dx * (event.shiftKey ? 10 : 1)) * 100) / 100;
          emitLive(joinLength(String(stepped), session.unit));
        }}
        onPointerUp={(event) => {
          if (!dragRef.current) return;
          dragRef.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          commit(joinLength(parsed.num, parsed.unit));
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
      />
      <Select
        className={styles.lengthUnit}
        rootClassName={styles.lengthUnitRoot}
        panelClassName={styles.lengthUnitPanel}
        value={unit}
        options={unitOptions}
        disabled={disabled}
        ariaLabel={ariaLabel}
        onChange={(next) => commit(next === "auto" ? "auto" : joinLength(parsed.num, next))}
      />
    </div>
  );
}
