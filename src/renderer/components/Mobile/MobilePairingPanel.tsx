import { CheckCircle, Devices, ShieldWarning } from "@phosphor-icons/react";
import { useState } from "react";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import styles from "./MobilePairingPanel.module.css";
import { RemoteAccountForm } from "./remote/RemoteAccountForm";
import { RemoteConnectionPanel } from "./remote/RemoteConnectionPanel";
import { RemoteDesktopDirectory } from "./remote/RemoteDesktopDirectory";
import { RemoteGrantedDevice } from "./remote/RemoteGrantedDevice";
import { RemotePairingApproval } from "./remote/RemotePairingApproval";
import { RemotePairingInvitation } from "./remote/RemotePairingInvitation";
import { useRemoteManagement } from "./remote/useRemoteManagement";

/** Account authentication, computer enrollment, relay connectivity and phone grants have independent states. */
export function MobilePairingPanel() {
  const t = useT();
  const { snapshot, busy, cancelling, error, readFailed, refresh, run, cancelLogin, listDesktops } =
    useRemoteManagement();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [directoryOrigin, setDirectoryOrigin] = useState<string | null>(null);
  const [localResetOrigin, setLocalResetOrigin] = useState<string | null>(null);
  const grant = snapshot?.grant && snapshot.grant.state !== "revoked" ? snapshot.grant : null;
  const claim = !grant && snapshot?.claim?.state === "claimed" ? snapshot.claim : null;
  const errorCode = error ?? snapshot?.error ?? (readFailed ? "STATE_UNAVAILABLE" : null);
  const errorKey = `remote.error.${errorCode}`;
  const errorText = errorCode ? t(errorKey) : "";
  const errorNotice =
    errorCode && errorCode !== "AUTH_CANCELLED" ? (
      <p className={styles.error} role="alert">
        {errorText === errorKey ? t("remote.error_generic") : errorText}
      </p>
    ) : null;
  const securityNotice = (
    <aside className={styles.securityNote}>
      <ShieldWarning size={16} weight="regular" />
      <p>
        <strong>{t("settings.remote.securityTitle")}</strong> {t("settings.remote.securityBody")}
      </p>
    </aside>
  );
  const canRemoveRegistration =
    !!snapshot?.accountReady &&
    !!snapshot.relayOrigin &&
    (snapshot.credentialState === "ready" ||
      snapshot.credentialState === "expired" ||
      !!snapshot.enrollment?.desktopId);
  const reset = (localOnly: boolean): void => {
    const origin = snapshot?.relayOrigin ?? null;
    void run((api) => api.resetEnrollment(localOnly)).then((success) => {
      if (success) {
        setConfirmReset(false);
        setLocalResetOrigin(localOnly ? origin : null);
      }
    });
  };
  return (
    <div className={styles.panel} data-selectable-text>
      {claim && snapshot ? (
        <RemotePairingApproval
          key={`${claim.claimId}:${claim.confirmationCode}`}
          claim={claim}
          relayOrigin={snapshot.relayOrigin ?? ""}
          projects={snapshot.projects}
          busy={busy}
          connected={snapshot.connected}
          onApprove={(claimId, projects, scopes) =>
            void run((api) => api.approve(claimId, projects, scopes))
          }
          onReject={() => void run((api) => api.reject())}
        >
          {securityNotice}
          {errorNotice}
        </RemotePairingApproval>
      ) : (
        <div className={styles.scroll}>
          <div className={styles.stack}>
            {!snapshot ? (
              <>
                {!readFailed && (
                  <p className={styles.hint} role="status">
                    {t("common.loading")}
                  </p>
                )}
                {errorNotice}
                {readFailed && (
                  <div>
                    <Button onClick={() => void refresh()}>{t("settings.remote.retry")}</Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <RemoteAccountForm
                  key={
                    snapshot.configured
                      ? `registered:${snapshot.relayOrigin}`
                      : (snapshot.enrollment?.registrationRequestId ?? "new")
                  }
                  snapshot={snapshot}
                  busy={busy}
                  cancelling={cancelling}
                  onEnroll={(request) => void run((api) => api.enroll(request))}
                  onSignIn={(relayOrigin) =>
                    void run((api) => api.account({ relayOrigin, reauthenticate: true }))
                  }
                  onLogout={() => void run((api) => api.logout())}
                  onCancel={() => void cancelLogin()}
                  onReset={() => setConfirmReset(true)}
                  onDirectory={setDirectoryOrigin}
                />
                {!confirmReset && !directoryOrigin && errorNotice}
                {localResetOrigin && (
                  <aside className={styles.securityNote}>
                    <ShieldWarning size={16} weight="regular" />
                    <div>
                      <p>{t("settings.remote.resetLocalWarning")}</p>
                      {snapshot.accountReady && (
                        <Button
                          disabled={busy}
                          onClick={() => setDirectoryOrigin(localResetOrigin)}
                        >
                          {t("settings.remote.directory")}
                        </Button>
                      )}
                    </div>
                  </aside>
                )}
                {snapshot.configured && (
                  <>
                    <RemoteConnectionPanel
                      snapshot={snapshot}
                      busy={busy}
                      onConnect={() => void run((api) => api.connect())}
                      onDisconnect={() => void run((api) => api.disconnect())}
                      onReset={() => setConfirmReset(true)}
                    />
                    <p className={styles.hint}>{t("settings.remote.readonly")}</p>
                    {grant ? (
                      <RemoteGrantedDevice
                        grant={grant}
                        deviceName={
                          snapshot.claim?.deviceId === grant.deviceId
                            ? snapshot.claim.deviceName
                            : null
                        }
                        projects={snapshot.projects}
                        busy={busy}
                        onRevoke={() => setConfirmRevoke(true)}
                      />
                    ) : (
                      <>
                        {snapshot.connected && (
                          <RemotePairingInvitation
                            qr={snapshot.qr}
                            connected
                            busy={busy}
                            onInvite={() => void run((api) => api.invite())}
                          />
                        )}
                        <section>
                          <div className={styles.sectionHeading}>
                            <h3>
                              {t("settings.remote.devices")}
                              <span className={styles.count}>0</span>
                            </h3>
                          </div>
                          <div className={styles.emptyDevices}>
                            <Devices size={24} weight="regular" />
                            <span>{t("settings.remote.empty")}</span>
                          </div>
                        </section>
                      </>
                    )}
                    {snapshot.grant?.state === "revoked" && (
                      <p className={`${styles.revokedNotice} ${styles.hint}`} role="status">
                        {snapshot.revocationPending ? (
                          <ShieldWarning size={16} weight="regular" />
                        ) : (
                          <CheckCircle size={16} weight="regular" />
                        )}
                        {t(
                          snapshot.revocationPending
                            ? "remote.revocationPending"
                            : "remote.revoked",
                        )}
                      </p>
                    )}
                  </>
                )}
                {securityNotice}
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmRevoke}
        nested
        title={t("settings.remote.revokeTitle")}
        message={
          <>
            {t("settings.remote.revokeBody")}
            {confirmRevoke && errorNotice}
          </>
        }
        confirmLabel={t("settings.remote.revoke")}
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          void run((api) => api.revoke()).then((success) => {
            if (success) setConfirmRevoke(false);
          });
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        nested
        title={t("settings.remote.resetTitle")}
        message={
          <div className={styles.resetDescription}>
            <p>
              {t(
                canRemoveRegistration
                  ? "settings.remote.resetBody"
                  : "settings.remote.resetLocalBody",
              )}
            </p>
            {canRemoveRegistration && (
              <p className={styles.hint}>{t("settings.remote.resetLocalWarning")}</p>
            )}
            {confirmReset && errorNotice}
          </div>
        }
        confirmLabel={t(
          canRemoveRegistration
            ? "settings.remote.removeAndReset"
            : "settings.remote.resetLocalOnly",
        )}
        secondaryLabel={canRemoveRegistration ? t("settings.remote.resetLocalOnly") : undefined}
        onSecondary={canRemoveRegistration ? () => reset(true) : undefined}
        tone="danger"
        busy={busy}
        busyLabel={t("settings.remote.resetting")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => reset(!canRemoveRegistration)}
      />
      {directoryOrigin && (
        <RemoteDesktopDirectory
          relayOrigin={directoryOrigin}
          currentDesktopId={snapshot?.desktopId ?? snapshot?.enrollment?.desktopId ?? null}
          busy={busy}
          operationError={errorCode}
          onList={listDesktops}
          onRemove={(relayOrigin, desktopId) =>
            run((api) => api.removeDesktop(relayOrigin, desktopId))
          }
          onClose={() => setDirectoryOrigin(null)}
        />
      )}
    </div>
  );
}
