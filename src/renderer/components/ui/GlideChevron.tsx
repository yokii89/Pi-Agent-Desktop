import { CaretDown, type IconWeight } from "@phosphor-icons/react";

/**
 * 下拉箭头：翻转角由 Popover 在 30fps 时间轴上写进 `--gs-chev`（docs/design/51）。
 * 静息值 0deg，所以 JS 不跑也朝下——箭头方向不能只依赖脚本。
 */
export function GlideChevron({
  size = 12,
  weight = "regular",
  className,
}: {
  size?: number;
  weight?: IconWeight;
  className?: string;
}) {
  return (
    <CaretDown
      size={size}
      weight={weight}
      className={className}
      style={{ transform: "rotate(var(--gs-chev, 0deg))" }}
    />
  );
}
