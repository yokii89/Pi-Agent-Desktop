/**
 * faviconService 集成测试：真起本地 HTTP 站点（不依赖外网），按 origin 分档验
 * 「直取 / link 发现 / 确认没图标 / 抓取抖动」四条路径与各自的缓存有效期。
 *
 * 抖动档是回归项：把「这次没网」当成「这站没图标」会让图标整日出不来（实测同一 URL
 * 命中 12 小时失败缓存后 0ms 返回 null，而直连抓同一个 favicon 只要 1.6s / 200）。
 *
 * electron 只用到 app.getPath("userData")，这里换成临时目录；时钟只假钟 Date，
 * 用来把「TTL 到期」压成一次 setSystemTime，不真的等 60 秒或 13 小时。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFaviconDataUrl } from "./faviconService";

vi.mock("electron", () => ({
  app: { getPath: () => process.env.PIDESK_FAVICON_TEST_DATA ?? "" },
}));

process.env.PIDESK_FAVICON_TEST_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-favicon-"));
const TMP_DIR = process.env.PIDESK_FAVICON_TEST_DATA;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_ALT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const DATA_PNG = `data:image/png;base64,${PNG.toString("base64")}`;
const DATA_ALT = `data:image/png;base64,${PNG_ALT.toString("base64")}`;

interface Site {
  server: http.Server;
  origin: string;
  hits: string[];
  /** 路由表可逐次改写，用于「先失败后成功」的退避回归。 */
  routes: Record<string, (res: http.ServerResponse) => void>;
}

const sites: Site[] = [];

function image(res: http.ServerResponse, mime: string, bytes: Buffer): void {
  res.writeHead(200, { "content-type": mime });
  res.end(bytes);
}

function html(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

async function startSite(
  routes: Record<string, (res: http.ServerResponse) => void>,
): Promise<Site> {
  const site: Site = {
    server: http.createServer(),
    origin: "",
    hits: [],
    routes,
  };
  site.server.on("request", (req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    site.hits.push(url);
    const handler = site.routes[url];
    if (handler) {
      handler(res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  await new Promise<void>((resolve) => {
    site.server.listen(0, "127.0.0.1", () => resolve());
  });
  site.origin = `http://127.0.0.1:${(site.server.address() as { port: number }).port}`;
  sites.push(site);
  return site;
}

interface IndexEntry {
  ok: boolean;
  file?: string;
  mime?: string;
  retry?: boolean;
  note?: string;
}

const cacheDir = (): string => path.join(TMP_DIR, "favicon-cache");
const readIndex = (): Record<string, IndexEntry> =>
  JSON.parse(fs.readFileSync(path.join(cacheDir(), "index.json"), "utf8")) as Record<
    string,
    IndexEntry
  >;

let base = 0;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
/** 站点用 image/x-icon 回吐同一串字节，断言 data URL 时 MIME 要跟着一致。 */
const DATA_ICO = `data:image/x-icon;base64,${PNG.toString("base64")}`;

describe("resolveFaviconDataUrl", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    base = Date.now();
  });

  // 假钟在整份文件里是单调推进的，每条用例起点拉回，避免「到期」测试读到未来时间
  beforeEach(() => {
    vi.setSystemTime(new Date(base));
  });

  afterAll(() => {
    vi.useRealTimers();
    for (const site of sites) site.server.close();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("直取 {origin}/favicon.ico 并落盘，30 天内换页面路径也不再打网络", async () => {
    const site = await startSite({ "/favicon.ico": (res) => image(res, "image/x-icon", PNG) });
    expect(await resolveFaviconDataUrl(`${site.origin}/a/b?c=1`)).toBe(DATA_ICO);

    const entry = readIndex()[site.origin];
    expect(entry?.ok).toBe(true);
    expect(entry?.mime).toBe("image/x-icon");
    expect(entry?.file?.endsWith(".ico")).toBe(true);
    expect(fs.existsSync(path.join(cacheDir(), entry?.file ?? ""))).toBe(true);

    vi.setSystemTime(new Date(base + DAY));
    expect(await resolveFaviconDataUrl(`${site.origin}/other`)).toBe(DATA_ICO);
    expect(site.hits).toEqual(["/favicon.ico"]);
  });

  it("favicon.ico 不在约定路径时按 HTML 的 link 声明补试", async () => {
    const site = await startSite({
      "/": (res) =>
        html(
          res,
          '<html><head><link rel="stylesheet" href="/s.css"><link rel="icon" href="/assets/touch.png"></head></html>',
        ),
      "/assets/touch.png": (res) => image(res, "image/png", PNG_ALT),
    });
    expect(await resolveFaviconDataUrl(site.origin)).toBe(DATA_ALT);
    expect(site.hits).toEqual(["/favicon.ico", "/", "/assets/touch.png"]);
  });

  it("2xx 但不是图片（门户劫持）只算「这里没有」，继续走发现而不是锁死", async () => {
    const site = await startSite({
      "/favicon.ico": (res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html>portal</html>");
      },
      "/": (res) =>
        html(res, '<html><head><link rel="apple-touch-icon" href="/real.png"></head></html>'),
      "/real.png": (res) => image(res, "image/png", PNG),
    });
    expect(await resolveFaviconDataUrl(site.origin)).toBe(DATA_PNG);
    expect(readIndex()[site.origin]?.ok).toBe(true);
  });

  it("站点确认没有图标：记 absent 走 12 小时，到期后重抓即恢复", async () => {
    const site = await startSite({
      "/": (res) => html(res, "<html><head><title>no icon here</title></head></html>"),
    });
    expect(await resolveFaviconDataUrl(site.origin)).toBeNull();

    const entry = readIndex()[site.origin];
    expect(entry?.ok).toBe(false);
    expect(entry?.retry).toBeUndefined();
    expect(entry?.note).toBe("no icon link");

    vi.setSystemTime(new Date(base + HOUR));
    expect(await resolveFaviconDataUrl(site.origin)).toBeNull();
    expect(site.hits).toEqual(["/favicon.ico", "/"]);

    vi.setSystemTime(new Date(base + 13 * HOUR));
    site.routes["/favicon.ico"] = (res) => image(res, "image/png", PNG);
    expect(await resolveFaviconDataUrl(site.origin)).toBe(DATA_PNG);
    expect(readIndex()[site.origin]?.ok).toBe(true);
  });

  it("服务端抖动只退避 60 秒，不被当成「这站没图标」锁一天", async () => {
    const site = await startSite({
      "/favicon.ico": (res) => {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("busy");
      },
    });
    expect(await resolveFaviconDataUrl(site.origin)).toBeNull();

    const entry = readIndex()[site.origin];
    expect(entry?.ok).toBe(false);
    expect(entry?.retry).toBe(true);
    expect(entry?.note).toBe("http 503");

    // 61 秒后重试即恢复：本模块最容易退化的一条
    vi.setSystemTime(new Date(base + 61 * 1000));
    site.routes["/favicon.ico"] = (res) => image(res, "image/png", PNG);
    expect(await resolveFaviconDataUrl(site.origin)).toBe(DATA_PNG);
    expect(readIndex()[site.origin]?.ok).toBe(true);
  });

  it("端口没人听记 network 抖动", async () => {
    const origin = "http://127.0.0.1:65530";
    expect(await resolveFaviconDataUrl(`${origin}/x`)).toBeNull();
    const entry = readIndex()[origin];
    expect(entry?.ok).toBe(false);
    expect(entry?.retry).toBe(true);
    expect(entry?.note).toBe("network");
  });

  it("非 http(s) 与非法输入直接 null，不写缓存", async () => {
    const before = Object.keys(readIndex()).length;
    expect(await resolveFaviconDataUrl("file:///D:/a/b.png")).toBeNull();
    expect(await resolveFaviconDataUrl("ftp://example.com")).toBeNull();
    expect(await resolveFaviconDataUrl("随便一句话")).toBeNull();
    expect(Object.keys(readIndex())).toHaveLength(before);
  });
});
