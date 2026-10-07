import { ipcMain } from "electron";
import { INSPECTOR_FLOAT_IPC, type InspectorFloatHandoff } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import {
  closeInspectorWindow,
  focusInspectorWindow,
  isInspectorWindowOpen,
  openInspectorWindow,
  relayChatAddToMainWindow,
  requestDockFromHost,
  setPendingHandoff,
  takePendingHandoff,
} from "./inspectorWindow";

/** 检查器浮窗 IPC（docs/design/38 §4.3）。 */
export function registerInspectorFloatIpc(): void {
  ipcMain.handle(
    INSPECTOR_FLOAT_IPC.open,
    (_event, req?: { handoff?: InspectorFloatHandoff | null }) =>
      envelope(() => {
        openInspectorWindow(req?.handoff ?? null);
        return isInspectorWindowOpen();
      }),
  );

  ipcMain.handle(
    INSPECTOR_FLOAT_IPC.dock,
    (_event, req?: { handoff?: InspectorFloatHandoff | null; fromHost?: boolean }) =>
      envelope(() => {
        if (req?.fromHost) return requestDockFromHost();
        closeInspectorWindow(req?.handoff ?? null);
        return null;
      }),
  );

  ipcMain.handle(INSPECTOR_FLOAT_IPC.focus, () => envelope(() => focusInspectorWindow()));

  ipcMain.handle(INSPECTOR_FLOAT_IPC.takeHandoff, () => envelope(() => takePendingHandoff()));

  ipcMain.handle(
    INSPECTOR_FLOAT_IPC.returnHandoff,
    (_event, req?: { handoff?: InspectorFloatHandoff | null }) =>
      envelope(() => {
        setPendingHandoff(req?.handoff ?? null);
        return null;
      }),
  );

  ipcMain.handle(INSPECTOR_FLOAT_IPC.chatAdd, () =>
    envelope(() => {
      relayChatAddToMainWindow();
      return null;
    }),
  );
}
