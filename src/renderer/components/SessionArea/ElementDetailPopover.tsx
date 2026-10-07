import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../hooks/useT";
import type { BrowserContextItem } from "../../services/browserService";
import { ElementDetail } from "./ElementDetail";
import styles from "./ElementDetailPopover.module.css";

/** 面板与锚点的垂直间隔。 */
const GAP = 6;
/** 贴视口边缘的安全距离。 */
const VIEWPORT_MARGIN = 8;

/**
 * 元素详情浮窗：锚定在芯片旁，portal + fixed，避免被输入框 overflow 裁剪。
 * 点击外部 / Escape 关闭。
 */
export function ElementDetailPopover({
  item,
  anchor,
  onClose,
}: {
  item: BrowserContextItem;
  /** 触发浮窗的芯片 DOM（contenteditable 内的原子节点，不是 React 元素）。 */
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // 浮层消费了 Esc：阻断冒泡，避免同时触发全局「Esc 停止」（docs/design/13 P1-7）
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = anchor.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // 优先上方，放不下再翻到下方
    let top = rect.top - GAP - height;
    if (top < VIEWPORT_MARGIN) top = rect.bottom + GAP;
    let left = rect.left;
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, rect.right - width);
    }
    if (top + height > viewportH - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, viewportH - height - VIEWPORT_MARGIN);
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }, [anchor]);

  return createPortal(
    <div
      ref={panelRef}
      className={styles.panel}
      role="dialog"
      aria-label={t("session.element.detail")}
    >
      <ElementDetail item={item} />
    </div>,
    document.body,
  );
}
