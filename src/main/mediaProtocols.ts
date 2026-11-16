import { protocol } from "electron";
import { IMAGE_PREVIEW_SCHEME } from "../shared/imagePreview";
import { MEDIA_PREVIEW_SCHEME } from "../shared/mediaPreview";
import { WALLPAPER_MEDIA_SCHEME } from "../shared/wallpaper";
import { servePreviewImage } from "./fs/imagePreview";
import { servePreviewMedia } from "./fs/mediaPreview";

/** Electron requires all privileged schemes to be registered together before app ready. */
export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WALLPAPER_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
    {
      scheme: MEDIA_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
    {
      scheme: IMAGE_PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/** Install after app ready, before any renderer loads. */
export function registerImagePreviewProtocol(): void {
  protocol.handle(IMAGE_PREVIEW_SCHEME, servePreviewImage);
}

/** 文件面板音视频协议与壁纸各自校验授权，共用底层流读取。 */
export function registerMediaPreviewProtocol(): void {
  protocol.handle(MEDIA_PREVIEW_SCHEME, servePreviewMedia);
}
