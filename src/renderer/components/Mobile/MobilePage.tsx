import { DeviceMobile, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useT } from "../../hooks/useT";
import { browserService } from "../../services/browserService";
import { useUiStore } from "../../stores/uiStore";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import styles from "./MobilePage.module.css";
import { MobilePairingPanel } from "./MobilePairingPanel";

/** 手机配对浮窗：与设置共用独立覆盖层，不占用中央页面路由。 */
export function MobilePage() {
  const t = useT();
  const { mobileOpen, closeMobile } = useUiStore();

  useEffect(() => {
    if (!mobileOpen) return;
    void browserService.setOverlaySuppressed(true, "mobile");
    return () => {
      void browserService.setOverlaySuppressed(false, "mobile");
    };
  }, [mobileOpen]);

  return (
    <Modal
      open={mobileOpen}
      onClose={closeMobile}
      ariaLabel={t("remote.title")}
      panelClassName={styles.dialog}
    >
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <DeviceMobile size={24} weight="regular" />
          <h1 className={styles.title}>{t("remote.title")}</h1>
        </div>
        <IconButton title={t("settings.close")} onClick={closeMobile}>
          <X size={18} weight="regular" />
        </IconButton>
      </header>
      <div className={styles.content}>
        <MobilePairingPanel />
      </div>
    </Modal>
  );
}
