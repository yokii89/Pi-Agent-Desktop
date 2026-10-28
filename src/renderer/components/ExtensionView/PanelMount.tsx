import { useEffect, useMemo, useRef } from "react";
import type { ViewNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { extensionViewService } from "../../services/extensionViewService";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { extensionPanelTabId, useExtensionViewStore } from "../../stores/extensionViewStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

/** 面板尺寸回传的去抖窗口（docs/06 R5）；拖动侧栏时合并成最后一帧。 */
const LAYOUT_DEBOUNCE_MS = 150;

/** 头部槽节点没有稳定 id 时用类型 + 下标，整组随 placementHint 一起替换。 */
function headerNodeKey(node: ViewNode, index: number): string {
  if ("id" in node && typeof node.id === "string") return `${node.type}:${node.id}`;
  return `${node.type}#${index}`;
}

/**
 * panel 挂载（P1）：右侧上下文栏面板体。
 * 页签关闭只隐藏（live View 继续运行）；此处的「结束面板」才发送 dismiss，
 * 并把对应页签一并收掉（结束是用户明确动作，不是断线重连）。
 */
export function PanelMount({ entry }: { entry: ExtensionViewEntry }) {
  const t = useT();
  const { dismiss, changeValue, sendAction } = useExtensionViewStore();
  const { dispatch } = useUiStore();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (buttonId) => sendAction(entry.id, buttonId, entry.values),
    }),
    [entry.id, entry.values, changeValue, sendAction],
  );

  // 内容盒尺寸回传（docs/06 R5）：挂载即发第一帧，resize 走 150ms 去抖。
  // 用 clientWidth/Height 而不是 borderBox：扩展排版关心的是可用内容宽，
  // 纵向滚动条出现导致 8px 收窄也要如实上报。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    let timer: number | undefined;
    let last: { width: number; height: number } | null = null;
    const send = (): void => {
      const width = body.clientWidth;
      const height = body.clientHeight;
      if (width <= 0) return;
      if (last && last.width === width && last.height === height) return;
      last = { width, height };
      extensionViewService.reportLayout(entry.id, width, height);
    };
    send();
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(send, LAYOUT_DEBOUNCE_MS);
    });
    observer.observe(body);
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [entry.id]);

  const endPanel = (): void => {
    dispatch({
      type: "closeSidebarTab",
      tab: extensionPanelTabId(entry.panelId ?? `ext-${entry.id}`),
    });
    dismiss(entry.id);
  };

  const header = entry.placementHint?.panelHeader;

  return (
    <div className={styles.panel}>
      {header && header.length > 0 ? (
        <div className={styles.panelHeader} data-panel-header="">
          {header.map((node, index) => (
            <ViewNodeRenderer key={headerNodeKey(node, index)} node={node} bridge={bridge} />
          ))}
        </div>
      ) : null}
      <div ref={bodyRef} className={styles.panelBody} data-panel-scroll="">
        <ViewNodeRenderer node={entry.root} bridge={bridge} />
      </div>
      {entry.actions.length > 0 ? (
        <div className={styles.panelFooter}>
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
      <div className={styles.panelCloseRow}>
        <Button variant="default" className={styles.ghostAction} onClick={endPanel}>
          {t("ui.view.closePanel")}
        </Button>
      </div>
    </div>
  );
}
