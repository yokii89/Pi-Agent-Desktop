import { useMemo } from "react";
import { useT } from "../../../hooks/useT";
import { delimiterForPath, parseDelimitedText } from "../../../utils/delimitedText";
import styles from "./DelimitedPreview.module.css";
import panelStyles from "./FilePanel.module.css";

export function DelimitedPreview({
  path,
  content,
  sourceTruncated,
}: {
  path: string;
  content: string;
  sourceTruncated: boolean;
}) {
  const t = useT();
  const table = useMemo(() => parseDelimitedText(content, delimiterForPath(path)), [content, path]);
  if (table.rows.length === 0) {
    return <p className={panelStyles.noMatch}>{t("panels.files.csvEmpty")}</p>;
  }
  const columns = Math.max(...table.rows.map((row) => row.length));
  return (
    <div className={styles.wrap} data-selectable-text="">
      <div className={styles.meta}>{t("panels.files.csvRows", { count: table.rows.length })}</div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns in a read-only preview
                <th key={index}>{table.rows[0][index] ?? ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(1).map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: immutable row ordering in a read-only preview
              <tr key={rowIndex}>
                {Array.from({ length: columns }, (_, columnIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed columns in a read-only preview
                  <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(table.truncated || sourceTruncated) && (
        <p className={panelStyles.truncatedNote}>{t("panels.files.truncatedNote")}</p>
      )}
    </div>
  );
}
