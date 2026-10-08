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
 * stream 挂载（P1）：长在会话文档流内的卡片，密度对齐 ToolCall。
 * 不抢焦点、不强制 scrollToBottom（SessionView 仅在钉底时跟随）。
 */
export function StreamMount({ entry }: { entry: ExtensionViewEntry }) {
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
    <div className={styles.streamCard} data-view-id={entry.id}>
      <div className={styles.streamHeader}>
        <span className={styles.streamTitle}>{entry.title || t("ui.view.fallbackTitleView")}</span>
        <IconButton title={t("common.close")} onClick={() => dismiss(entry.id)}>
          <X size={14} weight="regular" />
        </IconButton>
      </div>
      <div className={styles.streamBody}>
        <ViewNodeRenderer node={entry.root} bridge={bridge} />
      </div>
      {entry.actions.length > 0 ? (
        <div className={styles.streamFooter}>
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
    </div>
  );
}
