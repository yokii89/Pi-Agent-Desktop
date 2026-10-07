import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Popover.module.css";

/** 面板与触发器之间的垂直间隔。 */
const GAP = 6;
/** 面板贴视口边缘的安全距离。 */
const VIEWPORT_MARGIN = 8;

interface PopoverProps {
  /** 触发器渲染函数，接收打开状态与点击处理。 */
  trigger: (props: { open: boolean; onClick: () => void }) => ReactNode;
  /** 面板内容；传函数时注入 close，"选中后自动收起"这类交互需要它。 */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** 面板与触发器的对齐方向。 */
  align?: "left" | "right";
  /** 面板相对触发器的垂直位置。 */
  direction?: "top" | "bottom";
}

/**
 * 轻量弹出层：管理开合、外部点击、Escape 与滚动关闭。面板内容自由（Menu、模型说明等）。
 *
 * **面板 portal 到 body 并用 fixed 定位**：侧栏 `.nav` 与折叠容器都是 `overflow: hidden`
 * 的裁剪容器，面板留在原地会被裁掉——表现是"菜单看得见、点不到"，点击还会穿透到下层条目。
 * 坐标在首帧前（useLayoutEffect）按触发器矩形算好，方向放不下就翻到另一侧，再夹进视口。
 * 代价是面板不再随容器滚动，因此打开期间外部滚动一律收起（滚动后锚点已经错位）；
 * 面板自身（菜单列表）的内部滚动除外。
 */
export function Popover({ trigger, children, align = "left", direction = "top" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      // 面板已不在 root 的 DOM 子树里，两边都要判，否则点面板内部会把它关掉
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    // capture 阶段抢 Escape：Modal 也挂在 document 上监听 Escape 关闭，
    // 冒泡阶段两者都会触发；菜单打开时应先关菜单，而不是整窗。
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    // 面板自身（如模型菜单列表）内部滚动不应关闭；只收起「锚点已移走」的外部滚动
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;

    const place = (): void => {
      const anchor = root.getBoundingClientRect();
      const { width, height } = panel.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let top = direction === "bottom" ? anchor.bottom + GAP : anchor.top - GAP - height;
      const flippedTop = direction === "bottom" ? anchor.top - GAP - height : anchor.bottom + GAP;
      const fitsTop = (value: number): boolean =>
        value >= VIEWPORT_MARGIN && value + height <= viewportH - VIEWPORT_MARGIN;
      if (!fitsTop(top) && fitsTop(flippedTop)) top = flippedTop;

      let left = align === "right" ? anchor.right - width : anchor.left;
      const flippedLeft = align === "right" ? anchor.left : anchor.right - width;
      const fitsLeft = (value: number): boolean =>
        value >= VIEWPORT_MARGIN && value + width <= viewportW - VIEWPORT_MARGIN;
      if (!fitsLeft(left) && fitsLeft(flippedLeft)) left = flippedLeft;

      // 两侧都放不下（窗口极窄/极矮）时夹进视口，至少保证可见可点
      panel.style.left = `${Math.round(Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - width - VIEWPORT_MARGIN)))}px`;
      panel.style.top = `${Math.round(Math.max(VIEWPORT_MARGIN, Math.min(top, viewportH - height - VIEWPORT_MARGIN)))}px`;
    };

    place();
    // 模型列表等异步灌入会改变面板高度：不重算的话 fixed 坐标仍是「打开瞬间」的小面板
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, align, direction]);

  return (
    <div ref={rootRef} className={styles.root}>
      {trigger({ open, onClick: () => setOpen((v) => !v) })}
      {open &&
        createPortal(
          <div ref={panelRef} className={styles.panel}>
            {typeof children === "function" ? children(() => setOpen(false)) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}
