import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { TelegramHostRequest } from "../../shared/telegram.js";
import { toolArgs } from "./output.js";
export type TelegramHost = (request: TelegramHostRequest, signal?: AbortSignal) => Promise<string>;
/** Bot credentials and destination resolution stay in main; tools receive only delivery receipts. */
export function telegramTools(sessionId: string, host: TelegramHost): ToolRegistration[] {
  return [
    {
      name: "telegram_help",
      description: "Read PiDesk Telegram delivery and current feature guidance.",
      replay: "safe",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async execute(_args, _api, context) {
        return {
          output: [
            {
              type: "text",
              text: await host({ sessionId, op: "telegram_help" }, context.abortSignal),
            },
          ],
        };
      },
    },
    {
      name: "telegram_message",
      description:
        "Send a direct Telegram message to this session's explicitly configured private destination. Use only when the user explicitly asks for a direct Telegram message. Incoming Telegram turns already deliver completed answers automatically.",
      replay: "unsafe",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string", minLength: 1, maxLength: 32000 } },
      },
      async execute(args, _api, context) {
        return {
          output: [
            {
              type: "text",
              text: await host(
                { sessionId, op: "telegram_message", text: String(toolArgs(args).text) },
                context.abortSignal,
              ),
            },
          ],
        };
      },
    },
    {
      name: "telegram_attach",
      description:
        "Deliver 1–10 requested files through this session's configured Telegram destination. During Telegram work files queue for the active reply. For local work, use only when the user explicitly requests Telegram delivery. Paths may be absolute or relative to this workspace.",
      replay: "unsafe",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["paths"],
        properties: {
          paths: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string", minLength: 1, maxLength: 32768 },
          },
        },
      },
      async execute(args, _api, context) {
        return {
          output: [
            {
              type: "text",
              text: await host(
                { sessionId, op: "telegram_attach", paths: toolArgs(args).paths as string[] },
                context.abortSignal,
              ),
            },
          ],
        };
      },
    },
  ];
}
