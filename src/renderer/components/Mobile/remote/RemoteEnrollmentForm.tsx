import { Eye, EyeSlash, PlugsConnected } from "@phosphor-icons/react";
import { useId, useState } from "react";
import type { RemoteEnrollment } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import { IconButton } from "../../ui/IconButton";
import styles from "../MobilePairingPanel.module.css";

interface RemoteEnrollmentFormProps {
  busy: boolean;
  onEnroll: (enrollment: RemoteEnrollment) => void;
}

/** Keeps enrollment credentials local to the form and clears the one-time ticket on submission. */
export function RemoteEnrollmentForm({ busy, onEnroll }: RemoteEnrollmentFormProps) {
  const t = useT();
  const id = useId();
  const [origin, setOrigin] = useState("");
  const [ticket, setTicket] = useState("");
  const [trusted, setTrusted] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const canSubmit = !busy && trusted && !!origin.trim() && !!ticket.trim();
  return (
    <section className={`${styles.card} ${styles.enrollment}`}>
      <div className={styles.eyebrow}>
        <PlugsConnected size={16} weight="regular" />
        {t("settings.remote.setup")}
      </div>
      <h3>{t("settings.remote.connectTitle")}</h3>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          const enrollmentTicket = ticket;
          setTicket("");
          setShowTicket(false);
          onEnroll({ relayOrigin: origin.trim(), enrollmentTicket, trustRelay: trusted });
        }}
      >
        <label className={styles.field} htmlFor={`${id}-origin`}>
          {t("settings.remote.origin")}
          <input
            id={`${id}-origin`}
            type="url"
            required
            disabled={busy}
            value={origin}
            onChange={(event) => {
              setOrigin(event.target.value);
              setTrusted(false);
            }}
            placeholder="https://relay.example.invalid"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className={styles.field}>
          <label htmlFor={`${id}-ticket`}>{t("settings.remote.ticket")}</label>
          <div className={styles.inputWrap}>
            <input
              id={`${id}-ticket`}
              type={showTicket ? "text" : "password"}
              required
              disabled={busy}
              value={ticket}
              onChange={(event) => setTicket(event.target.value)}
              placeholder={t("settings.remote.ticketHint")}
              autoComplete="off"
              spellCheck={false}
            />
            <IconButton
              className={styles.revealTicket}
              title={t(showTicket ? "settings.remote.hideTicket" : "settings.remote.showTicket")}
              disabled={busy}
              onClick={() => setShowTicket((value) => !value)}
            >
              {showTicket ? (
                <EyeSlash size={16} weight="regular" />
              ) : (
                <Eye size={16} weight="regular" />
              )}
            </IconButton>
          </div>
        </div>
        <label className={styles.choice}>
          <input
            type="checkbox"
            checked={trusted}
            disabled={busy}
            onChange={(event) => setTrusted(event.target.checked)}
          />
          <span>{t("settings.remote.trust")}</span>
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            <PlugsConnected size={16} weight="regular" />
            {t(busy ? "settings.remote.connecting" : "settings.remote.enroll")}
          </Button>
        </div>
      </form>
    </section>
  );
}
