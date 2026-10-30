import { useCallback } from "react";
import type { ManagedProcess } from "../../shared/ipc";
import { selectProc } from "../stores/procStore";
import { useUiStore } from "../stores/uiStore";

/**
 * 从后台进程行（监控卡 / 中央浮卡）打开右侧栏「后台进程」页签并选中该进程。
 * 打开侧栏会让监控卡让位（docs/design/96），选中项在打开前写进 procStore。
 */
export function useOpenProcPanel(): (proc: ManagedProcess) => void {
  const { openSidebarTab } = useUiStore();
  return useCallback(
    (proc: ManagedProcess): void => {
      selectProc(proc.id);
      openSidebarTab("procs");
    },
    [openSidebarTab],
  );
}
