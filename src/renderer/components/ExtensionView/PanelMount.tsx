import { useMemo, useRef } from "react";
import type { ViewNode } from "../../../shared/view";
import { useExtensionViewLayout } from "../../hooks/useExtensionViewLayout";
import { useT } from "../../hooks/useT";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { extensionPanelTabId, useExtensionViewStore } from "../../stores/extensionViewStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { AgentWorkspaceView } from "./AgentWorkspaceView";
import { BashWorkspaceView } from "./BashWorkspaceView";
import styles from "./ExtensionView.module.css";
import { type ViewFormBridge, ViewNodeRenderer } from "./ViewNodeRenderer";

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
  const {
    dismiss,
    changeValue,
    sendAction,
    floatingWorkspaceIds,
    floatWorkspace,
    dockWorkspace,
    getWorkspaceMemory,
    getBashWorkspaceMemory,
  } = useExtensionViewStore();
  const { dispatch } = useUiStore();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isAgentWorkspace = entry.root.type === "agent-workspace";
  const isBashWorkspace = entry.root.type === "bash-workspace";
  const isWorkspace = isAgentWorkspace || isBashWorkspace;
  const floating = isWorkspace && floatingWorkspaceIds.has(entry.id);
  useExtensionViewLayout(entry.id, bodyRef, !floating);

  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      actions: entry.actions,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (buttonId) => sendAction(entry.id, buttonId, entry.values),
    }),
    [entry.id, entry.values, entry.actions, changeValue, sendAction],
  );

  const endPanel = (): void => {
    dispatch({
      type: "closeSidebarTab",
      tab: extensionPanelTabId(entry.panelId ?? `ext-${entry.id}`),
    });
    dismiss(entry.id);
  };

  const header = entry.placementHint?.panelHeader;

  if (floating) {
    return (
      <div className={styles.workspacePlaceholder}>
        <p data-selectable-text="">
          {t(isBashWorkspace ? "bashWorkspace.floatingHint" : "agentWorkspace.floatingHint")}
        </p>
        <Button onClick={() => dockWorkspace(entry.id)}>
          {t(isBashWorkspace ? "bashWorkspace.collapse" : "agentWorkspace.collapse")}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {header && header.length > 0 ? (
        <div className={styles.panelHeader} data-panel-header="">
          {header.map((node, index) => (
            <ViewNodeRenderer key={headerNodeKey(node, index)} node={node} bridge={bridge} />
          ))}
        </div>
      ) : null}
      <div
        ref={bodyRef}
        className={[styles.panelBody, isWorkspace ? styles.workspaceBody : ""].join(" ")}
        data-panel-scroll=""
        data-selectable-text=""
      >
        {entry.root.type === "agent-workspace" ? (
          <AgentWorkspaceView
            key={entry.id}
            node={entry.root}
            bridge={bridge}
            memory={getWorkspaceMemory(entry.id, entry.root.id)}
            floating={false}
            onToggleFloating={() => floatWorkspace(entry.id)}
          />
        ) : entry.root.type === "bash-workspace" ? (
          <BashWorkspaceView
            key={entry.id}
            viewId={entry.id}
            node={entry.root}
            bridge={bridge}
            memory={getBashWorkspaceMemory(entry.id, entry.root.id)}
            floating={false}
            onToggleFloating={() => floatWorkspace(entry.id)}
          />
        ) : (
          <ViewNodeRenderer key={entry.id} node={entry.root} bridge={bridge} />
        )}
      </div>
      {entry.actions.length > 0 && !isBashWorkspace ? (
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
      {!isWorkspace ? (
        <div className={styles.panelCloseRow}>
          <Button variant="default" className={styles.ghostAction} onClick={endPanel}>
            {t("ui.view.closePanel")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
