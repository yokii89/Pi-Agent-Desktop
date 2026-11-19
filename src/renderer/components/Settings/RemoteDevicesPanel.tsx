import { Broadcast, CheckCircle, Devices, ShieldWarning, WifiSlash } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LIMITS } from "../../../shared/remote";
import type { RemoteApi, RemoteSnapshot } from "../../../shared/remoteDesktop";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import styles from "./RemoteDevicesPanel.module.css";
import { RemoteEnrollmentForm } from "./remote/RemoteEnrollmentForm";
import { RemoteGrantedDevice } from "./remote/RemoteGrantedDevice";
import { RemotePairingApproval } from "./remote/RemotePairingApproval";
import { RemotePairingInvitation } from "./remote/RemotePairingInvitation";

function remoteApi(): RemoteApi {
  const api = window.pidesk?.remote;
  if (!api) throw new Error("AUTH_REQUIRED");
  return api;
}

type RemoteOperation = (api: RemoteApi) => ReturnType<RemoteApi["snapshot"]>;

/** Local-only pairing management. The relay connection and the phone's grant remain separate. */
export function RemoteDevicesPanel() {
  const t = useT();
  const id = useId();
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const mounted = useRef(false);
  const operationPending = useRef(false);
  const reading = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (reading.current || operationPending.current) return;
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
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), LIMITS.pollMs);
    return () => {
      mounted.current = false;
      revision.current += 1;
      clearInterval(timer);
    };
  }, [refresh]);
  const run = async (operation: RemoteOperation): Promise<void> => {
    if (operationPending.current) return;
    operationPending.current = true;
    revision.current += 1;
    setBusy(true);
    setError(null);
    try {
      const value = await unwrap(operation(remoteApi()));
      if (mounted.current) {
        setSnapshot(value);
        setReadFailed(false);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "CONTROL_FAILED");
      // A failed response may still have persisted a grant or a local revocation.
      try {
        const value = await unwrap(remoteApi().snapshot());
        if (mounted.current) {
          setSnapshot(value);
          setReadFailed(false);
        }
      } catch {
        if (mounted.current) setReadFailed(true);
      }
    } finally {
      operationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const grant = snapshot?.grant && snapshot.grant.state !== "revoked" ? snapshot.grant : null;
  const claim = !grant && snapshot?.claim?.state === "claimed" ? snapshot.claim : null;
  const errorCode = error ?? snapshot?.error ?? (readFailed ? "STATE_UNAVAILABLE" : null);
  const errorKey = `remote.error.${errorCode}`;
  const errorText = errorCode ? t(errorKey) : "";
  const errorNotice = errorCode ? (
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
            ) : !snapshot.configured ? (
              <>
                <RemoteEnrollmentForm
                  busy={busy}
                  onEnroll={(request) => void run((api) => api.enroll(request))}
                />
                {securityNotice}
                {errorNotice}
              </>
            ) : (
              <>
                {!snapshot.connected && (
                  <aside className={styles.offlineBanner}>
                    <WifiSlash size={20} weight="regular" />
                    <div>
                      <strong>{t("settings.remote.offlineTitle")}</strong>
                      <p className={styles.hint}>
                        {t(
                          grant
                            ? "settings.remote.offlinePaired"
                            : "settings.remote.offlineUnpaired",
                        )}
                      </p>
                    </div>
                    <Button disabled={busy} onClick={() => void run((api) => api.connect())}>
                      {t(busy ? "settings.remote.connecting" : "settings.remote.reconnect")}
                    </Button>
                  </aside>
                )}
                {grant ? (
                  <RemoteGrantedDevice
                    grant={grant}
                    deviceName={
                      snapshot.claim?.deviceId === grant.deviceId ? snapshot.claim.deviceName : null
                    }
                    projects={snapshot.projects}
                    busy={busy}
                    onRevoke={() => setConfirmRevoke(true)}
                  />
                ) : (
                  <>
                    <RemotePairingInvitation
                      qr={snapshot.qr}
                      connected={snapshot.connected}
                      busy={busy}
                      onInvite={() => void run((api) => api.invite())}
                    />
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
                    {t(snapshot.revocationPending ? "remote.revocationPending" : "remote.revoked")}
                  </p>
                )}
                <section className={styles.relay} aria-label={t("settings.remote.relay")}>
                  <div className={styles.relayMain}>
                    <Broadcast size={20} weight="regular" />
                    <div className={styles.relayText}>
                      <div className={styles.relayTitle}>
                        {t("settings.remote.relay")}
                        <span
                          className={`${styles.status} ${snapshot.connected ? styles.online : styles.pending}`}
                        >
                          <span className={styles.dot} />
                          {t(
                            snapshot.connected
                              ? "settings.remote.connected"
                              : "settings.remote.disconnected",
                          )}
                        </span>
                      </div>
                      <p className={styles.domain}>{snapshot.relayOrigin}</p>
                    </div>
                    <button
                      type="button"
                      className={styles.textButton}
                      aria-expanded={connectionExpanded}
                      aria-controls={`${id}-connection`}
                      onClick={() => setConnectionExpanded((expanded) => !expanded)}
                    >
                      {t(
                        connectionExpanded ? "settings.remote.collapse" : "settings.remote.manage",
                      )}
                    </button>
                  </div>
                  {connectionExpanded && (
                    <div className={styles.relayDetails} id={`${id}-connection`}>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void run((api) => (snapshot.connected ? api.disconnect() : api.connect()))
                        }
                      >
                        {t(
                          snapshot.connected
                            ? "settings.remote.pause"
                            : "settings.remote.reconnect",
                        )}
                      </Button>
                    </div>
                  )}
                </section>
                {securityNotice}
                {errorNotice}
              </>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        nested
        open={confirmRevoke}
        title={t("settings.remote.revokeTitle")}
        message={t("settings.remote.revokeBody")}
        confirmLabel={t("settings.remote.revoke")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          void run((api) => api.revoke()).finally(() => {
            if (mounted.current) setConfirmRevoke(false);
          });
        }}
      />
    </div>
  );
}
