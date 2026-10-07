import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import styles from "./IconButton.module.css";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称 / 悬停提示。 */
  title: string;
  /** 高亮（对应功能开启中）。 */
  active?: boolean;
  children: ReactNode;
}

/** 图标按钮：顶栏 / 侧栏 / 面板通用的最小交互单元。 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { title, active = false, className, children, ...rest },
  ref,
) {
  const cls = [styles.button, active ? styles.active : "", className ?? ""].join(" ").trim();
  return (
    <button ref={ref} type="button" title={title} aria-label={title} className={cls} {...rest}>
      {children}
    </button>
  );
});
