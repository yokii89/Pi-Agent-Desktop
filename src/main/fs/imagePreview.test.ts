import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PREVIEW_IMAGE_BYTES } from "../../shared/imagePreview";
import { readPreviewImage, servePreviewImage } from "./imagePreview";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "pidesk-image-preview-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function image(name: string, content = "image bytes") {
  const file = path.join(dir, name);
  await writeFile(file, content);
  const result = await readPreviewImage(file);
  if (!result) throw new Error("Missing image capability");
  return { file, result };
}

describe("side-panel image capabilities", () => {
  it("streams unicode paths with the right MIME and returns metadata only over IPC", async () => {
    const { result } = await image("图片 #&%.PNG");
    expect(result).not.toHaveProperty("dataUrl");
    expect(result.byteLength).toBe(11);
    const response = await servePreviewImage(new Request(result.url));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("image bytes");
    const head = await servePreviewImage(new Request(result.url, { method: "HEAD" }));
    expect(head.headers.get("Content-Length")).toBe("11");
    expect(await head.text()).toBe("");
  });

  it("accepts exactly 40MiB and rejects the next byte without loading the file", async () => {
    const file = path.join(dir, "boundary.bmp");
    await writeFile(file, "");
    await truncate(file, MAX_PREVIEW_IMAGE_BYTES);
    const result = await readPreviewImage(file);
    expect(result?.byteLength).toBe(MAX_PREVIEW_IMAGE_BYTES);
    await truncate(file, MAX_PREVIEW_IMAGE_BYTES + 1);
    await expect(readPreviewImage(file)).rejects.toThrow("40MiB");
  });

  it("does not expose arbitrary paths through edited capabilities", async () => {
    const { result } = await image("signed.png");
    const url = new URL(result.url);
    url.pathname = `${url.pathname}A`;
    expect((await servePreviewImage(new Request(url))).status).toBe(403);
    url.pathname = new URL(result.url).pathname;
    url.hostname = "elsewhere";
    expect((await servePreviewImage(new Request(url))).status).toBe(403);
    url.hostname = "preview";
    url.searchParams.set("signature", "bad");
    expect((await servePreviewImage(new Request(url))).status).toBe(403);
  });

  it("invalidates old URLs when files change and serves fresh bytes with a new URL", async () => {
    const { file, result } = await image("changing.png");
    await writeFile(file, "replacement image");
    expect((await servePreviewImage(new Request(result.url))).status).toBe(409);
    const next = await readPreviewImage(file);
    expect(next?.url).not.toBe(result.url);
    expect(await (await servePreviewImage(new Request(next?.url ?? ""))).text()).toBe(
      "replacement image",
    );
  });

  it("rejects directories, missing files, unsupported extensions and unsupported methods", async () => {
    const folder = path.join(dir, "folder.png");
    await mkdir(folder);
    await expect(readPreviewImage(folder)).rejects.toThrow();
    expect(await readPreviewImage(path.join(dir, "unsupported.tiff"))).toBeNull();
    const { file, result } = await image("removed.jpg");
    expect((await servePreviewImage(new Request(result.url, { method: "POST" }))).status).toBe(405);
    await rm(file);
    expect((await servePreviewImage(new Request(result.url))).status).toBe(404);
  });

  it("closes the file on consumer cancellation", async () => {
    const { file, result } = await image("cancel.png", "a".repeat(1024 * 1024));
    const response = await servePreviewImage(new Request(result.url));
    const reader = response.body?.getReader();
    expect((await reader?.read())?.value?.length).toBeGreaterThan(0);
    await reader?.cancel();
    await rm(file);
  });

  it("does not start a stream for an already aborted request", async () => {
    const { result } = await image("aborted.png");
    const controller = new AbortController();
    controller.abort();
    expect(
      (await servePreviewImage(new Request(result.url, { signal: controller.signal }))).status,
    ).toBe(499);
  });
});
