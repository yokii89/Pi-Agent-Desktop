import { useCallback, useEffect, useRef, useState } from "react";
import type { OfficeSearchProvider } from "../office/officeSearchTypes";

/**
 * React can retain the previous state snapshot after a preview closes. Forwarding through a
 * revocable ref keeps those snapshots from retaining the old provider's iframe and page cache.
 */
export function useOfficeSearchProvider() {
  const current = useRef<OfficeSearchProvider | null>(null);
  const [provider, setProvider] = useState<OfficeSearchProvider | null>(null);
  const search = useCallback<OfficeSearchProvider["search"]>(
    (...args) => current.current?.search(...args) ?? Promise.resolve(),
    [],
  );
  const navigate = useCallback<OfficeSearchProvider["navigate"]>((...args) => {
    current.current?.navigate(...args);
  }, []);
  const clearTarget = useCallback(() => current.current?.clearTarget(), []);
  const register = useCallback(
    (next: OfficeSearchProvider | null): void => {
      current.current = next;
      setProvider(
        next
          ? { kind: next.kind, previewKey: next.previewKey, search, navigate, clearTarget }
          : null,
      );
    },
    [search, navigate, clearTarget],
  );

  useEffect(
    () => () => {
      current.current = null;
    },
    [],
  );

  return [provider, register] as const;
}
