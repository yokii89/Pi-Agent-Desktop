import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
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
 *
 * 开合走 30fps 时间轴（docs/design/51）：收起要先演完动画再通知父级卸载，
 * 内部用 `closing` 闩住防止重复触发；父级直接卸载（如芯片消失）则没有出场动画。
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
  const closing = useRef(false);
  const overlay = useGlideOverlay(panelRef);

  const beginClose = useCallback((): void => {
    if (closing.current) return;
    closing.current = true;
    overlay.exit(onClose);
  }, [onClose, overlay]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.contains(target)) return;
      beginClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // 浮层消费了 Esc：阻断冒泡，避免同时触发全局「Esc 停止」（docs/design/13 P1-7）
        event.stopPropagation();
        beginClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, beginClose]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = anchor.getBoundingClientRect();
    // 用布局盒尺寸而非 getBoundingClientRect：入场补间期间盒子带着 scale，会量小一档
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // 优先上方，放不下再翻到下方
    let top = rect.top - GAP - height;
    let vOrigin = "bottom";
    if (top < VIEWPORT_MARGIN) {
      top = rect.bottom + GAP;
      vOrigin = "top";
    }
    let left = rect.left;
    let hOrigin = "left";
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, rect.right - width);
      hOrigin = "right";
    }
    if (top + height > viewportH - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, viewportH - height - VIEWPORT_MARGIN);
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    // 缩放要从贴着芯片的那一角长出，否则面板是"原地呼吸"而不是从锚点推开
    panel.style.transformOrigin = `${vOrigin} ${hOrigin}`;

    overlay.prime();
    overlay.enter();
  }, [anchor, overlay]);

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
