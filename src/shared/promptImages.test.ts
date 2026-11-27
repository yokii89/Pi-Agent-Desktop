import { describe, expect, it } from "vitest";
import { getI18nLocale, setI18nLocale, t } from "./i18n";
import type { PiImageContent } from "./ipc";
import { MAX_PROMPT_IMAGES, readPromptImages } from "./promptImages";

function images(count: number): PiImageContent[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "image",
    data: `image-${index}`,
    mimeType: "image/png",
  }));
}

describe("prompt image validation", () => {
  it("preserves all images in order when the message meets the limit", () => {
    const input = images(MAX_PROMPT_IMAGES);
    expect(readPromptImages(input)).toEqual(input);
    expect(readPromptImages([null, ...input, { type: "text", text: "ignored" }])).toEqual(input);
  });

  it("rejects the whole over-limit send instead of accepting a truncated image list", () => {
    const input = images(MAX_PROMPT_IMAGES + 1);
    const before = structuredClone(input);
    expect(() => readPromptImages(input)).toThrow();
    expect(input).toEqual(before);
  });

  it.each(["zh-CN", "en-US"] as const)("returns an actionable %s error", (locale) => {
    const previousLocale = getI18nLocale();
    try {
      setI18nLocale(locale);
      expect(() => readPromptImages(images(MAX_PROMPT_IMAGES + 1))).toThrow(
        t("session.input.tooManyImages", { count: MAX_PROMPT_IMAGES }),
      );
    } finally {
      setI18nLocale(previousLocale);
    }
  });

  it("treats missing and malformed image lists as empty", () => {
    expect(readPromptImages(undefined)).toEqual([]);
    expect(readPromptImages("image")).toEqual([]);
    expect(readPromptImages([null, 1, { type: "image", data: 1, mimeType: "image/png" }])).toEqual(
      [],
    );
  });
});
