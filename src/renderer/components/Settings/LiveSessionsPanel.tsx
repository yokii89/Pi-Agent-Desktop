import { ArrowsClockwise } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useLiveSessions } from "../../hooks/useLiveSessions";
import { useT } from "../../hooks/useT";
import { useSessionMeta } from "../../stores/sessionStore";
import { sessionTitle } from "../../utils/sessionTitle";
import { formatAbsoluteTime, formatElapsed } from "../../utils/time";
import { Button } from "../ui/Button";
import styles from "./LiveSessionsPanel.module.css";
import settingsStyles from "./Settings.module.css";

/** 设置里的完整存活进程清单；查看列表不会激活会话或延长其闲置期限。 */
export function LiveSessionsPanel() {
  const t = useT();
  const { allSessions, activeSessionId } = useSessionMeta();
  const { sessions, loading, loaded, error, refresh } = useLiveSessions();
  const titles = useMemo(
    () =>
      new Map(
        allSessions.map((session) => [
          session.file,
          sessionTitle(session, t("sidenav.session.untitled")),
        ]),
      ),
    [allSessions, t],
  );
  const unknown = t("common.unknown");

  return (
    <div className={settingsStyles.panel} data-selectable-text>
      <div className={styles.toolbar}>
        <div>
          <h3 className={styles.heading}>
            {loaded
              ? t("settings.liveSessions.count", { count: sessions.length })
              : t("settings.section.liveSessions")}
          </h3>
          <p className={styles.hint}>{t("settings.liveSessions.description")}</p>
        </div>
        <Button onClick={refresh} disabled={loading}>
          <ArrowsClockwise size={16} weight="regular" />
          {t("common.refresh")}
        </Button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {t("settings.liveSessions.error", { error })}
        </p>
      )}
      {!loaded && loading && <p role="status">{t("common.loading")}</p>}
      {loaded && !error && sessions.length === 0 && (
        <p className={styles.hint}>{t("settings.liveSessions.empty")}</p>
      )}
      <ul className={styles.list}>
        {sessions.map((session) => {
          const prefetch =
            session.createdBy === "new-chat-prefetch" ||
            session.createdBy === "speculative-prefetch";
          const title =
            (session.sessionFile && titles.get(session.sessionFile)) ||
            t(prefetch ? "settings.liveSessions.prefetch" : "sidenav.session.untitled");
          return (
            <li key={session.sessionId} className={styles.row}>
              <div className={styles.rowHeader}>
                <h4 className={styles.title}>{title}</h4>
                {session.sessionId === activeSessionId && (
                  <span className={styles.badge}>{t("settings.liveSessions.current")}</span>
                )}
                <span className={styles.state} data-state={session.state}>
                  {t(`settings.liveSessions.state.${session.state}`)}
                </span>
              </div>
              <dl className={styles.details}>
                <div>
                  <dt>{t("settings.liveSessions.pid")}</dt>
                  <dd>{session.pid}</dd>
                </div>
                <div>
                  <dt>{t("settings.liveSessions.source")}</dt>
                  <dd>
                    {session.createdBy
                      ? t(`settings.liveSessions.source.${session.createdBy}`)
                      : unknown}
                  </dd>
                </div>
                <div>
                  <dt>{t("settings.liveSessions.startedAt")}</dt>
                  <dd>
                    {session.startedAt === null ? unknown : formatAbsoluteTime(session.startedAt)}
                  </dd>
                </div>
                <div>
                  <dt>{t("settings.liveSessions.lastActivity")}</dt>
                  <dd
                    title={
                      session.lastActivityAt === null
                        ? undefined
                        : formatAbsoluteTime(session.lastActivityAt)
                    }
                  >
                    {session.lastActivityAt === null
                      ? unknown
                      : t("settings.liveSessions.ago", {
                          time: formatElapsed(Date.now() - session.lastActivityAt),
                        })}
                  </dd>
                </div>
                <div className={styles.full}>
                  <dt>{t("settings.liveSessions.cwd")}</dt>
                  <dd>{session.cwd ?? unknown}</dd>
                </div>
                <div className={styles.full}>
                  <dt>{t("settings.liveSessions.id")}</dt>
                  <dd className={styles.mono}>{session.sessionId}</dd>
                </div>
                <div className={styles.full}>
                  <dt>{t("settings.liveSessions.file")}</dt>
                  <dd>{session.sessionFile ?? t("settings.liveSessions.noFile")}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      <p className={styles.hint}>{t("settings.liveSessions.activityHint")}</p>
    </div>
  );
}
