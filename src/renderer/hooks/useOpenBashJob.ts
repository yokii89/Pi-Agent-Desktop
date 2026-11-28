import { useCallback } from "react";
import type { MonitorBashJob } from "../components/SessionMonitor/bashJobs";
import { findVisibleBashJob } from "../components/SessionMonitor/bashJobs";
import { extensionPanelTabId, useExtensionViewStore } from "../stores/extensionViewStore";
import { useSessionMeta } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";

/** Revalidate every click against the live extension projection before selecting or opening it. */
export function useOpenBashJob() {
  const { activeSessionId } = useSessionMeta();
  const { visiblePanels, changeValue, floatingWorkspaceIds, dockWorkspace } =
    useExtensionViewStore();
  const { openSidebarTab } = useUiStore();

  const openJob = useCallback(
    (target: MonitorBashJob): void => {
      const current = findVisibleBashJob(
        visiblePanels,
        activeSessionId,
        target.entry.id,
        target.job.id,
      );
      if (!current) return;
      if (floatingWorkspaceIds.has(current.entry.id)) dockWorkspace(current.entry.id);
      // Use the advertised page, not an optimistic filter that has not reached the extension.
      changeValue(current.entry.id, current.node.id, {
        ...current.node.value,
        selectedId: current.job.id,
      });
      openSidebarTab(extensionPanelTabId(current.entry.panelId ?? `ext-${current.entry.id}`));
    },
    [activeSessionId, changeValue, dockWorkspace, floatingWorkspaceIds, openSidebarTab, visiblePanels],
  );

  const openWorkspace = useCallback(
    (viewId: string): void => {
      const entry = visiblePanels.find(
        (candidate) =>
          candidate.id === viewId &&
          (candidate.sessionId ?? candidate.boundSessionId) === activeSessionId &&
          candidate.root.type === "bash-workspace",
      );
      if (!entry || entry.root.type !== "bash-workspace") return;
      if (floatingWorkspaceIds.has(entry.id)) dockWorkspace(entry.id);
      changeValue(entry.id, entry.root.id, { query: "", filter: "all", page: 0 });
      openSidebarTab(extensionPanelTabId(entry.panelId ?? `ext-${entry.id}`));
    },
    [activeSessionId, changeValue, dockWorkspace, floatingWorkspaceIds, openSidebarTab, visiblePanels],
  );

  return { openJob, openWorkspace };
}
