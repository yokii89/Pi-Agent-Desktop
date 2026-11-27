import { GitBranch } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useReviewAutoRefresh } from "../../hooks/useReviewAutoRefresh";
import { useT } from "../../hooks/useT";
import { gitService } from "../../services/gitService";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import type { FloatingWindowMemory } from "../../utils/floatingWindowGeometry";
import { GitGraphPanel } from "../ContextSidebar/panels/GitGraphPanel";
import { FloatingWindow } from "../ui/FloatingWindow";
import { ChangesPane } from "./ChangesPane";
import { ReviewHeaderActions } from "./ReviewHeaderActions";
import styles from "./ReviewWindow.module.css";

/** 会话内记忆由浮窗外壳消费，关闭重开保留原位置与尺寸。 */
const windowMemory: FloatingWindowMemory = {};

/**
 * 代码审查浮窗（原侧栏审查面板的浮窗化重构）。
 * 壳只管定位/拖拽/缩放/开关；数据与操作全部下沉到 ChangesPane（reviewStore）。
 * 挂载方式：App 里 `{reviewWindowOpen && <ReviewWindow />}`，开屏动效与刷新 effect 都依赖条件挂载。
 */
export function ReviewWindow() {
  const t = useT();
  const { cwd, repoRoot, reviewView, graphRefreshSeq, refresh, refreshIfStale } = useReviewStore();
  const { closeReviewWindow } = useUiStore();
  useReviewAutoRefresh({
    cwd,
    repoRoot,
    enabled: reviewView === "changes",
    refresh,
    refreshIfStale,
  });
  const [branch, setBranch] = useState<string | null>(null);

  // 分支 chip：随会话目录与手动刷新更新；非 git 仓库时静默隐藏
  // biome-ignore lint/correctness/useExhaustiveDependencies: graphRefreshSeq 是「手动刷新」的触发信号，effect 内不读它
  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let cancelled = false;
    gitService
      .branches(cwd)
      .then((result) => {
        if (!cancelled) setBranch(result.current);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, graphRefreshSeq]);

  // 图谱面板元素按输入记忆化：拖拽/缩放触发的壳重渲染不牵动 SVG 图谱
  const graphPanel = useMemo(
    () => <GitGraphPanel cwd={cwd} refreshSeq={graphRefreshSeq} />,
    [cwd, graphRefreshSeq],
  );

  return (
    <FloatingWindow
      title={t("panels.review.windowTitle")}
      closeLabel={t("panels.review.closeWindow")}
      onClose={closeReviewWindow}
      memory={windowMemory}
      actions={
        <>
          {branch && (
            <span className={styles.branchChip} title={branch}>
              <GitBranch size={12} weight="regular" />
              {branch}
            </span>
          )}
          <ReviewHeaderActions />
        </>
      }
    >
      {reviewView === "graph" ? graphPanel : <ChangesPane />}
    </FloatingWindow>
  );
}
