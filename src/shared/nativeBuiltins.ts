/** App-owned questionnaire, plan and job DTOs. No Electron or runtime imports. */
export type NativeExecutionConfig = { shell: string; env: Record<string, string> };
export type NativeQuestion = {
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};
export type NativeAnswer = { selected: string[]; text: string };
export type QuestionnaireReply = { cancelled: boolean; answers: NativeAnswer[] };
export type PendingQuestionnaire = {
  taskId: number;
  callId: string;
  version: 1;
  questions: NativeQuestion[];
  until: number;
};
export const PLAN_ACTIONS = ["execute", "new", "explore", "save"] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];
export type PendingPlan = { taskId: number; text: string; fingerprint: string; until: number };
export type NativeSessionState = {
  mode: "edit" | "plan";
  questions: Record<string, PendingQuestionnaire>;
  plan: PendingPlan | null;
  lastPlan: string;
  savedPlan: string;
};
export const NATIVE_STATE_KIND = "pidesk.builtins";
export const NATIVE_JOBS_KIND = "pidesk.jobs";
export const INTERACTION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const initialNativeSessionState = (): NativeSessionState => ({
  mode: "edit",
  questions: {},
  plan: null,
  lastPlan: "",
  savedPlan: "",
});

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number, empty = false): value is string {
  return (
    typeof value === "string" &&
    (empty || !!value.trim()) &&
    value.length <= max &&
    !value.includes("\0")
  );
}
/** Validate model inputs independently of provider-side schema validation. */
export function parseNativeQuestions(value: unknown): NativeQuestion[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
  const questions: NativeQuestion[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      !object(item) ||
      !text(item.header, 16) ||
      !text(item.question, 8000) ||
      seen.has(item.question.trim().toLowerCase()) ||
      !Array.isArray(item.options) ||
      item.options.length < 2 ||
      item.options.length > 4 ||
      (item.multiSelect !== undefined && typeof item.multiSelect !== "boolean")
    )
      return null;
    seen.add(item.question.trim().toLowerCase());
    const options: NativeQuestion["options"] = [];
    const labels = new Set<string>();
    for (const option of item.options) {
      if (
        !object(option) ||
        !text(option.label, 60) ||
        !text(option.description, 8000, true) ||
        ["other", "type something.", "next"].includes(option.label.trim().toLowerCase()) ||
        labels.has(option.label.trim().toLowerCase())
      )
        return null;
      labels.add(option.label.trim().toLowerCase());
      options.push({ label: option.label, description: option.description });
    }
    questions.push({
      header: item.header,
      question: item.question,
      options,
      multiSelect: item.multiSelect === true,
    });
  }
  return questions;
}
/** Bind an answer to the exact current questionnaire, including option membership and cardinality. */
export function parseQuestionnaireReply(
  value: unknown,
  questions: readonly NativeQuestion[],
): QuestionnaireReply | null {
  if (!object(value) || typeof value.cancelled !== "boolean" || !Array.isArray(value.answers))
    return null;
  if (value.cancelled) return value.answers.length === 0 ? { cancelled: true, answers: [] } : null;
  if (value.answers.length !== questions.length) return null;
  const answers: NativeAnswer[] = [];
  for (const [index, question] of questions.entries()) {
    const answer: unknown = value.answers[index];
    if (
      !object(answer) ||
      !Array.isArray(answer.selected) ||
      !text(answer.text, 16000, true) ||
      answer.selected.length > (question.multiSelect ? question.options.length : 1) ||
      new Set(answer.selected).size !== answer.selected.length ||
      !answer.selected.every(
        (label) =>
          typeof label === "string" && question.options.some((option) => option.label === label),
      ) ||
      (answer.selected.length === 0 && !answer.text.trim())
    )
      return null;
    answers.push({ selected: answer.selected as string[], text: answer.text.trim() });
  }
  return { cancelled: false, answers };
}

/** Validate app-owned document pushes before they cross the runtime port. */
export function isNativeSessionState(value: unknown): value is NativeSessionState {
  const id = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  const deadline = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const fingerprint = (value: unknown): value is string =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (
    !object(value) ||
    !["edit", "plan"].includes(String(value.mode)) ||
    !object(value.questions) ||
    Object.keys(value.questions).length > 128 ||
    !text(value.savedPlan, 32768, true) ||
    (value.lastPlan !== "" && !fingerprint(value.lastPlan))
  )
    return false;
  for (const [key, pending] of Object.entries(value.questions)) {
    if (
      !object(pending) ||
      !id(pending.taskId) ||
      key !== String(pending.taskId) ||
      pending.version !== 1 ||
      !text(pending.callId, 512) ||
      !deadline(pending.until) ||
      !parseNativeQuestions(pending.questions)
    )
      return false;
  }
  return (
    value.plan === null ||
    (object(value.plan) &&
      id(value.plan.taskId) &&
      text(value.plan.text, 128000) &&
      fingerprint(value.plan.fingerprint) &&
      deadline(value.plan.until))
  );
}

export type NativeJob = {
  id: string;
  taskId: number;
  callId: string;
  command: string;
  label: string;
  mode: "finish" | "detach" | "long";
  status: "running" | "exited" | "stopped" | "timed-out" | "orphaned";
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  logPath: string;
  truncated: boolean;
};
export type NativeJobOutput = { job: NativeJob; output: string; cursor: string; lost: boolean };
export type NativeStatePush = { sessionId: string; state: NativeSessionState };
export const NATIVE_IPC = {
  state: "pidesk:durable:nativeState",
  output: "pidesk:durable:nativeOutput",
  mode: "pidesk:durable:nativeMode",
  answer: "pidesk:durable:nativeAnswer",
  plan: "pidesk:durable:nativePlan",
  jobs: "pidesk:durable:nativeJobs",
  inspect: "pidesk:durable:nativeInspect",
  stop: "pidesk:durable:nativeStop",
} as const;
