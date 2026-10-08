import fs from "node:fs";
import path from "node:path";
import { IMAGE_MIME } from "../../shared/fileKinds";

/**
 * 「保存图片」的纯逻辑：data URL 解析 + 落盘文件名净化。
 * 单独成模块是因为它接收的是渲染层传来的不可信输入，必须能在不启动 Electron
 * 的前提下被测（fsService 顶部 import 了 app / dialog / shell）。
 */

/** 文件名主干长度上限（Windows 单段 255 字符，留出「 (2)」序号与扩展名余量）。 */
const MAX_STEM_CHARS = 96;
/** Windows 目录段非法字符 + 控制符/零宽等「其它」类码位（\p{C}）。 */
const ILLEGAL_NAME_CHARS = /[\p{C}<>:"/\\|?*]/gu;
/** Windows 保留设备名：即便带扩展名也不能当文件名（CON.png 写入即失败）。 */
const WIN_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** MIME → 扩展名：IMAGE_MIME 的反向表；未收录的类型统一按 png 落盘。 */
const EXT_FOR_MIME = new Map<string, string>(
  Object.entries(IMAGE_MIME).map(([ext, mime]) => [mime, ext]),
);

/** data URL → `{ mimeType, base64 }`；非 `data:image/...;base64,` 一律拒绝。 */
export function parseImageDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl ?? "");
  if (!match) return null;
  const base64 = match[2].replace(/\s/g, "");
  if (!base64) return null;
  return { mimeType: match[1].toLowerCase(), base64 };
}

/**
 * 渲染层传来的附件名属不可信输入：只取最后一段、剥掉非法字符与结尾的点/空格，
 * 结果永远是单个文件名而非路径。扩展名按真实 MIME 重新贴——名字写着 .png
 * 而字节是 jpeg 时以数据为准。
 */
export function toSaveFileName(raw: string | undefined, mimeType: string): string {
  const ext = EXT_FOR_MIME.get(mimeType) ?? "png";
  const last = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const stem = last
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(ILLEGAL_NAME_CHARS, "")
    .replace(/[. ]+$/, "")
    .slice(0, MAX_STEM_CHARS)
    .replace(/[. ]+$/, "")
    .trim();
  const base = stem || "image";
  return `${WIN_RESERVED_NAMES.test(base) ? `_${base}` : base}.${ext}`;
}

/** 在目标目录里挑一个未占用的名字：a.png → a (2).png → a (3).png（Windows 另存习惯）。 */
export function pickAvailablePath(dir: string, fileName: string): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(dir, n === 1 ? fileName : `${stem} (${n})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("同名文件过多，请先清理下载目录");
}
