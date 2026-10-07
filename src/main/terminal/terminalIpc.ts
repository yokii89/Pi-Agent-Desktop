import { ipcMain } from "electron";
import type { IpcResult, TerminalCreateRequest } from "../../shared/ipc";
import { TERMINAL_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { createTerminal, disposeTerminal, resizeTerminal, writeTerminal } from "./terminal";

/** 注册独立终端 IPC（docs/design/03 §4 / §8）。 */
export function registerTerminalIpc(): void {
  ipcMain.handle(
    TERMINAL_IPC.create,
    (_event, req: TerminalCreateRequest): Promise<IpcResult<string>> =>
      envelopeAsync(async () => createTerminal(req?.cwd)),
  );

  ipcMain.handle(
    TERMINAL_IPC.input,
    (_event, req: { id: string; data: string }): IpcResult<null> =>
      envelope(() => {
        writeTerminal(req.id, req.data);
        return null;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC.resize,
    (_event, req: { id: string; cols: number; rows: number }): IpcResult<null> =>
      envelope(() => {
        resizeTerminal(req.id, req.cols, req.rows);
        return null;
      }),
  );

  ipcMain.handle(
    TERMINAL_IPC.dispose,
    (_event, req: { id: string }): IpcResult<null> =>
      envelope(() => {
        disposeTerminal(req.id);
        return null;
      }),
  );
}
