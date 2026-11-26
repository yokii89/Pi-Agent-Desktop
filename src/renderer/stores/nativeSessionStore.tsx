import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { NativeSessionState } from "../../shared/nativeBuiltins";
import { unwrap } from "../services/ipc";
import { pideskApi } from "../services/pideskApi";
import { useSessionMeta } from "./sessionStore";
import { useUiStore } from "./uiStore";

const NativeContext = createContext<NativeSessionState | null>(null);
/** One subscription per window; active-session changes cannot publish a stale snapshot. */
export function NativeSessionProvider({ children }: { children: ReactNode }) {
  const { activeSessionId, processAlive } = useSessionMeta();
  const { showToast } = useUiStore();
  const [current, setCurrent] = useState<{ id: string; state: NativeSessionState } | null>(null);
  useEffect(() => {
    const api = pideskApi();
    if (!api || !activeSessionId || !processAlive) return;
    let cancelled = false;
    let revision = 0;
    const off = api.durable.onNativeState((push) => {
      if (push.sessionId !== activeSessionId) return;
      revision++;
      setCurrent({ id: activeSessionId, state: push.state });
    });
    void unwrap(api.durable.nativeState(activeSessionId))
      .then((state) => {
        if (!cancelled && revision === 0) setCurrent({ id: activeSessionId, state });
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(String(error));
      });
    return () => {
      cancelled = true;
      off();
    };
  }, [activeSessionId, processAlive, showToast]);
  return (
    <NativeContext value={processAlive && current?.id === activeSessionId ? current.state : null}>
      {children}
    </NativeContext>
  );
}
export function useNativeSession(): NativeSessionState | null {
  return useContext(NativeContext);
}
