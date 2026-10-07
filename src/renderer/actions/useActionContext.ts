import { useMemo } from "react";
import { useT } from "../hooks/useT";
import { useProjectStore } from "../stores/projectStore";
import { useReviewStore } from "../stores/reviewStore";
import { useSessionMeta } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { rollbackBlockReasonText } from "../utils/rollbackLastRound";
import {
  buildSessionTree,
  excludeArchivedSessions,
  flattenSessionTree,
} from "../utils/sessionGroups";
import type { ActionContext } from "./actionRegistry";

/**
 * 动作上下文装配：命令面板与全局快捷键监听共用同一份，
 * 保证两条触发路径（点击执行 / 按键执行）的行为与文案一致。
 */
export function useActionContext(): ActionContext {
  const t = useT();
  const {
    shortcuts,
    browserEnabled,
    commandPaletteOpen,
    showToast,
    navigate,
    openSidebarTab,
    openSettings,
    openReview,
    dispatch,
  } = useUiStore();
  const {
    newSession,
    openSessionFile,
    allSessions,
    activeSessionFile,
    pinnedFiles,
    archivedFiles,
  } = useSessionMeta();
  const { projects } = useProjectStore();
  const { canRollback, rollbackBlockReason, requestRollbackPrompt } = useReviewStore();

  return useMemo<ActionContext>(
    () => ({
      t,
      shortcuts,
      browserEnabled,
      commandPaletteOpen,
      newTask: newSession,
      setTheme: (theme) => dispatch({ type: "setTheme", theme }),
      navigate,
      openFilesPanel: () => dispatch({ type: "openFilesPanel" }),
      openSidebarTab: (tab) => openSidebarTab(tab),
      toggleTerminal: () => dispatch({ type: "toggleTerminalPanel" }),
      toggleNavCollapsed: () => dispatch({ type: "toggleNavCollapsed" }),
      toggleRightSidebar: () => dispatch({ type: "toggleRightSidebar" }),
      openReview,
      openSettings,
      setCommandPaletteOpen: (open) => dispatch({ type: "setCommandPaletteOpen", open }),
      showToast,
      sessionNav: () => ({
        // 已归档会话不进会话导航（docs/design/32）
        items: flattenSessionTree(
          buildSessionTree(
            excludeArchivedSessions(allSessions, archivedFiles),
            projects,
            pinnedFiles,
          ),
        ).map((session) => ({ file: session.file, cwd: session.cwd })),
        activeFile: activeSessionFile,
      }),
      openSessionFile: (file, cwd) => {
        void openSessionFile(file, cwd ?? undefined);
      },
      requestRollbackLastRound: () => {
        if (!canRollback) {
          showToast(rollbackBlockReasonText(rollbackBlockReason));
          return false;
        }
        requestRollbackPrompt();
        return true;
      },
    }),
    [
      t,
      shortcuts,
      browserEnabled,
      commandPaletteOpen,
      newSession,
      dispatch,
      navigate,
      openSidebarTab,
      openReview,
      openSettings,
      showToast,
      allSessions,
      activeSessionFile,
      pinnedFiles,
      archivedFiles,
      projects,
      openSessionFile,
      canRollback,
      rollbackBlockReason,
      requestRollbackPrompt,
    ],
  );
}
