import { protocol } from "electron";
import { IMAGE_PREVIEW_SCHEME } from "../shared/imagePreview";
import { WALLPAPER_MEDIA_SCHEME } from "../shared/wallpaper";
import { servePreviewImage } from "./fs/imagePreview";

/** Electron requires all privileged schemes to be registered together before app ready. */
export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WALLPAPER_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
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
