import { ipcMain } from "electron";
import {
  boundedText,
  DURABLE_IPC,
  parseDurableCommand,
  record,
} from "../../shared/durableProtocol";
import { isThinkingLevelId, PI_IPC, SESSION_IPC, type SessionStartRequest } from "../../shared/ipc";
import { sessionRefFromKey } from "../../shared/sessionRef";
import { envelopeAsync } from "../ipc/envelope";
import { disposeIdleSession } from "../session/disposeIdleSession";
import { exportSessionHtml, exportSessionMarkdown } from "../session/exportSession";
import { getCachedPiShellProbe, setPiShellPath } from "../session/piShell";
import { sessionRepository } from "../session/sessionRepository";
import { publicDurableModel, saveDurableModel } from "../settings/durableStore";
import { getMainWindow } from "../window/createMainWindow";
import { desktopSessions } from "./desktopSessions";

function id(value: unknown): string {
  if (!boundedText(value, 128)) throw new Error("Invalid UI session ID.");
  return value;
}

/** Production session IPC is restricted to the main window's top frame, including model credentials. */
export function registerDurableSessionIpc(): void {
  const handle = (channel: string, operation: (request: Record<string, unknown>) => unknown) => {
    ipcMain.handle(channel, (event, request: unknown) =>
      envelopeAsync(async () => {
        const window = getMainWindow();
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("UNTRUSTED_SENDER");
        if (request !== undefined && !record(request)) throw new Error("Invalid request.");
        return operation(record(request) ? request : {});
      }),
    );
  };
  handle(SESSION_IPC.start, (request) => {
    if (request.cwd !== undefined && !boundedText(request.cwd, 32_768))
      throw new Error("Invalid cwd.");
    if (request.sessionFile !== undefined && !boundedText(request.sessionFile, 32_768))
      throw new Error("Invalid session key.");
    if (request.sessionId !== undefined) id(request.sessionId);
    if (
      request.ref !== undefined &&
      (!record(request.ref) ||
        !["durable", "legacy-jsonl"].includes(String(request.ref.kind)) ||
        (request.ref.kind === "durable"
          ? !boundedText(request.ref.id, 128)
          : !boundedText(request.ref.file, 32_768)))
    )
      throw new Error("Invalid session reference.");
    return desktopSessions.start(request as SessionStartRequest);
  });
  handle(SESSION_IPC.prompt, (request) => {
    if (!boundedText(request.text, 256_000) || !request.text.trim())
      throw new Error("Input must not be empty or exceed 256000 characters.");
    if (request.images !== undefined && (!Array.isArray(request.images) || request.images.length))
      throw new Error("This desktop model currently supports text input only.");
    if (
      request.streamingBehavior !== undefined &&
      !["steer", "followUp"].includes(String(request.streamingBehavior))
    )
      throw new Error("Invalid queue intent.");
    return desktopSessions.submit(
      id(request.sessionId),
      request.text,
      request.streamingBehavior as "steer" | "followUp" | undefined,
    );
  });
  handle(SESSION_IPC.clearQueue, (request) => desktopSessions.clearQueue(id(request.sessionId)));
  handle(SESSION_IPC.stop, async (request) => {
    const attachment = desktopSessions.require(id(request.sessionId));
    await desktopSessions.command(attachment.id, { op: "abort", sessionId: attachment.storedId });
    return null;
  });
  handle(SESSION_IPC.dispose, async (request) => {
    await desktopSessions.close(id(request.sessionId));
    return null;
  });
  handle(SESSION_IPC.disposeIdle, (request) => disposeIdleSession(id(request.sessionId)));
  handle(SESSION_IPC.listAll, () => sessionRepository.list());
  handle(SESSION_IPC.list, async (request) => {
    if (!boundedText(request.cwd, 32_768)) throw new Error("Invalid cwd.");
    return sessionRepository.list(request.cwd);
  });
  handle(SESSION_IPC.messages, (request) => desktopSessions.messages(id(request.sessionId)));
  handle(SESSION_IPC.readTranscript, (request) => {
    if (!boundedText(request.file, 32_768)) throw new Error("Invalid session key.");
    if (
      request.before !== undefined &&
      (typeof request.before !== "number" ||
        !Number.isSafeInteger(request.before) ||
        request.before < 1)
    )
      throw new Error("Invalid history cursor.");
    return sessionRepository.page(
      sessionRefFromKey(request.file),
      request.before as number | undefined,
    );
  });
  handle(SESSION_IPC.remove, async (request) => {
    if (!boundedText(request.file, 256)) throw new Error("Invalid session key.");
    await desktopSessions.remove(request.file);
    return null;
  });
  handle(SESSION_IPC.rename, (request) => {
    if (!boundedText(request.file, 256) || !boundedText(request.name, 256, true))
      throw new Error("Invalid session name.");
    return { name: desktopSessions.rename(request.file, request.name) };
  });
  handle(SESSION_IPC.getCommands, (request) => desktopSessions.commands(id(request.sessionId)));
  handle(SESSION_IPC.getModelState, (request) =>
    desktopSessions.modelState(request.sessionId === undefined ? undefined : id(request.sessionId)),
  );
  handle(SESSION_IPC.getStats, () => ({}));
  handle(SESSION_IPC.getModels, () => {
    const model = publicDurableModel();
    return model
      ? [
          {
            provider: "pidesk-openai",
            modelId: model.modelId,
            label: model.modelId,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            input: ["text"],
            availableThinkingLevels: model.reasoning
              ? ["off", "minimal", "low", "medium", "high", "xhigh"]
              : ["off"],
          },
        ]
      : [];
  });
  handle(SESSION_IPC.setThinkingLevel, async (request) => {
    if (!isThinkingLevelId(request.level)) throw new Error("Invalid thinking level.");
    const attachment = desktopSessions.require(id(request.sessionId));
    await desktopSessions.command(attachment.id, {
      op: "configure",
      sessionId: attachment.storedId,
      thinkingLevel: request.level === "max" ? "xhigh" : request.level,
    });
    return null;
  });
  const selectModel = async (request: Record<string, unknown>) => {
    const config = publicDurableModel();
    if (!config || request.provider !== "pidesk-openai" || request.modelId !== config.modelId)
      throw new Error("Model is not configured in desktop settings.");
    if (request.sessionId) {
      const attachment = desktopSessions.require(id(request.sessionId));
      await desktopSessions.command(attachment.id, {
        op: "configure",
        sessionId: attachment.storedId,
        modelId: config.modelId,
      });
    }
    return {
      provider: "pidesk-openai",
      modelId: config.modelId,
      label: config.modelId,
      sessionApplied: !!request.sessionId,
    };
  };
  handle(SESSION_IPC.setModel, selectModel);
  handle(SESSION_IPC.setDefaultModel, async (request) => {
    await selectModel(request);
    return null;
  });
  for (const [channel, exporter] of [
    [SESSION_IPC.exportHtml, exportSessionHtml],
    [SESSION_IPC.exportMarkdown, exportSessionMarkdown],
  ] as const)
    handle(channel, (request) => {
      if (
        !boundedText(request.file, 32_768) ||
        (request.title !== undefined && !boundedText(request.title, 256, true))
      )
        throw new Error("Invalid export request.");
      return exporter({ file: request.file, title: request.title as string | undefined });
    });
  handle(DURABLE_IPC.model, () => publicDurableModel());
  handle(DURABLE_IPC.saveModel, async (request) => {
    desktopSessions.assertModelEditable();
    const config = saveDurableModel(request);
    await desktopSessions.updateModel();
    return config;
  });
  handle(DURABLE_IPC.history, (request) => {
    const attachment = desktopSessions.require(id(request.sessionId));
    const command = parseDurableCommand({
      op: "history",
      sessionId: attachment.storedId,
      limit: request.limit ?? 100,
      ...(request.before === undefined ? {} : { before: request.before }),
    });
    if (command?.op !== "history") throw new Error("Invalid history page.");
    return desktopSessions.entries(attachment.id, command.before, command.limit);
  });
  for (const op of ["continue", "compact", "withdraw"] as const)
    handle(DURABLE_IPC[op], (request) => {
      const attachment = desktopSessions.require(id(request.sessionId));
      const fields = Object.fromEntries(
        Object.entries(request).filter(([, value]) => value !== undefined),
      );
      const command = parseDurableCommand({ ...fields, op, sessionId: attachment.storedId });
      if (!command) throw new Error("Invalid Durable command.");
      return desktopSessions.command(attachment.id, command);
    });
  handle(PI_IPC.info, () => ({
    version: "Durable 1.6.0",
    provider: "pidesk-openai",
    model: publicDurableModel()?.modelId ?? null,
    thinkingLevel: "off",
    executablePath: null,
  }));
  handle(PI_IPC.shellGet, () => getCachedPiShellProbe());
  handle(PI_IPC.shellSet, (request) => {
    if (request.path !== null && !boundedText(request.path, 32_768))
      throw new Error("Invalid shell path.");
    return setPiShellPath(request.path as string | null);
  });
}
