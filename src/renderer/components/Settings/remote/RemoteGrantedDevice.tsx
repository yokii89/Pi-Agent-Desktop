import {
  Check,
  CheckCircle,
  DeviceMobile,
  Eye,
  Folder,
  LinkBreak,
  PlugsConnected,
} from "@phosphor-icons/react";
import type { Grant } from "../../../../shared/remote";
import { READ_SCOPES } from "../../../../shared/remote";
import type { RemoteSnapshot } from "../../../../shared/remoteDesktop";
import { useT } from "../../../hooks/useT";
import { Button } from "../../ui/Button";
import styles from "../RemoteDevicesPanel.module.css";

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
  projects,
  busy,
  onRevoke,
}: RemoteGrantedDeviceProps) {
  const t = useT();
  const prepared = grant.state === "prepared";
  const actions = grant.scopes.filter(
    (scope) => !(READ_SCOPES as readonly string[]).includes(scope),
  );
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
            {t("settings.remote.projects")} · {grant.projectIds.length}
          </h4>
          <ul className={styles.factList}>
            {grant.projectIds.map((id) => (
              <li key={id}>
                <Folder size={16} weight="regular" />
                <span>{projects.find((project) => project.id === id)?.name ?? id}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>{t("settings.remote.capabilities")}</h4>
          <ul className={styles.factList}>
            <li>
              <Eye size={16} weight="regular" />
              <span>{t("settings.remote.readAccess")}</span>
            </li>
            {actions.map((scope) => (
              <li key={scope}>
                <Check size={16} weight="regular" />
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
