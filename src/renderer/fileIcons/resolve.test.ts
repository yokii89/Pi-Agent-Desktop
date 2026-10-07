import { describe, expect, it } from "vitest";
import { resolveIconName } from "./resolve";

describe("resolveIconName", () => {
  it("resolves office and media types from extra mapping", () => {
    expect(resolveIconName("李瑞卿贷款回执.pdf")).toBe("file_pdf");
    expect(resolveIconName("工作簿1.xlsx")).toBe("file_excel");
    expect(resolveIconName("合同.docx")).toBe("file_word");
    expect(resolveIconName("路演.pptx")).toBe("file_powerpoint");
    expect(resolveIconName("track.mp3")).toBe("file_audio");
    expect(resolveIconName("demo.mp4")).toBe("file_video");
  });

  it("keeps generated mappings for code files", () => {
    expect(resolveIconName("index.ts")).toBe("file_typescript");
    expect(resolveIconName("App.tsx")).toBe("file_tsx");
    expect(resolveIconName("a.png")).toBe("file_image");
  });

  it("falls back to default text icon", () => {
    expect(resolveIconName("noext")).toBe("file_text");
    expect(resolveIconName("weird.unknownext")).toBe("file_text");
  });
});
