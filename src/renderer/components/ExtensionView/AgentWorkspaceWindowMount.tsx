import { useMemo, useRef } from "react";
import { useExtensionViewLayout } from "../../hooks/useExtensionViewLayout";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { AgentWorkspaceView } from "./AgentWorkspaceView";
import type { ViewFormBridge } from "./ViewNodeRenderer";

/** Keep the live workspace mounted at the app root while its sidebar tab is absent. */
export function AgentWorkspaceWindowMount({ entry }: { entry: ExtensionViewEntry }) {
  const { changeValue, sendAction, dockWorkspace, getWorkspaceMemory } = useExtensionViewStore();
  const contentRef = useRef<HTMLDivElement>(null);
  useExtensionViewLayout(entry.id, contentRef);
  const bridge = useMemo<ViewFormBridge>(
    () => ({
      values: entry.values,
      actions: entry.actions,
      onChange: (nodeId, value) => changeValue(entry.id, nodeId, value),
      onButtonAction: (actionId) => sendAction(entry.id, actionId, entry.values),
    }),
    [entry.id, entry.values, entry.actions, changeValue, sendAction],
  );
  if (entry.root.type !== "agent-workspace") return null;
  return (
    <AgentWorkspaceView
      node={entry.root}
      bridge={bridge}
      memory={getWorkspaceMemory(entry.id, entry.root.id)}
      floating
      onToggleFloating={() => dockWorkspace(entry.id)}
      contentRef={contentRef}
    />
  );
}
