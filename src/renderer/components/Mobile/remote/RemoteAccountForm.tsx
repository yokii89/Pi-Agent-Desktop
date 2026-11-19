import { useId, useRef, useState } from "react";
import type { RemoteAccountInput, RemoteEnrollment } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../MobilePairingPanel.module.css";

export function RemoteAccountForm({
  busy,
  relayOrigin,
  accountReady = false,
  onEnroll,
  onAccount,
  onLogout,
}: {
  busy: boolean;
  relayOrigin?: string;
  accountReady?: boolean;
  onEnroll?: (request: RemoteEnrollment) => void;
  onAccount?: (request: RemoteAccountInput) => void;
  onLogout?: () => void;
}) {
  const t = useT();
  const id = useId();
  const [origin, setOrigin] = useState(relayOrigin ?? "");
  const [name, setName] = useState("PiDesk");
  const [trusted, setTrusted] = useState(false);
  const registration = useRef<string | null>(null);
  return (
    <section className={styles.card}>
      <h3>{t("settings.remote.v2")}</h3>
      <p className={styles.hint}>{t("settings.remote.accountHint")}</p>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !trusted || !origin.trim()) return;
          if (onAccount) onAccount({ relayOrigin: origin.trim() });
          else {
            registration.current ??= crypto.randomUUID();
            onEnroll?.({
              controlVersion: 2,
              relayOrigin: origin.trim(),
              displayName: name.trim(),
              registrationRequestId: registration.current,
              trustRelay: trusted,
            });
          }
        }}
      >
        <label className={styles.field} htmlFor={`${id}-origin`}>
          {t("settings.remote.origin")}
          <input
            id={`${id}-origin`}
            type="url"
            required
            value={origin}
            disabled={busy || !!relayOrigin}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setOrigin(e.target.value);
              setTrusted(false);
              registration.current = null;
            }}
          />
        </label>
        {!relayOrigin && (
          <label className={styles.field} htmlFor={`${id}-name`}>
            {t("settings.remote.desktopName")}
            <input
              id={`${id}-name`}
              value={name}
              maxLength={64}
              required
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value);
                registration.current = null;
              }}
            />
          </label>
        )}
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={trusted}
            disabled={busy}
            onChange={(e) => setTrusted(e.target.checked)}
          />
          <span>{t("settings.remote.trust")}</span>
        </label>
        <div>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !trusted || !origin.trim() || (!relayOrigin && !name.trim())}
          >
            {t(
              accountReady ? "settings.remote.accountReconnect" : "settings.remote.accountConnect",
            )}
          </Button>
          {accountReady && onLogout ? (
            <Button type="button" disabled={busy} onClick={onLogout}>
              {t("settings.remote.accountLogout")}
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
