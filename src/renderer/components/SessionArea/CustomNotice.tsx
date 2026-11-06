import type { Icon } from "@phosphor-icons/react";
import { CaretDown, CaretRight, PuzzlePiece, Terminal } from "@phosphor-icons/react";
import { useState } from "react";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { customNoticeSummary } from "../../stores/customMessage";
import type { CustomEntry } from "../../stores/sessionTranscript";
import styles from "./CustomNotice.module.css";

/**
 * 扩展通知条目（docs/design/129 §8.4）：`role: "custom"` 的扩展消息在文档流里的一行落点。
 *
 * 为什么不是气泡也不是助手消息：说话的是扩展，不是用户也不是模型。所以它读作「一条系统通知 +
 * 可展开原文」——紧凑一行，默认收起（一条 20 行的作业回执不该把会话流撑开）。
 *
 * 未知 customType 一律按通用通知渲染，不静默丢弃：扩展发了消息却什么都看不见，
 * 是比"样式不完美"严重得多的问题。
 */
const KNOWN_TYPES: Record<string, { labelKey: string; icon: Icon }> = {
  "bash-job": { labelKey: "session.custom.bashJob", icon: Terminal },
};

export function CustomNotice({ entry }: { entry: CustomEntry }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const known = KNOWN_TYPES[entry.customType];
  const NoticeIcon = known?.icon ?? PuzzlePiece;
  const label = t(known?.labelKey ?? "session.custom.generic");
  const summary = customNoticeSummary(entry.text);
  // 单行且不长：展开只会重复同一行，于是不做成可点控件（避免键盘用户 Tab 到一个死按钮）。
  const expandable = entry.text.trim().split("\n").length > 1 || entry.text.length > 120;
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLPreElement>(open);

  const head = (
    <>
      <span className={styles.icon}>
        <NoticeIcon size={16} weight="regular" />
      </span>
      <span className={styles.label}>{label}</span>
      <span className={styles.summary}>{summary}</span>
      {expandable && (
        <span className={styles.caret} aria-hidden="true">
          {open ? (
            <CaretDown size={14} weight="regular" />
          ) : (
            <CaretRight size={14} weight="regular" />
          )}
        </span>
      )}
    </>
  );

  return (
    <section className={styles.notice} data-custom-type={entry.customType}>
      {expandable ? (
        <button
          type="button"
          className={styles.head}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {head}
        </button>
      ) : (
        <div className={styles.head}>{head}</div>
      )}
      <div className={styles.bodyWrap} ref={ref}>
        {rendered && (
          <pre className={styles.body} ref={innerRef}>
            {entry.text}
          </pre>
        )}
      </div>
    </section>
  );
}
