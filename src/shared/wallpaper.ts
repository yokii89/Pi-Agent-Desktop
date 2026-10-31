/**
 * 本地背景壁纸的共享口径（主进程媒体协议 + 渲染层 UI 共用）：
 * 支持的文件类型、遮罩强度归一、媒体 URL 与 HTTP Range 解析。
 * 壁纸素材只留在本机：路径不进 Gist 同步，也不会被复制或上传。
 */

export const WALLPAPER_MEDIA_SCHEME = "pidesk-media";
export const WALLPAPER_MEDIA_HOST = "wallpaper";

export const WALLPAPER_IMAGE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
] as const;

export const WALLPAPER_VIDEO_EXTENSIONS = ["mp4", "webm", "m4v", "ogv"] as const;

export type WallpaperKind = "image" | "video";

/** 遮罩强度默认值（0–100）：偏高的初值保证这层彩色画面压得住正文。 */
export const DEFAULT_WALLPAPER_DIM = 70;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  m4v: "video/x-m4v",
  ogv: "video/ogg",
};

export function wallpaperExtension(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function wallpaperKindFromPath(filePath: string): WallpaperKind | null {
  const ext = wallpaperExtension(filePath);
  if ((WALLPAPER_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return "image";
  if ((WALLPAPER_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  return null;
}

export function wallpaperMimeType(filePath: string): string | null {
  return MIME_BY_EXTENSION[wallpaperExtension(filePath)] ?? null;
}

/** 壁纸路径归一：空值表示关闭；不支持的扩展名视为无效（返回 null）。 */
export function normalizeWallpaperPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  return wallpaperKindFromPath(trimmed) ? trimmed : null;
}

/** 遮罩强度归一：非法值回退默认，合法值夹到 0–100。 */
export function clampWallpaperDim(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_WALLPAPER_DIM;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** 壁纸 `<img>` / `<video>` 的地址；查询串只用于换图时打破缓存，主进程只认当前设置里的路径。 */
export function wallpaperMediaUrl(filePath: string): string {
  return `${WALLPAPER_MEDIA_SCHEME}://${WALLPAPER_MEDIA_HOST}/?v=${encodeURIComponent(filePath)}`;
}

export function wallpaperFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * 解析单段 `Range: bytes=...`（视频拖动进度条依赖）。
 * null = 按完整响应处理（缺失 / 语法不认识 / 多段）；"unsatisfiable" = 416。
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (size <= 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end < start) return "unsatisfiable";
    if (start >= size) return "unsatisfiable";
    end = Math.min(end, size - 1);
  }
  return { start, end };
}
