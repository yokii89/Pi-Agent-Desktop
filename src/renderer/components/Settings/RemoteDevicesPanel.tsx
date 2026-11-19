import { DeviceMobile, ShieldCheck } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { getI18nLocale } from "../../../shared/i18n";
import { pairingText, type Scope } from "../../../shared/remote";
import type { RemoteApi, RemoteSnapshot } from "../../../shared/remoteDesktop";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import styles from "./RemoteDevicesPanel.module.css";
import { SettingRow, SettingsSection } from "./SettingRow";

function remoteApi(): RemoteApi {
  const api = window.pidesk?.remote;
  if (!api) throw new Error("AUTH_REQUIRED");
  return api;
}
/** Local-only pairing management. Approval requires a deliberate project selection. */
export function RemoteDevicesPanel() {
  const t = useT();
  const text = (key: string) => pairingText(getI18nLocale(), key);
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [relayOrigin, setOrigin] = useState("");
  const [ticket, setTicket] = useState("");
  const [trust, setTrust] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [scopes, setScopes] = useState<Scope[]>(["projects.read", "sessions.read"]);
  const [matchedClaimId, setMatchedClaimId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [image, setImage] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const refresh = useCallback(async () => {
    const result = await unwrap(remoteApi().snapshot());
    setSnapshot(result);
  }, []);
  useEffect(() => {
    let active = true;
    let reading = false;
    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        const value = await unwrap(remoteApi().snapshot());
        if (active) setSnapshot(value);
      } catch {
        if (active) setError("STATE_UNAVAILABLE");
      } finally {
        reading = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const claimId = snapshot?.claim?.claimId;
  const matched = !!claimId && matchedClaimId === claimId;
  useEffect(() => {
    if (!claimId) return;
    setSelected([]);
    setScopes(["projects.read", "sessions.read"]);
    setMatchedClaimId(null);
  }, [claimId]);
  const qr = snapshot?.qr ? JSON.stringify(snapshot.qr) : null;
  useEffect(() => {
    let active = true;
    setImage("");
    if (qr)
      void import("qrcode")
        .then((q) => q.toDataURL(qr, { width: 280, margin: 4, errorCorrectionLevel: "M" }))
        .then((value) => {
          if (active) setImage(value);
        })
        .catch(() => {
          if (active) setError("INVALID_FRAME");
        });
    return () => {
      active = false;
    };
  }, [qr]);
  const run = async (operation: (api: RemoteApi) => ReturnType<RemoteApi["snapshot"]>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await unwrap(operation(remoteApi())));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CONTROL_FAILED");
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const status = snapshot?.grant?.state;
  return (
    <div className={styles.panel}>
      <p data-selectable-text>{text("description")}</p>
      <div className={styles.notice} data-selectable-text>
        <ShieldCheck size={20} weight="regular" />
        <p>{text("trustBody")}</p>
      </div>
      {!snapshot?.configured ? (
        <SettingsSection title={text("enroll")}>
          <label className={styles.field}>
            {text("origin")}
            <input
              type="url"
              value={relayOrigin}
              onChange={(e) => {
                setOrigin(e.target.value);
                setTrust(false);
              }}
              placeholder="https://relay.example.invalid"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className={styles.field}>
            {text("ticket")}
            <input
              type="password"
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className={styles.choice}>
            <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />
            {text("trust")}
          </label>
          <Button
            variant="primary"
            disabled={busy || !trust || !relayOrigin || !ticket}
            onClick={() => {
              const enrollmentTicket = ticket;
              setTicket("");
              void run((api) => api.enroll({ relayOrigin, enrollmentTicket, trustRelay: trust }));
            }}
          >
            {text("enroll")}
          </Button>
        </SettingsSection>
      ) : (
        <>
          <SettingRow
            label={snapshot.relayOrigin ?? ""}
            description={snapshot.connected ? text("online") : text("offline")}
            control={
              <Button
                disabled={busy}
                onClick={() =>
                  void run((api) => (snapshot.connected ? api.disconnect() : api.connect()))
                }
              >
                {text(snapshot.connected ? "disconnect" : "connect")}
              </Button>
            }
          />
          {status === "active" || status === "prepared" || status === "revoked" ? (
            <SettingsSection
              title={text(
                status === "active"
                  ? "active"
                  : status === "prepared"
                    ? "prepared"
                    : snapshot.revocationPending
                      ? "revocationPending"
                      : "revoked",
              )}
            >
              <p data-selectable-text>
                {snapshot.grant?.projectIds
                  .map((id) => snapshot.projects.find((p) => p.id === id)?.name ?? id)
                  .join(" · ")}
              </p>
              <p data-selectable-text>
                {snapshot.grant?.scopes.map((scope) => text(`scope.${scope}`)).join(" · ")}
              </p>
              <Button variant="danger" disabled={busy} onClick={() => setConfirmRevoke(true)}>
                {text("revoke")}
              </Button>
            </SettingsSection>
          ) : null}
          {(!status || status === "revoked") && (
            <Button
              variant="primary"
              disabled={busy || !snapshot.connected}
              onClick={() => void run((api) => api.invite())}
            >
              <DeviceMobile size={20} weight="regular" />
              {text("createInvitation")}
            </Button>
          )}
          {image && snapshot.qr ? (
            <div className={styles.invitation}>
              <img src={image} alt={text("scan")} className={styles.qr} draggable={false} />
              <p>
                {text("expires")} {new Date(snapshot.qr.expiresAt).toLocaleTimeString()}
              </p>
            </div>
          ) : null}
          {snapshot.claim &&
          ["claimed", "approved", "credential_issued", "activating"].includes(
            snapshot.claim.state,
          ) ? (
            <SettingsSection title={text("confirmation")}>
              <p className={styles.code} data-selectable-text>
                {snapshot.claim.confirmationCode}
              </p>
              <p data-selectable-text>{snapshot.claim.deviceName}</p>
              <p className={styles.muted}>{text("selfReported")}</p>
              <p data-selectable-text>{text("confirmationHint")}</p>
              {snapshot.claim.state === "claimed" ? (
                <>
                  <label className={styles.choice}>
                    <input
                      type="checkbox"
                      checked={matched}
                      disabled={busy}
                      onChange={(e) =>
                        setMatchedClaimId(e.target.checked ? (claimId ?? null) : null)
                      }
                    />
                    {text("confirmationHint")}
                  </label>
                  <fieldset className={styles.projects}>
                    <legend>{text("capabilities")}</legend>
                    {(
                      [
                        ["sessions.send", "scope.sessions.send"],
                        ["sessions.stop", "scope.sessions.stop"],
                        ["sessions.create", "scope.sessions.create"],
                        ["interactions.read", "scope.interactions.read"],
                        ["interactions.answer", "scope.interactions.answer"],
                      ] as const
                    ).map(([scope, label]) => (
                      <label className={styles.choice} key={scope}>
                        <input
                          type="checkbox"
                          checked={scopes.includes(scope)}
                          disabled={busy}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setScopes((current) => {
                              const next = new Set(current);
                              if (checked) {
                                next.add(scope);
                                if (scope === "interactions.answer") next.add("interactions.read");
                              } else {
                                next.delete(scope);
                                if (scope === "interactions.read")
                                  next.delete("interactions.answer");
                              }
                              return [...next];
                            });
                          }}
                        />
                        {text(label)}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className={styles.projects}>
                    <legend>{text("projects")}</legend>
                    {snapshot.projects.map((p) => (
                      <label className={styles.choice} key={p.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(p.id)}
                          disabled={busy || (!selected.includes(p.id) && selected.length >= 20)}
                          onChange={(e) =>
                            setSelected((current) =>
                              e.target.checked
                                ? [...current, p.id]
                                : current.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {p.name}
                      </label>
                    ))}
                  </fieldset>
                  <div className={styles.actions}>
                    <Button
                      variant="primary"
                      disabled={busy || !matched || selected.length === 0}
                      onClick={() => {
                        if (claimId) void run((api) => api.approve(claimId, selected, scopes));
                      }}
                    >
                      {text("approve")}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => void run((api) => api.reject())}
                    >
                      {text("reject")}
                    </Button>
                  </div>
                </>
              ) : (
                <p>{text("prepared")}</p>
              )}
            </SettingsSection>
          ) : null}
        </>
      )}
      {error || snapshot?.error ? (
        <p role="alert" className={styles.error}>
          {text(`error.${error ?? snapshot?.error}`)}
        </p>
      ) : null}
      <ConfirmDialog
        nested
        open={confirmRevoke}
        title={text("revoke")}
        message={text("revokeConfirm")}
        confirmLabel={text("revoke")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        busy={busy}
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          void run((api) => api.revoke()).finally(() => setConfirmRevoke(false));
        }}
      />
    </div>
  );
}
