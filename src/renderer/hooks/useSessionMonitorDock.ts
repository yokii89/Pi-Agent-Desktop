import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
import { NAV_MOTION } from "../utils/motionTokens";
import { panelGeometry, writePanelGeometry } from "../utils/panelGeometry";

/**
 * 监控卡停靠层的宽度（px）：**与右侧上下文侧栏同宽**。
 *
 * 这个值同时是两层契约：
 * 1. 卡片自身的宽度 = 它减 16px（8px 滚动条槽 + 8px 呼吸），见 SessionMonitor.module.css；
 * 2. 正文让位量 = 它，所以侧栏开/关两种状态下文档流的内容区宽度完全一致（列宽不跳）。
 *
 * 卡停靠层是绝对定位覆盖层（不是并列的 flex 列），否则滚动条会被挤到屏幕中间。
 */
export const SESSION_MONITOR_DOCK_WIDTH = 300;

/**
 * 监控卡所在停靠位的宽度让位（docs/design/96）：
 * 在浮层同一条定帧时间轴（封顶 60fps）上补间停靠层宽度，
 * 与 `useContextSidebarCollapse` 的侧栏宽度恰好互补——
 *
 * 侧栏收起（collapseExit）的同时监控卡以同一时长长出来，侧栏展开（collapseEnter）
 * 的同时监控卡以同一时长让位。两条补间同曲线同时长，中央区宽度的变化互相抵消，
 * 会话文档流的列宽在开/关侧栏之间不跳。所以这里的时长不是"随手挑的节奏"，
 * 而是必须取侧栏那一侧的对称值，改一边就要改另一边。
 *
 * 写入走 `utils/panelGeometry`（直写各消费元素），不写继承型自定义属性：
 * 后者每帧让整棵文档树样式失效，见 panelGeometry.ts 文件头。
 *
 * 非侧栏原因引起的显隐（切页、会话回到空态）不播动画：那些切换本来就瞬时完成，
 * 再补一段宽度变化只会让新页面被挤一下。
 */
export function useSessionMonitorDock(
  rootRef: RefObject<HTMLDivElement | null>,
  visible: boolean,
  animated: boolean,
): boolean {
  const [mounted, setMounted] = useState(visible);
  const lastVisible = useRef(visible);
  const firstRun = useRef(true);
  const cancelRef = useRef<GlideCancel | null>(null);
  /**
   * `animated` 只取「切换那一刻」的值，不进 effect 依赖：它变（切页、回到空态）
   * 而 visible 没变时，重跑 effect 会先在 cleanup 里取消掉在途补间，再撞上
   * `lastVisible === visible` 直接返回——宽度就永久停在中间值、`mounted` 也卡住。
   */
  const animatedRef = useRef(animated);
  animatedRef.current = animated;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (firstRun.current) {
      firstRun.current = false;
      lastVisible.current = visible;
      // 首次挂载直接落在终态：应用启动不该演一遍"卡片长出来"
      writePanelGeometry(root, { monitor: visible ? SESSION_MONITOR_DOCK_WIDTH : 0 });
      return;
    }
    if (lastVisible.current === visible) return;
    lastVisible.current = visible;

    cancelRef.current?.();
    cancelRef.current = null;

    const to = visible ? SESSION_MONITOR_DOCK_WIDTH : 0;
    if (!animatedRef.current) {
      writePanelGeometry(root, { monitor: to });
      setMounted(visible);
      return;
    }

    // 当前视觉宽度以 panelGeometry 为准：被中断的上一段补间也落在同一个状态上
    const from = panelGeometry().monitor;
    if (visible) setMounted(true);

    cancelRef.current = glide({
      duration: visible ? NAV_MOTION.collapseExit : NAV_MOTION.collapseEnter,
      onUpdate: (progress) => {
        writePanelGeometry(root, { monitor: mix(from, to, progress) });
      },
      onComplete: () => {
        cancelRef.current = null;
        writePanelGeometry(root, { monitor: to });
        if (!visible) setMounted(false);
      },
    });

    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [visible, rootRef]);

  /**
   * 停靠层先 `setMounted`、下一拍才进 DOM：非动画路径写宽度时元素可能还不存在，
   * 挂载完成后再按当前视觉值补一次，否则卡片会停在 CSS 兜底的 0 宽。
   */
  useLayoutEffect(() => {
    if (mounted) writePanelGeometry(rootRef.current, { monitor: panelGeometry().monitor });
  }, [mounted, rootRef]);

  return mounted;
}
