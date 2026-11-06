import { ipcMain } from "electron";
import type { IpcResult } from "../../shared/ipc";
import { FAVICON_IPC } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { resolveFaviconDataUrl } from "./faviconService";

/**
 * 注册站点 favicon 抓取 IPC：渲染层传页面 URL，主进程代为抓取并按 origin 缓存，
 * 返回 data URL（失败为 null，不抛错）。
 */
export function registerFaviconIpc(): void {
  ipcMain.handle(
    FAVICON_IPC.get,
    (_event, req: { url?: string }): Promise<IpcResult<{ dataUrl: string | null }>> =>
      envelopeAsync(async () => ({
        dataUrl: await resolveFaviconDataUrl(req?.url ?? ""),
      })),
  );
}
