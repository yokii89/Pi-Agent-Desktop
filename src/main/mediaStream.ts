import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseByteRange } from "../shared/mediaPreview";

interface FileVersion {
  size: number;
  mtimeMs: number;
}

/**
 * 从已授权路径按需读取媒体；同一个文件句柄完成版本校验和流读取。
 * 消费端取消或请求中断时关闭句柄，拖动进度不会留下旧的磁盘读取。
 */
export async function serveMediaFile(
  request: Request,
  file: string,
  mime: string,
  version?: FileVersion,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return new Response(null, { status: 404 });
  let transferred = false;
  try {
    const info = await handle.stat();
    if (!info.isFile()) return new Response(null, { status: 404 });
    if (version && (info.size !== version.size || info.mtimeMs !== version.mtimeMs))
      return new Response(null, { status: 409 });
    const range = parseByteRange(request.headers.get("Range"), info.size);
    if (range === "unsatisfiable")
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Length": String(range ? range.end - range.start + 1 : info.size),
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    };
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
    const status = range ? 206 : 200;
    if (request.method === "HEAD" || info.size === 0)
      return new Response(null, { status, headers });
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const stream = handle.createReadStream({
      start: range?.start ?? 0,
      end: range?.end ?? info.size - 1,
      autoClose: true,
    });
    const abort = (): void => {
      stream.destroy();
    };
    request.signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => request.signal.removeEventListener("abort", abort));
    const body = Readable.toWeb(stream) as unknown as ConstructorParameters<typeof Response>[0];
    transferred = true;
    return new Response(body, { status, headers });
  } finally {
    if (!transferred) await handle.close();
  }
}
