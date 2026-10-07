import { X } from "@phosphor-icons/react";
import { useCallback, useMemo } from "react";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/**
 * modal 挂载（P0 必做）：现有 Modal + 底栏 actions。
 * 用户 Esc/×/backdrop → dismiss 事件；Host 再发 closed。
 */
export function ModalMount({ entry }: { entry: ExtensionViewEntry }) {
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

  const onClose = useCallback(() => {
    dismiss(entry.id);
  }, [dismiss, entry.id]);

  const title = entry.title || t("ui.view.fallbackTitleView");

  return (
    <Modal open onClose={onClose} ariaLabel={title} panelClassName={styles.modalPanel}>
      <div className={styles.modalHeader}>
        <div className={styles.modalTitle}>{title}</div>
        <IconButton title={t("common.close")} onClick={onClose}>
          <X size={18} weight="regular" />
        </IconButton>
      </div>
      <div className={styles.modalBody}>
        <ViewNodeRenderer node={entry.root} bridge={bridge} />
      </div>
      {entry.actions.length > 0 ? (
        <div className={styles.modalFooter}>
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
                className={action.variant === "ghost" ? styles.ghostAction : undefined}
                onClick={() => sendAction(entry.id, action.id, entry.values, action.kind)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </Modal>
  );
}
