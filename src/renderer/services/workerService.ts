import type {
  ExtensionWorkerStatus,
  PrefetchMetrics,
  PrefetchNotifyRequest,
  WorkerAcquireResult,
} from "../../shared/contribution";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

function workerApi() {
  const a = pideskApi()?.worker ?? window.pidesk?.worker;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

function prefetchApi() {
  const a = pideskApi()?.prefetch ?? window.pidesk?.prefetch;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

/** Extension Worker lease（docs/design/16 Phase F）。 */
export const workerService = {
  async acquire(): Promise<WorkerAcquireResult> {
    return unwrap(workerApi().acquire());
  },
  async release(): Promise<ExtensionWorkerStatus> {
    return unwrap(workerApi().release());
  },
  async status(): Promise<ExtensionWorkerStatus> {
    return unwrap(workerApi().status());
  },
};

/** speculative 预热（docs/design/16 Phase G）。 */
export const prefetchService = {
  async metrics(): Promise<PrefetchMetrics> {
    return unwrap(prefetchApi().metrics());
  },
  async notifyActive(req: PrefetchNotifyRequest): Promise<void> {
    await unwrap(prefetchApi().notifyActive(req));
  },
};
