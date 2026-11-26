import { ipcMain } from "electron";
import {
  boundedText,
  DURABLE_IPC,
  parseDurableCommand,
  record,
} from "../../shared/durableProtocol";
import { t } from "../../shared/i18n";
import { parseImageInputContents } from "../../shared/imageInput";
import { isThinkingLevelId, PI_IPC, SESSION_IPC, type SessionStartRequest } from "../../shared/ipc";
import { NATIVE_IPC } from "../../shared/nativeBuiltins";
import { sessionRefFromKey } from "../../shared/sessionRef";
import { envelopeAsync } from "../ipc/envelope";
import { discoverGatewayModels } from "../models/newApiCatalog";
import { disposeIdleSession } from "../session/disposeIdleSession";
import { exportSessionHtml, exportSessionMarkdown } from "../session/exportSession";
import { getCachedPiShellProbe, setPiShellPath } from "../session/piShell";
import { sessionRepository } from "../session/sessionRepository";
import { publicBuiltinTools, saveBuiltinTools } from "../settings/builtinToolsStore";
import { publicDurableModel, readDurableModel } from "../settings/durableStore";
import { gatewayCatalog, importCodexModel, saveGatewayModel } from "../settings/newApiStore";
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
    if (!boundedText(request.text, 256_000, true))
      throw new Error(t("session.durable.inputTooLong"));
    const images = request.images === undefined ? [] : parseImageInputContents(request.images);
    if (images === null) throw new Error(t("session.durable.invalidImages"));
    if (!request.text.trim() && images.length === 0)
      throw new Error(t("session.durable.emptyInput"));
    if (
      request.streamingBehavior !== undefined &&
      !["steer", "followUp"].includes(String(request.streamingBehavior))
    )
      throw new Error("Invalid queue intent.");
    return desktopSessions.submit(
      id(request.sessionId),
      request.text,
      request.streamingBehavior as "steer" | "followUp" | undefined,
      undefined,
      images.length ? images : undefined,
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
  handle(SESSION_IPC.getModelState, async (request) => {
    await desktopSessions.initialize();
    return desktopSessions.modelState(
      request.sessionId === undefined ? undefined : id(request.sessionId),
    );
  });
  handle(SESSION_IPC.getStats, () => ({}));
  handle(SESSION_IPC.getModels, async (request) => {
    if (request.force !== undefined && typeof request.force !== "boolean")
      throw new Error("Invalid refresh request.");
    const catalog = await desktopSessions.refreshModels(request.force === true);
    return catalog.models.map((model) => ({
      provider: "pidesk-openai",
      modelId: model.id,
      label: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      input: model.input,
      availableThinkingLevels: model.reasoning
        ? ["off", "minimal", "low", "medium", "high", "xhigh"]
        : ["off"],
    }));
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
    if (request.provider !== "pidesk-openai" || !boundedText(request.modelId, 256))
      throw new Error("Invalid desktop model selection.");
    return desktopSessions.selectModel(
      request.modelId,
      request.sessionId === undefined ? undefined : id(request.sessionId),
    );
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
  for (const op of [
    "nativeState",
    "nativeMode",
    "answerQuestionnaire",
    "answerPlan",
    "jobs",
    "inspectJob",
    "stopJob",
  ] as const) {
    const channel = {
      nativeState: NATIVE_IPC.state,
      nativeMode: NATIVE_IPC.mode,
      answerQuestionnaire: NATIVE_IPC.answer,
      answerPlan: NATIVE_IPC.plan,
      jobs: NATIVE_IPC.jobs,
      inspectJob: NATIVE_IPC.inspect,
      stopJob: NATIVE_IPC.stop,
    }[op];
    handle(channel, async (request) => {
      const attachment = desktopSessions.require(id(request.sessionId));
      const command = parseDurableCommand({ ...request, op, sessionId: attachment.storedId });
      if (!command) throw new Error("Invalid built-in operation.");
      const result = await desktopSessions.command(attachment.id, command);
      if (command.op === "answerPlan") {
        if (!record(result) || typeof result.status !== "string")
          throw new Error("Invalid plan review response.");
        if (
          record(result.result) &&
          result.result.action === "new" &&
          boundedText(result.result.text, 128000) &&
          boundedText(result.result.path, 32768)
        )
          return {
            status: result.status,
            ...(await desktopSessions.executePlanInNewSession(
              attachment.id,
              command.taskId,
              result.result.text,
              result.result.path,
            )),
          };
        return { status: result.status };
      }
      return result;
    });
  }
  handle(DURABLE_IPC.builtinTools, () => publicBuiltinTools());
  handle(DURABLE_IPC.saveBuiltinTools, async (request) => {
    const config = saveBuiltinTools(request);
    await desktopSessions.updateBuiltinTools();
    return config;
  });
  handle(DURABLE_IPC.model, () => publicDurableModel());
  handle(DURABLE_IPC.modelCatalog, (request) => {
    if (request.force !== undefined && typeof request.force !== "boolean")
      throw new Error("Invalid refresh request.");
    return desktopSessions.refreshModels(request.force === true);
  });
  handle(DURABLE_IPC.clearModelCache, () => {
    gatewayCatalog.clear();
    return null;
  });
  handle(DURABLE_IPC.testModelConnection, async () => {
    const config = readDurableModel();
    if (!config) throw new Error("Save a gateway configuration first.");
    const started = Date.now();
    const models = await discoverGatewayModels(config);
    return { count: models.length, latencyMs: Date.now() - started };
  });
  handle(DURABLE_IPC.importCodexModel, () => desktopSessions.changeModel(importCodexModel));
  handle(DURABLE_IPC.saveModel, (request) =>
    desktopSessions.changeModel(() => saveGatewayModel(request)),
  );
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
    version: "1.6.0",
    provider: "pidesk-openai",
    model: publicDurableModel()?.modelId ?? null,
    thinkingLevel: "off",
  }));
  handle(PI_IPC.shellGet, () => getCachedPiShellProbe());
  handle(PI_IPC.shellSet, async (request) => {
    if (request.path !== null && !boundedText(request.path, 32_768))
      throw new Error("Invalid shell path.");
    const probe = setPiShellPath(request.path as string | null);
    await desktopSessions.updateExecutionShell();
    return probe;
  });
}
