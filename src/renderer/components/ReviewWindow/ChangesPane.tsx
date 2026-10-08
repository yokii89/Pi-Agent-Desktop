import {
  CircleNotch,
  GitDiff,
  GitPullRequest,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { memo, useEffect, useRef, useState } from "react";
import type { GitChange, GitPushPlan } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { changeKey, type ReviewFilterMode, useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import { ROLLBACK_BLOCK_REASON_TEXT } from "../../utils/rollbackLastRound";
import { type CacheEntry, FileDiffInline } from "../Review/FileDiffInline";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ChangeList } from "./ChangeList";
import styles from "./ChangesPane.module.css";
import { CommitBar } from "./CommitBar";

/** 从 unknown 错误取可展示文案。 */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const EMPTY_HINT_KEYS: Record<ReviewFilterMode, string> = {
  unstaged: "panels.review.emptyUnstaged",
  staged: "panels.review.emptyStaged",
  all: "panels.review.emptyAll",
  lastRound: "panels.review.emptyLastRound",
};

const LAYER_LABEL_KEYS: Record<GitChange["layer"], string> = {
  staged: "panels.review.layer.staged",
  unstaged: "panels.review.layer.unstaged",
  untracked: "panels.review.layer.untracked",
};

const LAYER_CLASS: Record<GitChange["layer"], string> = {
  staged: styles.layerStaged,
  unstaged: styles.layerUnstaged,
  untracked: styles.layerUntracked,
};

function lastRoundEmptyHint(blockReason: string, t: ReturnType<typeof useT>): string {
  if (blockReason === "committed") {
    return t("panels.review.lastRoundCommitted");
  }
  if (blockReason === "notRepo") {
    return t("panels.review.lastRoundNotRepo");
  }
  return t(EMPTY_HINT_KEYS.lastRound);
}

function StateView({
  icon,
  text,
  hint,
  tone,
}: {
  icon: ReactNode;
  text: string;
  hint?: string;
  tone?: "error";
}) {
  return (
    <div className={[styles.state, tone === "error" ? styles.stateError : ""].join(" ")}>
      {icon}
      <p className={styles.stateText}>{text}</p>
      {hint && <p className={styles.stateHint}>{hint}</p>}
    </div>
  );
}

/**
 * 审查的变更区（停靠/浮窗共用）：分段筛选 + 列表/详情自适应双栏 + 提交栏 + 全部确认弹窗。
 * 持有 per-file diff 缓存（键含变更列表版本，刷新后自然失效，见 FileDiffInline）。
 */
function ChangesPaneImpl() {
  const t = useT();
  const { showToast } = useUiStore();
  const {
    phase,
    error,
    filterMode,
    setFilterMode,
    changes,
    changesVersion,
    visibleChanges,
    selectedKey,
    selectedChange,
    selectChange,
    clearSelection,
    lastRound,
    canRollback,
    rollingBack,
    rollbackBlockReason,
    requestRollbackPrompt,
    writing,
    staged,
    unstaged,
    untracked,
    stageChanges,
    unstageChanges,
    discardChanges,
    commit,
    fetchPushPlan,
    push,
  } = useReviewStore();
  const [message, setMessage] = useState("");
  const [discardTargets, setDiscardTargets] = useState<GitChange[] | null>(null);
  const [pushPlan, setPushPlan] = useState<GitPushPlan | null>(null);
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);

  // 按文件缓存 diff；条目键含仓库与变更列表版本（见 FileDiffInline）
  const cacheRef = useRef(new Map<string, CacheEntry>());

  // 刷新后跟随选中文件：同路径换层（如暂存动作）则切到新层条目；文件消失（提交/删除）则清空详情
  // biome-ignore lint/correctness/useExhaustiveDependencies: changesVersion 是「刷新完成」的触发信号，其余均来自 store 稳定引用
  useEffect(() => {
    const selected = selectedChange;
    if (!selected) return;
    if (visibleChanges.some((c) => changeKey(c) === selectedKey)) return;
    const moved = changes.find((c) => c.path === selected.path);
    if (moved) selectChange(moved);
    else clearSelection();
  }, [changesVersion]);

  const fail = (err: unknown): void => {
    showToast(t("panels.review.operationFailed", { message: errMessage(err) }));
  };

  // --- 行内 / 批量：暂存 & 取消暂存 ---
  const handleStage = (targets: GitChange[]): void => {
    if (targets.length === 0) return;
    void stageChanges(targets)
      .then(() => showToast(t("panels.review.stagedToast", { count: targets.length })))
      .catch(fail);
  };

  const handleUnstage = (targets: GitChange[]): void => {
    if (targets.length === 0) return;
    void unstageChanges(targets)
      .then(() => showToast(t("panels.review.unstagedToast", { count: targets.length })))
      .catch(fail);
  };

  // --- 丢弃（破坏性）：先入确认队列，确认后执行 ---
  const handleDiscardClick = (targets: GitChange[]): void => {
    if (targets.length === 0) return;
    setDiscardTargets(targets);
  };

  const handleConfirmDiscard = (): void => {
    const targets = discardTargets;
    if (!targets) return;
    void discardChanges(targets)
      .then((result) => {
        setDiscardTargets(null);
        showToast(
          t("panels.review.discardedToast", {
            restored: result.restored,
            removed: result.removed,
          }),
        );
      })
      .catch((err: unknown) => {
        setDiscardTargets(null);
        fail(err);
      });
  };

  // --- 提交 ---
  const handleCommit = (): void => {
    if (writing) return;
    if (staged.length === 0) {
      showToast(t("panels.review.commitNeedStaged"));
      return;
    }
    const text = message.trim();
    if (!text) {
      showToast(t("panels.review.commitNeedMessage"));
      return;
    }
    void commit(text)
      .then((result) => {
        setMessage("");
        showToast(t("panels.review.committedToast", { shortOid: result.shortOid }));
      })
      .catch(fail);
  };

  const handleCommitKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleCommit();
    }
  };

  // --- 推送：先拉取计划复述影响范围，确认后推送 ---
  const handlePushClick = (): void => {
    if (writing) return;
    void fetchPushPlan()
      .then((plan) => {
        setPushPlan(plan);
        setPushConfirmOpen(true);
      })
      .catch((err: unknown) => {
        showToast(t("panels.review.pushPlanFailed", { message: errMessage(err) }));
      });
  };

  const handleConfirmPush = (): void => {
    const plan = pushPlan;
    if (!plan) return;
    void push(plan)
      .then((result) => {
        setPushConfirmOpen(false);
        setPushPlan(null);
        showToast(
          t("panels.review.pushedToast", {
            remote: result.remote,
            branch: result.branch,
          }),
        );
      })
      .catch((err: unknown) => {
        setPushConfirmOpen(false);
        fail(err);
      });
  };

  // --- 撤销上一轮 ---
  // 确认弹窗由 reviewStore 驱动、全局宿主渲染（快捷键与按钮共用同一确认流）
  const handleRollbackClick = (): void => {
    requestRollbackPrompt();
  };

  if (phase !== "ready") {
    return (
      <div className={styles.root}>
        {phase === "noWorkspace" && (
          <StateView
            icon={<GitPullRequest size={24} weight="regular" className={styles.stateIcon} />}
            text={t("panels.review.noProject")}
            hint={t("panels.review.noProjectHint")}
          />
        )}
        {phase === "loading" && (
          <StateView
            icon={
              <CircleNotch
                size={24}
                weight="regular"
                className={`${styles.stateIcon} ${styles.spin}`}
              />
            }
            text={t("panels.review.loading")}
          />
        )}
        {phase === "notRepo" && (
          <StateView
            icon={<Warning size={24} weight="regular" className={styles.stateIcon} />}
            text={t("panels.review.notRepo")}
          />
        )}
        {phase === "error" && (
          <StateView
            icon={<WarningCircle size={24} weight="regular" className={styles.stateIcon} />}
            text={t("panels.review.error")}
            hint={error ?? t("panels.review.errorHint")}
            tone="error"
          />
        )}
      </div>
    );
  }

  const filters: { mode: ReviewFilterMode; labelKey: string; count: number }[] = [
    { mode: "all", labelKey: "panels.review.filter.all", count: changes.length },
    {
      mode: "unstaged",
      labelKey: "panels.review.filter.unstaged",
      count: unstaged.length + untracked.length,
    },
    { mode: "staged", labelKey: "panels.review.filter.staged", count: staged.length },
    { mode: "lastRound", labelKey: "panels.review.filter.lastRound", count: lastRound.length },
  ];

  return (
    <div className={styles.root}>
      {filterMode === "lastRound" && lastRound.length > 0 && (
        <div className={styles.rollbackBar}>
          <span className={styles.rollbackText}>
            {canRollback
              ? t("panels.review.rollbackPrompt")
              : t(ROLLBACK_BLOCK_REASON_TEXT[rollbackBlockReason])}
          </span>
          <button
            type="button"
            className={styles.rollbackBtn}
            disabled={!canRollback || rollingBack}
            title={canRollback ? ROLLBACK_BLOCK_REASON_TEXT.ready : undefined}
            onClick={handleRollbackClick}
          >
            {rollingBack ? t("panels.review.rollingBack") : t("panels.review.rollback")}
          </button>
        </div>
      )}
      <div className={styles.content}>
        <div className={styles.listCol}>
          <div
            className={styles.filterRow}
            role="tablist"
            aria-label={t("panels.review.filterLabel")}
          >
            {filters.map((filter) => (
              <button
                key={filter.mode}
                type="button"
                role="tab"
                aria-selected={filterMode === filter.mode}
                className={[
                  styles.filterChip,
                  filterMode === filter.mode ? styles.filterChipActive : "",
                ].join(" ")}
                onClick={() => setFilterMode(filter.mode)}
              >
                {t(filter.labelKey)}
                <span className={styles.filterCount}>{filter.count}</span>
              </button>
            ))}
          </div>
          {visibleChanges.length > 0 ? (
            <ChangeList
              changes={visibleChanges}
              selectedKey={selectedKey}
              busy={writing}
              onRowClick={selectChange}
              onStage={(change) => handleStage([change])}
              onUnstage={(change) => handleUnstage([change])}
              onDiscard={(change) => handleDiscardClick([change])}
            />
          ) : (
            <StateView
              icon={<GitPullRequest size={24} weight="regular" className={styles.stateIcon} />}
              text={t("panels.review.noChanges")}
              hint={
                filterMode === "lastRound"
                  ? lastRoundEmptyHint(rollbackBlockReason, t)
                  : t(EMPTY_HINT_KEYS[filterMode])
              }
            />
          )}
        </div>
        <div className={styles.detailCol}>
          {selectedChange ? (
            <>
              <div className={styles.detailHead}>
                <span
                  className={styles.detailPath}
                  title={
                    selectedChange.oldPath
                      ? `${selectedChange.oldPath} → ${selectedChange.path}`
                      : selectedChange.path
                  }
                >
                  {selectedChange.oldPath
                    ? `${selectedChange.oldPath} → ${selectedChange.path}`
                    : selectedChange.path}
                </span>
                <span className={[styles.layerChip, LAYER_CLASS[selectedChange.layer]].join(" ")}>
                  {t(LAYER_LABEL_KEYS[selectedChange.layer])}
                </span>
              </div>
              <div className={styles.detailBody}>
                <FileDiffInline change={selectedChange} cache={cacheRef} />
              </div>
            </>
          ) : (
            <StateView
              icon={<GitDiff size={24} weight="regular" className={styles.stateIcon} />}
              text={t("panels.review.detailEmpty")}
            />
          )}
        </div>
      </div>
      <CommitBar
        message={message}
        writing={writing}
        stagedCount={staged.length}
        canStageAll={unstaged.length + untracked.length > 0}
        canUnstageAll={staged.length > 0}
        onMessageChange={setMessage}
        onCommitKeyDown={handleCommitKeyDown}
        onStageAll={() => handleStage([...unstaged, ...untracked])}
        onUnstageAll={() => handleUnstage(staged)}
        onCommit={handleCommit}
        onPush={handlePushClick}
      />
      <ConfirmDialog
        open={discardTargets !== null}
        tone="danger"
        title={t("panels.review.discardConfirmTitle")}
        message={t("panels.review.discardConfirmMessage", {
          count: discardTargets?.length ?? 0,
        })}
        confirmLabel={t("panels.review.discardConfirm")}
        busy={writing}
        onConfirm={handleConfirmDiscard}
        onCancel={() => setDiscardTargets(null)}
      />
      <ConfirmDialog
        open={pushConfirmOpen && pushPlan !== null}
        title={t("panels.review.pushConfirmTitle")}
        message={
          pushPlan ? (
            <>
              <p>
                {t("panels.review.pushConfirmMessage", {
                  branch: pushPlan.branch,
                  remote: pushPlan.remote,
                  remoteBranch: pushPlan.remoteBranch,
                  ahead: pushPlan.ahead,
                })}
              </p>
              {!pushPlan.hasUpstream && <p>{t("panels.review.pushSetUpstreamNote")}</p>}
            </>
          ) : (
            ""
          )
        }
        confirmLabel={t("panels.review.push")}
        busy={writing}
        onConfirm={handleConfirmPush}
        onCancel={() => {
          setPushConfirmOpen(false);
          setPushPlan(null);
        }}
      />
    </div>
  );
}

/** 无 props：拖拽/缩放浮窗壳重渲染时整块 bail-out，列表不做无谓调和。 */
export const ChangesPane = memo(ChangesPaneImpl);
