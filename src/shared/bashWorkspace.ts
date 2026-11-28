import type { ProcDetail, ProcDetailRow } from "./ipc";

/** Host diagnostics supplement a job; they never replace the extension's lifecycle state. */
export interface BashJobRuntime extends ProcDetail {
  root: ProcDetailRow | null;
}

/** Both values resolve through the live authenticated View; callers cannot supply a PID or path. */
export interface BashJobRequest {
  viewId: string;
  jobId: string;
}
