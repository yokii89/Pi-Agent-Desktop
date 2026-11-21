import { clipboard, ipcMain, nativeImage } from "electron";
import type { ClipboardWriteImageRequest } from "../../shared/ipc";
import { CLIPBOARD_IPC } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";

/** PNG dataURL 前缀：只收渲染层后台渲染出的位图，不收任意 URL。 */
const PNG_DATA_URL = /^data:image\/png;base64,[a-z0-9+/=\s]+$/i;

/** 注册剪贴板写入和主窗口原生粘贴；粘贴仍由编辑器的 paste 事件处理。 */
export function registerClipboardIpc(): void {
  ipcMain.handle(CLIPBOARD_IPC.paste, (event) =>
    envelope(() => {
      const win = getMainWindow();
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      ) {
        throw new Error("UNTRUSTED_SENDER");
      }
      // 焦点离开主窗口或主 frame 后，本次粘贴作废。
      if (!win.isFocused() || event.sender.focusedFrame !== event.sender.mainFrame) return null;
      event.sender.paste();
      return null;
    }),
  );

  ipcMain.handle(CLIPBOARD_IPC.writeImage, (_event, req: ClipboardWriteImageRequest) =>
    envelope(() => {
      const dataUrl = (req?.dataUrl ?? "").trim();
      if (!PNG_DATA_URL.test(dataUrl)) throw new Error("仅支持 PNG dataURL");
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) throw new Error("图片数据为空");
      clipboard.writeImage(image);
      return null;
    }),
  );
}
