import { protocol } from "electron";
import {
  WALLPAPER_MEDIA_HOST,
  WALLPAPER_MEDIA_SCHEME,
  wallpaperMimeType,
} from "../../shared/wallpaper";
import { serveMediaFile } from "../mediaStream";
import { getSettings } from "../settings/settings";

/** 注册协议处理；必须在 app ready 之后、窗口加载之前调用。 */
export function registerWallpaperProtocol(): void {
  protocol.handle(WALLPAPER_MEDIA_SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }
    const url = new URL(request.url);
    if (url.hostname !== WALLPAPER_MEDIA_HOST) {
      return new Response(null, { status: 404 });
    }
    const filePath = getSettings().wallpaperPath;
    const mime = filePath ? wallpaperMimeType(filePath) : null;
    if (!filePath || !mime || url.searchParams.get("v") !== filePath) {
      // 迟到的旧请求不能拿到新文件，更不能把旧文件当作新选择的媒体返回。
      return new Response(null, { status: 404 });
    }
    return serveMediaFile(request, filePath, mime);
  });
}
