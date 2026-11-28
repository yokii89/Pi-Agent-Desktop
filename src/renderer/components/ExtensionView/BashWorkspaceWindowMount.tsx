import { useMemo, useRef } from "react";
import { useExtensionViewLayout } from "../../hooks/useExtensionViewLayout";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { BashWorkspaceView } from "./BashWorkspaceView";
import type { ViewFormBridge } from "./ViewNodeRenderer";

/** Floating and docked views share one session-owned reading memory and live job source. */
export function BashWorkspaceWindowMount({ entry }: { entry: ExtensionViewEntry }) {
  const { changeValue, sendAction, dockWorkspace, getBashWorkspaceMemory } =
    useExtensionViewStore();
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
  if (entry.root.type !== "bash-workspace") return null;
  return (
    <BashWorkspaceView
      viewId={entry.id}
      node={entry.root}
      bridge={bridge}
      memory={getBashWorkspaceMemory(entry.id, entry.root.id)}
      floating
      onToggleFloating={() => dockWorkspace(entry.id)}
      contentRef={contentRef}
    />
  );
}
