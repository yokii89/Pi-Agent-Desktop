import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseImageDataUrl, pickAvailablePath, toSaveFileName } from "./saveImageName";

describe("parseImageDataUrl", () => {
  it("拆出 MIME 与 base64", () => {
    const parsed = parseImageDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(parsed).toEqual({ mimeType: "image/png", base64: "iVBORw0KGgo=" });
  });

  it("MIME 大小写归一", () => {
    expect(parseImageDataUrl("data:IMAGE/JPEG;base64,AAA=")?.mimeType).toBe("image/jpeg");
  });

  it("折行 base64 去掉空白", () => {
    expect(parseImageDataUrl("data:image/png;base64,AAAA\nBBBB")?.base64).toBe("AAAABBBB");
  });

  it("非图片 / 非 data URL / 空数据一律拒绝", () => {
    expect(parseImageDataUrl("data:text/html;base64,AAA=")).toBeNull();
    expect(parseImageDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64,")).toBeNull();
    expect(parseImageDataUrl("data:image/png;charset=utf8,abc")).toBeNull();
    expect(parseImageDataUrl(undefined as unknown as string)).toBeNull();
  });
});

describe("toSaveFileName", () => {
  it("路径穿越只取最后一段", () => {
    expect(toSaveFileName("..\\..\\windows\\temp\\x.png", "image/png")).toBe("x.png");
    expect(toSaveFileName("a/b/c/photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
  });

  it("结果永不含目录分隔符与非法字符", () => {
    const name = toSaveFileName('my:pic<>|?".png', "image/png");
    expect(name).toBe("mypic.png");
    expect(/[\\/]/.test(name)).toBe(false);
  });

  it("Windows 保留设备名加前缀", () => {
    expect(toSaveFileName("CON", "image/png")).toBe("_CON.png");
    expect(toSaveFileName("aux.txt", "image/png")).toBe("_aux.png");
    expect(toSaveFileName("com1.png", "image/png")).toBe("_com1.png");
  });

  it("扩展名按真实 MIME 重贴", () => {
    expect(toSaveFileName("shot.png", "image/jpeg")).toBe("shot.jpeg");
    expect(toSaveFileName("shot", "image/webp")).toBe("shot.webp");
    expect(toSaveFileName("shot.png", "image/heic")).toBe("shot.png");
  });

  it("空名与纯点号回落到 image", () => {
    expect(toSaveFileName(undefined, "image/png")).toBe("image.png");
    expect(toSaveFileName("", "image/png")).toBe("image.png");
    expect(toSaveFileName("...", "image/png")).toBe("image.png");
    expect(toSaveFileName("photo. ", "image/png")).toBe("photo.png");
  });

  it("中文与空格保留，超长截断", () => {
    expect(toSaveFileName("截图 2026-10-08.png", "image/png")).toBe("截图 2026-10-08.png");
    const long = toSaveFileName(`${"x".repeat(300)}.png`, "image/png");
    expect(long).toHaveLength(100);
    expect(long.endsWith(".png")).toBe(true);
  });
});

describe("pickAvailablePath", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-save-name-"));

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("同名依次加序号", () => {
    fs.writeFileSync(path.join(dir, "a.png"), "");
    expect(path.basename(pickAvailablePath(dir, "a.png"))).toBe("a (2).png");
    fs.writeFileSync(path.join(dir, "a (2).png"), "");
    expect(path.basename(pickAvailablePath(dir, "a.png"))).toBe("a (3).png");
  });

  it("未被占用时原名返回", () => {
    expect(path.basename(pickAvailablePath(dir, "fresh.png"))).toBe("fresh.png");
  });
});
