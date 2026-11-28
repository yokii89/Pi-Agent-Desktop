import type { ViewBashJob, ViewBashWorkspaceNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import styles from "./BashWorkspace.module.css";
import { BashJobRuntime } from "./BashJobRuntime";
import { BashJobSource } from "./BashJobSource";

export function BashJobDetails({
  job,
  node,
  viewId,
  onRevealSource,
}: {
  job: ViewBashJob;
  node: ViewBashWorkspaceNode;
  viewId?: string;
  onRevealSource?: () => void;
}) {
  const t = useT();
  const date = (value: number): string => new Date(value).toLocaleString();
  const fields = [
    [t("bashWorkspace.id"), job.id],
    [t("bashWorkspace.rawStatus"), job.status],
    [t("bashWorkspace.mode"), job.mode],
    [t("bashWorkspace.reason"), job.reason],
    [t("bashWorkspace.detached"), t(job.detached ? "bashWorkspace.yes" : "bashWorkspace.no")],
    [t("bashWorkspace.startedAt"), date(job.startedAt)],
    [t("bashWorkspace.lastOutput"), date(job.lastOutputAt)],
    [t("bashWorkspace.killedBy"), job.killedBy ?? "—"],
    [t("bashWorkspace.exitCode"), job.status === "orphaned" ? "—" : String(job.exitCode ?? "—")],
    [t("bashWorkspace.cursor"), node.outputJobId === job.id ? node.cursor : "—"],
    ...(job.pid === undefined ? [] : [["PID", String(job.pid)]]),
    ...(job.processState === undefined
      ? []
      : [[t("bashWorkspace.processState"), t(`bashWorkspace.process.${job.processState}`)]]),
  ];
  return (
    <div className={styles.detailsPanel} data-selectable-text="">
      <section className={styles.detailsSection}>
        <h3>{t("bashWorkspace.execution")}</h3>
        <dl className={styles.detailGrid}>
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className={styles.detailsSection}>
        <h3>{t("bashWorkspace.mode")}</h3>
        <p className={styles.detailsNote}>
          <code>{job.mode}</code> · {t(`bashWorkspace.mode.${job.mode}`)}
        </p>
      </section>
      <section className={styles.detailsSection}>
        <h3>{t("bashWorkspace.lifecycle")}</h3>
        <ol className={styles.lifecycle}>
          <li>
            <span>{t("bashWorkspace.started")}</span>
            <time>{date(job.startedAt)}</time>
          </li>
          {job.status === "orphaned" ? (
            <li>
              <span>{t("bashWorkspace.restored")}</span>
            </li>
          ) : job.exitedAt !== undefined ? (
            <li>
              <span>{t("bashWorkspace.completedAt")}</span>
              <time>{date(job.exitedAt)}</time>
            </li>
          ) : (
            <li>
              <span>{t("bashWorkspace.live")}</span>
            </li>
          )}
        </ol>
      </section>
      {job.status === "orphaned" ? (
        <p className={styles.detailsNote}>{t("bashWorkspace.orphanNotice")}</p>
      ) : null}
      <BashJobSource key={`source:${job.id}`} job={job} onReveal={onRevealSource} />
      {viewId && job.pid !== undefined ? (
        <BashJobRuntime key={`${viewId}:${job.id}`} viewId={viewId} job={job} />
      ) : null}
    </div>
  );
}
