import { Power } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ProcessQuitRequest } from "../../../shared/windowClose";
import { useT } from "../../hooks/useT";
import { browserService } from "../../services/browserService";
import { windowService } from "../../services/windowService";
import { PiMark } from "../Splash/PiMark";
import { Modal } from "../ui/Modal";
import styles from "./QuitProcDialog.module.css";

/** 应用退出时由 PiDesk 接管后台进程处置确认。 */
export function QuitProcDialog({
  request,
  open,
  onSettled,
}: {
  request: ProcessQuitRequest;
  open: boolean;
  onSettled: (id: number) => void;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    void browserService.setOverlaySuppressed(true, "close-request");
    void windowService.closeReady(request.id).catch((reason: unknown) => setError(String(reason)));
    return () => {
      void browserService.setOverlaySuppressed(false, "close-request");
    };
  }, [open, request.id]);

  const decide = async (action: "cancel" | "kill" | "keep"): Promise<void> => {
    if (!open || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await windowService.closeDecision({ kind: "process-quit", id: request.id, action });
      onSettled(request.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const more = request.procs > request.commands.length;

  return (
    <Modal
      open={open}
      onClose={() => void decide("cancel")}
      ariaLabel={t("proc.quit.title")}
      panelClassName={styles.panel}
      priority
      initialFocusRef={cancelRef}
    >
      <div className={styles.head}>
        <PiMark className={styles.mark} />
        <h2 className={styles.title}>{t("proc.quit.title")}</h2>
      </div>
      <p className={styles.message}>{t("proc.quit.message", { count: request.procs })}</p>
      {request.commands.length > 0 && (
        <ul className={styles.commands} data-selectable-text>
          {request.commands.map(({ pid, command }) => (
            <li key={pid} title={command}>
              {command}
            </li>
          ))}
          {more && <li className={styles.more}>{t("proc.quit.more", { count: request.procs })}</li>}
        </ul>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          data-danger="true"
          disabled={busy}
          onClick={() => void decide("kill")}
        >
          <Power size={20} weight="regular" />
          {t("proc.quit.kill")}
        </button>
        <button
          type="button"
          className={styles.action}
          disabled={busy}
          onClick={() => void decide("keep")}
        >
          {t("proc.quit.keep")}
        </button>
        <button
          ref={cancelRef}
          type="button"
          className={styles.cancel}
          disabled={busy}
          onClick={() => void decide("cancel")}
        >
          {t("proc.quit.cancel")}
        </button>
      </div>
    </Modal>
  );
}
