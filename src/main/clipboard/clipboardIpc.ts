import { clipboard, ipcMain, nativeImage } from "electron";
import type { ClipboardWriteImageRequest } from "../../shared/ipc";
import { CLIPBOARD_IPC } from "../../shared/ipc";
import { envelope } from "../ipc/envelope";

/** PNG dataURL 前缀：只收渲染层后台渲染出的位图，不收任意 URL。 */
const PNG_DATA_URL = /^data:image\/png;base64,[a-z0-9+/=\s]+$/i;

/**
 * 系统剪贴板写入（docs/design/135）：表格「复制为图片」由渲染层离线渲染成 PNG，
 * 这里只负责落进系统剪贴板——渲染层没有 Electron clipboard，文本复制仍走 navigator.clipboard。
 */
export function registerClipboardIpc(): void {
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
