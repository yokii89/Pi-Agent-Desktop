import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Broadcast,
  Pause,
  ShieldWarning,
  WifiSlash,
} from "@phosphor-icons/react";
import type { RemoteSnapshot } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../MobilePairingPanel.module.css";

/** One connection action; signing in and resetting enrollment belong to the account card. */
export function RemoteConnectionPanel({
  snapshot,
  busy,
  onConnect,
  onDisconnect,
  onReset,
}: {
  snapshot: RemoteSnapshot;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onReset: () => void;
}) {
  const t = useT();
  const needsReset =
    snapshot.credentialState === "expired" ||
    snapshot.credentialState === "invalid" ||
    snapshot.error === "DEVICE_REVOKED" ||
    snapshot.error === "AUTH_EXPIRED";
  const connecting = snapshot.connectionState === "connecting";
  const status = snapshot.connected
    ? "connected"
    : connecting
      ? "connecting"
      : snapshot.connectionState === "paused"
        ? "paused"
        : "disconnected";
  return (
    <section className={styles.relay} aria-label={t("settings.remote.relay")}>
      <div className={styles.relayMain}>
        <Broadcast size={20} weight="regular" />
        <div className={styles.relayText}>
          <div className={styles.relayTitle}>
            {t("settings.remote.relay")}
            <span
              className={`${styles.status} ${snapshot.connected ? styles.online : styles.pending}`}
              role="status"
            >
              <span className={styles.dot} />
              {t(`settings.remote.${status}`)}
            </span>
          </div>
          <p className={styles.domain}>{snapshot.relayOrigin}</p>
        </div>
        {!needsReset && (
          <Button
            disabled={busy || !snapshot.accountReady}
            onClick={snapshot.connected || connecting ? onDisconnect : onConnect}
          >
            {snapshot.connected || connecting ? (
              <Pause size={16} weight="regular" />
            ) : (
              <ArrowClockwise size={16} weight="regular" />
            )}
            {t(
              snapshot.connected || connecting
                ? "settings.remote.pause"
                : "settings.remote.reconnect",
            )}
          </Button>
        )}
      </div>
      {needsReset ? (
        <div className={styles.connectionNotice}>
          <ShieldWarning size={20} weight="regular" />
          <div>
            <strong>
              {t(
                snapshot.credentialState === "expired" || snapshot.error === "AUTH_EXPIRED"
                  ? "settings.remote.registrationExpired"
                  : "settings.remote.registrationNeedsRecovery",
              )}
            </strong>
            <p className={styles.hint}>{t("settings.remote.registrationRecovery")}</p>
          </div>
          <Button disabled={busy} onClick={onReset}>
            <ArrowCounterClockwise size={16} weight="regular" />
            {t("settings.remote.resetEnrollment")}
          </Button>
        </div>
      ) : !snapshot.connected ? (
        <div className={styles.connectionNotice}>
          <WifiSlash size={20} weight="regular" />
          <p className={styles.hint}>
            {t(
              !snapshot.accountReady
                ? "settings.remote.connectionNeedsAccount"
                : snapshot.grant && snapshot.grant.state !== "revoked"
                  ? "settings.remote.offlinePaired"
                  : "settings.remote.offlineUnpaired",
            )}
          </p>
        </div>
      ) : null}
    </section>
  );
}
