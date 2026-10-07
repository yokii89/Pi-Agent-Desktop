import { useEffect } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import { GitGraphPanel } from "../ContextSidebar/panels/GitGraphPanel";
import { ChangesPane } from "./ChangesPane";
import { ReviewHeaderActions } from "./ReviewHeaderActions";
import styles from "./ReviewPanel.module.css";

/**
 * 代码审查的右侧边栏停靠态（默认形态）：头部与浮窗共用 ReviewHeaderActions，
 * 内容区与浮窗共用 ChangesPane / GitGraphPanel。随侧栏 tab 切换挂载/卸载，
 * 数据保鲜逻辑（过期才刷新）与旧侧栏审查面板一致。
 */
export function ReviewPanel() {
  const { cwd, reviewView, graphRefreshSeq, refreshIfStale } = useReviewStore();

  useEffect(() => {
    if (reviewView === "changes") refreshIfStale();
  }, [refreshIfStale, reviewView]);

  return (
    <>
      <div className={styles.header}>
        <ReviewHeaderActions />
      </div>
      <div className={styles.body}>
        {reviewView === "graph" ? (
          <GitGraphPanel cwd={cwd} refreshSeq={graphRefreshSeq} />
        ) : (
          <ChangesPane />
        )}
      </div>
    </>
  );
}
