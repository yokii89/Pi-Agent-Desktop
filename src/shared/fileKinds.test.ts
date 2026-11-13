import { describe, expect, it } from "vitest";
import {
  HTML_EXTS,
  IMAGE_EXTS,
  isHtmlPath,
  isJsonPath,
  isMarkdownPath,
  isNotebookPath,
  isPdfPath,
  isTabularPath,
  MARKDOWN_EXTS,
} from "./fileKinds";

describe("isMarkdownPath", () => {
  it("识别 md / markdown（大小写不敏感、多段后缀取最后一段）", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/a/b/c.markdown")).toBe(true);
    expect(isMarkdownPath("D:\\docs\\笔记.MD")).toBe(true);
    expect(isMarkdownPath("x.y.md")).toBe(true);
  });

  it("mdx / 无扩展名 / 其他类型不算 Markdown", () => {
    expect(isMarkdownPath("comp.mdx")).toBe(false);
    expect(isMarkdownPath("README")).toBe(false);
    expect(isMarkdownPath(".md")).toBe(false);
    expect(isMarkdownPath("a.txt")).toBe(false);
    expect(isMarkdownPath("")).toBe(false);
    expect(isMarkdownPath("D:\\dir\\")).toBe(false);
  });

  it("扩展名表为小写且不含点（主进程 mime 表键对齐的前提）", () => {
    for (const ext of [...IMAGE_EXTS, ...MARKDOWN_EXTS, ...HTML_EXTS]) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith(".")).toBe(false);
    }
  });
});

describe("isHtmlPath", () => {
  it("识别 html / htm（大小写不敏感）", () => {
    expect(isHtmlPath("index.html")).toBe(true);
    expect(isHtmlPath("page.HTM")).toBe(true);
    expect(isHtmlPath("D:\\site\\a\\b.html")).toBe(true);
  });

  it("其他类型不算网页", () => {
    expect(isHtmlPath("README.md")).toBe(false);
    expect(isHtmlPath("index.php")).toBe(false);
    expect(isHtmlPath("style.css")).toBe(false);
    expect(isHtmlPath("html")).toBe(false);
    expect(isHtmlPath("")).toBe(false);
  });
});

describe("specialized file paths", () => {
  it("recognizes tabular, notebook and PDF files case-insensitively", () => {
    expect(isTabularPath("data.CSV")).toBe(true);
    expect(isTabularPath("data.tsv")).toBe(true);
    expect(isNotebookPath("analysis.IPYNB")).toBe(true);
    expect(isPdfPath("docs/report.PDF")).toBe(true);
    expect(isTabularPath("data.json")).toBe(false);
  });

  it("recognizes JSON-family files without treating JSONL as JSON", () => {
    expect(isJsonPath("package.json")).toBe(true);
    expect(isJsonPath("settings.JSONC")).toBe(true);
    expect(isJsonPath("config.json5")).toBe(true);
    expect(isJsonPath("events.jsonl")).toBe(false);
  });
});
