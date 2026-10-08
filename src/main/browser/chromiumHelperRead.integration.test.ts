import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserLoginSource } from "../../shared/ipc";
import { readCookiesFromHelper, readLocalStorageFromHelper } from "./chromiumHelperRead";
import {
  resolveChromiumExecutable,
  runChromiumHelper,
  stageChromiumProfileForHelper,
} from "./chromiumHelperSession";

/**
 * 端到端验证「浏览器本体当解密 oracle + 一次导入只拉起一个 helper」这条路径
 * （docs/design/42 §6.6）。
 *
 * 用真实 Chrome 先往一个临时 profile 里写 Cookie / LocalStorage，再走生产路径读回来：
 * - Cookie 明文被读回（浏览器级 `Storage.getCookies` 返回全量明文）；
 * - LocalStorage 读的是**暂存副本**里的数据，而不是站点自己那份空存储（所以用只回静态
 *   页面的本地 HTTP 服务，站点侧永远不会有 `it-token`）。
 *
 * 没装 Chrome / Edge 或非 Windows 环境整组跳过：这是桌面端的常见环境，不是 CI 必需项。
 */

const executablePath = await resolveChromiumExecutable("chrome");
const enabled = process.platform === "win32" && executablePath !== null;
const suite = enabled ? describe : describe.skip;
const exe = executablePath ?? "";

suite("chromium helper read (integration, needs local Chrome)", () => {
  let server: Server;
  let origin = "";
  let source: BrowserLoginSource;
  let root = "";

  beforeAll(async () => {
    if (!enabled) return;
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>import-it</title><body>ok</body>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    origin = `http://127.0.0.1:${port}`;

    root = await mkdtemp(join(tmpdir(), "pidesk-helper-it-"));
    const userDataDir = join(root, "User Data");
    const profileDir = join(userDataDir, "Default");
    await mkdir(join(profileDir, "Network"), { recursive: true });
    // 真实环境里 Local State 带着 App-Bound 密钥，是 oracle 能解开 v20 Cookie 的前提
    await writeFile(join(userDataDir, "Local State"), JSON.stringify({ os_crypt: {} }));

    await runChromiumHelper({ executablePath: exe, userDataDir }, async (cdp) => {
      await cdp.send("Storage.setCookies", {
        cookies: [
          {
            name: "hostOnly",
            value: "host-only-value",
            domain: "example.org",
            path: "/",
            // 必须带过期时间：Chromium 的 session Cookie 只存在内存里，不会落库
            expires: Math.floor(Date.now() / 1000) + 3600,
          },
          {
            name: "SID",
            value: "domain-value",
            domain: ".example.com",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
            expires: Math.floor(Date.now() / 1000) + 3600,
          },
        ],
      });
      const sessionId = await cdp.attachPage();
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Page.navigate", { url: `${origin}/` }, sessionId);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const state = await cdp.send<{ result?: { value?: unknown } }>(
          "Runtime.evaluate",
          { expression: "document.readyState", returnByValue: true },
          sessionId,
        );
        if (state.result?.value === "complete") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const written = await cdp.send<{ result?: { value?: number } }>(
        "Runtime.evaluate",
        {
          expression: 'localStorage.setItem("it-token", "copied-value"); 1',
          returnByValue: true,
        },
        sessionId,
      );
      expect(written.result?.value).toBe(1);
    });

    source = {
      id: "chrome:Default",
      browserId: "chrome",
      browserLabel: "Google Chrome",
      profileDir: "Default",
      profileLabel: "Default",
      userDataDir,
      cookieDbPath: join(profileDir, "Network", "Cookies"),
      isDefaultBrowser: true,
    };
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  });

  it("reads plaintext cookies back through a staged copy of the profile", async () => {
    if (!enabled) return;
    const staged = await stageChromiumProfileForHelper(source, { includeLocalStorage: true });
    try {
      const cookies = await runChromiumHelper(
        { executablePath: exe, userDataDir: staged.userDataDir },
        (cdp) => readCookiesFromHelper(cdp),
      );
      expect(cookies.find((cookie) => cookie.name === "hostOnly")?.value).toBe("host-only-value");
      const domainCookie = cookies.find((cookie) => cookie.name === "SID");
      expect(domainCookie?.value).toBe("domain-value");
      expect(domainCookie?.domain).toBe(".example.com");
      expect(domainCookie?.httpOnly).toBe(true);
      expect(domainCookie?.sameSite).toBe("Lax");
    } finally {
      await staged.dispose();
    }
  }, 180_000);

  it("reads LocalStorage from the staged copy instead of the live site", async () => {
    if (!enabled) return;
    const staged = await stageChromiumProfileForHelper(source, { includeLocalStorage: true });
    try {
      const result = await runChromiumHelper(
        { executablePath: exe, userDataDir: staged.userDataDir },
        (cdp) => readLocalStorageFromHelper(cdp, [origin]),
      );
      expect(result.failedOrigins).toBe(0);
      expect(result.records).toEqual([{ origin, entries: [["it-token", "copied-value"]] }]);
    } finally {
      await staged.dispose();
    }
  }, 180_000);
});
