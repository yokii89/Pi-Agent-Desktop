import { X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/**
 * widget 挂载：
 * - 停靠态（缺省）：输入框上方/下方条状区，高度建议 ≤96px，内部滚动。
 * - 浮层态（placementHint.floating）：对齐输入栏 @ 菜单，absolute 覆盖层，
 *   不参与输入栈布局；表单类内容可用更高滚动区。
 */
export function WidgetMount({
  entry,
  side,
}: {
  entry: ExtensionViewEntry;
  side: "aboveEditor" | "belowEditor";
}) {
  const t = useT();
  const { dismiss, changeValue, sendAction } = useExtensionViewStore();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 浮层表单弹出即抢焦点（对齐 @ 菜单行为），落点优先激活 tab 面板内的
  // 第一个可交互元素；停靠条不抢，避免打断编辑中的输入。
  // entry.floating 既是开关也是边沿信号：同视图的整树 update 不重跑本 effect。
  useEffect(() => {
    if (!entry.floating) return;
    const body = bodyRef.current;
    if (!body) return;
    const scope = body.querySelector<HTMLElement>("[data-tab-panel]:not([hidden])") ?? body;
    const first = scope.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    first?.focus();
  }, [entry.floating]);

  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (buttonId) => sendAction(entry.id, buttonId, entry.values),
    }),
    [entry.id, entry.values, changeValue, sendAction],
  );

  const classNames = [styles.widget, entry.floating ? styles.widgetFloating : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classNames}
      data-view-id={entry.id}
      data-side={side}
      data-floating={entry.floating ? "true" : undefined}
    >
      <div className={styles.widgetHeader}>
        <span className={styles.widgetTitle}>{entry.title || t("ui.view.fallbackTitle")}</span>
        <IconButton title={t("common.close")} onClick={() => dismiss(entry.id)}>
          <X size={14} weight="regular" />
        </IconButton>
      </div>
      <div ref={bodyRef} className={styles.widgetBody}>
        <ViewNodeRenderer node={entry.root} bridge={bridge} />
      </div>
      {entry.actions.length > 0 ? (
        <div className={styles.widgetFooter}>
          {entry.actions.map((action) => {
            const variant =
              action.variant === "primary"
                ? "primary"
                : action.variant === "danger"
                  ? "danger"
                  : "default";
            return (
              <Button
                key={action.id}
                variant={variant}
                disabled={action.disabled}
                onClick={() => sendAction(entry.id, action.id, entry.values, action.kind)}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
