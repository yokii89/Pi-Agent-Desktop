import { CaretDown, CaretUp, MagnifyingGlass, Stop, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useT } from "../../../hooks/useT";
import { IconButton } from "../../ui/IconButton";
import styles from "./PreviewFindBar.module.css";

interface PreviewFindBarProps {
  query: string;
  /** 命中总数。 */
  count: number;
  /** 当前命中序号（1-based）；无命中或尚未选择结果时为 0。 */
  current: number;
  focusTick?: number;
  busy?: boolean;
  onQuery: (value: string) => void;
  /** 前后跳转：正数向下、负数向上。 */
  onStep: (delta: number) => void;
  onClose: () => void;
  onCancel?: () => void;
}

/** Shared find field for preview-level searches. */
export function PreviewFindBar({
  query,
  count,
  current,
  focusTick = 0,
  busy = false,
  onQuery,
  onStep,
  onClose,
  onCancel,
}: PreviewFindBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Repeated Ctrl+F refocuses and selects the current query.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusTick]);

  return (
    <search className={styles.bar} aria-label={t("panels.files.findTitle")} aria-busy={busy}>
      <MagnifyingGlass className={styles.icon} size={16} weight="regular" />
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder={t("panels.files.findPlaceholder")}
        aria-label={t("panels.files.findPlaceholder")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <span className={styles.count} aria-live="polite">
        {query.length === 0
          ? ""
          : count > 0
            ? current > 0
              ? `${current}/${count}`
              : String(count)
            : t(busy ? "panels.files.findSearching" : "panels.files.findNoMatch")}
      </span>
      {busy && onCancel && (
        <IconButton title={t("panels.files.office.cancelSearch")} onClick={onCancel}>
          <Stop size={16} weight="regular" />
        </IconButton>
      )}
      <IconButton
        title={t("panels.files.findPrev")}
        disabled={count === 0}
        onClick={() => onStep(-1)}
      >
        <CaretUp size={16} weight="regular" />
      </IconButton>
      <IconButton
        title={t("panels.files.findNext")}
        disabled={count === 0}
        onClick={() => onStep(1)}
      >
        <CaretDown size={16} weight="regular" />
      </IconButton>
      <IconButton title={t("common.close")} onClick={onClose}>
        <X size={16} weight="regular" />
      </IconButton>
    </search>
  );
}
