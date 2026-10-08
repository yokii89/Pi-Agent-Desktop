import type { ComponentProps } from "react";
import styles from "./Button.module.css";

type ButtonProps = ComponentProps<"button"> & {
  /** primary = 强调主操作；danger = 破坏性操作（卸载/丢弃）。 */
  variant?: "default" | "primary" | "danger";
};

/** 文本按钮：设置页与空态入口使用。 */
export function Button({ variant = "default", className, children, ref, ...rest }: ButtonProps) {
  const variantClass =
    variant === "primary" ? styles.primary : variant === "danger" ? styles.danger : "";
  const cls = [styles.button, variantClass, className ?? ""].join(" ").trim();
  return (
    <button type="button" ref={ref} className={cls} {...rest}>
      {children}
    </button>
  );
}
