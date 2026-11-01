/**
 * 扩展 UI 子协议的 IPC 注册（docs/design/123）。
 *
 * 出站（渲染层 → 主进程 → pi stdin）只有 `respond` 一条：推送走
 * `SESSION_UI_IPC.output`（由 piSession 直发），不需要渲染层订阅式回执。
 */
import { ipcMain } from "electron";
import type { IpcResult, SessionUiRespondRequest, SessionUiRespondResult } from "../../shared/ipc";
import { SESSION_UI_IPC } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import type { SessionUiAnswer } from "./extensionUi";
import { respondSessionUi } from "./piSession";

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
        return { settled: respondSessionUi(sessionId, id, toAnswer(req)) };
      }),
  );
}
