import { defineDoc, defineSignal } from "@earendil-works/pi-durable";
import {
  initialNativeSessionState,
  NATIVE_JOBS_KIND,
  NATIVE_STATE_KIND,
  type NativeJob,
} from "../../shared/nativeBuiltins.js";

/** Conversation authority for interaction restoration and execution gates. */
export const NativeState = defineDoc({
  kind: NATIVE_STATE_KIND,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: initialNativeSessionState,
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 32,
});
export const NativeJobs = defineDoc({
  kind: NATIVE_JOBS_KIND,
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: (): { items: NativeJob[] } => ({ items: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 32,
});
// JSON strings keep the signal small and schema-independent. The host validates the exact form first.
export const QuestionnaireSignal = defineSignal({
  name: "pidesk.questionnaire.answer",
  version: 1,
  schema: { type: "string", maxLength: 128000 },
});
export const PlanSignal = defineSignal({
  name: "pidesk.plan.answer",
  version: 1,
  schema: { type: "string", enum: ["execute", "new", "explore", "save"] },
});
