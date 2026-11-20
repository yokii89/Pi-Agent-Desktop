import { useId, useRef, useState } from "react";
import { origin as parseOrigin } from "../../../../shared/remote";
import type { RemoteEnrollment, RemoteSnapshot } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../MobilePairingPanel.module.css";
import { RemoteAccountIdentity } from "./RemoteAccountIdentity";
import { RemoteLoginProgress } from "./RemoteLoginProgress";

/** Keep account identity, browser authentication and computer registration separate from relay reconnect. */
export function RemoteAccountForm({
  busy,
  cancelling,
  snapshot,
  onEnroll,
  onSignIn,
  onLogout,
  onCancel,
  onReset,
  onDirectory,
}: {
  busy: boolean;
  cancelling: boolean;
  snapshot: RemoteSnapshot;
  onEnroll: (request: RemoteEnrollment) => void;
  onSignIn: (relayOrigin: string) => void;
  onLogout: () => void;
  onCancel: () => void;
  onReset: () => void;
  onDirectory: (relayOrigin: string) => void;
}) {
  const t = useT();
  const id = useId();
  const [origin, setOrigin] = useState(snapshot.relayOrigin ?? "");
  const [name, setName] = useState(snapshot.enrollment?.displayName ?? "PiDesk");
  const [trusted, setTrusted] = useState(false);
  const registration = useRef(snapshot.enrollment?.registrationRequestId ?? crypto.randomUUID());
  const originInput = useRef<HTMLInputElement>(null);
  const loggingIn = ["opening_browser", "waiting_for_browser", "exchanging_code"].includes(
    snapshot.auth.phase,
  );
  const recovery =
    snapshot.configured || !!snapshot.enrollment || snapshot.error === "REGISTRATION_STORE_INVALID";
  const relayOrigin = snapshot.relayOrigin ?? origin.trim();
  const identity = snapshot.auth.identity;
  const canClearAccount = [
    "AUTH_STORE_INVALID",
    "AUTH_STORE_CLEAR_FAILED",
    "SECURE_STORAGE_UNAVAILABLE",
  ].includes(snapshot.auth.error ?? "");
  const needsSignIn = !snapshot.accountReady;
  const operationKey =
    snapshot.operation === "enrolling"
      ? "enrolling"
      : snapshot.operation === "resetting"
        ? "resetting"
        : snapshot.operation === "signing_out"
          ? "signingOut"
          : "signingIn";
  const validateOrigin = (): boolean => {
    try {
      parseOrigin(origin.trim());
      originInput.current?.setCustomValidity("");
      return true;
    } catch {
      originInput.current?.setCustomValidity(t("remote.error.INVALID_ORIGIN"));
      originInput.current?.reportValidity();
      return false;
    }
  };
  return (
    <section className={`${styles.card} ${styles.accountCard}`} aria-labelledby={`${id}-title`}>
      <div className={styles.accountHeader}>
        <h3 id={`${id}-title`}>{t("settings.remote.accountTitle")}</h3>
        <span
          className={`${styles.status} ${snapshot.accountReady ? styles.online : styles.pending}`}
        >
          <span className={styles.dot} />
          {t(snapshot.accountReady ? "settings.remote.signedIn" : "settings.remote.signedOut")}
        </span>
      </div>
      <p className={styles.hint}>{t("settings.remote.accountHint")}</p>
      {loggingIn ? (
        <RemoteLoginProgress auth={snapshot.auth} cancelling={cancelling} onCancel={onCancel} />
      ) : (
        <>
          {snapshot.accountReady && (
            <div className={styles.accountSummary}>
              <RemoteAccountIdentity profile={identity} accountId={snapshot.accountId} />
              <div className={styles.accountActions}>
                {snapshot.relayOrigin && (
                  <Button disabled={busy} onClick={() => onSignIn(snapshot.relayOrigin ?? "")}>
                    {t("settings.remote.switchAccount")}
                  </Button>
                )}
                <Button disabled={busy} onClick={onLogout}>
                  {t("settings.remote.accountLogout")}
                </Button>
              </div>
            </div>
          )}
          {snapshot.configured ? (
            <>
              <p className={`${styles.domain} ${styles.accountDomain}`}>{relayOrigin}</p>
              {needsSignIn && relayOrigin && (
                <div className={styles.accountActions}>
                  <Button variant="primary" disabled={busy} onClick={() => onSignIn(relayOrigin)}>
                    {t(
                      snapshot.accountReady
                        ? "settings.remote.switchAccount"
                        : "settings.remote.signIn",
                    )}
                  </Button>
                </div>
              )}
              {!snapshot.accountReady && canClearAccount && (
                <div className={styles.accountActions}>
                  <Button disabled={busy} onClick={onLogout}>
                    {t("settings.remote.accountLogout")}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <form
              className={styles.form}
              aria-busy={busy}
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !trusted || !name.trim() || !validateOrigin()) return;
                onEnroll({
                  controlVersion: 2,
                  relayOrigin: origin.trim(),
                  displayName: name.trim(),
                  registrationRequestId: registration.current,
                  trustRelay: true,
                });
              }}
            >
              <div className={styles.accountFields}>
                <label className={styles.field} htmlFor={`${id}-origin`}>
                  {t("settings.remote.origin")}
                  <input
                    ref={originInput}
                    id={`${id}-origin`}
                    type="url"
                    required
                    value={origin}
                    disabled={busy || !!snapshot.enrollment}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      event.target.setCustomValidity("");
                      setOrigin(event.target.value);
                      setTrusted(false);
                    }}
                  />
                </label>
                <label className={styles.field} htmlFor={`${id}-name`}>
                  {t("settings.remote.desktopName")}
                  <input
                    id={`${id}-name`}
                    value={name}
                    maxLength={64}
                    required
                    disabled={busy || !!snapshot.enrollment}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              </div>
              {snapshot.enrollment && (
                <p className={styles.hint}>{t("settings.remote.enrollmentSaved")}</p>
              )}
              <label className={styles.choice}>
                <input
                  type="checkbox"
                  checked={trusted}
                  disabled={busy}
                  onChange={(event) => setTrusted(event.target.checked)}
                />
                <span>{t("settings.remote.trust")}</span>
              </label>
              <div className={styles.accountActions}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    busy ||
                    !trusted ||
                    !origin.trim() ||
                    !name.trim() ||
                    snapshot.error === "REGISTRATION_CREDENTIAL_LOST"
                  }
                >
                  {t(
                    snapshot.enrollment
                      ? "settings.remote.resumeEnrollment"
                      : snapshot.accountReady
                        ? "settings.remote.enrollComputer"
                        : "settings.remote.accountConnect",
                  )}
                </Button>
                {!snapshot.accountReady && canClearAccount && (
                  <Button disabled={busy} onClick={onLogout}>
                    {t("settings.remote.accountLogout")}
                  </Button>
                )}
              </div>
            </form>
          )}
          {busy && (
            <p className={`${styles.hint} ${styles.operationStatus}`} role="status">
              {t(`settings.remote.${operationKey}`)}
            </p>
          )}
          {(recovery || (snapshot.accountReady && snapshot.relayOrigin)) && (
            <div className={styles.accountManagement}>
              {snapshot.accountReady && snapshot.relayOrigin && (
                <Button disabled={busy} onClick={() => onDirectory(relayOrigin)}>
                  {t("settings.remote.directory")}
                </Button>
              )}
              {recovery && (
                <Button disabled={busy} onClick={onReset}>
                  {t("settings.remote.resetEnrollment")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
