import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_INPUT_BYTES,
  parseImageInputContent,
  parseImageInputContents,
} from "./imageInput";

describe("Durable image input validation", () => {
  it("accepts supported image blocks and returns only protocol fields", () => {
    expect(
      parseImageInputContent({
        type: "image",
        data: "AAAA",
        mimeType: "image/png",
        name: "private-filename.png",
      }),
    ).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
  });

  it("rejects malformed base64, unsupported MIME types and oversized images", () => {
    expect(
      parseImageInputContent({ type: "image", data: "not base64", mimeType: "image/png" }),
    ).toBeNull();
    expect(
      parseImageInputContent({ type: "image", data: "AAAA", mimeType: "image/bmp" }),
    ).toBeNull();
    const oversized = "A".repeat((MAX_IMAGE_INPUT_BYTES / 3) * 4 + 4);
    expect(
      parseImageInputContent({ type: "image", data: oversized, mimeType: "image/png" }),
    ).toBeNull();
  });

  it("bounds attachment count and rejects a batch containing an invalid item", () => {
    const image = { type: "image", data: "AAAA", mimeType: "image/jpeg" } as const;
    expect(parseImageInputContents(Array(MAX_IMAGE_ATTACHMENTS).fill(image))).toHaveLength(
      MAX_IMAGE_ATTACHMENTS,
    );
    expect(parseImageInputContents(Array(MAX_IMAGE_ATTACHMENTS + 1).fill(image))).toBeNull();
    expect(parseImageInputContents([image, { ...image, mimeType: "image/bmp" }])).toBeNull();
  });
});
