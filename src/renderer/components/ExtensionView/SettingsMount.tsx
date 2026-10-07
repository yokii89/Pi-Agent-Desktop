import { X } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/**
 * settings 挂载：设置「来自扩展」页内的一张卡片。
 * 关闭设置浮窗不 dismiss；卡片 × = dismiss。
 */
export function SettingsMount({ entry }: { entry: ExtensionViewEntry }) {
  const t = useT();
  const { dismiss, changeValue, sendAction } = useExtensionViewStore();

  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (buttonId) => sendAction(entry.id, buttonId, entry.values),
    }),
    [entry.id, entry.values, changeValue, sendAction],
  );

  return (
    <section className={styles.settingsCard} data-view-id={entry.id}>
      <header className={styles.settingsCardHeader}>
        <h3 className={styles.settingsCardTitle}>
          {entry.title || t("ui.view.fallbackTitleSettings")}
        </h3>
        <IconButton title={t("ui.view.removeSettings")} onClick={() => dismiss(entry.id)}>
          <X size={16} weight="regular" />
        </IconButton>
      </header>
      <div className={styles.settingsCardBody}>
        <ViewNodeRenderer node={entry.root} bridge={bridge} />
      </div>
      {entry.actions.length > 0 ? (
        <footer className={styles.settingsCardFooter}>
          {entry.actions.map((action) => (
            <Button
              key={action.id}
              variant={action.variant === "primary" ? "primary" : "default"}
              disabled={action.disabled}
              onClick={() => sendAction(entry.id, action.id, entry.values, action.kind)}
            >
              {action.label}
            </Button>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
