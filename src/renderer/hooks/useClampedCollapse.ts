import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type GlideCancel, glide, mix } from "../utils/glideMotion";
import { NAV_MOTION } from "../utils/motionTokens";

/**
 * 收起后仍保留的可见行数（docs/design/144）。
 *
 * 只夹「行数」，不夹像素：行高跟设置里的「对话流字号」（`--session-stream-font-md`）
 * 一起变，写死 px 会在改字号后夹到半行，露出被切掉的半截字形。
 */
export const USER_BUBBLE_COLLAPSED_LINES = 4;

interface ClampedCollapse {
  /** 绑到承载裁剪高度的元素（`.bubbleBody`）。 */
  ref: RefObject<HTMLDivElement | null>;
  /** 绑到被测量的内容元素，用于取完整高度与行高。 */
  innerRef: RefObject<HTMLDivElement | null>;
  /** 内容是否真的超过了折叠高度——不足时气泡不长出任何折叠痕迹。 */
  collapsible: boolean;
}

/**
 * 把正文裁剪到 {@link USER_BUBBLE_COLLAPSED_LINES} 行，展开时补间回完整高度。
 *
 * 为什么不复用 `useCollapseAnimation`：那个 Hook 的终态是「高度 0 + 内容整体淡出 + 交给
 * 调用方卸载容器」，用于列表 / 分区这类**整块进出**；这里收起后仍要显示前 N 行，内容不能
 * 淡出（淡出的是底部那层渐隐），也永远不卸载。两者终态不同，合并会让两边都变绕。
 * 共用的部分仍是同一条 `glide()` 定帧时间轴与 `NAV_MOTION` 时长，观感与侧栏 / 终端栏同源。
 *
 * 折叠高度按行高换算，必须等字体与行高落到计算样式上再量，所以测量放在 layout effect
 * （绘制前完成，首次出现不会闪一帧全文）；后续尺寸变化（窗口缩放、字号设置、换主题带来的
 * 字重变化）由 ResizeObserver 重新核对——只量一次会在重开会话或改字号后误判。
 */
export function useClampedCollapse(expanded: boolean): ClampedCollapse {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const [collapsible, setCollapsible] = useState(false);
  /** 收起补间中的取消句柄：中途反向时先停旧补间，再从当前视觉高度接管。 */
  const cancelRef = useRef<GlideCancel | null>(null);
  const firstRun = useRef(true);
  const lastExpanded = useRef(expanded);

  const measure = useCallback(() => {
    const clip = ref.current;
    const inner = innerRef.current;
    if (!clip || !inner) return;
    const lineHeight = Number.parseFloat(getComputedStyle(inner).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    // 内容高度与被裁剪盒的内联高度无关（overflow: hidden 只裁可见区，不压内容盒），
    // 所以不必先摘掉 height 再量，量到的就是完整高度。
    const natural = inner.offsetHeight;
    const clamp = Math.round(lineHeight * USER_BUBBLE_COLLAPSED_LINES);
    // 阈值留 1px 容差：亚像素行高下 `4 × 25.6` 与实测高度会差一两个小数位，
    // 不留容差会让刚好 4 行的消息长出「展开全文」。
    setCollapsedHeight(clamp);
    setCollapsible(natural > clamp + 1);
  }, []);

  useLayoutEffect(() => {
    measure();
    const inner = innerRef.current;
    if (!inner) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(inner);
    return () => observer.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    const clip = ref.current;
    const inner = innerRef.current;
    if (!clip || !inner) return;

    // 内容没超过折叠高度：交还自动高度，气泡与普通消息完全一样
    if (!collapsible) {
      clip.style.removeProperty("height");
      clip.style.removeProperty("will-change");
      firstRun.current = false;
      lastExpanded.current = expanded;
      return;
    }

    const target = expanded ? inner.offsetHeight : collapsedHeight;
    // 首次测量落位与「测量结果变化」（缩放窗口让行数够了 / 不够了）都直接落终态：
    // 那些变化不是用户点击引起的，播动画会像界面自己在抽搐。
    const animate = !firstRun.current && lastExpanded.current !== expanded;
    firstRun.current = false;
    lastExpanded.current = expanded;

    cancelRef.current?.();
    cancelRef.current = null;

    if (!animate) {
      if (expanded) clip.style.removeProperty("height");
      else clip.style.height = `${target}px`;
      clip.style.removeProperty("will-change");
      return;
    }

    // 起点取「当前视觉高度」：收起态有内联高度，展开态是自动高度（= 完整高度）
    const from = clip.offsetHeight;
    clip.style.willChange = "height";
    clip.style.height = `${from}px`;
    cancelRef.current = glide({
      duration: expanded ? NAV_MOTION.collapseEnter : NAV_MOTION.collapseExit,
      onUpdate: (progress) => {
        clip.style.height = `${mix(from, target, progress)}px`;
      },
      onComplete: () => {
        cancelRef.current = null;
        clip.style.removeProperty("will-change");
        // 展开落定后交还自动高度：响应式换行、字号变化都不必再回来改内联值
        if (expanded) clip.style.removeProperty("height");
        else clip.style.height = `${target}px`;
      },
    });

    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [expanded, collapsible, collapsedHeight]);

  return { ref, innerRef, collapsible };
}
