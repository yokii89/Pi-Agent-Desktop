import { useT } from "../../../hooks/useT";
import type { ToolStatus } from "../../../stores/toolPayload";
import { parseArgsRecord } from "../../../stores/toolPayload";
import styles from "./GenericToolResult.module.css";

/**
 * 未知工具兜底：pi 后续接入新工具时 UI 不崩、不空白。
 * 状态与工具名由外层 ToolCall 行承载，这里只展示参数与结果正文。
 */
export function GenericToolResult({
  argsText,
  resultText,
  status,
}: {
  argsText: string;
  resultText: string | null;
  status: ToolStatus;
}) {
  const t = useT();
  return (
    <div className={styles.generic}>
      {argsText.trim().length > 0 && (
        <>
          <p className={styles.label}>{t("session.tool.args")}</p>
          <div className={styles.body}>{renderJson(argsText)}</div>
        </>
      )}
      {resultText && resultText.trim().length > 0 && (
        <>
          <p className={styles.label}>
            {status === "error" ? t("session.tool.errorLabel") : t("session.tool.result")}
          </p>
          <div className={`${styles.body} ${status === "error" ? styles.errorBody : ""}`}>
            {resultText}
          </div>
        </>
      )}
      {status === "running" && !resultText?.trim() && (
        <p className={styles.label}>{t("session.tool.waitingResult")}</p>
      )}
    </div>
  );
}

/** JSON 文本渲染：键弱化、值提亮；非 JSON 原样展示。 */
function renderJson(text: string): React.ReactNode {
  const record = parseArgsRecord(text);
  if (Object.keys(record).length === 0) return text;
  return (
    <span>
      {"{ "}
      {Object.entries(record).map(([key, value], index) => (
        <span key={key}>
          {index > 0 && ", "}
          <span className={styles.k}>"{key}"</span>
          {": "}
          <span className={styles.v}>{formatValue(value)}</span>
        </span>
      ))}
      {" }"}
    </span>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value.length > 80 ? `${value.slice(0, 80)}…` : value}"`;
  if (value === null) return "null";
  if (typeof value === "object") return Array.isArray(value) ? `[${value.length}]` : "{…}";
  return String(value);
}
