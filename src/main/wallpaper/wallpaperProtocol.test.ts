import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { wallpaperMediaUrl } from "../../shared/wallpaper";
import { getSettings, updateSettings } from "../settings/settings";
import { registerWallpaperProtocol } from "./wallpaperProtocol";

const host = vi.hoisted(() => ({
  userData: "",
  handle: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getPath: () => host.userData, getLocale: () => "en-US" },
  protocol: { handle: host.handle },
}));

let serve: (request: Request) => Promise<Response>;
let first: string;
let second: string;

beforeAll(() => {
  host.userData = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-wallpaper-"));
  first = path.join(host.userData, "first.png");
  second = path.join(host.userData, "屋檐 #&%.WEBP");
  fs.writeFileSync(first, "first-image");
  fs.writeFileSync(second, "second-image");
  registerWallpaperProtocol();
  serve = host.handle.mock.calls[0][1];
});

afterAll(() => {
  fs.rmSync(host.userData, { recursive: true, force: true });
});

describe("wallpaper protocol and persisted selection", () => {
  it("never serves the old file for a new selection before settings are committed", async () => {
    updateSettings({ wallpaperPath: first });
    const early = await serve(new Request(wallpaperMediaUrl(second)));
    expect(early.status).toBe(404);

    updateSettings({ wallpaperPath: second });
    const ready = await serve(new Request(wallpaperMediaUrl(second)));
    expect(ready.status).toBe(200);
    expect(ready.headers.get("Content-Type")).toBe("image/webp");
    expect(await ready.text()).toBe("second-image");
    expect((await serve(new Request(wallpaperMediaUrl(first)))).status).toBe(404);
  });

  it("serves range and HEAD requests for the selected media", async () => {
    updateSettings({ wallpaperPath: second });
    const url = wallpaperMediaUrl(second, 2);
    const part = await serve(new Request(url, { headers: { Range: "bytes=0-5" } }));
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toBe("bytes 0-5/12");
    expect(await part.text()).toBe("second");
    const head = await serve(new Request(url, { method: "HEAD" }));
    expect(head.headers.get("Content-Length")).toBe("12");
    expect(await head.text()).toBe("");
  });

  it("returns a load failure for missing files and directories", async () => {
    const missing = path.join(host.userData, "missing.webp");
    updateSettings({ wallpaperPath: missing });
    expect((await serve(new Request(wallpaperMediaUrl(missing)))).status).toBe(404);
    const directory = path.join(host.userData, "directory.png");
    fs.mkdirSync(directory);
    updateSettings({ wallpaperPath: directory });
    expect((await serve(new Request(wallpaperMediaUrl(directory)))).status).toBe(404);
  });

  it("keeps the previous active path when writing settings fails", async () => {
    updateSettings({ wallpaperPath: first });
    const settings = path.join(host.userData, "settings.json");
    const backup = `${settings}.backup`;
    fs.renameSync(settings, backup);
    fs.mkdirSync(settings);
    try {
      expect(() => updateSettings({ wallpaperPath: second })).toThrow();
      expect(getSettings().wallpaperPath).toBe(first);
      const response = await serve(new Request(wallpaperMediaUrl(first)));
      expect(await response.text()).toBe("first-image");
    } finally {
      fs.rmdirSync(settings);
      fs.renameSync(backup, settings);
    }
  });
});
