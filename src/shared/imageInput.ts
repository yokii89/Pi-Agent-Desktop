export const MAX_IMAGE_ATTACHMENTS = 8;
export const MAX_IMAGE_INPUT_BYTES = 6 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ImageInputContent {
  type: "image";
  data: string;
  mimeType: string;
}

function decodedByteLength(data: string): number | null {
  if (
    !data ||
    data.length > Math.ceil(MAX_IMAGE_INPUT_BYTES / 3) * 4 ||
    data.length % 4 !== 0 ||
    !BASE64.test(data)
  )
    return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = (data.length / 4) * 3 - padding;
  return bytes > 0 && bytes <= MAX_IMAGE_INPUT_BYTES ? bytes : null;
}

/** Validate a private image block without decoding or retaining additional copies of its bytes. */
export function parseImageInputContent(value: unknown): ImageInputContent | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const image = value as Record<string, unknown>;
  if (
    image.type !== "image" ||
    typeof image.data !== "string" ||
    typeof image.mimeType !== "string" ||
    !IMAGE_MIME_TYPES.has(image.mimeType) ||
    decodedByteLength(image.data) === null
  )
    return null;
  return { type: "image", data: image.data, mimeType: image.mimeType };
}

/** Reject an entire submission when any attachment is invalid; never silently drop images. */
export function parseImageInputContents(value: unknown): ImageInputContent[] | null {
  if (!Array.isArray(value) || value.length > MAX_IMAGE_ATTACHMENTS) return null;
  const images: ImageInputContent[] = [];
  for (const item of value) {
    const image = parseImageInputContent(item);
    if (!image) return null;
    images.push(image);
  }
  return images;
}
