import { Check, DeviceMobile, Folder, X } from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";
import { ALL_SCOPES, type ClaimStatus } from "../../../../shared/remote";
import type { RemoteSnapshot } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../MobilePairingPanel.module.css";
import { usePairingCountdown } from "./usePairingCountdown";

interface RemotePairingApprovalProps {
  claim: ClaimStatus;
  relayOrigin: string;
  projects: RemoteSnapshot["projects"];
  busy: boolean;
  connected: boolean;
  children: ReactNode;
  onApprove: (claimId: string) => void;
  onReject: () => void;
}

/** Mounted per claim so no confirmation or permission choice carries over to another phone. */
export function RemotePairingApproval({
  claim,
  relayOrigin,
  projects,
  busy,
  connected,
  children,
  onApprove,
  onReject,
}: RemotePairingApprovalProps) {
  const t = useT();
  const id = useId();
  const [matched, setMatched] = useState(false);
  const remaining = usePairingCountdown(claim.expiresAt);
  const expired = remaining === 0;
  const code = claim.confirmationCode;
  const validCode = !!code && /^\d{8}$/.test(code);
  const disabled = busy || !connected || expired || !validCode;
  const canApprove = !disabled && matched;
  const summary = expired
    ? t("settings.remote.expiredClaim")
    : !connected
      ? t("settings.remote.offlineTitle")
      : !matched
        ? t("settings.remote.matchFirst")
        : t("settings.remote.grantAllSummary", {
            count: projects.length,
            permissions: ALL_SCOPES.length,
          });
  return (
    <div className={styles.approval}>
      <div className={styles.scroll}>
        <div className={styles.stack}>
          <section className={`${styles.card} ${styles.comparison}`}>
            <div className={styles.comparisonHead}>
              <div className={styles.deviceIdentity}>
                <div className={styles.deviceGlyph}>
                  <DeviceMobile size={24} weight="regular" />
                </div>
                <div>
                  <h3>{claim.deviceName || t("settings.remote.device")}</h3>
                  <p className={styles.hint}>{t("settings.remote.nameHint")}</p>
                </div>
              </div>
              <span className={styles.pendingBadge}>{t("settings.remote.request")}</span>
            </div>
            <div className={styles.comparisonMain}>
              <div className={styles.codeGroup}>
                <p className={styles.code}>
                  {validCode ? `${code.slice(0, 4)} ${code.slice(4)}` : "—"}
                </p>
                <p className={styles.domain}>{relayOrigin}</p>
              </div>
              <label className={`${styles.choice} ${styles.matchChoice}`}>
                <input
                  type="checkbox"
                  checked={matched}
                  disabled={disabled}
                  onChange={(event) => setMatched(event.target.checked)}
                />
                <span>{t("settings.remote.matched")}</span>
              </label>
            </div>
          </section>
          <div className={styles.grantColumns}>
            <section aria-labelledby={`${id}-projects`}>
              <div className={styles.sectionHeading}>
                <h3 id={`${id}-projects`}>{t("settings.remote.grantAllProjects")}</h3>
                <span className={styles.hint}>
                  {t("settings.remote.grantProjectCount", { count: projects.length })}
                </span>
              </div>
              <p className={styles.hint}>{t("settings.remote.grantFutureProjects")}</p>
              <div className={styles.projectList}>
                {projects.map((project) => (
                  <div className={styles.projectOption} key={project.id}>
                    <Folder size={16} weight="regular" />
                    <span>{project.name}</span>
                  </div>
                ))}
                {projects.length === 0 && (
                  <p className={styles.projectEmpty}>{t("settings.remote.noProjects")}</p>
                )}
              </div>
            </section>
            <section aria-labelledby={`${id}-permissions`}>
              <div className={styles.sectionHeading}>
                <h3 id={`${id}-permissions`}>{t("settings.remote.grantAllActions")}</h3>
              </div>
              <ul className={styles.factList}>
                {ALL_SCOPES.map((scope) => (
                  <li key={scope}>
                    <Check size={16} weight="regular" />
                    <span>{t(`remote.scope.${scope}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <p className={styles.hint}>{t("settings.remote.grantAllWarning")}</p>
          {children}
        </div>
      </div>
      <footer className={styles.grantFooter}>
        <p className={styles.hint} role="status">
          {summary}
        </p>
        <div className={styles.actions}>
          <Button disabled={busy} onClick={onReject}>
            <X size={16} weight="regular" />
            {t("remote.reject")}
          </Button>
          <Button
            variant="primary"
            disabled={!canApprove}
            onClick={() => {
              if (canApprove && Date.now() < Date.parse(claim.expiresAt)) {
                onApprove(claim.claimId);
              }
            }}
          >
            <Check size={16} weight="regular" />
            {t("settings.remote.approve")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
