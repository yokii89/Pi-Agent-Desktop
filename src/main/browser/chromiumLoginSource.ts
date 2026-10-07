import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserLoginSource } from "../../shared/ipc";

/** Windows 下常见 Chromium 系 User Data 根目录（相对 LOCALAPPDATA）。 */
const CHROMIUM_ROOTS = [
  {
    id: "chrome",
    label: "Google Chrome",
    rel: "Google/Chrome/User Data",
    progIds: ["ChromeHTML", "ChromeHTML804"],
  },
  {
    id: "edge",
    label: "Microsoft Edge",
    rel: "Microsoft/Edge/User Data",
    progIds: ["MSEdgeHTM", "MSEdgeHTM804"],
  },
] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readDefaultBrowserProgId(): Promise<string | null> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice' -ErrorAction SilentlyContinue).ProgId",
      ],
      { windowsHide: true, timeout: 8000, maxBuffer: 64 * 1024 },
    );
    const line = stdout.trim().split(/\r?\n/).pop()?.trim();
    return line || null;
  } catch {
    return null;
  }
}

function profileLabel(profileDir: string, infoCacheName?: string): string {
  if (infoCacheName?.trim()) return `${profileDir} · ${infoCacheName.trim()}`;
  return profileDir;
}

/**
 * 探测本机 Chromium 系浏览器 Profile（Chrome / Edge）。
 * 只看路径与 Local State 元数据，不读 Cookie 内容。
 */
export async function listChromiumLoginSources(
  localAppData: string,
): Promise<BrowserLoginSource[]> {
  const defaultProgId = await readDefaultBrowserProgId();
  const sources: BrowserLoginSource[] = [];

  for (const root of CHROMIUM_ROOTS) {
    const userData = join(localAppData, root.rel);
    if (!(await pathExists(userData))) continue;

    let infoCache: Record<string, { name?: string }> = {};
    try {
      const raw = await readFile(join(userData, "Local State"), "utf8");
      const parsed = JSON.parse(raw) as {
        profile?: { info_cache?: Record<string, { name?: string }> };
      };
      infoCache = parsed.profile?.info_cache ?? {};
    } catch {
      infoCache = {};
    }

    const profileDirs = new Set<string>(["Default"]);
    for (const key of Object.keys(infoCache)) {
      if (key === "Default" || /^Profile \d+$/i.test(key)) profileDirs.add(key);
    }

    for (const profileDir of [...profileDirs].sort((a, b) => a.localeCompare(b))) {
      const cookiesPath = join(userData, profileDir, "Network", "Cookies");
      const cookiesLegacy = join(userData, profileDir, "Cookies");
      let cookieDb = cookiesPath;
      if (!(await pathExists(cookiesPath))) {
        if (!(await pathExists(cookiesLegacy))) continue;
        cookieDb = cookiesLegacy;
      }
      const isDefaultBrowser = defaultProgId
        ? root.progIds.some((id) => defaultProgId.startsWith(id))
        : false;
      sources.push({
        id: `${root.id}:${profileDir}`,
        browserId: root.id,
        browserLabel: root.label,
        profileDir,
        profileLabel: profileLabel(profileDir, infoCache[profileDir]?.name),
        userDataDir: userData,
        cookieDbPath: cookieDb,
        isDefaultBrowser,
      });
    }
  }

  // 默认浏览器的来源排前，其次 Chrome、Edge，最后按 profile 名
  sources.sort((a, b) => {
    if (a.isDefaultBrowser !== b.isDefaultBrowser) return a.isDefaultBrowser ? -1 : 1;
    if (a.browserId !== b.browserId) return a.browserId.localeCompare(b.browserId);
    return a.profileDir.localeCompare(b.profileDir);
  });
  return sources;
}
