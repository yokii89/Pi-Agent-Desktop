import { ArrowClockwise, Clock, ClockClockwise, QrCode, WifiSlash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { PairingQr } from "../../../../shared/remote";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../RemoteDevicesPanel.module.css";
import { usePairingCountdown } from "./usePairingCountdown";

interface RemotePairingInvitationProps {
  qr: PairingQr | null;
  connected: boolean;
  busy: boolean;
  onInvite: () => void;
}

/** Renders an in-memory invitation and hides the QR immediately when it expires or disconnects. */
export function RemotePairingInvitation({
  qr,
  connected,
  busy,
  onInvite,
}: RemotePairingInvitationProps) {
  const t = useT();
  const [lastExpiry, setLastExpiry] = useState<string | null>(qr?.expiresAt ?? null);
  const [image, setImage] = useState<{ payload: string; url: string } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const payload = qr ? JSON.stringify(qr) : null;
  const remaining = usePairingCountdown(qr?.expiresAt ?? lastExpiry);
  const expired = !!(qr?.expiresAt ?? lastExpiry) && remaining === 0;
  const imageReady = !!payload && image?.payload === payload;
  const active = connected && !!qr && remaining > 0;
  useEffect(() => {
    if (qr) setLastExpiry(qr.expiresAt);
  }, [qr]);
  useEffect(() => {
    let active = true;
    setImage(null);
    setImageFailed(false);
    if (payload) {
      void import("qrcode")
        .then((qrcode) =>
          qrcode.toDataURL(payload, { width: 360, margin: 4, errorCorrectionLevel: "M" }),
        )
        .then((url) => {
          if (active) setImage({ payload, url });
        })
        .catch(() => {
          if (active) setImageFailed(true);
        });
    }
    return () => {
      active = false;
    };
  }, [payload]);
  const time = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <section className={`${styles.card} ${styles.invitation}`}>
      <div className={styles.invitationBody}>
        <div className={styles.invitationIntro}>
          <div className={styles.eyebrow}>
            <span className={styles.dot} />
            {t(
              !connected
                ? "settings.remote.disconnected"
                : expired
                  ? "settings.remote.expired"
                  : active
                    ? "settings.remote.waiting"
                    : "settings.remote.ready",
            )}
          </div>
          <h3>{t("settings.remote.scanTitle")}</h3>
          <ol className={styles.steps}>
            <li>{t("settings.remote.stepOpen")}</li>
            <li>{t("settings.remote.stepScan")}</li>
            <li>{t("settings.remote.stepApprove")}</li>
          </ol>
        </div>
        <div className={styles.qrArea}>
          <div className={styles.qrWrap}>
            {active && imageReady && image ? (
              <img
                className={styles.qr}
                src={image.url}
                alt={t("remote.scan")}
                width={180}
                height={180}
                draggable={false}
              />
            ) : (
              <div className={styles.qrPlaceholder}>
                {!connected ? (
                  <WifiSlash size={24} weight="regular" />
                ) : expired ? (
                  <ClockClockwise size={24} weight="regular" />
                ) : (
                  <QrCode size={24} weight="regular" />
                )}
                <p>
                  {t(
                    !connected
                      ? "settings.remote.disconnected"
                      : expired
                        ? "settings.remote.qrExpired"
                        : active && !imageFailed
                          ? "settings.remote.qrLoading"
                          : "settings.remote.noQr",
                  )}
                </p>
                {(!active || imageFailed) && (
                  <Button variant="primary" disabled={busy || !connected} onClick={onInvite}>
                    {t(
                      expired || imageFailed
                        ? "settings.remote.regenerate"
                        : "settings.remote.generate",
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
          {active && (
            <>
              <p className={styles.qrCaption}>
                <Clock size={16} weight="regular" />
                <span>{t("settings.remote.expiry", { time })}</span>
              </p>
              <button
                className={styles.textButton}
                type="button"
                disabled={busy}
                onClick={onInvite}
              >
                <ArrowClockwise size={16} weight="regular" />
                {t("settings.remote.refresh")}
              </button>
            </>
          )}
          {imageFailed && (
            <p className={styles.error} role="alert">
              {t("remote.error.INVALID_FRAME")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
