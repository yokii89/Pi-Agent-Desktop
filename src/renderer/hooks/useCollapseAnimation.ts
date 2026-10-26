import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
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
 * 容器展开/折叠动画：把被折叠的元素交给本 Hook，动画期间由定帧时间轴接管高度，
 * 结束后恢复自动高度并移除内联样式，DOM 上不留残留。
 *
 * 为什么不用 CSS `grid-template-rows: 0fr → 1fr` 或过渡 `height: auto`：
 * 前者在起始值为 0fr 时 Chromium 不补间（内容是瞬变），后者 auto 不可插值。
 * 用补间到实测像素值对任意内容都稳定。
 *
 * 为什么不是 GSAP：高度补间逐帧触发祖先重排，是纯粹的布局动画；
 * GSAP ticker 跟随屏幕刷新率，120/144Hz 上会把同一段补间跑成 120–144 次布局。
 * 这里改用浮层/侧栏共用的 glide() 定帧时间轴（封顶 GLIDE_MOTION.fps），
 * 与 docs/design/53 的尺寸补间同一条曲线；同时省掉首次展开等 GSAP chunk 的下载延迟。
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
  /** 在跑的补间（高度 + 内容淡入淡出）；切换方向时先停旧补间再从当前视觉值接管。 */
  const cancelRef = useRef<GlideCancel | null>(null);

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

    cancelRef.current?.();
    cancelRef.current = null;

    const settle = (): void => {
      cancelRef.current = null;
      if (expanded) {
        element.style.removeProperty("height");
        element.style.removeProperty("overflow");
        element.style.removeProperty("will-change");
        inner.style.removeProperty("opacity");
      } else {
        // 收起落定后**先保持高度 0 / 透明度 0**，再交出渲染权：settle 在 rAF 里执行，
        // setRendered(false) 要等 React 下一次提交才卸载容器；若此刻摘掉内联高度，
        // 浏览器可能先画一帧 height:auto 的满高列表，表现为收起后闪一下。
        // 容器随后被卸载，内联样式随之消失；万一调用方仍保留节点，它也只是保持收起态。
        element.style.height = "0px";
        element.style.setProperty("overflow", "hidden");
        element.style.removeProperty("will-change");
        inner.style.opacity = "0";
      }
      inner.style.removeProperty("will-change");
      setRendered(expanded);
      if (!expanded) onCollapsed.current?.();
    };

    // 实际渲染高度（受 max-height 约束）；scrollHeight 会拿到溢出内容的完整高度
    const contentHeight = inner.offsetHeight;
    // 起点取「当前视觉高度」：首次展开从 0 起；收起或半途反向都从实际盒高接着演，
    // 否则补间进行中再点击会把高度瞬间拉回 0/满高，肉眼就是一次跳变
    const from = expanded
      ? element.style.height
        ? element.offsetHeight
        : 0
      : element.offsetHeight;
    const to = expanded ? contentHeight : 0;
    // 半途反向时透明度也从当前值接着演；透明度只在补间期间写内联，落定即摘除
    const opacityFrom =
      inner.style.opacity === "" ? (expanded ? 0 : 1) : Number(inner.style.opacity);

    // 同步写入起始值（在浏览器绘制之前），避免 React 提交后闪现完整高度
    element.style.overflow = "hidden";
    element.style.willChange = "height";
    element.style.height = `${from}px`;
    inner.style.willChange = "opacity";
    inner.style.opacity = String(opacityFrom);

    const duration = expanded ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit;
    const cancels: GlideCancel[] = [];
    cancels.push(
      glide({
        duration,
        onUpdate: (progress) => {
          element.style.height = `${mix(from, to, progress)}px`;
        },
        onComplete: settle,
      }),
    );
    // 内容淡入淡出比高度先收尾（两段补间同帧启动，与原来的 timeline 同构）
    cancels.push(
      glide({
        duration: Math.min(NAV_MOTION.fade, duration),
        onUpdate: (progress) => {
          inner.style.opacity = String(mix(opacityFrom, expanded ? 1 : 0, progress));
        },
      }),
    );
    cancelRef.current = () => {
      for (const cancel of cancels) cancel();
    };

    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [expanded, rendered]);

  return { ref, innerRef, rendered };
}
