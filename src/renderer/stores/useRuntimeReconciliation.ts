import { useEffect } from "react";
import type { SessionRuntimeSnapshot } from "../../shared/contribution";
import { runtimeService } from "../services/contributionService";
import { claimFile, patchBucket, type SessionBucketsState } from "./sessionBuckets";
import { notifySessionRuntimeContext } from "./sessionContextBridge";

/** Renderer reload 后恢复主进程已有实例；读取快照不启动进程或切换当前会话。 */
export function useRuntimeReconciliation(
  update: (fn: (state: SessionBucketsState) => SessionBucketsState) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    const pushed = new Set<string>();
    const apply = (runtime: SessionRuntimeSnapshot): void => {
      if (cancelled) return;
      const alive =
        runtime.state === "ready" || runtime.state === "idle" || runtime.state === "busy";
      if (runtime.state === "starting" || runtime.state === "stopping") return;
      update((state) => {
        if (!alive && !state.buckets.has(runtime.sessionId)) return state;
        let next = patchBucket(state, runtime.sessionId, {
          cwd: runtime.cwd,
          sessionFile:
            runtime.sessionFile ?? state.buckets.get(runtime.sessionId)?.sessionFile ?? null,
          processAlive: alive,
          phase: runtime.state === "busy" ? "running" : "idle",
        });
        if (runtime.sessionFile) next = claimFile(next, runtime.sessionId, runtime.sessionFile);
        return next;
      });
      notifySessionRuntimeContext(runtime.sessionId, {
        cwd: runtime.cwd,
        sessionFile: runtime.sessionFile,
        processAlive: alive,
      });
    };
    const unsubscribe = runtimeService.onChanged((runtime) => {
      pushed.add(runtime.sessionId);
      apply(runtime);
    });
    void runtimeService
      .snapshot()
      .then((snapshots) => {
        for (const runtime of snapshots) if (!pushed.has(runtime.sessionId)) apply(runtime);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [update]);
}
