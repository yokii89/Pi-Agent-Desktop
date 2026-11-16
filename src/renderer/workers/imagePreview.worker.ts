/// <reference lib="webworker" />
import {
  type ImagePreviewRequest,
  type ImagePreviewResponse,
  previewBitmapSize,
} from "../utils/imagePreviewProtocol";

const worker = self as unknown as DedicatedWorkerGlobalScope;
let latest: ImagePreviewRequest | null = null;
let running = false;
let source: Promise<Blob> | null = null;

function respond(response: ImagePreviewResponse): void {
  worker.postMessage(response, response.type === "bitmap" ? [response.bitmap] : []);
}

// APNG has acTL before IDAT. Preserve PNG EXIF orientation through native rendering too.
// Read only chunk headers, avoiding another full-file buffer.
async function requiresNativePng(blob: Blob): Promise<boolean> {
  let offset = 8;
  while (offset + 8 <= blob.size) {
    const header = new DataView(await blob.slice(offset, offset + 8).arrayBuffer());
    const type = header.getUint32(4);
    if (type === 0x6163544c || type === 0x65584966) return true;
    if (type === 0x49444154 || type === 0x49454e44) return false;
    offset += header.getUint32(0) + 12;
  }
  return false;
}

async function render(request: ImagePreviewRequest): Promise<void> {
  source ??= fetch(request.url).then((response) => {
    if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
    return response.blob();
  });
  const blob = await source;
  if (latest?.id !== request.id) return;
  if (request.mime === "image/png" && (await requiresNativePng(blob))) {
    respond({ id: request.id, type: "native" });
    return;
  }
  // PNG's IHDR provides dimensions without allocating its full RGBA surface. Give the
  // decoder the output size directly: drawing a full 8K bitmap into a canvas first
  // otherwise creates large CPU/GPU intermediates even though the result is tiny.
  if (request.mime === "image/png") {
    const header = new DataView(await blob.slice(0, 24).arrayBuffer());
    if (
      header.byteLength !== 24 ||
      header.getUint32(0) !== 0x89504e47 ||
      header.getUint32(4) !== 0x0d0a1a0a
    )
      throw new Error("Invalid PNG header");
    const width = header.getUint32(16);
    const height = header.getUint32(20);
    if (!width || !height) throw new Error("Invalid PNG dimensions");
    const target = previewBitmapSize(width, height, request.width);
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
    });
    if (latest?.id !== request.id) bitmap.close();
    else respond({ id: request.id, type: "bitmap", bitmap, width, height });
    return;
  }
  const original = await createImageBitmap(blob);
  try {
    if (latest?.id !== request.id) return;
    const { width, height } = original;
    const target = previewBitmapSize(width, height, request.width);
    const bitmap = await createImageBitmap(original, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: "high",
    });
    if (latest?.id !== request.id) bitmap.close();
    else respond({ id: request.id, type: "bitmap", bitmap, width, height });
  } finally {
    original.close();
  }
}

// Serialize decodes: dragging the sidebar must not accumulate concurrent full-resolution images.
worker.onmessage = (event: MessageEvent<ImagePreviewRequest>) => {
  latest = event.data;
  if (running) return;
  running = true;
  void (async () => {
    let processed = -1;
    try {
      while (latest && processed !== latest.id) {
        const request = latest;
        processed = request.id;
        try {
          await render(request);
        } catch {
          respond({ id: request.id, type: "error" });
        }
      }
    } finally {
      running = false;
    }
  })();
};
