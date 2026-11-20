import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS } from "../../../../shared/remote";
import type { RemoteApi, RemoteSnapshot } from "../../../../shared/remoteDesktop";
import { unwrap } from "../../../services/ipc";

function remoteApi(): RemoteApi {
  const api = window.pidesk?.remote;
  if (!api) throw new Error("ACCOUNT_AUTH_REQUIRED");
  return api;
}
type Operation = (api: RemoteApi) => ReturnType<RemoteApi["snapshot"]>;

/** Poll progress during operations, and prevent cancelled or unmounted callers from publishing stale results. */
export function useRemoteManagement() {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const mounted = useRef(false);
  const reading = useRef(false);
  const operationPending = useRef(false);
  const operationId = useRef(0);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const version = revision.current;
    try {
      const value = await unwrap(remoteApi().snapshot());
      if (mounted.current && version === revision.current) {
        setSnapshot(value);
        setReadFailed(false);
      }
    } catch {
      if (mounted.current && version === revision.current) setReadFailed(true);
    } finally {
      reading.current = false;
    }
  }, []);
  const busy = localBusy || !!snapshot?.operation;
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      revision.current++;
      operationId.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), busy ? 300 : LIMITS.pollMs);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  const run = useCallback(
    async (operation: Operation): Promise<boolean> => {
      if (operationPending.current || snapshot?.operation) return false;
      const current = ++operationId.current;
      operationPending.current = true;
      revision.current++;
      setLocalBusy(true);
      setError(null);
      try {
        const value = await unwrap(operation(remoteApi()));
        if (mounted.current && current === operationId.current) {
          revision.current++;
          setSnapshot(value);
          setReadFailed(false);
        }
        return current === operationId.current;
      } catch (cause) {
        if (mounted.current && current === operationId.current) {
          revision.current++;
          const code = cause instanceof Error ? cause.message : "CONTROL_FAILED";
          if (code !== "AUTH_CANCELLED") setError(code);
          void refresh();
        }
        return false;
      } finally {
        if (current === operationId.current) {
          operationPending.current = false;
          if (mounted.current) setLocalBusy(false);
        }
      }
    },
    [refresh, snapshot?.operation],
  );
  const cancelLogin = useCallback(async () => {
    if (cancelling) return;
    const current = ++operationId.current;
    operationPending.current = true;
    revision.current++;
    setCancelling(true);
    setError(null);
    try {
      const value = await unwrap(remoteApi().cancelLogin());
      if (mounted.current && current === operationId.current) {
        revision.current++;
        setSnapshot(value);
        setReadFailed(false);
      }
    } catch (cause) {
      if (mounted.current && current === operationId.current)
        setError(cause instanceof Error ? cause.message : "CONTROL_FAILED");
    } finally {
      if (current === operationId.current) {
        operationPending.current = false;
        if (mounted.current) {
          setCancelling(false);
          setLocalBusy(false);
          void refresh();
        }
      }
    }
  }, [cancelling, refresh]);
  const listDesktops = useCallback(
    (relayOrigin: string) => unwrap(remoteApi().desktops(relayOrigin)),
    [],
  );
  return { snapshot, busy, cancelling, error, readFailed, refresh, run, cancelLogin, listDesktops };
}
