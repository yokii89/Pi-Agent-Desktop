import { useEffect } from "react";
import { fsService } from "../services/fsService";
import { isSameOrInsideDir } from "../utils/paths";

const STATUS_POLL_MS = 3000;

/** 审阅列表可见时响应工作区变更，并在无文件监听事件时定期与 Git 状态对账。 */
export function useReviewAutoRefresh({
  cwd,
  repoRoot,
  enabled,
  refresh,
  refreshIfStale,
}: {
  cwd: string | null;
  repoRoot: string | null;
  enabled: boolean;
  refresh: () => Promise<void>;
  refreshIfStale: () => void;
}): void {
  useEffect(() => {
    if (!enabled || !cwd) return;

    refreshIfStale();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        void refresh();
      }
    }, STATUS_POLL_MS);
    const onFocus = (): void => refreshIfStale();
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") refreshIfStale();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cwd, enabled, refresh, refreshIfStale]);

  useEffect(() => {
    if (!enabled || !repoRoot) return;

    let disposed = false;
    let watching = false;
    const unsubscribe = fsService.onChanged(({ dirs }) => {
      if (dirs.some((dir) => isSameOrInsideDir(dir, repoRoot))) void refresh();
    });
    void fsService.watch(repoRoot).then(
      () => {
        if (disposed) void fsService.unwatch(repoRoot).catch(() => {});
        else watching = true;
      },
      () => {},
    );

    return () => {
      disposed = true;
      unsubscribe();
      if (watching) void fsService.unwatch(repoRoot).catch(() => {});
    };
  }, [enabled, repoRoot, refresh]);
}
