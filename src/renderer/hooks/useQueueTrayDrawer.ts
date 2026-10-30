import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type GlideCancel, glide, glideEase, makeCubicBezier, mix } from "../utils/glideMotion";
import { QUEUE_TRAY_MOTION } from "../utils/motionTokens";

type QueueTrayPhase = "closed" | "opening" | "open" | "closing";

const exitEase = makeCubicBezier(...QUEUE_TRAY_MOTION.easeIn);
const EMPTY: readonly never[] = [];

interface QueueTrayDrawer<T> {
  /** 裁切容器：高度由本 Hook 补间，内容（托盘）顶对齐。 */
  clipRef: RefObject<HTMLDivElement | null>;
  /** 收起动画期间保留最后一份队列，直到高度归零。 */
  shownItems: readonly T[];
  /** true = 正在播收起补间（用于 inert / pointer-events）。 */
  closing: boolean;
}

/**
 * 排队托盘的抽屉进出场（docs/design/95，方案 1）：
 * 裁切高度 0→实测 H 定帧补间，托盘顶缘带着自身边框上移、底边始终压在输入卡后；
 * 展开态条数变化用 resize 续接；最后一条离开时先留住末次内容再收。
 *
 * 队列动作走「全清 → 重排」，中间会有一帧空快照：`clearing` 为真时按住不收起，
 * 并用一帧防抖兜住 clearQueue 与重排之间 clearing 可能闪回的间隙——只有真为空才收。
 *
 * 不复用 `useCollapseAnimation`：它不播首次展开、会在收起时淡出内容、
 * 且内容高度变化时不补间；这三条都和选定方案冲突。
 */
export function useQueueTrayDrawer<T>(
  items: readonly T[],
  trayRef: RefObject<HTMLUListElement | null>,
  clearing: boolean,
): QueueTrayDrawer<T> {
  const clipRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<QueueTrayPhase>("closed");
  const phaseRef = useRef<QueueTrayPhase>("closed");
  const lastItemsRef = useRef<readonly T[]>(EMPTY);
  const cancelRef = useRef<GlideCancel | null>(null);
  /** 高度补间在途：ResizeObserver 此时不抢方向盘（条数变化由 items effect 接管）。 */
  const animatingRef = useRef(false);
  const pendingCloseRef = useRef(0);
  const latestItemsRef = useRef(items);
  const latestClearingRef = useRef(clearing);

  useLayoutEffect(() => {
    latestItemsRef.current = items;
    latestClearingRef.current = clearing;
  });

  const setPhaseBoth = useCallback((next: QueueTrayPhase): void => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const cancelPendingClose = useCallback((): void => {
    if (pendingCloseRef.current) {
      cancelAnimationFrame(pendingCloseRef.current);
      pendingCloseRef.current = 0;
    }
  }, []);

  const startTween = useCallback(
    (
      clip: HTMLElement,
      from: number,
      to: number,
      duration: number,
      ease: (t: number) => number,
      done: () => void,
    ): void => {
      cancelRef.current?.();
      animatingRef.current = true;
      cancelRef.current = glide({
        duration,
        ease,
        onUpdate: (progress) => {
          clip.style.height = `${mix(from, to, progress)}px`;
        },
        onComplete: () => {
          cancelRef.current = null;
          animatingRef.current = false;
          done();
        },
      });
    },
    [],
  );

  // 非空快照只在提交后更新：空队列那一帧渲染仍能拿到上一份内容播收起
  useLayoutEffect(() => {
    if (items.length > 0) lastItemsRef.current = items;
  }, [items]);

  useLayoutEffect(() => {
    const clip = clipRef.current;
    const tray = trayRef.current;
    if (!clip || !tray) return;

    // 队列重排会连续回流多份快照（1→2→3 条）：上一份快照的 resize 可能还没开播，
    // 若本轮判定「无需改高」而不取消它，它会在之后把高度改回旧目标。每轮都先停旧补间。
    cancelRef.current?.();
    cancelRef.current = null;
    animatingRef.current = false;

    const natural = tray.offsetHeight;
    const inline = Number.parseFloat(clip.style.height);
    const from = Number.isFinite(inline)
      ? inline
      : phaseRef.current === "closed"
        ? 0
        : clip.offsetHeight;

    if (items.length === 0) {
      if (phaseRef.current === "closed") {
        cancelPendingClose();
        return;
      }
      // 单条动作的重写期：空快照是瞬态，不能当成最后一条离开
      if (clearing) {
        cancelPendingClose();
        return;
      }
      // 再等一帧：clearQueue 与重排之间 clearing 可能闪回 false，真收才收
      cancelPendingClose();
      pendingCloseRef.current = requestAnimationFrame(() => {
        pendingCloseRef.current = 0;
        if (latestItemsRef.current.length > 0 || latestClearingRef.current) return;
        const current = Number.parseFloat(clip.style.height) || 0;
        if (current <= 0.5) {
          clip.style.height = "0px";
          setPhaseBoth("closed");
          return;
        }
        setPhaseBoth("closing");
        startTween(clip, current, 0, QUEUE_TRAY_MOTION.exit, exitEase, () => {
          clip.style.height = "0px";
          setPhaseBoth("closed");
        });
      });
      return;
    }

    cancelPendingClose();
    if (natural <= 0) return;
    if (Math.abs(from - natural) < 0.5) {
      clip.style.height = `${natural}px`;
      if (phaseRef.current !== "open") setPhaseBoth("open");
      return;
    }

    const entering = phaseRef.current === "closed" || phaseRef.current === "closing";
    if (entering) setPhaseBoth("opening");
    startTween(
      clip,
      from,
      natural,
      entering ? QUEUE_TRAY_MOTION.enter : QUEUE_TRAY_MOTION.resize,
      glideEase,
      () => {
        clip.style.height = `${natural}px`;
        setPhaseBoth("open");
      },
    );
  }, [items, clearing, trayRef, setPhaseBoth, startTween, cancelPendingClose]);

  const hasTray = items.length > 0 || phase !== "closed";
  // 窗口变窄 / 文本换行会改变托盘自然高度：空闲时补一段 resize，避免定高裁字
  useLayoutEffect(() => {
    if (!hasTray) return;
    const clip = clipRef.current;
    const tray = trayRef.current;
    if (!clip || !tray) return;
    const observer = new ResizeObserver(() => {
      if (animatingRef.current) return;
      if (phaseRef.current !== "open") return;
      const natural = tray.offsetHeight;
      const current = Number.parseFloat(clip.style.height) || 0;
      if (natural <= 0 || Math.abs(natural - current) < 0.5) return;
      startTween(clip, current, natural, QUEUE_TRAY_MOTION.resize, glideEase, () => {
        clip.style.height = `${natural}px`;
        setPhaseBoth("open");
      });
    });
    observer.observe(tray);
    return () => observer.disconnect();
  }, [hasTray, trayRef, setPhaseBoth, startTween]);

  useEffect(
    () => () => {
      cancelRef.current?.();
      if (pendingCloseRef.current) cancelAnimationFrame(pendingCloseRef.current);
    },
    [],
  );

  const shownItems = items.length > 0 ? items : phase === "closed" ? EMPTY : lastItemsRef.current;

  return {
    clipRef,
    shownItems,
    closing: phase === "closing",
  };
}
