import { type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** 对话框主体类名（尺寸等由使用方通过 CSS Modules 控制）。 */
  panelClassName?: string;
  /** 无障碍名称。 */
  ariaLabel: string;
  children: ReactNode;
}

/** 面板内可聚焦元素（Tab 陷阱用）；tabindex=-1 的容器不算。 */
const FOCUSABLE_SELECTOR =
  'input, textarea, select, button, a[href], [tabindex="0"], [tabindex]:not([tabindex="-1"])';

/**
 * 通用浮窗：遮罩 + 居中面板，portal 到 body。
 * 支持 Escape / 点击遮罩关闭；面板内点击不关闭。
 * - 输入法组合期（isComposing）的 Escape 是取消候选，不关浮窗；
 * - Tab 在面板内循环（焦点陷阱），关闭后焦点归还触发元素。
 */
export function Modal({ open, onClose, panelClassName, ariaLabel, children }: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled"),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // 遮罩点击关闭：用 ref 绑定，避免把交互挂在静态 div 的 JSX 上
  useEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const onMouseDown = (event: MouseEvent): void => {
      if (event.target === backdrop) onClose();
    };
    backdrop.addEventListener("mousedown", onMouseDown);
    return () => backdrop.removeEventListener("mousedown", onMouseDown);
  }, [open, onClose]);

  // 打开时把焦点送进面板并记住触发元素；关闭（含卸载）后归还焦点
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    return () => {
      const restore = restoreRef.current;
      if (restore?.isConnected) restore.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div ref={backdropRef} className={styles.backdrop}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={[styles.panel, panelClassName ?? ""].join(" ").trim()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
