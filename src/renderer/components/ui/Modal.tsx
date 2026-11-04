import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { type GlideCancel, glide } from "../../utils/glideMotion";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import styles from "./Modal.module.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** 对话框主体类名（尺寸等由使用方通过 CSS Modules 控制）。 */
  panelClassName?: string;
  /** 无障碍名称。 */
  ariaLabel: string;
  /**
   * 二级浮窗：叠在另一层 Modal 之上（如设置浮窗里的凭据对话框）。两件半事：
   * 遮罩淡一档且不重复模糊、进出场走浮层那条定帧时间轴，另外面板不挂 `data-overlay-panel`
   * ——那是给「下拉/菜单」用的标记，挂上会让本层自己的 Tab 陷阱短路、Tab 直接跳出对话框；
   * 下层不抢焦点由开合栈（只有栈顶处理键盘）负责。默认 false，其余调用方表现不变。
   */
  nested?: boolean;
  children: ReactNode;
}

/** 面板内可聚焦元素（Tab 陷阱用）；tabindex=-1 的容器不算。 */
const FOCUSABLE_SELECTOR =
  'input, textarea, select, button, a[href], [tabindex="0"], [tabindex]:not([tabindex="-1"])';

/**
 * 打开中的浮窗栈：后开的既后挂进 body、也排在栈顶。
 * Escape / Tab 只认栈顶——两层各挂一个 document keydown 时，`stopPropagation`
 * 拦不住同一节点上的另一个监听器，一次 Esc 会连关两层（docs/design/128）。
 */
let modalSeq = 0;
const openStack: number[] = [];

/**
 * 通用浮窗：遮罩 + 居中面板，portal 到 body。
 * 支持 Escape / 点击遮罩关闭；面板内点击不关闭。
 * - 输入法组合期（isComposing）的 Escape 是取消候选，不关浮窗；
 * - Tab 在面板内循环（焦点陷阱），关闭后焦点归还触发元素。
 */
export function Modal({
  open,
  onClose,
  panelClassName,
  ariaLabel,
  nested = false,
  children,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stackId = useRef<number | null>(null);
  const backdropTween = useRef<GlideCancel>(() => {});
  const overlay = useGlideOverlay(panelRef);

  // 声明在键盘监听之前：键盘处理读的就是这条 effect 写入的栈位
  useEffect(() => {
    if (!open) return;
    const id = ++modalSeq;
    stackId.current = id;
    openStack.push(id);
    return () => {
      const index = openStack.indexOf(id);
      if (index >= 0) openStack.splice(index, 1);
      if (stackId.current === id) stackId.current = null;
    };
  }, [open]);

  const isTopmost = useCallback(
    (): boolean => stackId.current !== null && openStack[openStack.length - 1] === stackId.current,
    [],
  );

  /**
   * 挂载态与 open 分开：二级浮窗要演完退场才卸载节点。
   * 打开走渲染期置位（放进 useEffect 会晚一帧才出现，点击像卡了一下）；
   * 非 nested 的调用方维持原样：即时卸载、不播进出场。
   */
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    if (!nested) {
      setMounted(false);
      return;
    }
    const backdrop = backdropRef.current;
    backdropTween.current();
    if (backdrop) {
      backdropTween.current = glide({
        duration: GLIDE_MOTION.popOut,
        onUpdate: (p) => {
          backdrop.style.opacity = String(1 - p);
        },
        onComplete: () => {
          if (backdropRef.current) backdropRef.current.style.opacity = "";
        },
      });
    }
    overlay.exit(() => setMounted(false));
  }, [open, mounted, nested, overlay]);

  useLayoutEffect(() => {
    if (!open || !nested) return;
    const backdrop = backdropRef.current;
    backdropTween.current();
    if (backdrop) {
      backdrop.style.opacity = "0";
      backdropTween.current = glide({
        duration: GLIDE_MOTION.pop,
        onUpdate: (p) => {
          backdrop.style.opacity = String(p);
        },
        onComplete: () => {
          if (backdropRef.current) backdropRef.current.style.opacity = "";
        },
      });
    }
    // 对话框没有锚点，缩放原点留在面板中心
    overlay.prime();
    overlay.enter();
  }, [open, nested, overlay]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // 上层浮窗开着时，本层的键盘语义一律让位（否则会连关两层）
      if (!isTopmost()) return;
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
      // 浮层（下拉/菜单）portal 在 body 上、不在本面板子树里；焦点落在其中是合法状态，
      // 抢回来会让方向键与擦选在对话框内无法使用（docs/design/51）
      if (active instanceof Element && active.closest("[data-overlay-panel]")) return;
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
  }, [open, onClose, isTopmost]);

  // 遮罩点击关闭：用 ref 绑定，避免把交互挂在静态 div 的 JSX 上
  useEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const onMouseDown = (event: MouseEvent): void => {
      // 只认左键：右键是浮层内部的「呼出菜单」手势（如 lightbox 保存图片），不该顺手关掉浮窗
      if (event.button === 0 && event.target === backdrop) onClose();
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

  useEffect(
    () => () => {
      backdropTween.current();
    },
    [],
  );

  if (!mounted) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className={[styles.backdrop, nested ? styles.backdropNested : ""].join(" ").trim()}
    >
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
