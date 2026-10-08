import { CircleNotch, GitDiff, GitMerge } from "@phosphor-icons/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { GitChange, GitFileDiff } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { gitService } from "../../services/gitService";
import { useReviewStore } from "../../stores/reviewStore";
import { DiffView } from "./DiffView";
import styles from "./FileDiffInline.module.css";

interface DiffState {
  loading: boolean;
  diff: GitFileDiff | null;
  error: string | null;
}

export type CacheEntry = { ok: true; diff: GitFileDiff } | { ok: false; error: string };

function fileName(repoPath: string): string {
  return repoPath.split("/").at(-1) ?? repoPath;
}

/**
 * 按需拉取并渲染单文件 Diff（docs/审查页面ui 图 3）。
 * 缓存由调用方（审查浮窗 ChangesPane）持有并按文件复用，同一变更列表内切换选中不重复执行 git。
 */
export function FileDiffInline({
  change,
  cache,
}: {
  change: GitChange;
  cache: RefObject<Map<string, CacheEntry>>;
}) {
  const t = useT();
  const { cwd, changesVersion, repoRoot } = useReviewStore();
  const [state, setState] = useState<DiffState>({ loading: false, diff: null, error: null });
  const seqRef = useRef(0);

  useEffect(() => {
    if (!cwd) return;
    // 缓存键含仓库与变更列表版本：刷新后旧条目自然失效，避免读到过期 diff
    const key = `${repoRoot ?? ""}:${changesVersion}:${change.layer}|${change.path}`;
    const cached = cache.current?.get(key);
    if (cached) {
      setState(
        cached.ok
          ? { loading: false, diff: cached.diff, error: null }
          : { loading: false, diff: null, error: cached.error },
      );
      return;
    }
    const seq = ++seqRef.current;
    setState({ loading: true, diff: null, error: null });
    gitService
      .diff({
        cwd,
        path: change.path,
        oldPath: change.oldPath,
        layer: change.layer,
      })
      .then((diff) => {
        cache.current?.set(key, { ok: true, diff });
        if (seqRef.current === seq) setState({ loading: false, diff, error: null });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        cache.current?.set(key, { ok: false, error: message });
        if (seqRef.current === seq) setState({ loading: false, diff: null, error: message });
      });
  }, [change, cwd, cache, changesVersion, repoRoot]);

  if (state.loading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.notice}>
          <CircleNotch size={16} weight="regular" className={styles.spin} />
          <span>{t("ui.review.loadingDiff")}</span>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.notice}>
          <span>{t("ui.review.diffFailed")}</span>
          <span className={styles.noticeHint}>{state.error}</span>
        </div>
      </div>
    );
  }

  if (state.diff?.binary) {
    return (
      <div className={styles.wrap}>
        <div className={styles.notice}>
          <GitDiff size={16} weight="regular" />
          <span>{t("ui.review.binaryChanged")}</span>
          <span className={styles.noticeHint}>{fileName(change.path)}</span>
        </div>
      </div>
    );
  }

  if (state.diff?.conflicted) {
    return (
      <div className={styles.wrap}>
        <div className={styles.notice}>
          <GitMerge size={16} weight="regular" />
          <span>{t("ui.review.hasConflicts")}</span>
          <span className={styles.noticeHint}>{t("ui.review.resolveInTerminal")}</span>
        </div>
      </div>
    );
  }

  if (state.diff && state.diff.hunks.length > 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.scroll}>
          <DiffView hunks={state.diff.hunks} />
        </div>
        {state.diff.truncated && <p className={styles.truncated}>{t("ui.review.truncated")}</p>}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.notice}>
        <span>{t("ui.review.noContentDiff")}</span>
        <span className={styles.noticeHint}>
          {change.oldPath ? t("ui.review.pathOnly") : t("ui.review.noChangeInLayer")}
        </span>
      </div>
    </div>
  );
}
