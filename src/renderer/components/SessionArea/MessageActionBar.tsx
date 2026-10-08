import type { Icon } from "@phosphor-icons/react";
import styles from "./MessageActionBar.module.css";

export interface MessageAction {
  key: string;
  label: string;
  /** 悬浮提示（默认用 label）。 */
  title?: string;
  icon: Icon;
  onClick: () => void;
}

/**
 * 消息级操作条（docs/design/13 P1-6）：AI 回复的复制/引用、用户消息的复制/重发。
 * 常驻 chrome 不加——揭示由宿主容器负责（hover / :focus-within，键盘可达），
 * 本组件只负责条目外观；宿主把占位类名（通常 height:0 不占布局）传入 className。
 */
export function MessageActionBar({
  items,
  className,
}: {
  items: MessageAction[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={[styles.bar, className].filter(Boolean).join(" ")}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={styles.action}
          title={item.title ?? item.label}
          onClick={item.onClick}
        >
          <item.icon size={14} weight="regular" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
