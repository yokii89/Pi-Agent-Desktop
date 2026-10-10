import { describe, expect, it } from "vitest";
import type { PideskSettings } from "./ipc";
import {
  diffSyncableSettings,
  parseSettingsSyncEnvelope,
  pickSyncableSettings,
  SYNCABLE_SETTINGS_KEYS,
  summarizeSettingValue,
} from "./settingsSync";

function fakeSettings(): PideskSettings {
  return {
    projects: [{ id: "p1", name: "demo", dir: "C:/demo" }],
    lastProjectId: "p1",
    piExecutablePath: "C:/pi/pi.exe",
    terminalShell: "powershell",
    theme: "dark",
    locale: "zh-CN",
    navCollapsed: true,
    pinnedSessions: ["C:/s/a.jsonl"],
    globalPinnedSessions: ["C:/s/c.jsonl"],
    archivedSessions: { "C:/s/b.jsonl": 1 },
    sessionTitles: { "C:/s/a.jsonl": "标题" },
    browserRecentUrls: [],
    browserViewportWidth: null,
    defaultProjectDir: "C:/projects",
    showInTray: true,
    browserEnabled: true,
    browserLoginImportConsent: true,
    maxParallelSessions: 4,
    sessionPrefetchEnabled: false,
    welcomeRecentsEnabled: true,
    notification: {
      enabled: true,
      volume: 0.5,
      focusPolicy: "always",
      sounds: {},
      scenarios: {},
    } as unknown as PideskSettings["notification"],
    sessionStreamFontPx: 16,
    fontUiPreset: "default",
    fontMonoPreset: "cascadia",
    questionRailStyle: "line",
    shortcuts: {},
  } as PideskSettings;
}

describe("settingsSync whitelist", () => {
  it("pick 只保留用户偏好，不含路径与会话键", () => {
    const picked = pickSyncableSettings(fakeSettings());
    expect(Object.keys(picked).sort()).toEqual([...SYNCABLE_SETTINGS_KEYS].sort());
    expect(picked).not.toHaveProperty("projects");
    expect(picked).not.toHaveProperty("piExecutablePath");
    expect(picked).not.toHaveProperty("sessionTitles");
    expect(picked.theme).toBe("dark");
    expect(picked.welcomeRecentsEnabled).toBe(true);
  });

  it("解析合法信封", () => {
    const envelope = parseSettingsSyncEnvelope({
      format: 1,
      updatedAt: 100,
      appVersion: "0.3.0",
      deviceName: "PC",
      settings: pickSyncableSettings(fakeSettings()),
    });
    expect(envelope?.updatedAt).toBe(100);
    expect(envelope?.deviceName).toBe("PC");
  });

  it("拒绝未知 format 与坏形状", () => {
    expect(parseSettingsSyncEnvelope({ format: 2, updatedAt: 1, settings: {} })).toBeNull();
    expect(
      parseSettingsSyncEnvelope({ format: 1, updatedAt: Number.NaN, settings: {} }),
    ).toBeNull();
    expect(parseSettingsSyncEnvelope(null)).toBeNull();
  });

  it("diff 只列有差异的键，对象走 JSON 比较", () => {
    const local = pickSyncableSettings(fakeSettings());
    const remote = {
      ...local,
      theme: "light" as const,
      welcomeRecentsEnabled: false,
    };
    const changes = diffSyncableSettings(local, remote);
    expect(changes.map((c) => c.key).sort()).toEqual(["theme", "welcomeRecentsEnabled"]);
    expect(changes.find((c) => c.key === "theme")).toMatchObject({
      local: "dark",
      remote: "light",
    });
  });

  it("summarize 标量原样、嵌套收成短文案", () => {
    expect(summarizeSettingValue(true)).toBe("true");
    expect(summarizeSettingValue("hello")).toBe("hello");
    expect(summarizeSettingValue([1, 2])).toBe("列表(2)");
    expect(summarizeSettingValue({ a: 1 })).toBe("对象");
    expect(summarizeSettingValue(null)).toBe("—");
  });
});
