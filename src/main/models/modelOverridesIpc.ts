/**
 * 模型能力覆盖 IPC（docs/design/49）：读快照 / 写补丁 + 重载存活会话。
 * 写盘后自动重载存活会话（switch_session，保留对话），新覆盖在当前会话即生效；
 * busy 会话重载失败计入 failed，由渲染层提示「重开后生效」。
 */
import { ipcMain } from "electron";
import type {
  IpcResult,
  PiModelOverrideSetRequest,
  PiModelOverrideSetResult,
  PiModelOverridesSnapshot,
} from "../../shared/ipc";
import { MODEL_OVERRIDES_IPC } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { listLiveSessions, reloadSessionConfig } from "../session/piSession";
import { readModelOverrides, setModelOverride } from "./modelOverrides";

export function registerModelOverridesIpc(): void {
  ipcMain.handle(
    MODEL_OVERRIDES_IPC.get,
    (): Promise<IpcResult<PiModelOverridesSnapshot>> =>
      envelopeAsync(async () => readModelOverrides()),
  );

  ipcMain.handle(
    MODEL_OVERRIDES_IPC.set,
    (_event, req: PiModelOverrideSetRequest): Promise<IpcResult<PiModelOverrideSetResult>> =>
      envelopeAsync(async () => {
        if (!req || typeof req.provider !== "string" || typeof req.modelId !== "string") {
          throw new Error("参数不完整");
        }
        setModelOverride({
          provider: req.provider,
          modelId: req.modelId,
          patch: req.patch ?? {},
        });
        let reloaded = 0;
        let failed = 0;
        for (const sessionId of listLiveSessions()) {
          try {
            await reloadSessionConfig(sessionId);
            reloaded += 1;
          } catch {
            failed += 1;
          }
        }
        return { reloaded, failed };
      }),
  );
}
