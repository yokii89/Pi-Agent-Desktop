import {
  CheckCircle,
  DeviceMobile,
  Folder,
  LinkBreak,
  PlugsConnected,
} from "@phosphor-icons/react";
import type { Grant } from "../../../../shared/remote";
import type { RemoteSnapshot } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../MobilePairingPanel.module.css";

interface RemoteGrantedDeviceProps {
  grant: Grant;
  deviceName: string | null;
  projects: RemoteSnapshot["projects"];
  busy: boolean;
  onRevoke: () => void;
}

/** Shows the persisted grant without assuming that the phone itself is online. */
export function RemoteGrantedDevice({
  grant,
  deviceName,
  projects: _configuredProjects,
  busy,
  onRevoke,
}: RemoteGrantedDeviceProps) {
  const t = useT();
  const prepared = grant.state === "prepared";
  const projectAccess = grant.projectIds === "all" ? null : grant.projectIds;
  return (
    <section className={`${styles.card} ${styles.deviceCard}`}>
      <div className={styles.comparisonHead}>
        <div className={styles.deviceIdentity}>
          <div className={`${styles.deviceGlyph} ${styles.pairedGlyph}`}>
            <DeviceMobile size={24} weight="regular" />
          </div>
          <h3>{deviceName || t("settings.remote.device")}</h3>
        </div>
        <span
          className={`${styles.status} ${prepared ? styles.pending : styles.online}`}
          role="status"
        >
          {prepared ? (
            <PlugsConnected size={16} weight="regular" />
          ) : (
            <CheckCircle size={16} weight="regular" />
          )}
          {t(prepared ? "settings.remote.activation" : "remote.active")}
        </span>
      </div>
      <div className={styles.deviceFacts}>
        <section>
          <h4>
            {t("settings.remote.grantAllProjects")} ·{" "}
            {projectAccess === null ? t("remote.allProjects") : projectAccess.length}
          </h4>
          <ul className={styles.factList}>
            {projectAccess === null ? (
              <li>
                <Folder size={16} weight="regular" />
                <span>{t("settings.remote.grantFutureProjects")}</span>
              </li>
            ) : (
              projectAccess.map((id) => (
                <li key={id}>
                  <Folder size={16} weight="regular" />
                  <span>{id}</span>
                </li>
              ))
            )}
          </ul>
        </section>
        <section>
          <h4>{t("settings.remote.capabilities")}</h4>
          <ul className={styles.factList}>
            {grant.scopes.map((scope) => (
              <li key={scope}>
                <span>{t(`remote.scope.${scope}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className={styles.deviceFooter}>
        <p className={styles.hint}>{t("settings.remote.changePermissions")}</p>
        <Button className={styles.revokeButton} disabled={busy} onClick={onRevoke}>
          <LinkBreak size={16} weight="regular" />
          {t("settings.remote.revoke")}
        </Button>
      </div>
    </section>
  );
}
