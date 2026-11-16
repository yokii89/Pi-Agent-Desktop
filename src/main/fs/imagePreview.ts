import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { IMAGE_EXTS, IMAGE_MIME } from "../../shared/fileKinds";
import { t } from "../../shared/i18n";
import { IMAGE_PREVIEW_SCHEME, MAX_PREVIEW_IMAGE_BYTES } from "../../shared/imagePreview";
import type { FsPreviewImageResult } from "../../shared/ipc";

// Capabilities live for this process only. No retained pixel buffers or ever-growing path registry.
const secret = randomBytes(32);
function sign(value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function mimeFor(file: string): string | undefined {
  const ext = path.extname(file).slice(1).toLowerCase();
  return (IMAGE_EXTS as readonly string[]).includes(ext)
    ? IMAGE_MIME[ext as (typeof IMAGE_EXTS)[number]]
    : undefined;
}

/** Issue a versioned image capability after checking the file, without reading its contents. */
export async function readPreviewImage(file: string): Promise<FsPreviewImageResult | null> {
  const absolute = path.resolve(file);
  const mime = mimeFor(absolute);
  if (!mime) return null;
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(t("panels.files.imageNotFile"));
  if (info.size > MAX_PREVIEW_IMAGE_BYTES) throw new Error(t("panels.files.imageTooLarge"));
  const payload = Buffer.from(JSON.stringify([absolute, info.size, info.mtimeMs])).toString(
    "base64url",
  );
  return {
    kind: "image",
    url: `${IMAGE_PREVIEW_SCHEME}://preview/${payload}?signature=${sign(payload)}`,
    mime,
    byteLength: info.size,
  };
}

/** Serve only signed, unchanged image files; request cancellation closes the disk stream. */
export async function servePreviewImage(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  const url = new URL(request.url);
  const payload = url.pathname.slice(1);
  const signature = url.searchParams.get("signature") ?? "";
  if (
    url.protocol !== `${IMAGE_PREVIEW_SCHEME}:` ||
    url.host !== "preview" ||
    !/^[\da-f]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(payload), "hex"))
  )
    return new Response(null, { status: 403 });

  const [file, size, mtimeMs] = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as [
    string,
    number,
    number,
  ];
  const mime = mimeFor(file);
  if (!mime) return new Response(null, { status: 403 });
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return new Response(null, { status: 404 });
  let transferred = false;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== size || info.mtimeMs !== mtimeMs)
      return new Response(null, { status: 409 });
    if (info.size > MAX_PREVIEW_IMAGE_BYTES) return new Response(null, { status: 413 });
    const headers = {
      "Content-Type": mime,
      "Content-Length": String(info.size),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.method === "HEAD" || info.size === 0) return new Response(null, { headers });
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const stream = handle.createReadStream({ start: 0, end: info.size - 1, autoClose: true });
    const abort = (): void => {
      stream.destroy();
    };
    request.signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => request.signal.removeEventListener("abort", abort));
    const body = Readable.toWeb(stream) as unknown as ConstructorParameters<typeof Response>[0];
    transferred = true;
    return new Response(body, { headers });
  } finally {
    if (!transferred) await handle.close();
  }
}
