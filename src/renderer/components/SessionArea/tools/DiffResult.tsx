import { GitDiff } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useT } from "../../../hooks/useT";
import { useReviewStore } from "../../../stores/reviewStore";
import { parseUnifiedDiff } from "../../../stores/toolPayload";
import { useUiStore } from "../../../stores/uiStore";
import { FileLink } from "../FileLink";
import styles from "./DiffResult.module.css";

/** 默认先渲染前几个 hunk，其余折叠为「展开其余」。 */
const INITIAL_HUNKS = 2;

export function DiffResult({
  path,
  diff,
  additions,
  deletions,
}: {
  path: string;
  diff: string;
  additions: number;
  deletions: number;
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const { changes, selectChange, phase } = useReviewStore();
  const { openReview, showToast } = useUiStore();
  const hunks = useMemo(() => parseUnifiedDiff(diff), [diff]);

  const openInReview = () => {
    const normalized = path.replace(/\\/g, "/");
    const hit = changes.find(
      (change) => change.path === normalized || change.path.endsWith(normalized),
    );
    if (!hit) {
      showToast(t("session.review.fileNotFound"));
      return;
    }
    openReview();
    selectChange(hit);
  };

  const reviewDisabled = phase !== "ready" || changes.length === 0;
  const openTitle = reviewDisabled ? t("session.review.noChanges") : t("session.review.openIn");

  if (hunks.length === 0) {
    return (
      <div className={styles.diff}>
        <div className={styles.head}>
          <GitDiff size={16} weight="regular" />
          <FileLink path={path} />
          <span className={styles.right}>
            <span className={styles.stat}>
              <span className={styles.add}>+{additions}</span>
              <span className={styles.del}>-{deletions}</span>
            </span>
            <button
              type="button"
              className={styles.ghost}
              disabled={reviewDisabled}
              title={openTitle}
              onClick={openInReview}
            >
              {t("session.review.openDiff")}
            </button>
          </span>
        </div>
        <p className={styles.empty}>{t("session.tool.unparsableDiff")}</p>
      </div>
    );
  }

  const visible = showAll ? hunks : hunks.slice(0, INITIAL_HUNKS);
  const hidden = hunks.length - visible.length;

  return (
    <div className={styles.diff}>
      <div className={styles.head}>
        <span className={styles.glyph}>
          <GitDiff size={16} weight="regular" />
        </span>
        <FileLink path={path} />
        <span className={styles.right}>
          <span className={styles.stat}>
            <span className={styles.add}>+{additions}</span>
            <span className={styles.del}>-{deletions}</span>
          </span>
          <button
            type="button"
            className={styles.ghost}
            disabled={reviewDisabled}
            title={openTitle}
            onClick={openInReview}
          >
            {t("session.review.openDiff")}
          </button>
        </span>
      </div>
      {visible.map((hunk) => (
        <div key={hunk.header} className={styles.hunkBlock}>
          <div className={styles.hunkHead}>{hunk.header}</div>
          <div className={styles.body}>
            {hunk.lines.map((line, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: diff 行无稳定 id，hunk 内顺序固定
                key={`${line.kind}:${line.oldLine ?? "-"}:${line.newLine ?? "-"}:${index}`}
                className={`${styles.line} ${line.kind === "add" ? styles.addLine : line.kind === "del" ? styles.delLine : ""}`}
              >
                <span className={styles.num}>{line.oldLine ?? ""}</span>
                <span className={styles.num}>{line.newLine ?? ""}</span>
                <span className={styles.sign}>
                  {line.kind === "add" ? "+" : line.kind === "del" ? "-" : ""}
                </span>
                <span className={styles.txt}>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className={styles.fold} onClick={() => setShowAll(true)}>
          {t("session.tool.expandHunks", { count: hidden })}
        </button>
      )}
      {showAll && hunks.length > INITIAL_HUNKS && (
        <button type="button" className={styles.fold} onClick={() => setShowAll(false)}>
          {t("session.tool.collapseHunks")}
        </button>
      )}
    </div>
  );
}
