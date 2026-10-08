/**
 * 用户消息图片附件：校验、预处理与 pi ImageContent 转换（docs/design/21）。
 * 纯数据/纯函数可单测；需要 DOM 的解码/缩放走 `loadComposerImage`。
 */

import { t } from "../../shared/i18n";
import type { PiImageContent } from "../../shared/ipc";

/** 单条消息最多附图张数。 */
export const MAX_ATTACH_IMAGES = 8;
/** 长边上限（对齐 pi images.autoResize 默认 2000）。 */
export const MAX_IMAGE_EDGE = 2000;
/** 处理后单张字节上限（JSONL 单行 8MB 内留余量）。 */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** 输入栏待发附件（composerStore 持有）。 */
export interface ComposerImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  /** 处理后字节数（base64 解码后）。 */
  byteLength: number;
  /** 预览用 data URL。 */
  previewUrl: string;
  /** base64（无 `data:` 前缀），发送时直接进 ImageContent。 */
  data: string;
  /** 转码/缩小提示，仅 UI title，不进 prompt 正文。 */
  hint?: string;
}

/** 气泡/历史展示图（data URL）。 */
export interface UserMessageImage {
  src: string;
  mimeType: string;
  name?: string;
}

const SUPPORTED_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** 从魔数嗅探图片 MIME；非图片或无法识别返回 null。 */
export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  // WEBP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  return null;
}

/** 是否可直接作为 prompt ImageContent 的 MIME（无需转码）。 */
export function isSupportedPromptMime(mimeType: string): boolean {
  return SUPPORTED_MIME.has(mimeType.split(";")[0]?.trim().toLowerCase() ?? "");
}

/** 附件 → pi ImageContent（rpc.md）。 */
export function toPiImageContent(attachment: ComposerImageAttachment): PiImageContent {
  return {
    type: "image",
    data: attachment.data,
    mimeType: attachment.mimeType,
  };
}

/** 气泡展示图 → pi ImageContent（重新发送时用）。 */
export function piImageFromDisplay(image: UserMessageImage): PiImageContent {
  const data = image.src.startsWith("data:")
    ? image.src.slice(image.src.indexOf(",") + 1)
    : image.src;
  return { type: "image", data, mimeType: image.mimeType };
}

/** base64 → data URL（展示）。 */
export function toDataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`;
}

/** 从消息 content 抽出 ImageContent（历史回读）；非法块跳过。 */
export function imagesFromMessageContent(value: unknown): UserMessageImage[] {
  const images: UserMessageImage[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as {
      type?: unknown;
      data?: unknown;
      mimeType?: unknown;
      content?: unknown;
    };
    if (record.type === "image" && typeof record.data === "string") {
      const mimeType =
        typeof record.mimeType === "string" && record.mimeType ? record.mimeType : "image/png";
      images.push({ src: toDataUrl(mimeType, record.data), mimeType });
      return;
    }
    if (record.content !== undefined) visit(record.content);
  };
  visit(value);
  return images;
}

function bufferToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface DecodedBitmap {
  bitmap: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  close: () => void;
}

async function decodeBitmap(blob: Blob): Promise<DecodedBitmap | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // fall through to <img>
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return null;
    return {
      bitmap: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function encodeScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
  mimeType: string,
): Promise<Blob | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source, 0, 0, width, height);
  // 动图缩放会丢帧：仅对需要缩放/转码的走 canvas；原生支持的 GIF/WebP 动图尽量原样透传
  const outType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), outType, 0.92);
  });
}

export type LoadImageResult =
  | { ok: true; attachment: ComposerImageAttachment }
  | { ok: false; message: string };

/**
 * 读入 File/Blob → 规范化附件（docs/design/21 §4.3）。
 * 魔数校验 → 白名单/转码 → 长边与字节限额。失败时给出可执行原因。
 */
export async function loadComposerImage(source: Blob, name?: string): Promise<LoadImageResult> {
  const display =
    name ||
    (typeof File !== "undefined" && source instanceof File
      ? source.name
      : t("session.image.placeholder"));
  if (/\.svg$/i.test(display) || source.type === "image/svg+xml") {
    return { ok: false, message: t("image.svgRejected") };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await source.arrayBuffer();
  } catch {
    return { ok: false, message: t("image.readFailed") };
  }
  const raw = new Uint8Array(buffer);
  if (raw.length === 0) return { ok: false, message: t("image.empty") };
  const sniffed = detectImageMime(raw);
  if (!sniffed) return { ok: false, message: t("image.unknownFormat") };

  // 动图（GIF/WebP）只能原样透传：canvas 缩放/转码会静默冻成静态帧
  const isAnimatedRisk = sniffed === "image/gif" || sniffed === "image/webp";
  if (isAnimatedRisk) {
    if (raw.length > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        message: sniffed === "image/gif" ? t("image.gifTooLarge") : t("image.webpTooLarge"),
      };
    }
    const decoded = await decodeBitmap(source);
    if (!decoded) return { ok: false, message: t("image.decodeFailed") };
    const { width, height, close } = decoded;
    if (Math.max(width, height) > MAX_IMAGE_EDGE) {
      close();
      return {
        ok: false,
        message: sniffed === "image/gif" ? t("image.gifTooBigEdge") : t("image.webpTooBigEdge"),
      };
    }
    close();
    const data = bufferToBase64(raw);
    return {
      ok: true,
      attachment: {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: display,
        mimeType: sniffed,
        width,
        height,
        byteLength: raw.length,
        previewUrl: toDataUrl(sniffed, data),
        data,
      },
    };
  }

  // 静态白名单（png/jpeg）且够小：原样透传
  if (isSupportedPromptMime(sniffed) && raw.length <= MAX_IMAGE_BYTES) {
    const decoded = await decodeBitmap(source);
    if (!decoded) return { ok: false, message: t("image.decodeFailed") };
    const { width, height, close } = decoded;
    const needScale = Math.max(width, height) > MAX_IMAGE_EDGE;
    if (!needScale) {
      close();
      const data = bufferToBase64(raw);
      return {
        ok: true,
        attachment: {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: display,
          mimeType: sniffed,
          width,
          height,
          byteLength: raw.length,
          previewUrl: toDataUrl(sniffed, data),
          data,
        },
      };
    }
    const scale = MAX_IMAGE_EDGE / Math.max(width, height);
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const blob = await encodeScaled(decoded.bitmap, tw, th, sniffed);
    close();
    if (!blob) return { ok: false, message: t("image.scaleFailed") };
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, message: t("image.tooLargeAfterScale") };
    }
    const data = bufferToBase64(bytes);
    const outMime = sniffed === "image/jpeg" ? "image/jpeg" : "image/png";
    return {
      ok: true,
      attachment: {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: display,
        mimeType: outMime,
        width: tw,
        height: th,
        byteLength: bytes.length,
        previewUrl: toDataUrl(outMime, data),
        data,
        hint: t("image.hint.scaled", { width: tw, height: th }),
      },
    };
  }

  // 需转码（bmp 等）或 png/jpeg 超字节：canvas 转 PNG
  const decoded = await decodeBitmap(source);
  if (!decoded) return { ok: false, message: t("image.decodeOrFormat") };
  const { width, height, close } = decoded;
  const scale =
    Math.max(width, height) > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / Math.max(width, height) : 1;
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));
  const blob = await encodeScaled(decoded.bitmap, tw, th, "image/png");
  close();
  if (!blob) return { ok: false, message: t("image.pngConvertFailed") };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    return { ok: false, message: t("image.tooLargeAfterConvert") };
  }
  const data = bufferToBase64(bytes);
  const hints: string[] = [];
  if (sniffed !== "image/png") {
    hints.push(t("image.hint.converted", { format: sniffed.replace("image/", "") }));
  }
  if (scale < 1) hints.push(t("image.hint.scaled", { width: tw, height: th }));
  return {
    ok: true,
    attachment: {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: display,
      mimeType: "image/png",
      width: tw,
      height: th,
      byteLength: bytes.length,
      previewUrl: toDataUrl("image/png", data),
      data,
      ...(hints.length > 0 ? { hint: hints.join("；") } : {}),
    },
  };
}

/** 仅测试用：从 base64 构造附件（不走解码）。 */
export function attachmentFromBase64(
  data: string,
  mimeType: string,
  name = t("session.image.placeholder"),
): ComposerImageAttachment {
  const bytes = base64ToBytes(data);
  return {
    id: `img_test_${Math.random().toString(36).slice(2, 8)}`,
    name,
    mimeType,
    width: 0,
    height: 0,
    byteLength: bytes.length,
    previewUrl: toDataUrl(mimeType, data),
    data,
  };
}
