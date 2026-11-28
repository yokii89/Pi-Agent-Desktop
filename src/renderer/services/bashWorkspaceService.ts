import type { BashJobRuntime } from "../../shared/bashWorkspace";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

function requireView() {
  const view = pideskApi()?.view;
  if (!view) throw new Error("View host is unavailable");
  return view;
}

/** Host supplements a live extension workspace; callers cannot supply a PID or filesystem path. */
export const bashWorkspaceService = {
  inspect(viewId: string, jobId: string): Promise<BashJobRuntime> {
    return unwrap(requireView().bashRuntime({ viewId, jobId }));
  },
  async openLog(viewId: string, jobId: string): Promise<void> {
    await unwrap(requireView().bashOpenLog({ viewId, jobId }));
  },
};
