import { type ReactNode, useEffect, useRef } from "react";
import { useT } from "../../hooks/useT";
import { Button } from "./Button";
import styles from "./ConfirmDialog.module.css";
import { Modal } from "./Modal";

export type ConfirmTone = "default" | "danger";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 正文；纯文本可直接传 string。 */
  message: ReactNode;
  /** 确认按钮文案；默认随界面语言。 */
  confirmLabel?: string;
  /** 取消按钮文案；默认随界面语言。 */
  cancelLabel?: string;
  /** danger：确认按钮用破坏性色，且默认焦点落在取消。 */
  tone?: ConfirmTone;
  /** 确认操作进行中：禁用关闭与按钮。 */
  busy?: boolean;
  /** busy 时确认按钮文案，默认与 confirmLabel 相同。 */
  busyLabel?: string;
  /**
   * 可选第三动作（如「保留后台进程」）：放在取消与确认之间。
   * 不传则保持经典双钮。
   */
  secondaryLabel?: string;
  secondaryBusyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
}

/**
 * 通用确认对话框（基于 Modal）。
 * 后续所有「二次确认」场景统一走本组件，不再使用 window.confirm。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = "default",
  busy = false,
  busyLabel,
  secondaryLabel,
  secondaryBusyLabel,
  onConfirm,
  onCancel,
  onSecondary,
}: ConfirmDialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmText = confirmLabel ?? t("common.confirm");
  const cancelText = cancelLabel ?? t("common.cancel");

  // 破坏性操作默认焦点在取消，降低误触
  useEffect(() => {
    if (!open) return;
    const target = tone === "danger" ? cancelRef.current : confirmRef.current;
    target?.focus();
  }, [open, tone]);

  const handleCancel = (): void => {
    if (busy) return;
    onCancel();
  };

  return (
    <Modal open={open} onClose={handleCancel} ariaLabel={title} panelClassName={styles.panel}>
      <div className={styles.body}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.message}>{message}</div>
        <div className={styles.actions}>
          <Button ref={cancelRef} disabled={busy} onClick={handleCancel}>
            {cancelText}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button
              disabled={busy}
              onClick={() => {
                if (busy) return;
                onSecondary();
              }}
            >
              {busy ? (secondaryBusyLabel ?? secondaryLabel) : secondaryLabel}
            </Button>
          ) : null}
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={busy}
            onClick={() => {
              if (busy) return;
              onConfirm();
            }}
          >
            {busy ? (busyLabel ?? confirmText) : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
