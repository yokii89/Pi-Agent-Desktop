import { describe, expect, it } from "vitest";
import {
  type ComposerImageAttachment,
  detectImageMime,
  imagesFromMessageContent,
  isSupportedPromptMime,
  piImageFromDisplay,
  toDataUrl,
  toPiImageContent,
} from "./imageAttach";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

const PNG_MAGIC = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG_MAGIC = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF_MAGIC = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WEBP_MAGIC = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
const BMP_MAGIC = bytes(0x42, 0x4d, 0x00, 0x00);

describe("detectImageMime", () => {
  it("sniffs png / jpeg / gif / webp / bmp by magic", () => {
    expect(detectImageMime(PNG_MAGIC)).toBe("image/png");
    expect(detectImageMime(JPEG_MAGIC)).toBe("image/jpeg");
    expect(detectImageMime(GIF_MAGIC)).toBe("image/gif");
    expect(detectImageMime(WEBP_MAGIC)).toBe("image/webp");
    expect(detectImageMime(BMP_MAGIC)).toBe("image/bmp");
  });

  it("returns null for non-images and short buffers", () => {
    expect(detectImageMime(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
    expect(detectImageMime(bytes(0x89))).toBeNull();
  });
});

describe("isSupportedPromptMime", () => {
  it("accepts provider-safe mime and rejects others", () => {
    expect(isSupportedPromptMime("image/png")).toBe(true);
    expect(isSupportedPromptMime("image/jpeg")).toBe(true);
    expect(isSupportedPromptMime("image/jpg")).toBe(false);
    expect(isSupportedPromptMime("image/bmp")).toBe(false);
    expect(isSupportedPromptMime("image/svg+xml")).toBe(false);
  });
});

describe("ImageContent mapping", () => {
  const attachment: ComposerImageAttachment = {
    id: "1",
    name: "a.png",
    mimeType: "image/png",
    width: 10,
    height: 10,
    byteLength: 3,
    previewUrl: toDataUrl("image/png", "AAAA"),
    data: "AAAA",
  };

  it("maps attachment to pi ImageContent without data: prefix", () => {
    expect(toPiImageContent(attachment)).toEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
  });

  it("round-trips display image back to ImageContent", () => {
    expect(
      piImageFromDisplay({ src: toDataUrl("image/png", "AAAA"), mimeType: "image/png" }),
    ).toEqual({
      type: "image",
      data: "AAAA",
      mimeType: "image/png",
    });
  });
});

describe("imagesFromMessageContent", () => {
  it("extracts image blocks from user content array", () => {
    const images = imagesFromMessageContent([
      { type: "text", text: "看图" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
    expect(images).toEqual([{ src: "data:image/png;base64,AAAA", mimeType: "image/png" }]);
  });

  it("ignores non-image blocks and malformed nodes", () => {
    expect(
      imagesFromMessageContent([
        { type: "text", text: "hi" },
        { type: "image", data: 1 },
        null,
        "nope",
      ]),
    ).toEqual([]);
  });
});
