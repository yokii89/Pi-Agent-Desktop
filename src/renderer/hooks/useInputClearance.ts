import { type RefObject, useEffect } from "react";

/**
 * 把悬浮输入栏实测高度写入容器的 `--session-input-height`，
 * 供底部留白 `--session-input-clearance` 推导（tokens.css）。
 *
 * 输入栏会随多行草稿 / 附件 / 扩展 widget 长高：留白必须跟实测高度走，
 * 否则末尾正文会被压在输入栏下且滚不出来（docs/design/10 C4）。
 */
export function useInputClearance(
  containerRef: RefObject<HTMLElement | null>,
  inputRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const input = inputRef.current;
    if (!container || !input) return;

    const apply = (): void => {
      container.style.setProperty("--session-input-height", `${input.offsetHeight}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(input);
    return () => {
      observer.disconnect();
      container.style.removeProperty("--session-input-height");
    };
  }, [containerRef, inputRef, enabled]);
}
