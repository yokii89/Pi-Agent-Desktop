import { describe, expect, it } from "vitest";
import {
  createFileAttachmentId,
  localFilePath,
  looksLikeImage,
  MAX_ATTACH_FILES,
  routeAttachFile,
  toDisplayPath,
} from "./fileAttach";

function makeFile(name: string, type = "", legacyPath?: string): File {
  const file = new File(["x"], name, type ? { type } : undefined);
  if (legacyPath !== undefined) {
    Object.defineProperty(file, "path", { value: legacyPath });
  }
  return file;
}

describe("fileAttach routing", () => {
  it("sends image-like names to the image pipeline", () => {
    expect(routeAttachFile(makeFile("a.png", "image/png"), () => "").kind).toBe("image");
    expect(routeAttachFile(makeFile("b.JPEG", ""), () => "").kind).toBe("image");
    expect(routeAttachFile(makeFile("c.svg", "image/svg+xml"), () => "").kind).toBe("image");
  });

  it("routes non-images to path attachments via webUtils.getPathForFile", () => {
    const route = routeAttachFile(
      makeFile("notes.pdf", "application/pdf"),
      () => "D:/docs/notes.pdf",
    );
    expect(route).toEqual({
      kind: "file",
      path: "D:/docs/notes.pdf",
      name: "notes.pdf",
    });
  });

  it("rejects non-images without a local path", () => {
    const route = routeAttachFile(makeFile("notes.md", "text/markdown"), () => "");
    expect(route).toEqual({ kind: "reject", messageKey: "session.file.noPath" });
  });

  it("prefers pathForFile, then falls back to legacy File.path", () => {
    expect(localFilePath(makeFile("a.txt"), () => "C:/a.txt")).toBe("C:/a.txt");
    expect(localFilePath(makeFile("a.txt", "", "C:/legacy.txt"), () => "")).toBe("C:/legacy.txt");
    expect(localFilePath(makeFile("a.txt"), () => "")).toBeNull();
    const weird = makeFile("a.txt");
    Object.defineProperty(weird, "path", { value: 42 });
    expect(localFilePath(weird, () => "")).toBeNull();
  });

  it("looksLikeImage trusts MIME first then extension", () => {
    expect(looksLikeImage(makeFile("blob", "image/webp"))).toBe(true);
    expect(looksLikeImage(makeFile("photo.webp", ""))).toBe(true);
    expect(looksLikeImage(makeFile("photo.txt", "text/plain"))).toBe(false);
  });
});

describe("toDisplayPath", () => {
  it("uses workspace-relative slash paths when under cwd", () => {
    expect(toDisplayPath("D:/proj/src/a.ts", "D:/proj")).toBe("src/a.ts");
    expect(toDisplayPath("D:\\proj\\src\\a.ts", "D:/proj/")).toBe("src/a.ts");
    expect(toDisplayPath("D:/proj/a.ts", "D:/proj")).toBe("a.ts");
  });

  it("falls back to basename outside the workspace", () => {
    expect(toDisplayPath("D:/other/a.ts", "D:/proj")).toBe("a.ts");
    expect(toDisplayPath("D:/other/a.ts", null)).toBe("a.ts");
  });
});

describe("limits and ids", () => {
  it("caps file attachments at a stable constant", () => {
    expect(MAX_ATTACH_FILES).toBe(16);
  });

  it("creates distinct ids", () => {
    expect(createFileAttachmentId("a")).not.toBe(createFileAttachmentId("a"));
  });
});
