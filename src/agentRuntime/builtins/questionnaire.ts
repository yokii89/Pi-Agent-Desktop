import type { ToolRegistration } from "@earendil-works/pi-durable";
import {
  INTERACTION_LIFETIME_MS,
  parseNativeQuestions,
  parseQuestionnaireReply,
} from "../../shared/nativeBuiltins.js";
import { toolArgs } from "./output.js";
import { NativeState, QuestionnaireSignal } from "./state.js";

/** A question holds a durable task, never an in-memory UI callback. */
export function questionnaireTool(): ToolRegistration {
  return {
    name: "ask_user_question",
    description:
      "Ask the user 1–4 structured questions when a decision is needed. Each question has 2–4 options, optional multiSelect, and a built-in free-text field. Do not author Other, Type something. or Next options. The user may cancel. Wait for the actual answer before dependent work.",
    replay: "safe",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["header", "question", "options"],
            properties: {
              header: { type: "string", minLength: 1, maxLength: 16 },
              question: { type: "string", minLength: 1, maxLength: 8000 },
              multiSelect: { type: "boolean", default: false },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "description"],
                  properties: {
                    label: { type: "string", minLength: 1, maxLength: 60 },
                    description: { type: "string", maxLength: 8000 },
                  },
                },
              },
            },
          },
        },
      },
    },
    async execute(args, api, context) {
      const questions = parseNativeQuestions(toolArgs(args).questions);
      if (!questions)
        throw new Error(
          "Invalid questionnaire. Use 1–4 distinct questions, 2–4 distinct options and no reserved labels.",
        );
      const signal = await api.readSignal(QuestionnaireSignal, "answer", context);
      if (signal !== undefined) {
        await api.commit(async (tx) => {
          delete (await tx.doc(NativeState, api.conversationId)).questions[String(api.taskId)];
        }, context);
        let reply = null;
        if ("value" in signal && typeof signal.value === "string") {
          try {
            reply = parseQuestionnaireReply(JSON.parse(signal.value), questions);
          } catch {
            /* An invalid stored answer cannot approve a decision. */
          }
        }
        if (!reply)
          return {
            output: [{ type: "text", text: "The questionnaire expired without an answer." }],
            isError: true,
          };
        return {
          output: [
            {
              type: "text",
              text: reply.cancelled
                ? "The user cancelled the questionnaire. No decision was approved."
                : questions
                    .map((question, index) => {
                      const answer = reply.answers[index];
                      return `${question.question}\n${answer.selected.join(", ")}${answer.text ? `${answer.selected.length ? "\nUser notes: " : ""}${answer.text}` : ""}`;
                    })
                    .join("\n\n"),
            },
          ],
          details: { cancelled: reply.cancelled, answers: reply.answers },
        };
      }
      const until = await api.memo(
        "pidesk.questionnaire.until",
        api.now() + INTERACTION_LIFETIME_MS,
        context,
      );
      if (until <= api.now()) {
        await api.commit(async (tx) => {
          delete (await tx.doc(NativeState, api.conversationId)).questions[String(api.taskId)];
        }, context);
        return {
          output: [{ type: "text", text: "The questionnaire expired without an answer." }],
          isError: true,
        };
      }
      await api.commit(async (tx) => {
        const state = await tx.doc(NativeState, api.conversationId);
        state.questions[String(api.taskId)] = {
          taskId: api.taskId,
          callId: api.callId,
          version: 1,
          questions,
          until,
        };
      }, context);
      return { sleep: { signals: [QuestionnaireSignal.key("answer")], until } };
    },
    async cancel(_args, api, context) {
      await api.commit(async (tx) => {
        delete (await tx.doc(NativeState, api.conversationId)).questions[String(api.taskId)];
      }, context);
    },
  };
}
