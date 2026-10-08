/**
 * 文件类型常量：主进程 fs 读取分流与渲染层预览分流共用的事实来源。
 * 只含纯数据与纯函数，主进程 / 渲染进程均可安全 import。
 */

/** 可作图片预览的扩展名（小写、不含点），与主进程 IMAGE_MIME 的键一一对应。 */
export const IMAGE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "svg",
] as const;

/** 按 Markdown 文档流渲染预览的扩展名；.mdx 含 JSX，故意排除（渲染出来是误导性文本）。 */
export const MARKDOWN_EXTS = ["md", "markdown"] as const;

/** 可交由侧栏浏览器渲染的网页扩展名（file:// 专用通道，docs/文件面板文件渲染方案.md）。 */
export const HTML_EXTS = ["html", "htm"] as const;

/** 取路径最后一段扩展名（小写；无扩展名 / 点文件返回空串）。 */
function extOf(path: string): string {
  const name = path.split(/[/\\]/).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** 是否 Markdown 文件（文件面板按文档流渲染预览的分流依据）。 */
export function isMarkdownPath(path: string): boolean {
  return (MARKDOWN_EXTS as readonly string[]).includes(extOf(path));
}

/** 是否网页文件（文件面板「在侧栏浏览器中打开」的分流依据）。 */
export function isHtmlPath(path: string): boolean {
  return (HTML_EXTS as readonly string[]).includes(extOf(path));
}
