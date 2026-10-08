import { Clock, Plus } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import type {
  ScheduledRunRecord,
  ScheduledTask,
  SchedulerTaskInput,
} from "../../../shared/scheduler";
import { useT } from "../../hooks/useT";
import { useSchedulerStore } from "../../stores/schedulerStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ScheduledTaskDialog } from "./ScheduledTaskDialog";
import { ScheduledTaskRow } from "./ScheduledTaskRow";
import { ScheduledTaskRunsDialog } from "./ScheduledTaskRunsDialog";
import styles from "./ScheduledTasksPage.module.css";

/**
 * 定时任务页（中央路由 page="scheduled"）：
 * 任务卡片列表 + 新建/编辑对话框 + 运行历史 + 删除确认。
 * 页面只做编排；行、对话框、文案工具各自独立成件。
 */
export function ScheduledTasksPage() {
  const t = useT();
  const { showToast } = useUiStore();
  const { tasks, runs, loaded, error, createTask, updateTask, removeTask, setTaskEnabled, runNow } =
    useSchedulerStore();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [runsTarget, setRunsTarget] = useState<ScheduledTask | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  // 启用中的在前，其后按下次触发时刻升序（无计划的排最后），新任务容易被看到
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const aNext = a.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      const bNext = b.nextRunAt ?? Number.MAX_SAFE_INTEGER;
      if (aNext !== bNext) return aNext - bNext;
      return b.createdAt - a.createdAt;
    });
  }, [tasks]);

  // 单趟扫描台账取每任务最近一条补跑记录：O(runs)，不随任务数相乘；
  // 比较 startedAt 而非数组序——补跑与定时派发交错落账时数组序不保证时间序
  const latestCatchUpByTask = useMemo(() => {
    const latest = new Map<string, ScheduledRunRecord>();
    for (const run of runs) {
      if (run.trigger !== "catch-up" || !run.missedCount) continue;
      const prev = latest.get(run.taskId);
      if (!prev || run.startedAt > prev.startedAt) latest.set(run.taskId, run);
    }
    return latest;
  }, [runs]);

  const runsForTarget = useMemo(
    () =>
      runsTarget
        ? runs
            .filter((run) => run.taskId === runsTarget.id)
            .sort((a, b) => b.startedAt - a.startedAt)
        : [],
    [runs, runsTarget],
  );

  const handleToggle = useCallback(
    async (task: ScheduledTask, enabled: boolean): Promise<void> => {
      setBusyTaskId(task.id);
      try {
        await setTaskEnabled(task.id, enabled);
        showToast(enabled ? t("scheduled.toast.enabled") : t("scheduled.toast.disabled"));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyTaskId(null);
      }
    },
    [setTaskEnabled, showToast, t],
  );

  const handleRunNow = useCallback(
    async (task: ScheduledTask): Promise<void> => {
      setBusyTaskId(task.id);
      try {
        const outcome = await runNow(task.id);
        if (outcome.kind === "dispatching") showToast(t("scheduled.toast.runDispatched"));
        else showToast(t("scheduled.toast.runSkipped"));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyTaskId(null);
      }
    },
    [runNow, showToast, t],
  );

  const handleSubmit = useCallback(
    async (input: SchedulerTaskInput): Promise<void> => {
      if (editing) {
        await updateTask(editing.id, input);
        showToast(t("scheduled.toast.saved"));
      } else {
        await createTask(input);
        showToast(t("scheduled.toast.created"));
      }
    },
    [createTask, editing, showToast, t, updateTask],
  );

  const handleDelete = useCallback(async (): Promise<void> => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setBusyTaskId(target.id);
    try {
      await removeTask(target.id);
      showToast(t("scheduled.toast.removed"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTaskId(null);
    }
  }, [deleteTarget, removeTask, showToast, t]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            {t("scheduled.title")}
            <span className={styles.count}> · {t("scheduled.count", { n: tasks.length })}</span>
          </h1>
          <p className={styles.subtitle}>{t("scheduled.subtitle")}</p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus size={16} weight="regular" /> {t("scheduled.newTask")}
          </Button>
        </div>
      </header>

      <div className={styles.body}>
        {error ? <div className={styles.errorBanner}>{error}</div> : null}
        {!loaded ? (
          <div className={styles.loading}>{t("common.loading")}</div>
        ) : sortedTasks.length === 0 ? (
          <div className={styles.empty}>
            <Clock size={24} weight="regular" />
            <p className={styles.emptyTitle}>{t("scheduled.empty.title")}</p>
            <p>{t("scheduled.empty.description")}</p>
          </div>
        ) : (
          <div className={styles.taskList}>
            {sortedTasks.map((task) => (
              <ScheduledTaskRow
                key={task.id}
                task={task}
                latestCatchUp={latestCatchUpByTask.get(task.id) ?? null}
                busy={busyTaskId === task.id}
                onToggle={(enabled) => void handleToggle(task, enabled)}
                onRunNow={() => void handleRunNow(task)}
                onEdit={() => {
                  setEditing(task);
                  setDialogOpen(true);
                }}
                onHistory={() => setRunsTarget(task)}
                onDelete={() => setDeleteTarget(task)}
              />
            ))}
          </div>
        )}
      </div>

      <ScheduledTaskDialog
        open={dialogOpen}
        task={editing}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <ScheduledTaskRunsDialog
        open={runsTarget !== null}
        task={runsTarget}
        runs={runsForTarget}
        onClose={() => setRunsTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("scheduled.deleteConfirm.title")}
        tone="danger"
        confirmLabel={t("scheduled.deleteConfirm.confirm")}
        message={
          deleteTarget ? t("scheduled.deleteConfirm.message", { name: deleteTarget.name }) : ""
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
