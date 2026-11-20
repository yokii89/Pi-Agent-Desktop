import { useCallback, useRef, useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

/**
 * 打开历史会话的统一入口：
 * - 仅当该会话成为 active 时切换项目上下文（后台跨项目不打断当前 project）
 * - 目标已有存活进程 → 瞬时切换，无 opening 旋转
 * - 目标无进程 → openingFile 旋转直至 start settle
 * - 输入正文、@ 引用和附件由 composer 草稿仓库按会话保留
 */
export function useOpenHistory() {
  const { selectProject } = useProjectStore();
  const { activeSessionFile, openSessionFile, isFileProcessAlive } = useSessionMeta();
  const { navigate } = useUiStore();
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const openSeqRef = useRef(0);

  const open = useCallback(
    (session: SessionSummary, projectId: string | null): void => {
      const seq = ++openSeqRef.current;
      // 热切换（已有存活进程）→ 瞬时切换，不闪 opening 旋转（决策 #4 / B3）
      const hot = isFileProcessAlive(session.file);
      selectProject(projectId);
      if (!hot) setOpeningFile(session.file);
      openSessionFile(session.file, session.cwd ?? undefined).finally(() => {
        if (openSeqRef.current === seq) setOpeningFile(null);
      });
      navigate("session");
    },
    [openSessionFile, selectProject, navigate, isFileProcessAlive],
  );

  return { open, openingFile, activeSessionFile };
}
