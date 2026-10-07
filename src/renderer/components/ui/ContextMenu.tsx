import { useEffect, useLayoutEffect, useRef } from "react";
import styles from "./ContextMenu.module.css";
import { type MenuItem, MenuList } from "./Menu";

interface ContextMenuProps {
  /** 视口坐标（pointer 事件的 clientX/Y）。 */
  position: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
}

/**
 * 光标定位的右键菜单：条目模型与 Menu 一致。
 * 打开时按实际尺寸收拢进视口边缘；点击外部 / Escape / 选中条目后关闭。
 */
export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // 绘制前按菜单实际尺寸修正坐标，避免越出视口（useLayoutEffect 同步于首次绘制）
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const x = Math.max(4, Math.min(position.x, window.innerWidth - rect.width - 4));
    const y = Math.max(4, Math.min(position.y, window.innerHeight - rect.height - 4));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }, [position]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        // 菜单消费了 Esc：阻断冒泡，避免同时触发更内层的全局快捷键（如「Esc 停止」）
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
  }, [onClose]);

  return (
    <div ref={panelRef} className={styles.panel} style={{ left: position.x, top: position.y }}>
      <MenuList items={items} afterSelect={onClose} />
    </div>
  );
}
