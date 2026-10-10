import fsp from "node:fs/promises";
import { dialog } from "electron";
import { t } from "../../shared/i18n";
import type { SessionExportRequest } from "../../shared/ipc";
import { getMainWindow } from "../window/createMainWindow";
import { buildSessionMarkdown, toExportFileName } from "./exportMarkdown";
import { assertSessionFile, readSessionTranscript } from "./sessionTranscriptRead";

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

  const options = {
    title: t("session.export.saveTitle"),
    defaultPath: toExportFileName(title),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  };
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await fsp.writeFile(result.filePath, markdown, "utf8");
  return { path: result.filePath };
}
