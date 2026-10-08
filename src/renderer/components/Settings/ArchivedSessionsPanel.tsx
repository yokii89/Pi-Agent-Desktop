import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { buildSessionTree } from "../../utils/sessionGroups";
import { sessionTitle } from "../../utils/sessionTitle";
import { formatShortRelativeTime } from "../../utils/time";
import { useOpenHistory } from "../SideNav/useOpenHistory";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { IconButton } from "../ui/IconButton";
import styles from "./ArchivedSessionsPanel.module.css";
import settingsStyles from "./Settings.module.css";

/** 一条归档行：会话摘要 + 归档时间。 */
interface ArchivedRow {
  session: SessionSummary;
  archivedAt: number;
}

/**
 * 设置 → 已归档对话（docs/design/32）：归档会话的唯一管理入口。
 * 行点击 = 取消归档并打开（回到侧栏原分组）；行内按钮提供「仅恢复」与「删除」。
 * 归档数据源是 settings.archivedSessions，展示元数据取自侧栏同一份 allSessions——
 * 文件已不存在的登记（外部删除）由主进程 listAllSessions 清理，这里自然不展示。
 */
export function ArchivedSessionsPanel() {
  const t = useT();
  const { allSessions, archivedFiles, unarchiveSession, removeSession, sessionTitles } =
    useSessionMeta();
  const { projects } = useProjectStore();
  const { open } = useOpenHistory();
  const [pendingDelete, setPendingDelete] = useState<ArchivedRow | null>(null);

  // 归档登记 → 展示行：按归档时间倒序；allSessions 里找不到的（登记残留）跳过
  const rows = useMemo<ArchivedRow[]>(() => {
    const byFile = new Map(allSessions.map((session) => [session.file, session]));
    const result: ArchivedRow[] = [];
    for (const [file, archivedAt] of Object.entries(archivedFiles)) {
      const session = byFile.get(file);
      if (session) result.push({ session, archivedAt });
    }
    return result.sort((a, b) => b.archivedAt - a.archivedAt);
  }, [allSessions, archivedFiles]);

  // 归档会话 → 所属项目：复用 buildSessionTree 的"嵌套最深优先"匹配，
  // 恢复打开时 selectProject 的项目上下文才与侧栏分组一致
  const projectIdByFile = useMemo(() => {
    const tree = buildSessionTree(
      rows.map((row) => row.session),
      projects,
    );
    const map = new Map<string, string | null>();
    for (const group of tree.projectGroups) {
      for (const session of group.sessions) map.set(session.file, group.project.id);
    }
    for (const session of tree.tasks) map.set(session.file, null);
    return map;
  }, [rows, projects]);

  /** 行点击：先取消归档（行回到侧栏原分组），再走统一打开动线（清草稿 / 选项目 / 导航）。 */
  const restoreAndOpen = (row: ArchivedRow): void => {
    unarchiveSession(row.session.file);
    open(row.session, projectIdByFile.get(row.session.file) ?? null);
  };

  return (
    <div className={settingsStyles.panel}>
      <section className={settingsStyles.section}>
        {rows.length === 0 ? (
          <div>
            <p className={styles.empty}>{t("settings.archived.empty")}</p>
            <p className={styles.hint}>{t("settings.archived.emptyHint")}</p>
          </div>
        ) : (
          <div className={styles.list}>
            {rows.map((row) => {
              const title = sessionTitle(row.session, sessionTitles[row.session.file]);
              const projectId = projectIdByFile.get(row.session.file) ?? null;
              const spaceName = projects.find((p) => p.id === projectId)?.name ?? null;
              return (
                <div key={row.session.file} className={styles.row}>
                  <button
                    type="button"
                    className={styles.main}
                    title={t("settings.archived.restoreAndOpen")}
                    onClick={() => restoreAndOpen(row)}
                  >
                    <span className={styles.title}>{title}</span>
                    {spaceName && <span className={styles.space}>{spaceName}</span>}
                    <span className={styles.time}>
                      {t("settings.archived.archivedAt", {
                        time: formatShortRelativeTime(row.archivedAt),
                      })}
                    </span>
                  </button>
                  <div className={styles.actions}>
                    <IconButton
                      title={t("settings.archived.restoreLabel", { title })}
                      onClick={() => unarchiveSession(row.session.file)}
                    >
                      <ArrowCounterClockwise size={16} weight="regular" />
                    </IconButton>
                    <IconButton title={t("common.delete")} onClick={() => setPendingDelete(row)}>
                      <Trash size={16} weight="regular" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("settings.archived.deleteConfirm.title")}
        message={t("settings.archived.deleteConfirm.message")}
        confirmLabel={t("settings.archived.deleteConfirm.confirm")}
        tone="danger"
        onConfirm={() => {
          if (pendingDelete) void removeSession(pendingDelete.session.file);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
