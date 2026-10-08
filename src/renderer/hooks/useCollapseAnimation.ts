import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { loadGsap, prefersReducedMotion } from "../utils/animation";
import { NAV_MOTION } from "../utils/motionTokens";

/** 折叠容器与内容元素都只需读高度，故收窄到 HTMLElement。 */
type CollapsibleElement = HTMLElement;

interface CollapseAnimation<E extends CollapsibleElement, I extends CollapsibleElement> {
  /** 绑到会被展开/折叠的块级元素（承载高度补间）。 */
  ref: RefObject<E | null>;
  /** 绑到内部内容元素，用于测量内容高度。 */
  innerRef: RefObject<I | null>;
  /** 折叠动画结束后置为 false，可用于清空仅展开时才需要的状态（如"显示更多"）。 */
  rendered: boolean;
}

/**
 * 容器展开/折叠动画：把被折叠的元素交给本 Hook，动画期间由 GSAP 接管高度，
 * 结束后恢复自动高度并移除内联样式，DOM 上不留残留。
 *
 * 为什么不用 CSS `grid-template-rows: 0fr → 1fr` 或过渡 `height: auto`：
 * 前者在起始值为 0fr 时 Chromium 不补间（内容是瞬变），后者 auto 不可插值。
 * 用 GSAP 把高度补间到实测像素值对任意内容都稳定。
 *
 * 折叠时不能立刻卸载 DOM（否则无从播放收起的补间），所以是否渲染由内部
 * `rendered` 状态决定，而不是直接跟随 `expanded`。因此**调用方必须先渲染
 * 容器（用 rendered 判断），再依赖本 Hook 完成动画**，不要在动画期间卸载。
 *
 * 泛型参数由调用方声明真实元素类型（如 <div> 容器 + <ul> 内容）：
 * RefObject 在 TS 中是不变的，不能用宽类型顶替窄类型。
 *
 * 内容元素不得带外边距（margin 不计入 offsetHeight，会造成漏测），
 * 需要间距请用内层 padding / gap。
 * 展开目标高度取 offsetHeight（实际渲染盒），不要用 scrollHeight：
 * 内层若带 max-height + overflow，scrollHeight 是未截断全文高度，会把外层撑爆，
 * settle 摘掉内联 height 后再跳回真实高度，表现为展开时页面闪一下。
 */
export function useCollapseAnimation<
  E extends CollapsibleElement = HTMLDivElement,
  I extends CollapsibleElement = HTMLElement,
>(expanded: boolean, options?: { onCollapsed?: () => void }): CollapseAnimation<E, I> {
  const ref = useRef<E>(null);
  const innerRef = useRef<I>(null);
  const firstRun = useRef(true);
  const lastExpanded = useRef(expanded);
  const onCollapsed = useRef(options?.onCollapsed);
  onCollapsed.current = options?.onCollapsed;
  const [rendered, setRendered] = useState(expanded);

  useLayoutEffect(() => {
    const element = ref.current;
    const inner = innerRef.current;

    // 收起时 DOM 必须存在才能播补间；若此刻还没渲染（如父层同步折叠），直接跳到终态
    if (!element || !inner) {
      firstRun.current = false;
      setRendered(expanded);
      return;
    }

    // 首次挂载不播动画：避免应用启动时侧栏整体生长，也避免初始折叠态先闪一下
    if (firstRun.current) {
      firstRun.current = false;
      lastExpanded.current = expanded;
      if (expanded !== rendered) setRendered(expanded);
      return;
    }
    // 状态回退到与上一轮相同的值时（React 18 严格模式的双调用）不重播动画
    if (lastExpanded.current === expanded) return;
    lastExpanded.current = expanded;

    const settle = (): void => {
      element.style.removeProperty("height");
      element.style.removeProperty("overflow");
      element.style.removeProperty("will-change");
      setRendered(expanded);
      if (!expanded) onCollapsed.current?.();
    };

    if (prefersReducedMotion()) {
      settle();
      return;
    }

    // 实际渲染高度（受 max-height 约束）；scrollHeight 会拿到溢出内容的完整高度
    const contentHeight = inner.offsetHeight;
    // 展开：0 → 内容高；收起：当前实际高 → 0。方向必须显式区分，
    // 否则收起会朝内容高补间（看起来"纹丝不动然后消失"）。
    const from = expanded ? 0 : element.offsetHeight;
    const to = expanded ? contentHeight : 0;
    // 同步写入起始高度（在 setRendered 触发重渲染之前），避免 React 提交后闪现完整高度
    element.style.overflow = "hidden";
    element.style.willChange = "height, opacity";
    element.style.height = `${from}px`;

    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (cancelled || !element.isConnected) return;
      // 补间期间若用户再次点击，新 timeline 会从当前高度接管，不会跳变
      gsap
        .timeline({ onComplete: settle })
        .to(element, {
          height: to,
          duration: expanded ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit,
          ease: expanded ? NAV_MOTION.easeOut : NAV_MOTION.easeIn,
        })
        .fromTo(
          inner,
          { opacity: expanded ? 0 : 1 },
          {
            opacity: expanded ? 1 : 0,
            duration: NAV_MOTION.fade,
            ease: NAV_MOTION.easeOut,
          },
          "<",
        );
    });

    return () => {
      cancelled = true;
    };
  }, [expanded, rendered]);

  return { ref, innerRef, rendered };
}
