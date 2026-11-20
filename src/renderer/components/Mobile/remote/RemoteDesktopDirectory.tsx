import { ArrowClockwise, Desktop, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopSummary } from "../../../../shared/remote";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { IconButton } from "../../ui/IconButton";
import { Modal } from "../../ui/Modal";
import styles from "../MobilePairingPanel.module.css";

/** Explicit account-directory access provides recovery for lost or unfinished computer registrations. */
export function RemoteDesktopDirectory({
  relayOrigin,
  currentDesktopId,
  busy,
  operationError,
  onList,
  onRemove,
  onClose,
}: {
  relayOrigin: string;
  currentDesktopId: string | null;
  busy: boolean;
  operationError: string | null;
  onList: (relayOrigin: string) => Promise<DesktopSummary[]>;
  onRemove: (relayOrigin: string, desktopId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [items, setItems] = useState<DesktopSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DesktopSummary | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++revision.current;
    setLoading(true);
    setError(null);
    try {
      const values = await onList(relayOrigin);
      if (mounted.current && version === revision.current) setItems(values);
    } catch (cause) {
      if (mounted.current && version === revision.current)
        setError(cause instanceof Error ? cause.message : "CONTROL_FAILED");
    } finally {
      if (mounted.current && version === revision.current) setLoading(false);
    }
  }, [onList, relayOrigin]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, [refresh]);
  const visibleError = error ?? operationError;
  const errorKey = `remote.error.${visibleError}`;
  const errorText = visibleError ? t(errorKey) : "";
  return (
    <Modal
      open
      nested
      onClose={() => {
        if (!busy) onClose();
      }}
      ariaLabel={t("settings.remote.directory")}
      panelClassName={styles.directoryDialog}
    >
      <header className={styles.directoryHeader}>
        <h2>{t("settings.remote.directory")}</h2>
        <IconButton title={t("settings.close")} disabled={busy} onClick={onClose}>
          <X size={20} weight="regular" />
        </IconButton>
      </header>
      <div className={styles.directoryContent} data-selectable-text>
        <p className={styles.hint}>{t("settings.remote.directoryHint")}</p>
        <p className={styles.domain}>{relayOrigin}</p>
        {visibleError && (
          <p className={styles.error} role="alert">
            {errorText === errorKey ? t("remote.error.CONTROL_FAILED") : errorText}
          </p>
        )}
        {loading ? (
          <p className={styles.hint} role="status">
            {t("common.loading")}
          </p>
        ) : items.length === 0 && !visibleError ? (
          <p className={styles.hint}>{t("settings.remote.directoryEmpty")}</p>
        ) : null}
        <ul className={styles.directoryList}>
          {items.map((item) => (
            <li key={item.desktopId}>
              <Desktop size={20} weight="regular" />
              <div className={styles.directoryItem}>
                <p>
                  {item.displayName}
                  {item.desktopId === currentDesktopId
                    ? ` · ${t("settings.remote.thisComputer")}`
                    : ""}
                </p>
                <p className={styles.hint}>
                  {t(`settings.remote.registrationState.${item.state}`)} ·{" "}
                  {item.desktopId.slice(0, 8)}
                </p>
              </div>
              <Button
                disabled={busy || loading || item.state === "revoked"}
                onClick={() => setSelected(item)}
              >
                <Trash size={16} weight="regular" />
                {t("settings.remote.removeComputer")}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <footer className={styles.directoryFooter}>
        <Button disabled={busy || loading} onClick={() => void refresh()}>
          <ArrowClockwise size={16} weight="regular" />
          {t("settings.remote.directoryRefresh")}
        </Button>
        <Button disabled={busy} onClick={onClose}>
          <X size={16} weight="regular" />
          {t("settings.close")}
        </Button>
      </footer>
      <ConfirmDialog
        open={!!selected}
        nested
        title={t("settings.remote.removeComputerTitle")}
        message={t("settings.remote.removeComputerBody", { name: selected?.displayName ?? "" })}
        confirmLabel={t("settings.remote.removeComputer")}
        tone="danger"
        busy={busy}
        onCancel={() => setSelected(null)}
        onConfirm={() => {
          if (!selected) return;
          void onRemove(relayOrigin, selected.desktopId).then((removed) => {
            if (!mounted.current) return;
            if (removed) {
              setSelected(null);
              void refresh();
            } else {
              setError(null);
              setSelected(null);
            }
          });
        }}
      />
    </Modal>
  );
}
