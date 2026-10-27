import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { dialog, type SaveDialogOptions } from "electron";
import { t } from "../../shared/i18n";
import type { SessionExportRequest } from "../../shared/ipc";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";
import { buildSessionMarkdown, toExportFileName } from "./exportMarkdown";
import { resolvePiCommand } from "./piLauncher";
import { exportHtml, liveSessionIdForFile } from "./piSession";
import { assertSessionFile, readSessionTranscript } from "./sessionTranscriptRead";

const execFileAsync = promisify(execFile);
/** 大会话的 HTML 生成是 pi 侧同步渲染，给足时间但不无限挂起。 */
const HTML_EXPORT_TIMEOUT_MS = 60_000;
/** CLI 只有一行 "Exported to"，留出 stderr 噪声余量。 */
const HTML_EXPORT_MAX_BUFFER = 4 * 1024 * 1024;

async function pickSavePath(options: SaveDialogOptions): Promise<string | null> {
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

/**
 * 导出会话记录为 Markdown（行菜单「导出记录」，docs/design/45）：
 * 磁盘 transcript → 文档，标题作默认文件名（经净化）；用户取消时返回 null。
 * 纯转换逻辑在 exportMarkdown.ts，本模块只做对话框与写盘。
 */
export async function exportSessionMarkdown(
  req: SessionExportRequest,
): Promise<{ path: string } | null> {
  const resolved = assertSessionFile(req.file);
  const payload = await readSessionTranscript(resolved);
  const title = req.title?.trim() || t("session.export.defaultName");
  const markdown = buildSessionMarkdown(payload, {
    title,
    file: resolved,
    exportedAt: Date.now(),
  });

  const target = await pickSavePath({
    title: t("session.export.saveTitle"),
    defaultPath: toExportFileName(title),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!target) return null;
  await fsp.writeFile(target, markdown, "utf8");
  return { path: target };
}

/**
 * 导出会话记录为 HTML（pi 原生导出）：
 * - 存活实例走 RPC `export_html`：读 pi 内存态，包含系统提示词、工具定义与扩展自定义工具渲染；
 * - 冷会话走 `pi --export <jsonl> <html>`：独立导出同一份文件，不额外拉起常驻会话。
 */
export async function exportSessionHtml(
  req: SessionExportRequest,
): Promise<{ path: string } | null> {
  const resolved = assertSessionFile(req.file);
  const title = req.title?.trim() || t("session.export.defaultName");
  const target = await pickSavePath({
    title: t("session.export.saveTitle"),
    defaultPath: toExportFileName(title, "html"),
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!target) return null;

  const liveId = liveSessionIdForFile(resolved);
  if (liveId) {
    await exportHtml(liveId, target);
  } else {
    await exportHtmlStandalone(resolved, target);
  }
  return { path: target };
}

/** 冷会话的独立导出：pi 的 `--export` 在加载扩展前就退出，不产生常驻进程。 */
async function exportHtmlStandalone(input: string, output: string): Promise<void> {
  const { file, args } = resolvePiCommand(getSettings().piExecutablePath);
  try {
    await execFileAsync(file, [...args, "--export", input, output], {
      cwd: os.homedir(),
      env: process.env,
      windowsHide: true,
      timeout: HTML_EXPORT_TIMEOUT_MS,
      maxBuffer: HTML_EXPORT_MAX_BUFFER,
    });
  } catch (err) {
    // pi 把失败原因写在 stderr；超时 / 启动失败时退回系统错误文本
    const stderr = (err as { stderr?: unknown }).stderr;
    const detail =
      typeof stderr === "string"
        ? stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ")
        : "";
    throw new Error(
      detail || (err instanceof Error ? err.message : t("sidenav.session.exportFailed")),
    );
  }
}
