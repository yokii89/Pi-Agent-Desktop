import { CaretDown, CaretUp, X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useT } from "../../../hooks/useT";
import { IconButton } from "../../ui/IconButton";
import styles from "./PreviewFindBar.module.css";

interface PreviewFindBarProps {
  query: string;
  /** 命中总数。 */
  count: number;
  /** 当前命中序号（1-based）；无命中时为 0。 */
  current: number;
  onQuery: (value: string) => void;
  /** 前后跳转：正数向下、负数向上。 */
  onStep: (delta: number) => void;
  onClose: () => void;
}

/**
 * 文件面板内查找条（Ctrl+F）：输入即查、Enter / Shift+Enter 跳命中、Esc 收起。
 * 只管交互与计数展示，命中计算与高亮在 usePreviewFind。
 */
export function PreviewFindBar({
  query,
  count,
  current,
  onQuery,
  onStep,
  onClose,
}: PreviewFindBarProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开即聚焦并全选：连续 Ctrl+F 可以改关键词而不是长出一段
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <search className={styles.bar}>
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        placeholder={t("panels.files.findPlaceholder")}
        aria-label={t("panels.files.findPlaceholder")}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
            return;
          }
          if (event.key === "Escape") {
            // 查找条消费 Esc：别同时触发「Esc 停止会话」等更外层快捷键
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
            ? `${current}/${count}`
            : t("panels.files.findNoMatch")}
      </span>
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
