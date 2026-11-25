import fsp from "node:fs/promises";
import { dialog, type SaveDialogOptions } from "electron";
import { t } from "../../shared/i18n";
import type { SessionExportRequest } from "../../shared/ipc";
import { sessionRefFromKey } from "../../shared/sessionRef";
import { getMainWindow } from "../window/createMainWindow";
import { buildSessionMarkdown, toExportFileName } from "./exportMarkdown";
import { sessionRepository } from "./sessionRepository";

async function pickSavePath(options: SaveDialogOptions): Promise<string | null> {
  const parent = getMainWindow();
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? null : result.filePath;
}

/** Export saved history through the repository; neither backend is resumed or written. */
export async function exportSessionMarkdown(
  req: SessionExportRequest,
): Promise<{ path: string } | null> {
  return exportDocument(req, "md");
}

/** A self-contained script-free HTML document. All transcript content is escaped. */
export async function exportSessionHtml(
  req: SessionExportRequest,
): Promise<{ path: string } | null> {
  return exportDocument(req, "html");
}

async function exportDocument(
  req: SessionExportRequest,
  format: "md" | "html",
): Promise<{ path: string } | null> {
  const ref = sessionRefFromKey(req.file);
  const payload = await sessionRepository.transcript(ref);
  const title = req.title?.trim() || t("session.export.defaultName");
  const markdown = buildSessionMarkdown(payload, { title, file: req.file, exportedAt: Date.now() });
  const target = await pickSavePath({
    title: t("session.export.saveTitle"),
    defaultPath: toExportFileName(title, format),
    filters: [{ name: format === "md" ? "Markdown" : "HTML", extensions: [format] }],
  });
  if (!target) return null;
  await fsp.writeFile(target, format === "md" ? markdown : sessionHtml(title, markdown), "utf8");
  return { path: target };
}

/** Content stays inert even when it contains HTML, scripts, links or closing tags. */
export function sessionHtml(title: string, markdown: string): string {
  const escapeHtml = (text: string) =>
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style>body{max-width:90ch;margin:2rem auto;padding:0 1rem;font:16px/1.6 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style></head><body><pre>${escapeHtml(markdown)}</pre></body></html>`;
}
