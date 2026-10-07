import { useT } from "../../hooks/useT";
import type { BrowserContextItem } from "../../services/browserService";
import styles from "./ElementDetail.module.css";

/** 元素详情内容（浮窗 / 历史气泡共用）：selector、文本、a11y 等只读采集信息。 */
export function ElementDetail({ item }: { item: BrowserContextItem }) {
  const t = useT();
  return (
    <div className={styles.detail}>
      <p className={styles.title}>{item.label}</p>
      <p className={styles.detailRow}>
        <span className={styles.detailKey}>selector</span>
        <span className={styles.mono}>{item.selector || "—"}</span>
      </p>
      {item.textSummary && (
        <p className={styles.detailRow}>
          <span className={styles.detailKey}>{t("session.element.text")}</span>
          <span>{item.textSummary}</span>
        </p>
      )}
      {item.a11y && (
        <p className={styles.detailRow}>
          <span className={styles.detailKey}>{t("session.element.a11y")}</span>
          <span>{item.a11y}</span>
        </p>
      )}
      <p className={styles.detailRow}>
        <span className={styles.detailKey}>{t("session.element.source")}</span>
        <span className={styles.url}>{item.url}</span>
      </p>
      {item.rect && (
        <p className={styles.detailRow}>
          <span className={styles.detailKey}>{t("session.element.size")}</span>
          <span>
            {t("session.element.viewport", {
              width: Math.round(item.rect.width),
              height: Math.round(item.rect.height),
              vw: item.viewport.width,
              vh: item.viewport.height,
            })}
          </span>
        </p>
      )}
      {item.styles && (
        <p className={styles.detailRow}>
          <span className={styles.detailKey}>{t("session.element.styles")}</span>
          <span className={styles.mono}>{item.styles}</span>
        </p>
      )}
      {item.screenshot && (
        <>
          <img
            className={styles.detailShot}
            src={`data:image/png;base64,${item.screenshot.base64}`}
            alt={t("session.element.screenshot")}
          />
          <p className={styles.detailPath}>{item.screenshot.path}</p>
        </>
      )}
      {item.outerHTML && <pre className={styles.detailHtml}>{item.outerHTML}</pre>}
    </div>
  );
}
