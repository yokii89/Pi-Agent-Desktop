/**
 * 扩展 UI 子协议的 IPC 注册（docs/design/123）。
 *
 * Retained in-memory UI adapter. Native extensions use instance Views or Durable
 * interactions; this module cannot write to a retired agent process.
 */
import { ipcMain } from "electron";
import type { IpcResult, SessionUiRespondRequest, SessionUiRespondResult } from "../../shared/ipc";
import { SESSION_UI_IPC } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import { getSessionUiLedger, type SessionUiAnswer } from "./extensionUi";
import { markRuntimeUsedByUser } from "./runtimeCoordinator";

function toAnswer(req: SessionUiRespondRequest): SessionUiAnswer {
  const answer: SessionUiAnswer = {};
  if (typeof req.value === "string") answer.value = req.value;
  if (typeof req.confirmed === "boolean") answer.confirmed = req.confirmed;
  if (req.cancelled === true) answer.cancelled = true;
  return answer;
}

export function registerSessionUiIpc(): void {
  ipcMain.handle(
    SESSION_UI_IPC.respond,
    (_event, req: SessionUiRespondRequest): IpcResult<SessionUiRespondResult> =>
      envelope(() => {
        // 渲染层报告不是可信输入：缺字段一律按「未结算」处理，不写 pi stdin
        if (!req || typeof req !== "object") return { settled: false };
        const { sessionId, id } = req;
        if (typeof sessionId !== "string" || !sessionId) return { settled: false };
        if (typeof id !== "string" || !id) return { settled: false };
        const settled = getSessionUiLedger()?.respond(sessionId, id, toAnswer(req)) ?? false;
        if (settled) markRuntimeUsedByUser(sessionId);
        return { settled };
      }),
  );
}
