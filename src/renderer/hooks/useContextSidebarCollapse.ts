import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
import { NAV_MOTION } from "../utils/motionTokens";
import { panelGeometry, writePanelGeometry } from "../utils/panelGeometry";

interface SidebarCollapse {
  /** 绑到三栏网格根元素（.app）：补间直接写它的 grid-template-columns 与侧栏宽度。 */
  ref: RefObject<HTMLDivElement | null>;
  /** 视觉上处于展开态（含收起补间进行中）：aside 保持挂载，sidebarClosed 类不生效。 */
  mounted: boolean;
  /** 收起补间已落定：此时才套 sidebarClosed（轨道归 0）并卸载 aside。 */
  closed: boolean;
}

/**
 * 右侧上下文侧栏的收起/展开：在浮层同一条定帧时间轴（封顶 60fps）上，
 * 用下拉曲线（glide() 的默认缓动 = GLIDE_MOTION.easeOut）补间侧栏宽度。
 * 走 `utils/panelGeometry` 直写网格轨道与侧栏宽度，**不写继承型自定义属性**——
 * 后者每帧会让整棵文档树样式失效（实测 ~5ms/次，见 panelGeometry.ts 文件头）。
 *
 * 收起不能立刻卸载 aside（否则无从播放补间）：补间落定才卸载并套 sidebarClosed；
 * 展开则先挂载，从当前视觉宽度（收起后为 0）起跳。
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
      // 首次挂载直接落终态（与 CSS 变量同值，只是把视觉宽度记进 panelGeometry）
      writePanelGeometry(root, { sidebar: expanded ? widthRef.current : 0 });
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

    // 当前视觉宽度以 panelGeometry 为准：拖拽、上一段被中断的补间都落在同一个状态上
    const from = panelGeometry().sidebar;
    const to = expanded ? widthRef.current : 0;

    cancelRef.current = glide({
      duration: expanded ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit,
      onUpdate: (progress) => {
        writePanelGeometry(root, { sidebar: mix(from, to, progress) });
      },
      onComplete: () => {
        cancelRef.current = null;
        // 展开落点取「此刻的 store 宽度」而不是切换时的快照：补间途中窗口变窄被夹取时
        // （ContextSidebar 的 clamp 会写 DOM 再 dispatch），内联宽度得跟着 store 收敛，
        // 否则会停在夹取前的那一档
        writePanelGeometry(root, { sidebar: expanded ? widthRef.current : 0 });
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
