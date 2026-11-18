import { ArrowLeft, ArrowsClockwise, CaretRight, Pulse, Stop } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { getI18nLocale } from "../../../shared/i18n";
import { useLiveSessions } from "../../hooks/useLiveSessions";
import { useT } from "../../hooks/useT";
import { sessionService } from "../../services/sessionService";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { sessionTitle } from "../../utils/sessionTitle";
import { formatShortRelativeTime } from "../../utils/time";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import styles from "./LiveSessionsPanel.module.css";
import settingsStyles from "./Settings.module.css";

function formatDate(timestamp: number | null, unavailable: string): string {
  if (!timestamp) return unavailable;
  return new Intl.DateTimeFormat(getI18nLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

/** 设置 → 存活会话：展示完整进程清单，点击进入详情并确认结束空闲实例。 */
export function LiveSessionsPanel() {
  const t = useT();
  const { sessions: runtimeSnapshots, loading, loaded, error, refresh } = useLiveSessions();
  const { allSessions, activeSessionId } = useSessionMeta();
  const { showToast } = useUiStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<{ sessionId: string; title: string } | null>(
    null,
  );
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const summaryByFile = new Map(allSessions.map((session) => [session.file, session]));
    return runtimeSnapshots
      .filter((runtime) => ["ready", "idle", "busy", "starting"].includes(runtime.state))
      .map((runtime) => {
        const summary = runtime.sessionFile ? summaryByFile.get(runtime.sessionFile) : undefined;
        const status =
          runtime.state === "busy" ? "running" : runtime.state === "starting" ? "starting" : "idle";
        return {
          ...runtime,
          status,
          title: summary
            ? sessionTitle(summary, t("sidenav.session.untitled"))
            : runtime.createdBy === "new-chat-prefetch" ||
                runtime.createdBy === "speculative-prefetch"
              ? t("settings.liveSessions.prefetch")
              : t("sidenav.session.untitled"),
          cwd: runtime.cwd ?? summary?.cwd ?? null,
          updatedAt: summary?.updatedAt ?? null,
          createdAt: summary?.startedAt ?? null,
          firstUserMessage: summary?.firstUserMessage ?? null,
        };
      })
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }, [allSessions, runtimeSnapshots, t]);
  const selected = rows.find((row) => row.sessionId === selectedId) ?? null;
  const pendingTitle =
    rows.find((row) => row.sessionId === pendingClose?.sessionId)?.title ??
    pendingClose?.title ??
    "";

  const confirmClose = async (): Promise<void> => {
    if (!pendingClose || closing) return;
    setClosing(true);
    setCloseError(null);
    try {
      const result = await sessionService.disposeIdle(pendingClose.sessionId);
      if (result === "busy") {
        setCloseError(t("settings.liveSessions.close.busy"));
        return;
      }
      setPendingClose(null);
      setSelectedId(null);
      void refresh();
      showToast(t("settings.liveSessions.close.ended"));
    } catch {
      setCloseError(t("settings.liveSessions.close.failed"));
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className={settingsStyles.panel} data-selectable-text>
      <p>{t("settings.liveSessions.description")}</p>
      <Button onClick={() => void refresh()} disabled={loading}>
        <ArrowsClockwise size={16} weight="regular" />
        {t("common.refresh")}
      </Button>
      {error && (
        <p className={styles.error} role="alert">
          {t("settings.liveSessions.error", { error })}
        </p>
      )}
      {!loaded && loading && <p role="status">{t("common.loading")}</p>}
      {selected ? (
        <section aria-label={t("settings.liveSessions.details")}>
          <Button onClick={() => setSelectedId(null)}>
            <ArrowLeft size={16} weight="regular" />
            {t("settings.liveSessions.back")}
          </Button>
          <header className={styles.detailHeader}>
            <div className={styles.detailHeading}>
              <h3 className={styles.detailTitle} data-selectable-text>
                {selected.title}
              </h3>
              <span className={styles.status} data-status={selected.status}>
                {t(`settings.liveSessions.status.${selected.status}`)}
              </span>
            </div>
            {selected.status === "idle" && (
              <Button
                variant="danger"
                onClick={() => {
                  setCloseError(null);
                  setPendingClose({ sessionId: selected.sessionId, title: selected.title });
                }}
              >
                <Stop size={16} weight="regular" />
                {t("settings.liveSessions.closeIdle")}
              </Button>
            )}
          </header>
          <dl className={styles.details} data-selectable-text>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.pid")}</dt>
              <dd>{selected.pid}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.source")}</dt>
              <dd>
                {selected.createdBy
                  ? t(`settings.liveSessions.source.${selected.createdBy}`)
                  : t("common.unknown")}
              </dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.lastActivity")}</dt>
              <dd>{formatDate(selected.lastActivityAt, t("common.unknown"))}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.id")}</dt>
              <dd>{selected.sessionId}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.file")}</dt>
              <dd>{selected.sessionFile ?? t("settings.liveSessions.noFile")}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.workingDirectory")}</dt>
              <dd>{selected.cwd ?? t("common.unknown")}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.startedAt")}</dt>
              <dd>{formatDate(selected.startedAt, t("common.unknown"))}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.createdAt")}</dt>
              <dd>{formatDate(selected.createdAt, t("common.unknown"))}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt>{t("settings.liveSessions.updatedAt")}</dt>
              <dd>{formatDate(selected.updatedAt, t("common.unknown"))}</dd>
            </div>
            {selected.firstUserMessage && (
              <div className={styles.detailRow}>
                <dt>{t("settings.liveSessions.firstMessage")}</dt>
                <dd className={styles.firstMessage}>{selected.firstUserMessage}</dd>
              </div>
            )}
          </dl>
        </section>
      ) : (
        <section aria-label={t("settings.liveSessions.listTitle")}>
          <header className={styles.listHeader}>
            <h3 className={styles.listTitle}>{t("settings.liveSessions.listTitle")}</h3>
            <span className={styles.count}>
              {t("settings.liveSessions.count", { count: rows.length })}
            </span>
          </header>
          {loaded && rows.length === 0 ? (
            <div className={styles.empty}>
              <Pulse size={24} weight="regular" />
              <p>{t("settings.liveSessions.empty")}</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.sessionId}>
                  <button
                    type="button"
                    className={styles.item}
                    onClick={() => setSelectedId(row.sessionId)}
                  >
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{row.title}</span>
                      <span className={styles.itemMeta}>{row.cwd ?? t("common.unknown")}</span>
                    </span>
                    {row.sessionId === activeSessionId && (
                      <span className={styles.current}>{t("settings.liveSessions.current")}</span>
                    )}
                    <span className={styles.status} data-status={row.status}>
                      {t(`settings.liveSessions.status.${row.status}`)}
                    </span>
                    {row.updatedAt !== null && (
                      <span className={styles.itemTime}>
                        {formatShortRelativeTime(row.updatedAt)}
                      </span>
                    )}
                    <CaretRight size={16} weight="regular" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ConfirmDialog
        open={pendingClose !== null}
        title={t("settings.liveSessions.closeConfirm.title")}
        message={
          <>
            <p>{t("settings.liveSessions.closeConfirm.message", { title: pendingTitle })}</p>
            {closeError && (
              <p className={styles.error} role="alert">
                {closeError}
              </p>
            )}
          </>
        }
        confirmLabel={t("settings.liveSessions.closeConfirm.confirm")}
        busyLabel={t("settings.liveSessions.close.pending")}
        busy={closing}
        tone="danger"
        nested
        onConfirm={() => void confirmClose()}
        onCancel={() => setPendingClose(null)}
      />
    </div>
  );
}
