import { useMemo } from "react";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { Button } from "../ui/Button";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/**
 * panel 挂载（P1）：右侧上下文栏面板体。
 * 关闭入口在 ContextSidebar Tab 条（收起侧栏 ≠ dismiss；面板关闭钮 = dismiss）。
 */
export function PanelMount({ entry }: { entry: ExtensionViewEntry }) {
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
    <div className={styles.panel}>
      <div className={styles.panelBody}>
        <ViewNodeRenderer node={entry.root} bridge={bridge} />
      </div>
      {entry.actions.length > 0 ? (
        <div className={styles.panelFooter}>
          {entry.actions.map((action) => {
            const variant =
              action.variant === "primary"
                ? "primary"
                : action.variant === "danger"
                  ? "danger"
                  : "default";
            return (
              <Button
                key={action.id}
                variant={variant}
                disabled={action.disabled}
                onClick={() => sendAction(entry.id, action.id, entry.values, action.kind)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
      <div className={styles.panelCloseRow}>
        <Button variant="default" className={styles.ghostAction} onClick={() => dismiss(entry.id)}>
          {t("ui.view.closePanel")}
        </Button>
      </div>
    </div>
  );
}
