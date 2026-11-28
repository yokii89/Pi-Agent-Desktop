import { ArrowUpRight, Copy } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { ViewBashJob } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { useSessionEntries, useSessionMeta } from "../../stores/sessionStore";
import { revealSessionToolCall } from "../../stores/sessionToolReveal";
import { IconButton } from "../ui/IconButton";
import styles from "./BashJobInspector.module.css";
import { findSourceToolBlock, SOURCE_OUTPUT_LIMIT, sourceToolData } from "./bashRuntimeData";

/** Show the launch tool's captured result, independently of the job's current output. */
export function BashJobSource({ job, onReveal }: { job: ViewBashJob; onReveal?: () => void }) {
  const t = useT();
  const entries = useSessionEntries();
  const { activeSessionId } = useSessionMeta();
  const block = useMemo(
    () => findSourceToolBlock(entries, job.sourceToolCallId),
    [entries, job.sourceToolCallId],
  );
  const source = useMemo(() => (block ? sourceToolData(block) : null), [block]);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const copy = async (): Promise<void> => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.command);
      setNotice({ id: job.id, text: t("bashWorkspace.source.copied") });
    } catch (reason) {
      setNotice({
        id: job.id,
        text: t("bashWorkspace.source.copyFailed", { message: String(reason) }),
      });
    }
  };

  return (
    <section className={styles.inspector} data-selectable-text="">
      <div className={styles.sectionHead}>
        <h3>{t("bashWorkspace.source.title")}</h3>
        <div className={styles.actions}>
          {activeSessionId && job.sourceToolCallId ? (
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                if (activeSessionId && job.sourceToolCallId) {
                  revealSessionToolCall(activeSessionId, job.sourceToolCallId);
                  onReveal?.();
                }
              }}
            >
              <ArrowUpRight size={16} weight="regular" />
              {t("bashWorkspace.source.reveal")}
            </button>
          ) : null}
          {source?.command ? (
            <IconButton title={t("bashWorkspace.source.copyCommand")} onClick={() => void copy()}>
              <Copy size={16} weight="regular" />
            </IconButton>
          ) : null}
        </div>
      </div>
      {!source || !block ? (
        <p className={styles.note}>
          {t(
            job.sourceToolCallId
              ? "bashWorkspace.source.missing"
              : "bashWorkspace.source.noReference",
          )}
        </p>
      ) : (
        <>
          <pre className={styles.command}>{source.command || "—"}</pre>
          <dl className={styles.metaGrid}>
            <div>
              <dt>{t("bashWorkspace.source.toolCallId")}</dt>
              <dd>{job.sourceToolCallId}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.source.timeout")}</dt>
              <dd>
                {source.timeout === null
                  ? t("bashWorkspace.source.timeoutUnset")
                  : t("bashWorkspace.source.timeoutSeconds", { seconds: source.timeout })}
              </dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.source.status")}</dt>
              <dd>{t(`bashWorkspace.source.status.${block.status}`)}</dd>
            </div>
            <div>
              <dt>{t("bashWorkspace.source.exitCode")}</dt>
              <dd>
                {source.pending ? t("bashWorkspace.source.callPending") : (source.exitCode ?? "—")}
              </dd>
            </div>
          </dl>
          <h4 className={styles.subTitle}>{t("bashWorkspace.source.startupOutput")}</h4>
          <p className={styles.note}>{t("bashWorkspace.source.outputNote")}</p>
          {source.output ? (
            <section
              className={styles.output}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: captured output needs keyboard scrolling
              tabIndex={0}
              aria-label={t("bashWorkspace.source.startupOutput")}
            >
              {source.output}
            </section>
          ) : (
            <p className={styles.note}>{t("bashWorkspace.source.noOutput")}</p>
          )}
          {source.capped ? (
            <p className={styles.note}>
              {t("bashWorkspace.source.capped", { chars: SOURCE_OUTPUT_LIMIT })}
            </p>
          ) : null}
          {source.truncated ? (
            <p className={styles.note}>{t("bashWorkspace.source.truncated")}</p>
          ) : null}
        </>
      )}
      {notice?.id === job.id ? (
        <p className={styles.note} role="status">
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
