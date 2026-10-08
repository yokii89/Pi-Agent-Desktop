import type { CSSProperties } from "react";
import type { PiContextBucket, PiContextUsage } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import { formatTokens } from "../../utils/formatTokens";
import { Popover } from "../ui/Popover";
import styles from "./ContextUsageChip.module.css";

/** 阈值沿用 pi footer（footer.ts）：>90 danger、>70 warning。 */
const DANGER_PERCENT = 90;
const WARNING_PERCENT = 70;

const BUCKET_CLASS: Record<PiContextBucket, string> = {
  user: styles.segUser,
  assistant: styles.segAssistant,
  thinking: styles.segThinking,
  toolResult: styles.segTool,
  summary: styles.segSummary,
  skills: styles.segSkills,
  other: styles.segOther,
};

const BUCKET_LABEL_KEY: Record<PiContextBucket, string> = {
  user: "session.context.bucket.user",
  assistant: "session.context.bucket.assistant",
  thinking: "session.context.bucket.thinking",
  toolResult: "session.context.bucket.toolResult",
  summary: "session.context.bucket.summary",
  skills: "session.context.bucket.skills",
  other: "session.context.bucket.other",
};

function toneClass(percent: number | null): string {
  if (percent === null) return "";
  if (percent > DANGER_PERCENT) return styles.danger;
  if (percent > WARNING_PERCENT) return styles.warning;
  return "";
}

function resolveWindow(usage: PiContextUsage | null, contextWindow: number | null): number | null {
  const window_ = usage?.contextWindow ?? contextWindow;
  return window_ != null && window_ > 0 ? window_ : null;
}

/**
 * 上下文用量圆环（docs/design/28）：模型名左侧纯进度环。
 * hover 快览；点开 Popover 看分类占比（只给百分比，Σ 与标题总数不必相等）。
 */
export function ContextUsageChip() {
  const t = useT();
  const {
    processAlive,
    contextUsage,
    contextBreakdown,
    contextWindow,
    autoCompactionEnabled,
    refreshContextUsage,
  } = useSessionMeta();

  const window_ = resolveWindow(contextUsage, contextWindow);
  // 无 model / 会话未启动 / 窗口未知 → 不渲染（不是 0%）
  if (!processAlive || window_ === null) return null;

  const percent = contextUsage?.percent ?? null;
  const usedTokens = contextUsage?.tokens ?? null;
  const remaining = percent != null ? 100 - percent : null;

  const title = autoCompactionEnabled
    ? `${t("session.context.tooltip")} ${t("session.context.auto")}`
    : t("session.context.tooltip");
  const main =
    percent != null && remaining != null
      ? t("session.context.usedPct", {
          used: percent.toFixed(1),
          remaining: remaining.toFixed(1),
        })
      : t("session.context.unknown");
  const detail = t("session.context.usedTokens", {
    used: usedTokens != null ? formatTokens(usedTokens) : "?",
    total: formatTokens(window_),
  });
  const aria = t("session.context.aria", {
    value: usedTokens != null ? `${formatTokens(usedTokens)}/${formatTokens(window_)}` : "?",
  });

  return (
    <Popover
      direction="top"
      align="right"
      trigger={({ open, onClick }) => (
        <button
          type="button"
          className={`${styles.chip} ${toneClass(percent)} ${open ? styles.chipOpen : ""}`}
          title={title}
          aria-label={aria}
          aria-expanded={open}
          onClick={() => {
            void refreshContextUsage();
            onClick();
          }}
        >
          <span
            className={styles.ring}
            style={
              {
                "--ring-pct": `${Math.min(100, Math.max(0, percent ?? 0))}%`,
              } as CSSProperties
            }
          />
          <span role="tooltip" className={styles.tooltip}>
            <span className={styles.tooltipTitle}>{title}</span>
            <span className={styles.tooltipMain}>{main}</span>
            <span className={styles.tooltipDetail}>{detail}</span>
          </span>
        </button>
      )}
    >
      <div className={styles.panel}>
        <div className={styles.panelTitle}>{title}</div>
        <div className={styles.panelMain}>{main}</div>
        <div className={styles.panelDetail}>{detail}</div>
        {contextBreakdown && contextBreakdown.length > 0 && (
          <>
            <div className={styles.bar} role="img" aria-label={t("session.context.breakdownAria")}>
              {contextBreakdown.map((slice) => (
                <span
                  key={slice.bucket}
                  className={`${styles.seg} ${BUCKET_CLASS[slice.bucket]}`}
                  style={{ width: `${Math.max(0, slice.ratioPercent)}%` }}
                />
              ))}
            </div>
            <ul className={styles.legend}>
              {contextBreakdown.map((slice) => (
                <li key={slice.bucket} className={styles.legendRow}>
                  <span className={`${styles.swatch} ${BUCKET_CLASS[slice.bucket]}`} />
                  <span className={styles.legendName}>{t(BUCKET_LABEL_KEY[slice.bucket])}</span>
                  <span className={styles.legendPct}>{slice.ratioPercent.toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Popover>
  );
}
