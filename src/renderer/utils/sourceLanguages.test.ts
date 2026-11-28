import { describe, expect, it } from "vitest";
import { editorLanguageFor, loadEditorLanguage } from "../editor/editorLanguages";
import { sourceLanguageForPath } from "./sourceLanguages";

describe("TeX source language", () => {
  it("resolves .tex files case-insensitively across Windows and POSIX paths", () => {
    expect(sourceLanguageForPath("D:\\papers\\sample.tex")).toEqual({
      shikiLanguage: "latex",
      editorLanguage: "tex",
    });
    expect(sourceLanguageForPath("/papers/SAMPLE.TEX")?.editorLanguage).toBe("tex");
    expect(editorLanguageFor("/papers/sample.tex")).toBe("tex");
  });

  it.each([
    "latex",
    "ltx",
    "sty",
    "cls",
    "clo",
    "def",
    "dtx",
    "ins",
    "tikz",
    "pgf",
    "pdf_tex",
    "bbl",
    "aux",
    "toc",
    "lof",
    "lot",
    "nav",
    "snm",
    "vrb",
    "bbx",
    "cbx",
    "lbx",
    "dbx",
  ])("uses the TeX mode for .%s files", (extension) => {
    expect(editorLanguageFor(`/papers/source.${extension}`)).toBe("tex");
  });

  it("loads the TeX syntax mode on demand", async () => {
    await expect(loadEditorLanguage("tex")).resolves.not.toBeNull();
  });
});
