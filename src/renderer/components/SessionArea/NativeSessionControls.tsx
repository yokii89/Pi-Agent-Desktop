import { TerminalWindow } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  type NativeAnswer,
  type NativeJob,
  type NativeJobOutput,
  type PendingPlan,
  type PendingQuestionnaire,
  type PlanAction,
  parseQuestionnaireReply,
} from "../../../shared/nativeBuiltins";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { pideskApi } from "../../services/pideskApi";
import { useNativeSession } from "../../stores/nativeSessionStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { OptionList } from "../ui/OptionList";
import styles from "./NativeSessionControls.module.css";
import toolbarStyles from "./TaskInputToolbar.module.css";

export function NativeQuestionnaireHost() {
  const state = useNativeSession();
  const { activeSessionId } = useSessionMeta();
  const pending = Object.values(state?.questions ?? {}).sort((a, b) => a.taskId - b.taskId)[0];
  return pending && activeSessionId ? (
    <Questionnaire
      key={`${activeSessionId}:${pending.taskId}`}
      sessionId={activeSessionId}
      pending={pending}
    />
  ) : null;
}
function Questionnaire({
  sessionId,
  pending,
}: {
  sessionId: string;
  pending: PendingQuestionnaire;
}) {
  const t = useT();
  const { showToast } = useUiStore();
  const [answers, setAnswers] = useState<NativeAnswer[]>(
    pending.questions.map(() => ({ selected: [], text: "" })),
  );
  const [busy, setBusy] = useState(false);
  const update = (index: number, answer: NativeAnswer) =>
    setAnswers((previous) =>
      previous.map((item, position) => (position === index ? answer : item)),
    );
  const respond = async (cancelled: boolean) => {
    const api = pideskApi();
    if (!api || busy) return;
    setBusy(true);
    try {
      const status = await unwrap(
        api.durable.answerQuestionnaire(sessionId, pending.taskId, pending.version, {
          cancelled,
          answers: cancelled ? [] : answers,
        }),
      );
      if (status === "closed") showToast(t("native.interaction.closed"));
    } catch (error) {
      showToast(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      ariaLabel={t("native.questionnaire")}
      panelClassName={styles.dialog}
      onClose={() => void respond(true)}
    >
      <h2>{t("native.questionnaire")}</h2>
      <div className={styles.scroll}>
        {pending.questions.map((question, index) => (
          <fieldset className={styles.question} key={question.question} disabled={busy}>
            <legend data-selectable-text>
              {question.header} · {question.question}
            </legend>
            {question.options.map((option) => (
              <label key={option.label} className={styles.option}>
                <input
                  type={question.multiSelect ? "checkbox" : "radio"}
                  name={`question-${index}`}
                  checked={answers[index].selected.includes(option.label)}
                  onChange={(event) =>
                    update(index, {
                      ...answers[index],
                      selected: question.multiSelect
                        ? event.target.checked
                          ? [...answers[index].selected, option.label]
                          : answers[index].selected.filter((label) => label !== option.label)
                        : [option.label],
                    })
                  }
                />
                <span data-selectable-text>
                  <strong>{option.label}</strong>
                  <span className={styles.description}>{option.description}</span>
                </span>
              </label>
            ))}
            <label className={styles.custom}>
              {t("native.freeText")}
              <textarea
                className={styles.textarea}
                value={answers[index].text}
                maxLength={16000}
                onChange={(event) => update(index, { ...answers[index], text: event.target.value })}
              />
            </label>
            {answers[index].selected.length > 0 && (
              <Button onClick={() => update(index, { ...answers[index], selected: [] })}>
                {t("native.clearSelection")}
              </Button>
            )}
          </fieldset>
        ))}
      </div>
      <div className={styles.actions}>
        <Button onClick={() => void respond(true)} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={
            busy || !parseQuestionnaireReply({ cancelled: false, answers }, pending.questions)
          }
          onClick={() => void respond(false)}
        >
          {t("native.submit")}
        </Button>
      </div>
    </Modal>
  );
}

/** Review actions stay next to the composer; the complete plan is already in the document flow. */
export function NativePlanReview() {
  const state = useNativeSession();
  const { activeSessionId } = useSessionMeta();
  return state?.plan && activeSessionId ? (
    <PlanReview
      key={`${activeSessionId}:${state.plan.taskId}`}
      sessionId={activeSessionId}
      plan={state.plan}
    />
  ) : null;
}
function PlanReview({ sessionId, plan }: { sessionId: string; plan: PendingPlan }) {
  const t = useT();
  const { refreshSidebarSessions, openSessionFile } = useSessionMeta();
  const { showToast } = useUiStore();
  const [busy, setBusy] = useState(false);
  const choose = async (action: PlanAction) => {
    const api = pideskApi();
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await unwrap(api.durable.answerPlan(sessionId, plan.taskId, action));
      if (result.status === "closed") showToast(t("native.interaction.closed"));
      if (result.file) {
        await refreshSidebarSessions();
        await openSessionFile(result.file);
      }
    } catch (error) {
      showToast(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.review} aria-label={t("native.review")}>
      <p data-selectable-text>{t("native.review")}</p>
      <div className={styles.actions}>
        {(["execute", "new", "explore", "save"] as const).map((action) => (
          <Button
            key={action}
            variant={action === "execute" ? "primary" : "default"}
            disabled={busy}
            onClick={() => void choose(action)}
          >
            {t(`native.plan.${action}`)}
          </Button>
        ))}
      </div>
    </section>
  );
}

export function NativeJobsButton() {
  const { activeSessionId } = useSessionMeta();
  return <SessionJobs key={activeSessionId ?? "empty"} sessionId={activeSessionId} />;
}
function SessionJobs({ sessionId: activeSessionId }: { sessionId: string | null }) {
  const t = useT();
  const { showToast } = useUiStore();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NativeJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [output, setOutput] = useState<NativeJobOutput | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const api = pideskApi();
    if (!api || !open || !activeSessionId) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const jobs = await unwrap(api.durable.jobs(activeSessionId));
        const result = selected
          ? await unwrap(api.durable.inspectJob(activeSessionId, selected))
          : null;
        if (!cancelled) {
          setRows(jobs);
          setOutput(result);
        }
      } catch (error) {
        if (!cancelled) {
          showToast(String(error));
          setOpen(false);
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, activeSessionId, selected, showToast]);
  const stop = async () => {
    const api = pideskApi();
    if (!api || !activeSessionId || !selected || busy) return;
    setBusy(true);
    try {
      const result = await unwrap(api.durable.stopJob(activeSessionId, selected));
      setOutput(result);
      setRows((jobs) => jobs.map((job) => (job.id === selected ? result.job : job)));
    } catch (error) {
      showToast(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={toolbarStyles.iconBtn}
        disabled={!activeSessionId}
        title={t("native.jobs")}
        aria-label={t("native.jobs")}
        onClick={() => {
          setRows([]);
          setOutput(null);
          setSelected(null);
          setOpen(true);
        }}
      >
        <TerminalWindow size={20} weight="regular" />
      </button>
      <Modal
        open={open && !!activeSessionId}
        onClose={() => setOpen(false)}
        ariaLabel={t("native.jobs")}
        panelClassName={styles.dialog}
      >
        <h2>{t("native.jobs")}</h2>
        <div className={styles.scroll}>
          {rows.length === 0 ? (
            <p>{t("native.jobs.empty")}</p>
          ) : (
            <OptionList
              role="listbox"
              ariaLabel={t("native.jobs")}
              rows={rows.map((job) => ({
                key: job.id,
                text: `${job.label || job.command} · ${t(`native.job.${job.status}`)}`,
                node: (
                  <span>
                    {job.label || job.command} · {t(`native.job.${job.status}`)}
                  </span>
                ),
                selected: job.id === selected,
              }))}
              onSelect={(index) => {
                setOutput(null);
                setSelected(rows[index]?.id ?? null);
              }}
            />
          )}
          {output && (
            <>
              <p data-selectable-text>
                {output.job.id} · {t(`native.job.${output.job.status}`)}
                {output.job.exitCode === null ? "" : ` · ${output.job.exitCode}`}
              </p>
              {output.lost && <p data-selectable-text>{t("native.jobs.truncated")}</p>}
              <pre className={styles.output} data-selectable-text>
                {output.output}
              </pre>
              {output.job.status === "orphaned" && <p>{t("native.jobs.orphaned")}</p>}
              <Button
                variant="danger"
                onClick={() => void stop()}
                disabled={busy || output.job.status !== "running"}
              >
                {t("native.jobs.stop")}
              </Button>
            </>
          )}
        </div>
        <div className={styles.actions}>
          <Button onClick={() => setOpen(false)}>{t("common.close")}</Button>
        </div>
      </Modal>
    </>
  );
}
