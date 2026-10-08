import { ipcMain, shell } from "electron";
import { WINDOW_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { getMainWindow } from "./createMainWindow";

/** 注册窗口控制 IPC（自绘标题栏三键 + 最大化状态查询 + 外链）。 */
export function registerWindowIpc(): void {
  ipcMain.handle(WINDOW_IPC.minimize, () =>
    envelope(() => {
      getMainWindow()?.minimize();
      return null;
    }),
  );

  // 切换最大化 / 还原，返回切换后的状态供渲染层立即更新图标
  ipcMain.handle(WINDOW_IPC.toggleMaximize, () =>
    envelope(() => {
      const win = getMainWindow();
      if (!win) return false;
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return win.isMaximized();
    }),
  );

  ipcMain.handle(WINDOW_IPC.close, () =>
    envelope(() => {
      getMainWindow()?.close();
      return null;
    }),
  );

  ipcMain.handle(WINDOW_IPC.getState, () =>
    envelope(() => getMainWindow()?.isMaximized() ?? false),
  );

  ipcMain.handle(WINDOW_IPC.openExternal, (_event, req: { url?: string }) =>
    envelopeAsync(async () => {
      const url = (req?.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("仅支持 http(s) 外链");
      await shell.openExternal(url);
      return null;
    }),
  );
}
