import { type ReactNode, useEffect, useRef, useState } from "react";
import { loadGsap, prefersReducedMotion } from "../../utils/animation";
import { NAV_MOTION } from "../../utils/motionTokens";
import styles from "./SideNav.module.css";

interface RevealOnRowHoverProps {
  children: ReactNode;
}

/**
 * 行内操作按钮的"随行悬浮出现"：不靠 CSS opacity 突变，而是由 GSAP 播放
 * 位移 + 缩放 + 回弹的组合（按钮从右侧滑入），观感上像被行主动"让"出来。
 *
 * 鼠标悬浮有短暂延迟（NAV_MOTION.revealDelay）：快速扫过列表时不闪按钮，
 * 停留下来才出现；键盘聚焦是明确意图，立即显示不延迟。
 *
 * 关键约束：包裹元素 opacity:0 时若同时 pointer-events:none，鼠标一旦移到
 * 该元素上就收不到事件，按钮会永远无法出现。所以 pointer-events 始终开启，
 * 由外层整行（[data-side-row]）驱动显隐 —— 因此本组件必须作为列表行内、
 * 靠行右缘的容器使用。
 */
export function RevealOnRowHover({ children }: RevealOnRowHoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  // 菜单打开等"需要常驻"的场景由子元素标记，此时不允许收起。
  // 用 ref 承载锁定态供事件回调读取，state 仅供 CSS 兜底选择器使用
  const locked = useRef(false);
  const [lockedAttr, setLockedAttr] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const row = root.closest("[data-side-row]") ?? root.parentElement;
    if (!row) return;

    // 悬浮揭示的延迟计时器：离开行即取消，停留才兑现
    let enterTimer: number | null = null;
    const cancelEnter = (): void => {
      if (enterTimer !== null) {
        window.clearTimeout(enterTimer);
        enterTimer = null;
      }
    };

    // 子元素会因菜单开合而改写 rowButtonOpen；用 MutationObserver 同步锁定态，
    // 避免菜单面板还在显示、触发器却已淡出的失锚问题
    const syncLock = (): void => {
      const next = root.querySelector(`.${styles.rowButtonOpen}`) !== null;
      locked.current = next;
      setLockedAttr(next);
      // 菜单刚打开而鼠标已不在行上时，补一次显形
      if (next) setShown(true);
    };

    const setShown = (next: boolean): void => {
      if (shown.current === next) return;
      shown.current = next;
      const target = root.firstElementChild as HTMLElement | null;
      if (!target) return;
      if (prefersReducedMotion()) {
        root.style.setProperty("--reveal", next ? "1" : "0");
        return;
      }
      void loadGsap().then((gsap) => {
        if (!root.isConnected) return;
        // 只补间 --reveal，真实 opacity 由 CSS 的 :hover / :focus-within 决定，
        // 这样键盘聚焦不依赖本动画是否跑完（详见 SideNav.module.css 注释）
        gsap.to(root, {
          "--reveal": next ? 1 : 0,
          duration: NAV_MOTION.fade,
          ease: NAV_MOTION.easeOut,
        });
        gsap.fromTo(
          target,
          next ? { x: 8, scale: 0.8 } : { x: 0, scale: 1 },
          next
            ? { x: 0, scale: 1, duration: NAV_MOTION.hover, ease: NAV_MOTION.easeBack }
            : { x: 4, scale: 0.9, duration: NAV_MOTION.fade },
        );
      });
    };

    syncLock();
    const observer = new MutationObserver(syncLock);
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });

    const onEnter = (): void => {
      if (enterTimer !== null) return;
      enterTimer = window.setTimeout(() => {
        enterTimer = null;
        setShown(true);
      }, NAV_MOTION.revealDelay * 1000);
    };
    const onLeave = (): void => {
      cancelEnter();
      // 菜单开着时鼠标可能已离开行，但操作仍在进行，不能收起
      if (!locked.current) setShown(false);
    };
    // 键盘聚焦也算"行被激活"，且是明确意图：立即显示，不参与悬浮延迟
    const onFocusIn = (): void => {
      cancelEnter();
      setShown(true);
    };
    row.addEventListener("mouseenter", onEnter);
    row.addEventListener("mouseleave", onLeave);
    row.addEventListener("focusin", onFocusIn);
    return () => {
      cancelEnter();
      observer.disconnect();
      row.removeEventListener("mouseenter", onEnter);
      row.removeEventListener("mouseleave", onLeave);
      row.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.hoverReveal} data-locked={lockedAttr ? "" : undefined}>
      {children}
    </div>
  );
}
