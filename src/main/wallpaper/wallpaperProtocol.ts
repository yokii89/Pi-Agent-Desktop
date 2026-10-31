import fs from "node:fs";
import { Readable } from "node:stream";
import { protocol } from "electron";
import {
  type ByteRange,
  parseByteRange,
  WALLPAPER_MEDIA_HOST,
  WALLPAPER_MEDIA_SCHEME,
  wallpaperMimeType,
} from "../../shared/wallpaper";
import { getSettings } from "../settings/settings";

/**
 * 本地壁纸媒体协议（docs/design/111）：渲染层不能直接读 `file://`（CSP 收紧、
 * contextIsolation），4K 图片 / 视频也不适合走 data URL 进 settings.json。
 * 协议只暴露当前设置里的那一个文件，不把任意路径开放给渲染层。
 */
export function registerWallpaperScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WALLPAPER_MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

function createMediaStream(filePath: string, range: ByteRange | null): fs.ReadStream {
  return range
    ? fs.createReadStream(filePath, { start: range.start, end: range.end })
    : fs.createReadStream(filePath);
}

function responseHeaders(
  size: number,
  mime: string,
  range: ByteRange | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    // 同一路径可能被用户换文件；壁纸不是可缓存资产
    "Cache-Control": "no-store",
    "Content-Length": String(range ? range.end - range.start + 1 : size),
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return headers;
}

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
    if (!filePath || !mime) return new Response(null, { status: 404 });

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return new Response(null, { status: 404 });
    }
    // 手改设置指向目录 / 设备文件时不把它当媒体流
    if (!stat.isFile()) return new Response(null, { status: 404 });

    const range = parseByteRange(request.headers.get("Range"), stat.size);
    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const headers = responseHeaders(stat.size, mime, range);
    const status = range ? 206 : 200;
    if (request.method === "HEAD") return new Response(null, { status, headers });

    // tsconfig.main 不带 DOM lib，BodyInit 不是全局名；从 Response 构造签名取参数类型
    const body = Readable.toWeb(
      createMediaStream(filePath, range),
    ) as unknown as ConstructorParameters<typeof Response>[0];
    return new Response(body, { status, headers });
  });
}
