import { useT } from "../../hooks/useT";
import { CONFLICT_LIST_LIMIT, type RollbackInspect } from "../../utils/rollbackLastRound";
import { ConfirmDialog } from "./ConfirmDialog";
import styles from "./RollbackLastRoundDialog.module.css";

function PathList({ paths }: { paths: string[] }) {
  const t = useT();
  if (paths.length === 0) return null;
  const shown = paths.slice(0, CONFLICT_LIST_LIMIT);
  const rest = paths.length - shown.length;
  return (
    <>
      <ul className={styles.pathList}>
        {shown.map((path) => (
          <li key={path} className={styles.pathItem}>
            {path}
          </li>
        ))}
      </ul>
      {rest > 0 && <p className={styles.more}>{t("ui.rollback.moreFiles", { count: rest })}</p>}
    </>
  );
}

/**
 * 「撤销本轮文件改动」确认框：汇总卡与审阅面板共用。
 * N 与还原/删除拆分、冲突路径均以执行前 inspect 为准（docs/design/11 §5–§6）。
 */
export function RollbackLastRoundDialog({
  open,
  busy,
  inspect,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  inspect: RollbackInspect | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const total = inspect?.total ?? 0;
  const restoreCount = inspect?.restoreCount ?? null;
  const deleteCount = inspect?.deleteCount ?? null;
  const conflictOverwrite = inspect?.conflictOverwrite ?? [];
  const conflictDelete = inspect?.conflictDelete ?? [];
  const hasConflict = conflictOverwrite.length > 0 || conflictDelete.length > 0;
  const loading = inspect?.loading === true;
  const dialogBusy = busy || loading;

  return (
    <ConfirmDialog
      open={open}
      title={t("ui.rollback.title")}
      tone="danger"
      confirmLabel={t("ui.rollback.confirm")}
      busy={dialogBusy}
      busyLabel={loading && !busy ? t("ui.rollback.checking") : t("ui.rollback.undoing")}
      onCancel={onCancel}
      onConfirm={onConfirm}
      message={
        <div className={styles.message}>
          {loading ? (
            <p className={styles.lead}>{t("ui.rollback.checkingLead")}</p>
          ) : (
            <>
              <p className={styles.lead}>{t("ui.rollback.lead", { count: total })}</p>
              <ul className={styles.bullets}>
                <li>
                  {t("ui.rollback.bullet.restoreStart1")}
                  <strong>{t("ui.rollback.bullet.restoreStart2")}</strong>
                  {t("ui.rollback.bullet.restoreStart3")}
                </li>
                <li>{t("ui.rollback.bullet.keepEarlier")}</li>
                {deleteCount !== null ? (
                  deleteCount > 0 && (
                    <li>{t("ui.rollback.bullet.deleteNewCount", { count: deleteCount })}</li>
                  )
                ) : (
                  <li>{t("ui.rollback.bullet.deleteNew")}</li>
                )}
                {restoreCount !== null && restoreCount > 0 && (
                  <li>{t("ui.rollback.bullet.restoreCount", { count: restoreCount })}</li>
                )}
                <li>
                  {t("ui.rollback.bullet.noUndo1")}
                  <strong>{t("ui.rollback.bullet.noUndo2")}</strong>
                  {t("ui.rollback.bullet.noUndo3")}
                </li>
              </ul>
              {hasConflict && (
                <div className={styles.conflict}>
                  {conflictOverwrite.length > 0 && (
                    <>
                      <p className={styles.conflictTitle}>{t("ui.rollback.conflictOverwrite")}</p>
                      <PathList paths={conflictOverwrite} />
                    </>
                  )}
                  {conflictDelete.length > 0 && (
                    <>
                      <p className={styles.conflictTitle}>{t("ui.rollback.conflictDelete")}</p>
                      <PathList paths={conflictDelete} />
                    </>
                  )}
                </div>
              )}
              <p className={styles.risk}>{t("ui.rollback.risk")}</p>
            </>
          )}
        </div>
      }
    />
  );
}
