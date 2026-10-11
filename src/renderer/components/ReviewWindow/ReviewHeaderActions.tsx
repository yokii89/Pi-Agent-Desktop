import { ArrowClockwise, ArrowsIn } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import { IconButton } from "../ui/IconButton";
import { Segmented } from "../ui/Segmented";
import styles from "./ReviewWindow.module.css";

/**
 * 审查头部操作区（停靠/浮窗两种宿主共用）：视图切换 + 汇总 + 形态互切 + 刷新。
 * 宿主只提供外层容器（浮窗另有标题/分支/关闭，停靠态是普通面板头）。
 */
export function ReviewHeaderActions() {
  const t = useT();
  const { cwd, phase, summary, reviewView, setReviewView, refreshing, refresh, bumpGraphRefresh } =
    useReviewStore();
  const { reviewMode, toggleReviewMode } = useUiStore();
  const docked = reviewMode === "docked";

  const handleRefresh = (): void => {
    void refresh();
    bumpGraphRefresh();
  };

  return (
    <>
      <Segmented
        className={styles.tabs}
        size="sm"
        semantics="tab"
        equal={false}
        ariaLabel={t("panels.review.viewLabel")}
        value={reviewView}
        items={[
          { value: "changes", label: t("panels.review.viewChanges") },
          { value: "graph", label: t("panels.review.viewGraph") },
        ]}
        onChange={(view) => setReviewView(view)}
      />
      <div className={styles.spacer} />
      {reviewView === "changes" && phase === "ready" && (
        <span className={styles.summaryChip}>
          {t("panels.review.headerSummary", {
            files: summary.files,
            additions: summary.additions,
            deletions: summary.deletions,
          })}
        </span>
      )}
      <IconButton
        title={docked ? t("panels.review.openAsFloat") : t("panels.review.dockToSidebar")}
        onClick={toggleReviewMode}
      >
        <ArrowsIn size={16} weight="regular" />
      </IconButton>
      <IconButton
        title={t("panels.review.refresh")}
        disabled={!cwd || (reviewView === "changes" && refreshing)}
        onClick={handleRefresh}
      >
        <ArrowClockwise
          size={16}
          weight="regular"
          className={reviewView === "changes" && refreshing ? styles.spin : undefined}
        />
      </IconButton>
    </>
  );
}
