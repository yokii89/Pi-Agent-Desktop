import { defaultUrlTransform } from "react-markdown";
import { resolveMarkdownRef } from "./markdownRefs";

export type MarkdownImageSource = { kind: "local"; path: string } | { kind: "url"; url: string };

const IMAGE_DATA_URL =
  /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif|svg\+xml)(?:;[^,]*)?,/i;

/** 图片引用只允许可展示的图片 URL 或本地文件；相对路径必须有明确的文件/会话目录。 */
export function resolveMarkdownImageSource(
  src: string,
  sourcePath?: string | null,
  baseDir?: string | null,
): MarkdownImageSource | null {
  const value = src.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      return { kind: "url", url: new URL(value).href };
    } catch {
      return null;
    }
  }
  if (IMAGE_DATA_URL.test(value)) return { kind: "url", url: value };
  const path = resolveMarkdownRef(value, sourcePath, baseDir);
  return path ? { kind: "local", path } : null;
}

/** 仅 img 的 src 放行本地路径和图片 data URL；链接仍沿用 Markdown 的协议过滤。 */
export function markdownUrlTransform(url: string, key: string): string {
  if (key === "src" && resolveMarkdownImageSource(url, null, "/")) return url;
  return defaultUrlTransform(url);
}
