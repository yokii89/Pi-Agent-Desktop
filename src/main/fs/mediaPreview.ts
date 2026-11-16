import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { mediaInfoForPath } from "../../shared/fileKinds";
import { t } from "../../shared/i18n";
import type { FsPreviewMediaResult } from "../../shared/ipc";
import { MEDIA_PREVIEW_SCHEME } from "../../shared/mediaPreview";
import { serveMediaFile } from "../mediaStream";

// 签名仅在当前主进程内有效，避免维护随打开文件数量增长的路径登记表。
const secret = randomBytes(32);
function sign(payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** 校验磁盘文件后签发只读 URL；大媒体文件只返回元信息。 */
export async function readPreviewMedia(file: string): Promise<FsPreviewMediaResult | null> {
  const absolute = path.resolve(file);
  const media = mediaInfoForPath(absolute);
  if (!media) return null;
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(t("panels.files.media.notFile"));
  const payload = Buffer.from(JSON.stringify([absolute, info.size, info.mtimeMs])).toString(
    "base64url",
  );
  return {
    kind: "media",
    mediaKind: media.kind,
    url: `${MEDIA_PREVIEW_SCHEME}://preview/${payload}?signature=${sign(payload)}`,
    mime: media.mime,
    byteLength: info.size,
  };
}

/** 仅服务当前进程签发且磁盘版本未变的媒体，支持 HEAD 和单段 Range。 */
export async function servePreviewMedia(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405 });
  const url = new URL(request.url);
  const payload = url.pathname.slice(1);
  const signature = url.searchParams.get("signature") ?? "";
  if (
    url.protocol !== `${MEDIA_PREVIEW_SCHEME}:` ||
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
  const media = mediaInfoForPath(file);
  if (!media) return new Response(null, { status: 403 });
  return serveMediaFile(request, file, media.mime, { size, mtimeMs });
}
