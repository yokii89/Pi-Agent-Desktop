import { Check, DeviceMobile, Eye, Folder, MagnifyingGlass, X } from "@phosphor-icons/react";
import { type ReactNode, useId, useState } from "react";
import { type ClaimStatus, LIMITS, READ_SCOPES, type Scope } from "../../../../shared/remote";
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
  onApprove: (claimId: string, projects: string[], scopes: Scope[]) => void;
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
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const remaining = usePairingCountdown(claim.expiresAt);
  const selectedIds = selected.filter((projectId) =>
    projects.some((project) => project.id === projectId),
  );
  const needle = query.trim().toLocaleLowerCase();
  const visibleProjects = projects.filter((project) =>
    project.name.toLocaleLowerCase().includes(needle),
  );
  const expired = remaining === 0;
  const code = claim.confirmationCode;
  const validCode = !!code && /^\d{8}$/.test(code);
  const disabled = busy || !connected || expired || !validCode;
  const canApprove = !disabled && matched && selectedIds.length > 0;
  const summary = expired
    ? t("settings.remote.expiredClaim")
    : !connected
      ? t("settings.remote.offlineTitle")
      : !matched
        ? t("settings.remote.matchFirst")
        : selectedIds.length === 0
          ? t("settings.remote.selectFirst")
          : t("settings.remote.readOnlySummary", { count: selectedIds.length });
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
                <h3 id={`${id}-projects`}>{t("settings.remote.projects")}</h3>
                <span className={styles.hint}>
                  {t("settings.remote.selected", {
                    count: selectedIds.length,
                    total: projects.length,
                  })}
                </span>
              </div>
              <label className={styles.search}>
                <MagnifyingGlass size={16} weight="regular" />
                <input
                  type="search"
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("settings.remote.searchProjects")}
                  aria-label={t("settings.remote.searchProjects")}
                />
              </label>
              <div className={styles.projectList}>
                {visibleProjects.map((project) => (
                  <label className={styles.projectOption} key={project.id}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(project.id)}
                      disabled={
                        disabled ||
                        (!selectedIds.includes(project.id) && selectedIds.length >= LIMITS.projects)
                      }
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selectedIds, project.id]
                            : selectedIds.filter((projectId) => projectId !== project.id),
                        )
                      }
                    />
                    <Folder size={16} weight="regular" />
                    <span>{project.name}</span>
                  </label>
                ))}
                {visibleProjects.length === 0 && (
                  <p className={styles.projectEmpty}>
                    {t(
                      projects.length === 0
                        ? "settings.remote.noProjects"
                        : "settings.remote.noMatches",
                    )}
                  </p>
                )}
              </div>
              <p className={`${styles.hint} ${styles.projectLimit}`}>
                {t("settings.remote.projectLimit", { max: LIMITS.projects })}
              </p>
            </section>
            <section aria-labelledby={`${id}-permissions`}>
              <div className={styles.sectionHeading}>
                <h3 id={`${id}-permissions`}>{t("settings.remote.permissions")}</h3>
              </div>
              <p className={styles.baseline}>
                <Eye size={16} weight="regular" />
                <span>{t("settings.remote.baseline")}</span>
              </p>
            </section>
          </div>
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
                onApprove(claim.claimId, selectedIds, [...READ_SCOPES]);
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
