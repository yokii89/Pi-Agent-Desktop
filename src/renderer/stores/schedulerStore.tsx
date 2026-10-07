import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  RunNowOutcome,
  ScheduledRunRecord,
  ScheduledTask,
  SchedulerTaskInput,
} from "../../shared/scheduler";
import { schedulerService } from "../services/schedulerService";

/**
 * 定时任务 store：任务与运行台账的渲染层镜像。
 * 数据源以主进程 changed 推送为准（调度器在触发、补跑、台账回填时都会推全量快照），
 * list 只作初次装载与降级刷新。
 */
interface SchedulerStoreValue {
  tasks: ScheduledTask[];
  runs: ScheduledRunRecord[];
  loaded: boolean;
  /** list / 推送解包失败的最近一次错误；null = 正常。 */
  error: string | null;
  refresh: () => Promise<void>;
  createTask: (input: SchedulerTaskInput) => Promise<ScheduledTask>;
  updateTask: (id: string, patch: SchedulerTaskInput) => Promise<ScheduledTask>;
  removeTask: (id: string) => Promise<void>;
  setTaskEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<RunNowOutcome>;
}

const SchedulerStoreContext = createContext<SchedulerStoreValue | null>(null);

export function SchedulerProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<{ tasks: ScheduledTask[]; runs: ScheduledRunRecord[] }>({
    tasks: [],
    runs: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // 吞掉拒绝改为错误态：store 的刷新多为 fire-and-forget，未接住的 rejection 只会变控制台噪声
    try {
      const next = await schedulerService.list();
      setSnapshot({ tasks: next.tasks, runs: next.runs });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 主进程是唯一事实源：任何触发/补跑/台账回填都会推全量快照
    return schedulerService.onChanged((next) => {
      setSnapshot({ tasks: next.tasks, runs: next.runs });
      setError(null);
    });
  }, [refresh]);

  const createTask = useCallback(
    async (input: SchedulerTaskInput): Promise<ScheduledTask> => {
      const task = await schedulerService.create(input);
      await refresh();
      return task;
    },
    [refresh],
  );

  const updateTask = useCallback(
    async (id: string, patch: SchedulerTaskInput): Promise<ScheduledTask> => {
      const task = await schedulerService.update(id, patch);
      await refresh();
      return task;
    },
    [refresh],
  );

  const removeTask = useCallback(
    async (id: string): Promise<void> => {
      await schedulerService.remove(id);
      await refresh();
    },
    [refresh],
  );

  const setTaskEnabled = useCallback(
    async (id: string, enabled: boolean): Promise<void> => {
      await schedulerService.setEnabled(id, enabled);
      await refresh();
    },
    [refresh],
  );

  const runNow = useCallback(
    async (id: string): Promise<RunNowOutcome> => {
      const outcome = await schedulerService.runNow(id);
      // 派发是异步的：先拉一次台账展示「进行中」，后续以推送为准
      if (outcome.kind === "dispatching") void refresh();
      return outcome;
    },
    [refresh],
  );

  const value = useMemo<SchedulerStoreValue>(
    () => ({
      tasks: snapshot.tasks,
      runs: snapshot.runs,
      loaded,
      error,
      refresh,
      createTask,
      updateTask,
      removeTask,
      setTaskEnabled,
      runNow,
    }),
    [snapshot, loaded, error, refresh, createTask, updateTask, removeTask, setTaskEnabled, runNow],
  );

  return <SchedulerStoreContext.Provider value={value}>{children}</SchedulerStoreContext.Provider>;
}

export function useSchedulerStore(): SchedulerStoreValue {
  const ctx = useContext(SchedulerStoreContext);
  if (!ctx) throw new Error("useSchedulerStore 必须在 SchedulerProvider 内使用");
  return ctx;
}
