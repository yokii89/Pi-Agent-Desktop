import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * 滚动跟随状态机（docs/design/10 §3.5 / docs/design/13 P1-1）。
 *
 * 取代「一颗 pinned 布尔 + entries 变化补一次 scrollTop」：
 * - follow：内容高度变化（ResizeObserver 信号）就贴底；free：完全不动，只回报未读高度。
 * - follow → free 只能由用户主动上滚（scrollTop 减少）或产生选区触发；
 *   内容增长导致的程序贴底（scrollTop 只增）不会误判。
 * - free → follow：用户滚回底部（距底 < 48px）或调用 jumpToLatest()。
 * - follow 期容器 CSS 需 `overflow-anchor: none`（SessionView 按 mode 切换），
 *   不和 Chromium 原生滚动锚定抢 scrollTop；free 期恢复 auto，补 content-visibility 首次实现跳动。
 *
 * 单一写入者：程序化贴底只走 stickToBottom()，写后回读钳制值入账。
 * jumpToLatest 也走它、不用 smooth —— smooth 动画中途的任何 scrollTop 同步赋值
 * （流式增长触发的贴底）会按规范取消动画，表现为"滑到一半瞬移"。
 */

/** 距底多近仍视为"在底部"（px）：free → follow 的回贴阈值。 */
const REATTACH_THRESHOLD_PX = 48;
/** follow 时 scrollTop 减少超过该值才算用户上滚（px）：过滤滚动抖动。 */
const USER_SCROLL_UP_PX = 2;

export type FollowMode = "follow" | "free";

/** 距视口底部还有多少内容（px）。 */
function distanceToBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * 程序化贴底：唯一写入者，写后回读钳制值入账。
 * 浏览器会把赋值钳到最大可滚动距离，回读值才是 scroll 事件将看到的 scrollTop。
 */
function stickToBottom(el: HTMLElement, lastTopRef: { current: number }): void {
  el.scrollTop = el.scrollHeight;
  lastTopRef.current = el.scrollTop;
}

export function useStickToBottom<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  contentRef: RefObject<HTMLElement | null>,
): {
  mode: FollowMode;
  /** free 模式下视口底部之后的内容高度（px）；follow 时恒为 0。 */
  unreadPx: number;
  jumpToLatest: () => void;
  /**
   * 跳到指定 scrollTop（px），供问题导航分段栏等定位跳转用。
   * 先 goFree()——否则 follow 期内容增长会把落点贴底拽回；smooth 动画期间
   * 流式增长在 free 下只更新 unreadPx，不打断动画（docs/design/10 §3.5）。
   */
  jumpToOffset: (px: number, behavior?: ScrollBehavior) => void;
  /** 会话切换等场景强制回到 follow（不滚动，只复位状态）。 */
  reset: () => void;
} {
  const [mode, setMode] = useState<FollowMode>("follow");
  const [unreadPx, setUnreadPx] = useState(0);
  const modeRef = useRef<FollowMode>("follow");
  const lastTopRef = useRef(0);

  const goFollow = useCallback(() => {
    modeRef.current = "follow";
    setMode("follow");
    setUnreadPx(0);
  }, []);

  const goFree = useCallback(() => {
    if (modeRef.current === "free") return;
    modeRef.current = "free";
    setMode("free");
  }, []);

  // 内容高度变化是"有新内容"的唯一可靠信号：图片解码、代码高亮、流式增量
  // 都不经过 store，只有高度变化能同时覆盖（docs/design/10 C1）
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      if (modeRef.current === "follow") {
        stickToBottom(el, lastTopRef);
      } else {
        setUnreadPx(distanceToBottom(el));
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [containerRef, contentRef]);

  // 滚动事件只在 scrollTop 变化时触发：减少 = 用户上滚（唯一 follow → free 的滚动信号）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = (): void => {
      const prevTop = lastTopRef.current;
      lastTopRef.current = el.scrollTop;
      const distance = distanceToBottom(el);
      if (modeRef.current === "follow") {
        if (el.scrollTop < prevTop - USER_SCROLL_UP_PX && distance > REATTACH_THRESHOLD_PX) {
          goFree();
        }
        return;
      }
      if (distance < REATTACH_THRESHOLD_PX) {
        goFollow();
      } else {
        setUnreadPx(distance);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [containerRef, goFollow, goFree]);

  // 非折叠选区落在容器内 → 强制 free：拖选复制/引用不被自动滚动拽回（docs/design/10 C2）
  useEffect(() => {
    const onSelectionChange = (): void => {
      const selection = document.getSelection();
      const el = containerRef.current;
      if (!el || !selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (el.contains(range.startContainer) && el.contains(range.endContainer)) {
        goFree();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [containerRef, goFree]);

  const jumpToLatest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    goFollow();
    stickToBottom(el, lastTopRef);
  }, [containerRef, goFollow]);

  const jumpToOffset = useCallback(
    (px: number, behavior: ScrollBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el) return;
      // 跳转前先脱离 follow，避免动画/落点被贴底逻辑抢回（docs/design/10 §3.5）
      goFree();
      const target = Number.isFinite(px) ? Math.max(0, px) : 0;
      if (behavior === "smooth") {
        el.scrollTo({ top: target, behavior: "smooth" });
        // 动画途中 scrollTop 逐帧变化，scroll 事件会持续入账；此处只同步当前值
        lastTopRef.current = el.scrollTop;
      } else {
        el.scrollTop = target;
        // 瞬时路径回读钳制值入账，避免下一次 onScroll 把浏览器钳位误判成用户上滚
        lastTopRef.current = el.scrollTop;
      }
    },
    [containerRef, goFree],
  );

  const reset = useCallback(() => {
    lastTopRef.current = containerRef.current?.scrollTop ?? 0;
    goFollow();
  }, [containerRef, goFollow]);

  return { mode, unreadPx, jumpToLatest, jumpToOffset, reset };
}
