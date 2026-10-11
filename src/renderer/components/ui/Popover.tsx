import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import styles from "./Popover.module.css";

/** 面板与触发器之间的垂直间隔。 */
const GAP = 6;
/** 面板贴视口边缘的安全距离。 */
const VIEWPORT_MARGIN = 8;
/** 收起时把焦点交还给触发器：面板卸载会让焦点掉回 body，键盘用户会丢失位置。 */
const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** 触发器渲染函数收到的参数：open 用于箭头/展开态外观，onClick 切换开合，close 供键盘"就地提交"收起。 */
export interface PopoverTriggerProps {
  open: boolean;
  onClick: () => void;
  close: () => void;
}

interface PopoverProps {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  /** 面板内容；传函数时注入 close，"选中后自动收起"这类交互需要它。 */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** 面板与触发器的对齐方向。 */
  align?: "left" | "right";
  /** 面板相对触发器的垂直位置。 */
  direction?: "top" | "bottom";
  /**
   * 根节点（包裹触发器的那层 div）的类名。嵌入式控件必须能给它定尺寸：
   * 根是 `inline-flex`，站点的 `父 > 子` 选择器会因为它而断链。
   */
  rootClassName?: string;
  /** 面板外壳的附加类名（宽度、内距等外壳级差异都从这里进来）。 */
  panelClassName?: string;
}

/**
 * 轻量弹出层：管理开合、外部点击、Escape 与滚动关闭。面板内容自由（Menu、模型说明等）。
 *
 * **面板 portal 到 body、用 fixed 定位**：侧栏 `.nav` 与折叠容器都是 `overflow: hidden`
 * 的裁剪容器，面板留在原地会被裁掉——表现是"菜单看得见、点不到"，点击还会穿透到下层条目。
 * 坐标在首帧前（useLayoutEffect）按触发器矩形算好，方向放不下就翻到另一侧，再夹进视口。
 * 代价是面板不再随容器滚动，因此打开期间外部滚动一律收起（滚动后锚点已经错位）；
 * 面板自身（菜单列表）的内部滚动除外。
 *
 * **开合走浮层定帧时间轴**（docs/design/51，帧率见 GLIDE_MOTION.fps）：弹出/收起与箭头翻转、按压回弹共用
 * cubic-bezier(0.23, 1, 0.32, 1)。收起要先演动画再卸载，所以 `open`（逻辑开合）与
 * `mounted`（是否在 DOM 里）分开；补间结束时清除内联样式，静息外观交回 CSS。
 */
export function Popover({
  trigger,
  children,
  align = "left",
  direction = "top",
  rootClassName,
  panelClassName,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const chevronTween = useRef<GlideCancel>(() => {});
  const pressTween = useRef<GlideCancel>(() => {});
  const chevron = useRef(0);
  const press = useRef(0);
  const mountedRef = useRef(false);
  /** 收起时焦点是否要交还触发器（面板卸载会把焦点掉到 body，键盘用户会丢位置）。 */
  const handBack = useRef(false);
  /** 面板节点是新建的还是从收起动画里复用的：新建才需要写起点，复用要从当前值接着演。 */
  const fresh = useRef(false);
  const overlay = useGlideOverlay(panelRef);

  const animateChevron = useCallback((nextOpen: boolean): void => {
    chevronTween.current();
    const from = chevron.current;
    chevronTween.current = glide({
      duration: GLIDE_MOTION.chevron,
      onUpdate: (p) => {
        chevron.current = mix(from, nextOpen ? 1 : 0, p);
        rootRef.current?.style.setProperty("--gs-chev", `${(chevron.current * 180).toFixed(3)}deg`);
      },
    });
  }, []);

  const animatePress = useCallback((nextPressed: boolean): void => {
    pressTween.current();
    const from = press.current;
    pressTween.current = glide({
      duration: GLIDE_MOTION.press,
      onUpdate: (p) => {
        press.current = mix(from, nextPressed ? 1 : 0, p);
        rootRef.current?.style.setProperty("--gs-press", press.current.toFixed(3));
      },
    });
  }, []);

  const requestOpen = useCallback(() => {
    // 测量与按压回弹互斥：不先复位就会拿缩放中的触发器矩形去锚定面板
    pressTween.current();
    press.current = 0;
    rootRef.current?.style.setProperty("--gs-press", "0");
    if (!mountedRef.current) {
      mountedRef.current = true;
      fresh.current = true;
      setMounted(true);
    }
    setOpen(true);
    animateChevron(true);
  }, [animateChevron]);

  const requestClose = useCallback(() => {
    if (!open) return;
    setOpen(false);
    animateChevron(false);
    // 收起要先演完动画再卸载，所以这里不直接 setMounted(false)
    handBack.current = panelRef.current?.contains(document.activeElement) ?? false;
    overlay.exit(() => {
      mountedRef.current = false;
      setMounted(false);
      if (handBack.current) {
        handBack.current = false;
        rootRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
      }
    });
  }, [open, animateChevron, overlay]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      // 面板已不在 root 的 DOM 子树里，两边都要判，否则点面板内部会把它关掉
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      requestClose();
    };
    // capture 阶段抢 Escape：Modal 也挂在 document 上监听 Escape 关闭，
    // 冒泡阶段两者都会触发；菜单打开时应先关菜单，而不是整窗。
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestClose();
      }
    };
    // 面板自身（如模型菜单列表）内部滚动不应关闭；只收起「锚点已移走」的外部滚动
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      requestClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, requestClose]);

  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;

    // 起点必须在首帧前写好：CSS 只描述静息态，否则会闪一下全尺寸面板
    if (fresh.current) {
      fresh.current = false;
      overlay.prime();
    }

    const place = (): void => {
      const anchor = root.getBoundingClientRect();
      // 用布局盒尺寸而非 getBoundingClientRect：入场时面板带着 scale(0.95)，
      // 后者量到的是缩放后的盒子，异步灌入的长列表会被算错高度而翻边。
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let top = direction === "bottom" ? anchor.bottom + GAP : anchor.top - GAP - height;
      const flippedTop = direction === "bottom" ? anchor.top - GAP - height : anchor.bottom + GAP;
      const fitsTop = (value: number): boolean =>
        value >= VIEWPORT_MARGIN && value + height <= viewportH - VIEWPORT_MARGIN;
      let side: "top" | "bottom" = direction;
      if (!fitsTop(top) && fitsTop(flippedTop)) {
        top = flippedTop;
        side = direction === "bottom" ? "top" : "bottom";
      }

      let left = align === "right" ? anchor.right - width : anchor.left;
      const flippedLeft = align === "right" ? anchor.left : anchor.right - width;
      const fitsLeft = (value: number): boolean =>
        value >= VIEWPORT_MARGIN && value + width <= viewportW - VIEWPORT_MARGIN;
      let resolvedAlign: "left" | "right" = align;
      if (!fitsLeft(left) && fitsLeft(flippedLeft)) {
        left = flippedLeft;
        resolvedAlign = align === "right" ? "left" : "right";
      }

      // 两侧都放不下（窗口极窄/极矮）时夹进视口，至少保证可见可点
      panel.style.left = `${Math.round(Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - width - VIEWPORT_MARGIN)))}px`;
      panel.style.top = `${Math.round(Math.max(VIEWPORT_MARGIN, Math.min(top, viewportH - height - VIEWPORT_MARGIN)))}px`;
      // 缩放要从贴着触发器的那一角长出，否则面板是"原地呼吸"而不是从触发器推开
      panel.style.transformOrigin = `${side === "bottom" ? "top" : "bottom"} ${resolvedAlign}`;
    };

    place();
    overlay.enter();
    // 模型列表等异步灌入会改变面板高度：不重算的话 fixed 坐标仍是「打开瞬间」的小面板
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, mounted, align, direction, overlay]);

  useEffect(
    () => () => {
      chevronTween.current();
      pressTween.current();
    },
    [],
  );

  return (
    <div
      ref={rootRef}
      className={[styles.root, rootClassName].filter(Boolean).join(" ")}
      onPointerDown={(event) => {
        // 禁用的触发器不会开面板，也就不该跟着回弹一下
        if (!open && !(event.target as HTMLElement).closest(":disabled")) animatePress(true);
      }}
      onPointerUp={() => animatePress(false)}
      onPointerLeave={() => animatePress(false)}
      onPointerCancel={() => animatePress(false)}
    >
      {trigger({
        open,
        close: requestClose,
        onClick: () => (open ? requestClose() : requestOpen()),
      })}
      {mounted &&
        createPortal(
          // data-overlay-panel：让 Modal 的焦点陷阱认得"焦点在浮层里"，不去抢它
          <div
            ref={panelRef}
            className={[styles.panel, panelClassName].filter(Boolean).join(" ")}
            data-overlay-panel=""
          >
            {typeof children === "function" ? children(requestClose) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}
