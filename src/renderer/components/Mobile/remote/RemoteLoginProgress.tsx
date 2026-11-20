import { ArrowSquareOut } from "@phosphor-icons/react";
import type { DesktopAuthSnapshot } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../MobilePairingPanel.module.css";
import { usePairingCountdown } from "./usePairingCountdown";

/** The main-process deadline survives closing and reopening the pairing panel. */
export function RemoteLoginProgress({
  auth,
  cancelling,
  onCancel,
}: {
  auth: DesktopAuthSnapshot;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const t = useT();
  const remaining = usePairingCountdown(
    auth.deadline ? new Date(auth.deadline).toISOString() : null,
  );
  const time = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  const key =
    auth.phase === "opening_browser"
      ? "openingBrowser"
      : auth.phase === "exchanging_code"
        ? "exchangingCode"
        : "waitingForBrowser";
  return (
    <div className={styles.loginProgress}>
      <div className={styles.accountIdentity}>
        <ArrowSquareOut size={20} weight="regular" />
        <div>
          <p role="status" aria-live="polite">
            {t(`settings.remote.${key}`)}
          </p>
          <p className={styles.hint}>{t("settings.remote.loginWaitingHint")}</p>
        </div>
      </div>
      <div className={styles.accountActions}>
        <span className={styles.loginCountdown}>
          {t("settings.remote.loginRemaining", { time })}
        </span>
        <Button disabled={cancelling} onClick={onCancel}>
          {t(cancelling ? "settings.remote.cancellingLogin" : "settings.remote.cancelLogin")}
        </Button>
      </div>
    </div>
  );
}
