import type {
  RunNowOutcome,
  ScheduledRunRecord,
  ScheduledTask,
  SchedulerSnapshot,
  SchedulerTaskInput,
} from "../../shared/scheduler";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 定时任务 IPC 封装；错误向上抛（调用方 toast / 错误态展示）。 */
export const schedulerService = {
  list(): Promise<SchedulerSnapshot> {
    const api = pideskApi();
    if (!api) throw new Error("preload 未就绪");
    return unwrap(api.scheduler.list());
  },
  create(input: SchedulerTaskInput): Promise<ScheduledTask> {
    const api = pideskApi();
    if (!api) throw new Error("preload 未就绪");
    return unwrap(api.scheduler.create(input));
  },
  update(id: string, patch: SchedulerTaskInput): Promise<ScheduledTask> {
    const api = pideskApi();
    if (!api) throw new Error("preload 未就绪");
    return unwrap(api.scheduler.update(id, patch));
  },
  remove(id: string): Promise<null> {
    const api = pideskApi();
    if (!api) throw new Error("preload 未就绪");
    return unwrap(api.scheduler.remove(id));
  },
  setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    const api = pideskApi();
    if (!api) throw new Error("preload 未就绪");
    return unwrap(api.scheduler.setEnabled(id, enabled));
  },
  runNow(id: string): Promise<RunNowOutcome> {
    const api = pideskApi();
    if (!api) throw new Error("preload 未就绪");
    return unwrap(api.scheduler.runNow(id));
  },
  /** 订阅主进程快照推送；preload 未就绪时返回空退订。 */
  onChanged(callback: (snapshot: SchedulerSnapshot) => void): () => void {
    const api = pideskApi();
    return api ? api.scheduler.onChanged(callback) : () => {};
  },
};

export type { ScheduledRunRecord, ScheduledTask, SchedulerSnapshot, SchedulerTaskInput };
