import { useT } from "../../../hooks/useT";
import type { FileReadPayload, ToolStatus } from "../../../stores/toolPayload";
import styles from "./FileReadResult.module.css";

/** 文件读取结果：路径由外层工具行承载，这里只保留内容预览（限高）。 */
export function FileReadResult({
  payload,
  status,
}: {
  payload: FileReadPayload;
  status: ToolStatus;
}) {
  const t = useT();
  const failed = status === "error" || payload.content.startsWith("Error");
  if (failed) {
    return (
      <div className={styles.preview}>
        <p className={styles.err}>{t("session.tool.readFailed")}</p>
      </div>
    );
  }
  if (payload.content.trim().length === 0) return null;
  return (
    <div className={styles.preview}>
      <pre className={styles.pre}>{payload.content}</pre>
      {payload.truncated && <p className={styles.muted}>{t("session.tool.truncated")}</p>}
    </div>
  );
}
