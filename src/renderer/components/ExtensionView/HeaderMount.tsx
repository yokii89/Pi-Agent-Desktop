import { useMemo } from "react";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { Button } from "../ui/Button";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/**
 * header 挂载：顶栏紧凑条。只展示紧凑控件；复杂树由主进程已降级。
 * 不抢焦点；关闭通过 ghost 按钮 dismiss。
 */
export function HeaderMount({ entry }: { entry: ExtensionViewEntry }) {
  const t = useT();
  const { dismiss, changeValue, sendAction } = useExtensionViewStore();

  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (buttonId) => sendAction(entry.id, buttonId, entry.values),
    }),
    [entry.id, entry.values, changeValue, sendAction],
  );

  return (
    <div
      className={styles.headerSlot}
      data-view-id={entry.id}
      // 顶栏是拖拽区：槽位本身 no-drag，避免点按钮变成拖窗口
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      title={entry.title || t("ui.view.fallbackTitle")}
    >
      <ViewNodeRenderer node={entry.root} bridge={bridge} />
      {entry.actions.length > 0
        ? entry.actions.slice(0, 2).map((action) => (
            <Button
              key={action.id}
              variant={action.variant === "primary" ? "primary" : "default"}
              disabled={action.disabled}
              className={styles.headerAction}
              onClick={() => sendAction(entry.id, action.id, entry.values, action.kind)}
            >
              {action.label}
            </Button>
          ))
        : null}
      <Button
        variant="default"
        className={styles.headerDismiss}
        onClick={() => dismiss(entry.id)}
        title={t("common.close")}
        aria-label={
          entry.title
            ? t("ui.view.closeTitled", { title: entry.title })
            : t("ui.view.closeExtension")
        }
      >
        ×
      </Button>
    </div>
  );
}
