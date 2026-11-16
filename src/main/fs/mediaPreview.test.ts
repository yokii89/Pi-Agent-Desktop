import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPreviewMedia, servePreviewMedia } from "./mediaPreview";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "pidesk-media-preview-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function media(name: string, content = "0123456789") {
  const file = path.join(dir, name);
  await writeFile(file, content);
  const result = await readPreviewMedia(file);
  if (!result) throw new Error("Missing media capability");
  return { file, result };
}

describe("file preview media streams", () => {
  it("returns only metadata for large media and streams unicode paths", async () => {
    const { result } = await media("录屏 #&%.MP4");
    expect(result.mediaKind).toBe("video");
    expect(result).not.toHaveProperty("data");
    const response = await servePreviewMedia(new Request(result.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("0123456789");
    const large = path.join(dir, "large.wav");
    await writeFile(large, "");
    await truncate(large, 512 * 1024 * 1024);
    const metadata = await readPreviewMedia(large);
    expect(metadata).toMatchObject({ kind: "media", mediaKind: "audio", byteLength: 536870912 });
  });

  it("supports seeking with closed, open and suffix ranges without reading other bytes", async () => {
    const { result } = await media("ranges.mp3");
    for (const [range, content, expected] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=7-", "789", "bytes 7-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
      ["bytes=8-99", "89", "bytes 8-9/10"],
    ]) {
      const response = await servePreviewMedia(
        new Request(result.url, { headers: { Range: range } }),
      );
      expect(response.status).toBe(206);
      expect(response.headers.get("Content-Range")).toBe(expected);
      expect(response.headers.get("Content-Length")).toBe(String(content.length));
      expect(await response.text()).toBe(content);
    }
    const head = await servePreviewMedia(
      new Request(result.url, { method: "HEAD", headers: { Range: "bytes=2-4" } }),
    );
    expect(head.status).toBe(206);
    expect(head.headers.get("Content-Length")).toBe("3");
    expect(await head.text()).toBe("");
  });

  it("rejects impossible ranges and handles empty files without opening a body stream", async () => {
    const { result } = await media("invalid-range.ogg");
    for (const range of ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=9007199254740993-"]) {
      const response = await servePreviewMedia(
        new Request(result.url, { headers: { Range: range } }),
      );
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
    }
    const empty = await media("empty.webm", "");
    const response = await servePreviewMedia(new Request(empty.result.url));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(
      (await servePreviewMedia(new Request(empty.result.url, { headers: { Range: "bytes=0-" } })))
        .status,
    ).toBe(416);
  });

  it("rejects edited capabilities and old versions while accepting a fresh URL", async () => {
    const { file, result } = await media("signed.m4a");
    const edited = new URL(result.url);
    edited.pathname += "A";
    expect((await servePreviewMedia(new Request(edited))).status).toBe(403);
    edited.pathname = new URL(result.url).pathname;
    edited.hostname = "arbitrary";
    expect((await servePreviewMedia(new Request(edited))).status).toBe(403);
    edited.hostname = "preview";
    edited.searchParams.set("signature", "bad");
    expect((await servePreviewMedia(new Request(edited))).status).toBe(403);
    await writeFile(file, "replacement media");
    expect((await servePreviewMedia(new Request(result.url))).status).toBe(409);
    const fresh = await readPreviewMedia(file);
    expect(fresh?.url).not.toBe(result.url);
    expect(await (await servePreviewMedia(new Request(fresh?.url ?? ""))).text()).toBe(
      "replacement media",
    );
  });

  it("rejects non-files, unsupported formats, missing files and write methods", async () => {
    const folder = path.join(dir, "folder.mp4");
    await mkdir(folder);
    await expect(readPreviewMedia(folder)).rejects.toThrow();
    expect(await readPreviewMedia(path.join(dir, "unsupported.avi"))).toBeNull();
    const { file, result } = await media("removed.flac");
    expect((await servePreviewMedia(new Request(result.url, { method: "POST" }))).status).toBe(405);
    await rm(file);
    expect((await servePreviewMedia(new Request(result.url))).status).toBe(404);
  });

  it("closes files when seeking cancels a reader or the request is aborted", async () => {
    const { file, result } = await media("cancel.webm", "a".repeat(1024 * 1024));
    const response = await servePreviewMedia(new Request(result.url));
    const reader = response.body?.getReader();
    expect((await reader?.read())?.value?.length).toBeGreaterThan(0);
    await reader?.cancel();
    const controller = new AbortController();
    controller.abort();
    expect(
      (await servePreviewMedia(new Request(result.url, { signal: controller.signal }))).status,
    ).toBe(499);
    await rm(file);
  });
});
