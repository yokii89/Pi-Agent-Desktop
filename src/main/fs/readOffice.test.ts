import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICE_MAX_BYTES, officeFormatForPath } from "../../shared/officePreview";
import { readOfficeFile } from "./readOffice";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pidesk-office-"));
  dirs.push(dir);
  const file = path.join(dir, name);
  await writeFile(file, bytes);
  return file;
}

describe("Office read boundary", () => {
  it("recognizes compatible formats case-insensitively and distinguishes legacy files", () => {
    expect(officeFormatForPath("C:\\workspace\\合同.DOCX")).toBe("docx");
    expect(officeFormatForPath("/workspace/a.PPTX")).toBe("pptx");
    for (const ext of ["xls", "xlsx", "xlsm", "xlsb"])
      expect(officeFormatForPath(`a.${ext}`)).toBe("spreadsheet");
    for (const ext of ["doc", "ppt", "wps", "dps", "et"])
      expect(officeFormatForPath(`a.${ext}`)).toBeNull();
    for (const file of [".docx", "a.md", "a.toString", "a.docx/readme"])
      expect(officeFormatForPath(file)).toBeUndefined();
  });

  it("returns exact binary bytes without changing the source", async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const file = await fixture("合同.docx", bytes);
    const result = await readOfficeFile(file, "docx");
    expect(result).toEqual({
      kind: "office",
      status: "ready",
      format: "docx",
      data: bytes,
      byteLength: bytes.length,
    });
    expect(new Uint8Array(await readFile(file))).toEqual(bytes);
  });

  it("keeps unavailable files as metadata-only results so system-open remains reachable", async () => {
    const file = await fixture("large.pptx", new Uint8Array([1]));
    await truncate(file, OFFICE_MAX_BYTES + 1);
    expect(await readOfficeFile(file, "pptx")).toEqual({
      kind: "office",
      status: "unavailable",
      reason: "tooLarge",
      byteLength: OFFICE_MAX_BYTES + 1,
    });
    expect(await readOfficeFile(file, null)).toMatchObject({
      status: "unavailable",
      reason: "legacy",
    });
  });

  it("rejects missing files through the normal IO error path", async () => {
    const file = await fixture("file.docx", new Uint8Array());
    await rm(file);
    await expect(readOfficeFile(file, "docx")).rejects.toThrow();
  });
});
