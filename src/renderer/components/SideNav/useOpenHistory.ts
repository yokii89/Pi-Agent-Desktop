import { useCallback, useRef, useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useComposerStore } from "../../stores/composerStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

/**
 * 打开历史会话的统一入口：
 * - 仅当该会话成为 active 时切换项目上下文（后台跨项目不打断当前 project）
 * - 目标已有存活进程 → 瞬时切换，无 opening 旋转
 * - 目标无进程 → openingFile 旋转直至 start settle
 * - 切换 active 时清空 composer 草稿（按会话隔离：不把 A 的 @ 芯片带进 B）
 */
export function useOpenHistory() {
  const { selectProject } = useProjectStore();
  const { activeSessionFile, openSessionFile, isFileProcessAlive } = useSessionMeta();
  const { clearFileMentions, clearImageAttachments, clearFileAttachments } = useComposerStore();
  const { navigate } = useUiStore();
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const openSeqRef = useRef(0);

  const open = useCallback(
    (session: SessionSummary, projectId: string | null): void => {
      const seq = ++openSeqRef.current;
      // 热切换（已有存活进程）→ 瞬时切换，不闪 opening 旋转（决策 #4 / B3）
      const hot = isFileProcessAlive(session.file);
      clearFileMentions();
      clearImageAttachments();
      clearFileAttachments();
      selectProject(projectId);
      if (!hot) setOpeningFile(session.file);
      openSessionFile(session.file, session.cwd ?? undefined).finally(() => {
        if (openSeqRef.current === seq) setOpeningFile(null);
      });
      navigate("session");
    },
    [
      openSessionFile,
      selectProject,
      navigate,
      clearFileMentions,
      clearImageAttachments,
      clearFileAttachments,
      isFileProcessAlive,
    ],
  );

  return { open, openingFile, activeSessionFile };
}
