import { useMemo } from "react";
import { useExtensionViewStore } from "../stores/extensionViewStore";
import { projectBashJobs } from "../components/SessionMonitor/bashJobs";

/** Active-session Bash job summary from live extension View projections only. */
export function useBashJobs(activeSessionId: string | null) {
  const { visiblePanels } = useExtensionViewStore();
  return useMemo(
    () => projectBashJobs(visiblePanels, activeSessionId),
    [visiblePanels, activeSessionId],
  );
}
