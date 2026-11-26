import { ipcMain } from "electron";
import { boundedText, record } from "../../shared/durableProtocol";
import { sessionRefFromKey, sessionRefKey } from "../../shared/sessionRef";
import { TELEGRAM_IPC } from "../../shared/telegram";
import { agentRuntimeManager } from "../agentRuntime/agentRuntimeManager";
import { desktopSessions } from "../agentRuntime/desktopSessions";
import { envelopeAsync } from "../ipc/envelope";
import { durableCatalog } from "../settings/durableStore";
import {
  mergeTelegramConfig,
  readTelegramConfig,
  writeTelegramConfig,
} from "../settings/telegramStore";
import { getMainWindow } from "../window/createMainWindow";
import { TelegramBridge } from "./bridge";

export const telegramService = new TelegramBridge(readTelegramConfig, writeTelegramConfig, {
  open: (key) => desktopSessions.start({ ref: sessionRefFromKey(key) }),
  submit: async (id, text, requestId) => {
    await desktopSessions.submit(id, text, "followUp", requestId);
  },
  abort: async (id, clear) => {
    if (clear) await desktopSessions.clearQueue(id);
    await desktopSessions.command(id, {
      op: "abort",
      sessionId: desktopSessions.require(id).storedId,
    });
  },
  continue: async (id, requestId) => {
    await desktopSessions.command(id, {
      op: "continue",
      sessionId: desktopSessions.require(id).storedId,
      requestId,
    });
  },
  state: async (id) =>
    (await desktopSessions.command(id, {
      op: "nativeState",
      sessionId: desktopSessions.require(id).storedId,
    })) as import("../../shared/nativeBuiltins").NativeSessionState,
  answer: (id, taskId, reply) =>
    desktopSessions.command(id, {
      op: "answerQuestionnaire",
      sessionId: desktopSessions.require(id).storedId,
      taskId,
      version: 1,
      reply,
    }),
  plan: async (id, taskId, action) => {
    const result = await desktopSessions.command(id, {
      op: "answerPlan",
      sessionId: desktopSessions.require(id).storedId,
      taskId,
      action,
    });
    if (
      record(result) &&
      record(result.result) &&
      result.result.action === "new" &&
      boundedText(result.result.text, 128000) &&
      boundedText(result.result.path, 32768)
    ) {
      const target = await desktopSessions.executePlanInNewSession(
        id,
        taskId,
        result.result.text,
        result.result.path,
      );
      // Explicit /plan new transfers the binding to the actual newly created desktop session.
      telegramService.disconnect();
      writeTelegramConfig({
        ...readTelegramConfig(),
        sessionKey: target.file,
        delivered: 0,
        pending: null,
        outbox: [],
      });
      await telegramService.connect();
      return target;
    }
    return result;
  },
  baseline: async (id) => (await desktopSessions.entries(id, undefined, 1))[0]?.id ?? 0,
  cwd: (key) => {
    const summary = durableCatalog().find((item) => item.file === key);
    if (!summary?.cwd) throw new Error("Unknown Telegram workspace.");
    return summary.cwd;
  },
});

/** Same trusted-window boundary as model settings. Connecting is always an explicit desktop action. */
export function registerTelegramIpc(): void {
  agentRuntimeManager.setHostHandler((request, signal) => telegramService.host(request, signal));
  agentRuntimeManager.subscribe(
    (update) => telegramService.observe(update),
    () => telegramService.disconnect(),
  );
  for (const [op, channel] of Object.entries(TELEGRAM_IPC)) {
    ipcMain.handle(channel, (event, request: unknown) =>
      envelopeAsync(async () => {
        const window = getMainWindow();
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("UNTRUSTED_SENDER");
        if (op === "status") return telegramService.status();
        if (op === "disconnect") return telegramService.disconnect();
        if (op === "connect") return telegramService.connect();
        if (op === "save") {
          const config = mergeTelegramConfig(request, readTelegramConfig());
          telegramService.disconnect();
          writeTelegramConfig(config);
          return telegramService.status();
        }
        if (op === "bind") {
          if (!record(request) || !boundedText(request.sessionId, 128))
            throw new Error("Choose an open Durable session.");
          const attachment = desktopSessions.require(request.sessionId);
          const baseline = (await desktopSessions.entries(attachment.id, undefined, 1))[0]?.id ?? 0;
          telegramService.disconnect();
          writeTelegramConfig({
            ...readTelegramConfig(),
            sessionKey: sessionRefKey({ kind: "durable", id: attachment.storedId }),
            delivered: baseline,
            pending: null,
            outbox: [],
          });
          return telegramService.status();
        }
        throw new Error("Unknown Telegram operation.");
      }),
    );
  }
}
