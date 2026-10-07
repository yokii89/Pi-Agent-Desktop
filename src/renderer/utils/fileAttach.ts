/**
 * 非图片文件附件（docs/design/25）：路径引用模型。
 * 不读文件内容——经 Electron `webUtils.getPathForFile` 取绝对路径，发送进 `引用路径` 载荷。
 */

import { pideskApi } from "../services/pideskApi";
import { fileMentionName } from "./fileMentionFormat";

/** 单条消息最多附带的非图片文件数。 */
export const MAX_ATTACH_FILES = 16;

/** 输入栏待发文件附件（composerStore 持有）。 */
export interface ComposerFileAttachment {
  id: string;
  /** 展示名（basename）。 */
  name: string;
  /** 绝对路径（Agent 载荷）。 */
  path: string;
  /** 相对工作区的展示路径（/ 分隔）；不在工作区时退化为 basename。 */
  displayPath: string;
  kind: "file" | "dir";
}

export type AttachRoute =
  | { kind: "image"; file: File }
  | { kind: "file"; path: string; name: string }
  | { kind: "reject"; messageKey: string };

/** 默认取路径：preload `fs.pathForFile`（webUtils.getPathForFile）。 */
function defaultPathForFile(file: File): string {
  try {
    return pideskApi()?.fs.pathForFile(file) ?? "";
  } catch {
    return "";
  }
}

/**
 * File → 本地绝对路径。
 * Electron 32+ 移除 `File.path`，官方替代是 `webUtils.getPathForFile`（preload 同步 API）。
 * 测试可注入 `pathForFile`；无路径返回 null。
 */
export function localFilePath(
  file: File,
  pathForFile: (file: File) => string = defaultPathForFile,
): string | null {
  const viaApi = pathForFile(file);
  if (typeof viaApi === "string" && viaApi.length > 0) return viaApi;
  // 旧 Electron / 测试夹具：File.path 兜底
  const legacy = (file as File & { path?: unknown }).path;
  return typeof legacy === "string" && legacy.length > 0 ? legacy : null;
}

const IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|bmp|avif|ico|svg)$/i;

/** 先验分流：像图片的走 docs/21 管线（仍会魔数校验）；其余作路径附件。 */
export function looksLikeImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_NAME_RE.test(file.name);
}

/** 工作区相对展示路径；跨盘/外部文件用 basename（完整路径在 title）。 */
export function toDisplayPath(absPath: string, cwd: string | null): string {
  const normalized = absPath.replace(/\\/g, "/");
  const root = cwd?.replace(/\\/g, "/").replace(/\/+$/, "") ?? null;
  if (root) {
    const prefix = `${root}/`;
    if (normalized === root) return fileMentionName(normalized);
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      return normalized.slice(prefix.length);
    }
  }
  return fileMentionName(normalized);
}

/** 对话框 / 拖入文件 → 附件路由。 */
export function routeAttachFile(
  file: File,
  pathForFile: (file: File) => string = defaultPathForFile,
): AttachRoute {
  if (looksLikeImage(file)) return { kind: "image", file };
  const path = localFilePath(file, pathForFile);
  if (!path) return { kind: "reject", messageKey: "session.file.noPath" };
  return { kind: "file", path, name: file.name || fileMentionName(path) };
}

/** 附件 id（store 去重键之外的 React key）。 */
export function createFileAttachmentId(path: string): string {
  return `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${path.length}`;
}
