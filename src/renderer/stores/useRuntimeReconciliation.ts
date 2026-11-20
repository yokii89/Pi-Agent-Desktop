import { useEffect } from "react";
import type { SessionRuntimeSnapshot } from "../../shared/contribution";
import { runtimeService } from "../services/contributionService";
import { claimFile, patchBucket, type SessionBucketsState } from "./sessionBuckets";
import { notifySessionRuntimeContext } from "./sessionContextBridge";

/** 运行时就绪不等于已提交任务：预启动的空桶继续使用首页和首页草稿。 */
export function reconcileSessionRuntime(
  state: SessionBucketsState,
  runtime: SessionRuntimeSnapshot,
): SessionBucketsState {
  if (runtime.state === "starting" || runtime.state === "stopping") return state;
  const alive = runtime.state === "ready" || runtime.state === "idle" || runtime.state === "busy";
  const current = state.buckets.get(runtime.sessionId);
  if (!alive && !current) return state;
  const empty = current?.phase === "empty" && !current.sessionFile && !runtime.sessionFile;
  let next = patchBucket(state, runtime.sessionId, {
    cwd: runtime.cwd,
    sessionFile: runtime.sessionFile ?? current?.sessionFile ?? null,
    processAlive: alive,
    phase: runtime.state === "busy" ? "running" : empty ? "empty" : "idle",
  });
  if (runtime.sessionFile) next = claimFile(next, runtime.sessionId, runtime.sessionFile);
  return next;
}

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
      update((state) => reconcileSessionRuntime(state, runtime));
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
