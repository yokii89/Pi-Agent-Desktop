import { type ReactNode, useEffect, useRef } from "react";
import type { BuddyPose } from "./buddyPose";
import { animateBuddyThinking } from "./buddyThinking";
import styles from "./InputBuddy.module.css";

/** 所有形象接收同一组姿态，不读取业务 store，也不自行维护计时器。 */
export interface BuddyArtworkProps {
  pose: BuddyPose;
  /** 设置缩略图与静态姿态表关闭动画，保留相同的五官与姿态。 */
  animated?: boolean;
}

interface BuddySvgProps extends BuddyArtworkProps {
  className: string;
  children: ReactNode;
}

/** 统一画布、描边与装饰语义；y=203 是输入卡沿，读屏标签由外层控件提供。 */
export function BuddySvg({ pose, animated = true, className, children }: BuddySvgProps) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!animated || pose !== "thinking" || !ref.current) return;
    return animateBuddyThinking(ref.current);
  }, [animated, pose]);

  return (
    <svg
      ref={ref}
      className={`${styles.art} ${className}`}
      data-pose={pose}
      data-motion={animated ? undefined : "still"}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  );
}
