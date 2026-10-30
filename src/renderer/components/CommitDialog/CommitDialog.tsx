import { GitBranch, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { GitPushPlan } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore } from "../../stores/uiStore";
import { pathBasename } from "../../utils/paths";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import styles from "./CommitDialog.module.css";
import { canCommit, formatStat, sumDiffStat } from "./commitDialogData";

interface CommitDialogProps {
  open: boolean;
  onClose: () => void;
  /** 当前分支（只读展示）；null = 游离 HEAD。 */
  branch: string | null;
  /** 提交/推送成功后通知调用方重读环境信息（待推送数、上游状态）。 */
  onRepoChange: () => void;
}

type DialogAction = "commit" | "commitPush" | "push";

/** 在途动作 + 所处步骤（提交并推送会先后走两步，按钮文案跟着变）。 */
interface BusyState {
  action: DialogAction;
  step: "commit" | "push";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 「提交或推送」浮窗：会话监控卡环境信息里的入口打开，口径与审查面板一致。
 *
 * - 默认勾选「包含未暂存变更」：提交前把未暂存/未跟踪改动一并 `git add`；
 * - 推送即按钮本身即确认，不再叠二次确认（打开浮窗并点按钮已是明确意图）；
 * - 提交说明必须手写：PiDesk 没有模型通道，不做 AI 生成（docs/design/30）。
 */
export function CommitDialog({ open, onClose, branch, onRepoChange }: CommitDialogProps) {
  const t = useT();
  const { locale, showToast } = useUiStore();
  const {
    cwd,
    phase,
    changes,
    staged,
    unstaged,
    untracked,
    summary,
    writing,
    refreshIfStale,
    stageChanges,
    commit,
    fetchPushPlan,
    push,
  } = useReviewStore();
  const [message, setMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cwdRef = useRef(cwd);

  // 换项目后不把上一个仓库的提交说明带过去
  useEffect(() => {
    if (cwdRef.current === cwd) return;
    cwdRef.current = cwd;
    setMessage("");
  }, [cwd]);

  useEffect(() => {
    if (!open) return;
    refreshIfStale();
    // Modal 打开时先把焦点送到面板本身；等它落定再把光标放进输入框
    const raf = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [open, refreshIfStale]);

  const stagedStat = sumDiffStat(staged);
  const stat = includeUnstaged
    ? { files: summary.files, additions: summary.additions, deletions: summary.deletions }
    : { files: staged.length, additions: stagedStat.additions, deletions: stagedStat.deletions };
  const hasDiff = stat.files > 0;
  const committable =
    phase === "ready" &&
    canCommit({
      message,
      includeUnstaged,
      changeCount: changes.length,
      stagedCount: staged.length,
      busy: busy !== null || writing,
    });
  const busyNow = busy !== null;

  const fail = (err: unknown): void => {
    showToast(t("panels.review.operationFailed", { message: errMessage(err) }));
  };

  /** 提交（含按需暂存）；成功后由调用方决定是否继续推送。 */
  const runCommit = async (): Promise<boolean> => {
    const text = message.trim();
    if (!committable || !text) return false;
    if (includeUnstaged && (unstaged.length > 0 || untracked.length > 0)) {
      await stageChanges([...unstaged, ...untracked]);
    }
    const result = await commit(text);
    setMessage("");
    showToast(t("panels.review.committedToast", { shortOid: result.shortOid }));
    onRepoChange();
    return true;
  };

  const handleCommit = (): void => {
    if (!committable) return;
    setBusy({ action: "commit", step: "commit" });
    void (async () => {
      try {
        if (!(await runCommit())) return;
        onClose();
      } catch (err) {
        fail(err);
      } finally {
        setBusy(null);
      }
    })();
  };

  const handlePush = (): void => {
    if (busyNow || phase !== "ready") return;
    setBusy({ action: "push", step: "push" });
    void (async () => {
      let plan: GitPushPlan;
      try {
        plan = await fetchPushPlan();
      } catch (err) {
        showToast(t("panels.review.pushPlanFailed", { message: errMessage(err) }));
        setBusy(null);
        return;
      }
      try {
        if (plan.hasUpstream && plan.ahead === 0) {
          showToast(t("commitDialog.nothingToPush"));
          return;
        }
        await push(plan);
        showToast(t("panels.review.pushedToast", { remote: plan.remote, branch: plan.branch }));
        onRepoChange();
        onClose();
      } catch (err) {
        fail(err);
      } finally {
        setBusy(null);
      }
    })();
  };

  const handleCommitPush = (): void => {
    if (!committable) return;
    setBusy({ action: "commitPush", step: "commit" });
    void (async () => {
      try {
        if (!(await runCommit())) return;
        setBusy({ action: "commitPush", step: "push" });
        const plan = await fetchPushPlan();
        await push(plan);
        showToast(t("panels.review.pushedToast", { remote: plan.remote, branch: plan.branch }));
        onRepoChange();
        onClose();
      } catch (err) {
        fail(err);
      } finally {
        setBusy(null);
      }
    })();
  };

  const commitLabel =
    busy?.action === "commit" ? t("commitDialog.committing") : t("commitDialog.commit");
  const commitPushLabel =
    busy?.action === "commitPush"
      ? busy.step === "commit"
        ? t("commitDialog.committing")
        : t("commitDialog.pushing")
      : t("commitDialog.commitAndPush");
  const pushLabel = busy?.action === "push" ? t("commitDialog.pushing") : t("commitDialog.push");

  return (
    <Modal
      open={open && cwd !== null}
      onClose={() => {
        if (!busyNow) onClose();
      }}
      ariaLabel={t("commitDialog.title")}
      panelClassName={styles.panel}
    >
      <header className={styles.header}>
        <div className={styles.headText}>
          <h2 className={styles.title}>{t("commitDialog.title")}</h2>
          <p className={styles.subtitle}>
            {t("commitDialog.subtitle", { project: cwd ? pathBasename(cwd) : "" })}
          </p>
        </div>
        <IconButton title={t("common.close")} disabled={busyNow} onClick={onClose}>
          <X size={16} weight="regular" />
        </IconButton>
      </header>

      <div className={styles.body}>
        <div className={styles.branchField}>
          <GitBranch size={16} weight="regular" className={styles.branchIcon} aria-hidden="true" />
          <span className={styles.branchName}>{branch ?? t("commitDialog.branch.detached")}</span>
        </div>

        <textarea
          ref={inputRef}
          className={styles.input}
          rows={5}
          value={message}
          placeholder={t("commitDialog.message.placeholder")}
          aria-label={t("commitDialog.message.label")}
          disabled={busyNow}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              handleCommit();
            }
          }}
        />

        <div className={styles.includeRow}>
          <label className={styles.includeLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={includeUnstaged}
              disabled={busyNow || changes.length === 0}
              onChange={(event) => setIncludeUnstaged(event.target.checked)}
            />
            <span>{t("commitDialog.includeUnstaged")}</span>
          </label>
          {hasDiff ? (
            <span
              className={styles.stats}
              title={t("commitDialog.stats.title", {
                files: stat.files,
                additions: stat.additions,
                deletions: stat.deletions,
              })}
            >
              <span className={styles.add}>+{formatStat(stat.additions, locale)}</span>
              <span className={styles.del}>−{formatStat(stat.deletions, locale)}</span>
            </span>
          ) : (
            <span className={styles.noChanges}>
              {t(includeUnstaged ? "commitDialog.noChanges" : "commitDialog.noStaged")}
            </span>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={`${styles.btn} ${styles.ghostBtn}`}
          disabled={busyNow || phase !== "ready"}
          onClick={handlePush}
        >
          {pushLabel}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!committable}
          onClick={handleCommitPush}
        >
          {commitPushLabel}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.primaryBtn}`}
          disabled={!committable}
          onClick={handleCommit}
        >
          {commitLabel}
        </button>
      </footer>
    </Modal>
  );
}
