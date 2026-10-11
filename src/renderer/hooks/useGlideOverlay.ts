import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
import { GLIDE_MOTION } from "../utils/motionTokens";

/** 入场起点缩放（对齐 docs/ui-design/glide-select-bezier.html 的 scale(0.95)）。 */
const ENTER_SCALE = 0.95;

export interface GlideOverlayApi {
  /** 首帧前把面板写到"未展开"起点（opacity 0 + scale 0.95），避免出现全尺寸闪帧。 */
  prime: () => void;
  /** 从当前视觉值演到展开态；结束后清除内联样式，外观交回 CSS。 */
  enter: () => void;
  /** 从当前视觉值演到收起态，演完再回调 done（调用方在那里卸载节点）。 */
  exit: (done: () => void) => void;
  /** 停表但不写终态。 */
  cancel: () => void;
}

/**
 * 浮层外壳的进出补间（docs/design/51）：Popover、右键菜单、检查器浮窗等共用同一条曲线与时序。
 *
 * 只负责"随时间变化的数值"（opacity + scale）；`transform-origin` 与 `left/top`
 * 归各组件的定位逻辑写，因为锚点关系只有它们知道。中途打断的补间从当前值继续，
 * 所以连点触发器不会出现"闪回起点再弹一次"。
 */
export function useGlideOverlay(panelRef: RefObject<HTMLElement | null>): GlideOverlayApi {
  const tween = useRef<GlideCancel>(() => {});
  const visual = useRef({ opacity: 0, scale: ENTER_SCALE });

  const write = useCallback((): void => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.opacity = String(visual.current.opacity);
    panel.style.transform = `scale(${visual.current.scale})`;
  }, [panelRef]);

  const run = useCallback(
    (target: { opacity: number; scale: number }, duration: number, done?: () => void): void => {
      tween.current();
      const from = { ...visual.current };
      const opening = target.opacity === 1;
      tween.current = glide({
        duration,
        onUpdate: (p) => {
          visual.current = {
            opacity: mix(from.opacity, target.opacity, p),
            scale: mix(from.scale, target.scale, p),
          };
          write();
        },
        onComplete: () => {
          const panel = panelRef.current;
          if (opening) {
            visual.current = { opacity: 1, scale: 1 };
            // 内联的缩放/透明度会盖住后续的尺寸自适应，演完就撤
            if (panel) {
              panel.style.opacity = "";
              panel.style.transform = "";
              panel.style.pointerEvents = "";
            }
          } else if (panel) {
            panel.style.transformOrigin = "";
          }
          done?.();
        },
      });
    },
    [panelRef, write],
  );

  const prime = useCallback((): void => {
    visual.current = { opacity: 0, scale: ENTER_SCALE };
    write();
  }, [write]);

  const enter = useCallback((): void => {
    run({ opacity: 1, scale: 1 }, GLIDE_MOTION.pop);
  }, [run]);

  const exit = useCallback(
    (done: () => void): void => {
      const panel = panelRef.current;
      // 收起动画期间面板还在 DOM 里，不能再吃掉一次点击
      if (panel) panel.style.pointerEvents = "none";
      run({ opacity: 0, scale: ENTER_SCALE }, GLIDE_MOTION.popOut, done);
    },
    [panelRef, run],
  );

  const cancel = useCallback((): void => {
    tween.current();
  }, []);

  useEffect(() => () => tween.current(), []);

  // 返回值要稳定：调用方会把它写进 useCallback/useEffect 的依赖，每次渲染换对象会白挂监听
  return useMemo(() => ({ prime, enter, exit, cancel }), [prime, enter, exit, cancel]);
}
