import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
import { NAV_MOTION } from "../utils/motionTokens";

interface SidebarCollapse {
  /** 绑到三栏网格根元素（.app）：补间直接写它上面的 --context-sidebar-width。 */
  ref: RefObject<HTMLDivElement | null>;
  /** 视觉上处于展开态（含收起补间进行中）：aside 保持挂载，sidebarClosed 类不生效。 */
  mounted: boolean;
  /** 收起补间已落定：此时才套 sidebarClosed（轨道归 0）并卸载 aside。 */
  closed: boolean;
}

/**
 * 右侧上下文侧栏的收起/展开：在浮层同一条定帧时间轴（封顶 60fps）上，
 * 用下拉曲线（glide() 的默认缓动 = GLIDE_MOTION.easeOut）补间根元素上的
 * `--context-sidebar-width`。网格 aside 轨道与侧栏自身宽度吃同一个变量，
 * 一处补间两处跟随；写入方式与拖拽把手同路（直写根元素内联变量，不经 React 渲染），
 * 拖拽与收展补间操作的是同一个属性，互相衔接不跳变。
 *
 * 收起不能立刻卸载 aside（否则无从播放补间）：补间落定才卸载并套 sidebarClosed；
 * 展开则先挂载，从内联变量里的当前视觉宽度（收起后为 0）起跳。
 * 首次挂载不播动画（应用启动不生长）；再次切换时取消旧补间、从当前视觉值接管。
 * 命中 prefers-reduced-motion 时由 glide() 直接落终态。
 */
export function useContextSidebarCollapse(expanded: boolean, width: number): SidebarCollapse {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(expanded);
  const [closed, setClosed] = useState(!expanded);
  const firstRun = useRef(true);
  const lastExpanded = useRef(expanded);
  /** 补间的目标宽度取切换时刻的 store 值；width 变化（拖拽提交）不重播补间。 */
  const widthRef = useRef(width);
  widthRef.current = width;
  const cancelRef = useRef<GlideCancel | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    if (firstRun.current) {
      firstRun.current = false;
      lastExpanded.current = expanded;
      return;
    }
    if (lastExpanded.current === expanded) return;
    lastExpanded.current = expanded;

    cancelRef.current?.();
    cancelRef.current = null;

    if (expanded) {
      setMounted(true);
      setClosed(false);
    }

    // 当前视觉宽度以内联变量为准：React 提交的 store 宽度、拖拽把手的实时写入、
    // 上一段被中断的补间都落在同一个属性上，从它起跳就不会跳变。
    const from = Number.parseFloat(root.style.getPropertyValue("--context-sidebar-width")) || 0;
    const to = expanded ? widthRef.current : 0;
    root.style.setProperty("--context-sidebar-width", `${from}px`);

    cancelRef.current = glide({
      duration: expanded ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit,
      onUpdate: (progress) => {
        root.style.setProperty("--context-sidebar-width", `${mix(from, to, progress)}px`);
      },
      onComplete: () => {
        cancelRef.current = null;
        root.style.setProperty("--context-sidebar-width", `${to}px`);
        if (expanded) {
          setClosed(false);
        } else {
          setClosed(true);
          setMounted(false);
        }
      },
    });

    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [expanded]);

  return { ref, mounted, closed };
}
