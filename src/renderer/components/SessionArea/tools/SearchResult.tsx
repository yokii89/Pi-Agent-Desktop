import { useT } from "../../../hooks/useT";
import type { SearchHit, SearchPayload } from "../../../stores/toolPayload";
import { FileLink } from "../FileLink";
import styles from "./SearchResult.module.css";

/** 默认最多展开前 4 条命中，其余收进「还有 N 处」。 */
const MAX_VISIBLE = 4;

export function SearchResult({ payload }: { payload: SearchPayload }) {
  const t = useT();
  if (payload.hits.length === 0) {
    return <p className={styles.empty}>{t("session.tool.noHits")}</p>;
  }
  const visible = payload.hits.slice(0, MAX_VISIBLE);
  const rest = payload.hits.length - visible.length;

  return (
    <div className={styles.hits}>
      {visible.map((hit, index) => (
        <HitRow
          // biome-ignore lint/suspicious/noArrayIndexKey: 命中行可能重复，需 index 去重
          key={`${hit.path}:${hit.line ?? ""}:${hit.text.slice(0, 48)}:${index}`}
          hit={hit}
          pattern={payload.pattern}
        />
      ))}
      {(rest > 0 || payload.truncated) && (
        <div className={styles.more}>
          {rest > 0
            ? t("session.tool.moreHits", { count: rest })
            : t("session.tool.resultsTruncated")}
        </div>
      )}
    </div>
  );
}

function HitRow({ hit, pattern }: { hit: SearchHit; pattern: string }) {
  const label = hit.line != null ? `${hit.path}:${hit.line}` : hit.path;
  return (
    <div className={styles.hit}>
      <FileLink path={label} className={styles.hpath} />
      {hit.text.length > 0 && (
        <>
          <span className={styles.sep}>·</span>
          <span className={styles.htext}>{highlight(hit.text, pattern)}</span>
        </>
      )}
    </div>
  );
}

/** 把查询词在命中行里高亮；pattern 过长或含正则元字符时跳过高亮。 */
function highlight(text: string, pattern: string): React.ReactNode {
  if (!pattern || pattern.length > 64 || /[*?[\]\\^$]/.test(pattern)) return text;
  const index = text.indexOf(pattern);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className={styles.mark}>{pattern}</mark>
      {text.slice(index + pattern.length)}
    </>
  );
}
