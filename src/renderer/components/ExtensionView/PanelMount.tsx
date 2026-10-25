import { useMemo } from "react";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { extensionPanelTabId, useExtensionViewStore } from "../../stores/extensionViewStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/**
 * panel 挂载（P1）：右侧上下文栏面板体。
 * 页签关闭只隐藏（live View 继续运行）；此处的「结束面板」才发送 dismiss，
 * 并把对应页签一并收掉（结束是用户明确动作，不是断线重连）。
 */
export function PanelMount({ entry }: { entry: ExtensionViewEntry }) {
  const t = useT();
  const { dismiss, changeValue, sendAction } = useExtensionViewStore();
  const { dispatch } = useUiStore();

  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (buttonId) => sendAction(entry.id, buttonId, entry.values),
    }),
    [entry.id, entry.values, changeValue, sendAction],
  );

  const endPanel = (): void => {
    dispatch({
      type: "closeSidebarTab",
      tab: extensionPanelTabId(entry.panelId ?? `ext-${entry.id}`),
    });
    dismiss(entry.id);
  };

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
        <Button variant="default" className={styles.ghostAction} onClick={endPanel}>
          {t("ui.view.closePanel")}
        </Button>
      </div>
    </div>
  );
}
