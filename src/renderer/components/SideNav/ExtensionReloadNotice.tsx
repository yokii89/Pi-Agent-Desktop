import { ArrowsClockwise } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import styles from "./SideNav.module.css";

/** 扩展变更只提醒，下次用户启动会话时才加载新配置。 */
export function ExtensionReloadNotice({ sessionFile }: { sessionFile: string }) {
  const t = useT();
  const { runtimeSnapshots } = useExtensionViewStore();
  const stale = runtimeSnapshots.some(
    (runtime) =>
      runtime.sessionFile === sessionFile &&
      runtime.staleExtension &&
      runtime.state !== "cold" &&
      runtime.state !== "failed",
  );
  if (!stale) return null;
  return (
    <span
      role="img"
      className={styles.historyStatus}
      title={t("sidenav.reloadNotice.staleHint")}
      aria-label={t("sidenav.reloadNotice.stale")}
    >
      <ArrowsClockwise size={16} weight="regular" />
    </span>
  );
}
