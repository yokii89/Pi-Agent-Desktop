import { useMemo } from "react";
import type { SessionSummary } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { buildSessionTree, excludeArchivedSessions } from "../../utils/sessionGroups";
import { formatShortRelativeTime } from "../../utils/time";
import { useOpenHistory } from "../SideNav/useOpenHistory";
import styles from "./WelcomeSplash.module.css";

/** 空态展示的最近会话条数（docs/design/13 P2-3）：够回访，不喧宾。 */
const RECENT_LIMIT = 3;

interface RecentEntry {
  session: SessionSummary;
  /** 会话归属项目（useOpenHistory 需要显式项目上下文）；顶层"任务"为 null。 */
  projectId: string | null;
}

/**
 * 中央区空态：主标题 + 副文案 + 最近会话快捷入口。
 * 回访用户最高频意图是"继续昨天那个会话"，入口前移到空态（docs/design/13 P2-3）；
 * 项目选择仍由输入栏上方的工作区芯片承担。
 * 历史记录区块受设置「常规 → 欢迎页历史记录」控制，默认关闭。
 */
export function WelcomeSplash() {
  const t = useT();
  const { allSessions, pinnedFiles, archivedFiles } = useSessionMeta();
  const { projects } = useProjectStore();
  const welcomeRecentsEnabled = useUiStore().welcomeRecentsEnabled;
  const { open } = useOpenHistory();

  // 复用侧栏的归属树（cwd → 项目 + 置顶前移），再按最后活动时间取最近几条；
  // 已归档会话不进最近回访入口（docs/design/32）；
  // 设置关闭历史记录时不算也不渲染（默认关闭）
  const recents = useMemo<RecentEntry[]>(() => {
    if (!welcomeRecentsEnabled) return [];
    const tree = buildSessionTree(
      excludeArchivedSessions(allSessions, archivedFiles),
      projects,
      pinnedFiles,
    );
    const entries: RecentEntry[] = [
      ...tree.tasks.map((session) => ({ session, projectId: null })),
      ...tree.projectGroups.flatMap((group) =>
        group.sessions.map((session) => ({ session, projectId: group.project.id })),
      ),
    ];
    return entries.sort((a, b) => b.session.updatedAt - a.session.updatedAt).slice(0, RECENT_LIMIT);
  }, [welcomeRecentsEnabled, allSessions, archivedFiles, projects, pinnedFiles]);

  return (
    <div className={styles.splash}>
      <h1 className={styles.headline}>{t("session.welcome.headline")}</h1>
      {recents.length > 0 && (
        <div className={styles.recents}>
          {recents.map(({ session, projectId }) => (
            <button
              key={session.file}
              type="button"
              className={styles.recentItem}
              title={session.firstUserMessage ?? undefined}
              onClick={() => open(session, projectId)}
            >
              <span className={styles.recentTitle}>
                {session.firstUserMessage ?? t("session.emptySession")}
              </span>
              <span className={styles.recentTime}>
                {formatShortRelativeTime(session.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
