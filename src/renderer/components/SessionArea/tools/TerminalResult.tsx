import { useMemo, useState } from "react";
import { useT } from "../../../hooks/useT";
import type { TerminalPayload } from "../../../stores/toolPayload";
import { stripAnsi, tokenizeAnsi } from "../../../utils/ansi";
import styles from "./TerminalResult.module.css";

/** 长输出限高；超过则展示渐隐并可原地展开。 */
const COLLAPSED_MAX = 200;

/**
 * 终端结果卡（Codex 式）：上栏命令、下栏输出。
 * 命令与 shell 类型由外层 ToolCall 行承载标题；这里展示完整命令原文 + 流输出。
 */
export function TerminalResult({
  payload,
  command,
  running,
}: {
  payload: TerminalPayload;
  /** 完整命令（优先 block.subject / payload.command）。 */
  command?: string;
  running: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const cmd = (command || payload.command || "").trim();
  const text = payload.output;
  const spans = useMemo(() => tokenizeAnsi(text), [text]);
  const plain = useMemo(() => stripAnsi(text), [text]);
  const long = useMemo(() => plain.length > 800 || plain.split("\n").length > 14, [plain]);
  const clamped = long && !expanded;
  const exitFailed = !running && payload.exitCode !== null && payload.exitCode !== 0;
  const showMeta = exitFailed || (payload.truncated && !running) || (long && !running);

  return (
    <div className={styles.card}>
      {cmd.length > 0 && (
        <div className={styles.cmdPane}>
          <pre className={styles.cmdText}>{cmd}</pre>
        </div>
      )}

      <div
        className={`${styles.outPane} ${clamped ? styles.clamped : ""}`}
        style={clamped ? { maxHeight: COLLAPSED_MAX } : undefined}
      >
        {running && plain.length === 0 ? (
          <p className={styles.empty}>{t("session.tool.streamingOutput")}</p>
        ) : plain.length === 0 ? (
          <span className={styles.empty}>{t("session.tool.noOutput")}</span>
        ) : (
          <pre className={styles.pre}>
            {spans.map((span, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: span 序列按文本切分，顺序固定
              <span key={index} className={span.className}>
                {span.text}
              </span>
            ))}
          </pre>
        )}
        {running && plain.length > 0 && (
          <span className={styles.streaming}>{t("session.tool.streamingOutput")}</span>
        )}
      </div>

      {showMeta && (
        <div className={styles.foot}>
          {exitFailed && (
            <span className={`${styles.pill} ${styles.err}`}>exit {payload.exitCode}</span>
          )}
          {payload.truncated && !running && (
            <span className={styles.truncated}>{t("session.tool.truncated")}</span>
          )}
          {long && !running && (
            <button type="button" className={styles.ghost} onClick={() => setExpanded((v) => !v)}>
              {expanded ? t("common.collapse") : t("session.tool.expandAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
