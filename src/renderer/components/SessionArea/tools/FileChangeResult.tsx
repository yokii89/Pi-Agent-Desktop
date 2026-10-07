import type { ReactNode } from "react";
import { useT } from "../../../hooks/useT";
import type { FileChangePayload, ToolStatus } from "../../../stores/toolPayload";
import styles from "./FileChangeResult.module.css";

/**
 * 文件写入/修改结果：路径与 +N -M 已在工具行；这里只保留失败文案或 diff 本体。
 */
export function FileChangeResult({
  payload,
  status,
  diffNode,
}: {
  payload: FileChangePayload;
  status: ToolStatus;
  /** 展开区内容（通常为 DiffResult）。 */
  diffNode?: ReactNode;
}) {
  const t = useT();
  const failed = status === "error";
  if (failed) {
    return (
      <p className={styles.err}>
        {payload.mode === "write" ? t("session.tool.writeFailed") : t("session.tool.editFailed")}
      </p>
    );
  }
  if (!payload.diff) {
    return <p className={styles.muted}>{t("session.tool.noDiff")}</p>;
  }
  return <div className={styles.wrap}>{diffNode}</div>;
}
