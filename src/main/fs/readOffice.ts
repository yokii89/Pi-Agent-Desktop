import { open } from "node:fs/promises";
import { t } from "../../shared/i18n";
import type { FsReadOfficeResult } from "../../shared/ipc";
import { OFFICE_MAX_BYTES, type OfficePreviewFormat } from "../../shared/officePreview";

/** Read through a bounded handle so replacement/growth cannot turn the preview into an unbounded allocation. */
export async function readOfficeFile(
  file: string,
  format: OfficePreviewFormat | null,
): Promise<FsReadOfficeResult> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(t("panels.files.office.notRegular"));
    if (format === null || stat.size > OFFICE_MAX_BYTES) {
      return {
        kind: "office",
        status: "unavailable",
        byteLength: stat.size,
        reason: format === null ? "legacy" : "tooLarge",
      };
    }
    const buffer = new Uint8Array(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      throw new Error(t("panels.files.office.changed"));
    }
    return { kind: "office", status: "ready", format, data: buffer, byteLength: offset };
  } finally {
    await handle.close();
  }
}
