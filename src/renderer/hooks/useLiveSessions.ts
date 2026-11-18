import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveSessionSnapshot } from "../../shared/contribution";
import { runtimeService } from "../services/contributionService";

const REFRESH_INTERVAL_MS = 5000;

/** 仅面板挂载期间读取完整进程清单；串行刷新，卸载后丢弃迟到结果。 */
export function useLiveSessions() {
  const [sessions, setSessions] = useState<LiveSessionSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await runtimeService.liveSessions();
      if (!mountedRef.current) return;
      setSessions(rows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)));
      setLoaded(true);
      setError(null);
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    mountedRef.current = true;
    const schedule = (): void => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        await refresh();
        schedule();
      }, REFRESH_INTERVAL_MS);
    };
    void refresh();
    schedule();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refresh]);

  return { sessions, loading, loaded, error, refresh };
}
