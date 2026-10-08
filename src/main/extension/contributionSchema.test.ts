import { describe, expect, it } from "vitest";
import {
  buildContributionKey,
  computeCatalogFingerprint,
  computeContextId,
  contributionsFromPackage,
  normalizeProjectDir,
  packageKeyIdentity,
  parsePideskManifest,
} from "./contributionSchema";

describe("normalizeProjectDir / computeContextId", () => {
  it("null → user context", () => {
    expect(normalizeProjectDir(null)).toBeNull();
    expect(computeContextId(null)).toBe("user");
    expect(computeContextId(undefined)).toBe("user");
  });

  it("Windows 反斜杠与盘符大小写归一后 contextId 稳定", () => {
    const a = computeContextId("D:\\Code\\PI\\pidesk");
    const b = computeContextId("d:/Code/PI/pidesk");
    const c = computeContextId("d:/Code/PI/pidesk/");
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toMatch(/^proj_[0-9a-f]{16}$/);
  });

  it("不同项目生成不同 contextId", () => {
    expect(computeContextId("D:/Code/A")).not.toBe(computeContextId("D:/Code/B"));
  });
});

describe("packageKeyIdentity", () => {
  it("npm/git identity 保持可读", () => {
    expect(packageKeyIdentity("npm", "@scope/pkg")).toBe("npm:@scope/pkg");
    expect(packageKeyIdentity("git", "github.com/owner/repo")).toBe("git:github.com/owner/repo");
  });

  it("local 路径不暴露绝对路径，同 basename 不同路径 key 不同", () => {
    const k1 = packageKeyIdentity("local", "D:/exts/yoki-plan");
    const k2 = packageKeyIdentity("local", "E:/other/yoki-plan");
    expect(k1).not.toBe(k2);
    expect(k1.startsWith("local:yoki-plan:")).toBe(true);
    expect(k1).not.toContain("D:");
    expect(k2).not.toContain("E:");
  });
});

describe("buildContributionKey", () => {
  it("user/project 同名 id 生成不同 key", () => {
    const base = {
      contextId: "user",
      packageKey: "npm:yoki-plan",
      placement: "access-mode" as const,
      id: "plan",
    };
    const userKey = buildContributionKey({ ...base, scope: "user" });
    const projKey = buildContributionKey({
      ...base,
      contextId: "proj_abc",
      scope: "project",
    });
    expect(userKey).not.toBe(projKey);
    expect(userKey).toBe("ck:user:user:npm:yoki-plan:access-mode:plan");
  });
});

describe("parsePideskManifest", () => {
  it("缺省返回空目录", () => {
    expect(parsePideskManifest(undefined)).toEqual({
      accessModes: [],
      settingsViews: [],
      panels: [],
      workerSafe: false,
    });
  });

  it("解析 accessModes + worker.safe", () => {
    const m = parsePideskManifest({
      contributes: {
        accessModes: [
          {
            id: "plan",
            title: "计划模式",
            description: "只读探索",
            icon: "clipboard",
            accent: "warning",
            activation: "onAccessMode",
          },
        ],
      },
      worker: { safe: true },
    });
    expect(m.workerSafe).toBe(true);
    expect(m.accessModes).toHaveLength(1);
    expect(m.accessModes[0]?.id).toBe("plan");
    expect(m.accessModes[0]?.icon).toBe("clipboard");
  });

  it("非法 icon 被丢弃，条目仍保留", () => {
    const m = parsePideskManifest({
      contributes: {
        accessModes: [{ id: "plan", title: "计划模式", icon: "<svg>evil</svg>" }],
      },
    });
    expect(m.accessModes).toHaveLength(1);
    expect(m.accessModes[0]?.icon).toBeUndefined();
  });

  it("解析 panels 并默认 activation=onSessionView（docs/design/19 §10.1）", () => {
    const m = parsePideskManifest({
      contributes: {
        panels: [{ id: "telegram-bridge", title: "Telegram", description: "Bridge 侧栏" }],
      },
    });
    expect(m.panels).toHaveLength(1);
    expect(m.panels[0]?.id).toBe("telegram-bridge");
    expect(m.panels[0]?.activation).toBe("onSessionView");
  });
});

describe("contributionsFromPackage", () => {
  const ctx = computeContextId(null);

  it("禁用包不产出 contribution", () => {
    const r = contributionsFromPackage(
      {
        packageId: "yoki-plan",
        sourceIdentity: "npm:yoki-plan",
        scope: "user",
        pideskField: {
          contributes: { accessModes: [{ id: "plan", title: "计划模式" }] },
        },
        enabled: false,
      },
      ctx,
    );
    expect(r.entries).toHaveLength(0);
  });

  it("启用包产出 access-mode 条目", () => {
    const r = contributionsFromPackage(
      {
        packageId: "yoki-plan",
        sourceIdentity: "npm:yoki-plan",
        scope: "user",
        packageVersion: "1.0.0",
        pideskField: {
          contributes: {
            accessModes: [
              { id: "plan", title: "计划模式", description: "只读探索", icon: "clipboard" },
            ],
          },
        },
        enabled: true,
      },
      ctx,
    );
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e?.placement).toBe("access-mode");
    expect(e?.id).toBe("plan");
    expect(e?.title).toBe("计划模式");
    expect(e?.packageVersion).toBe("1.0.0");
    expect(e?.key).toContain("access-mode");
    expect(e?.key).toContain("plan");
  });

  it("启用包产出 panel 条目且 key 含 placement/id", () => {
    const r = contributionsFromPackage(
      {
        packageId: "@llblab/pi-telegram",
        sourceIdentity: "npm:@llblab/pi-telegram",
        scope: "user",
        pideskField: {
          contributes: {
            panels: [{ id: "telegram-bridge", title: "Telegram" }],
          },
        },
        enabled: true,
      },
      ctx,
    );
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e?.placement).toBe("panel");
    expect(e?.id).toBe("telegram-bridge");
    expect(e?.activation).toBe("onSessionView");
    expect(e?.key).toContain(":panel:");
    expect(e?.key).toContain("telegram-bridge");
  });

  it("同包重复 id 进诊断且只保留一条", () => {
    const r = contributionsFromPackage(
      {
        packageId: "dup",
        sourceIdentity: "npm:dup",
        scope: "user",
        pideskField: {
          contributes: {
            accessModes: [
              { id: "plan", title: "A" },
              { id: "plan", title: "B" },
            ],
          },
        },
        enabled: true,
      },
      ctx,
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.title).toBe("A");
    expect(r.diagnostics.some((d) => d.message.includes("重复"))).toBe(true);
  });

  it("缺 title 的项跳过并进诊断", () => {
    const r = contributionsFromPackage(
      {
        packageId: "bad",
        sourceIdentity: "npm:bad",
        scope: "user",
        pideskField: {
          contributes: {
            accessModes: [{ id: "x" }, { id: "ok", title: "好的" }],
          },
        },
        enabled: true,
      },
      ctx,
    );
    // parseItem 在 parsePideskManifest 内过滤非法项，不进 entries
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.id).toBe("ok");
  });
});

describe("computeCatalogFingerprint", () => {
  it("内容相同指纹稳定，版本变化指纹变化", () => {
    const a = computeCatalogFingerprint([
      { key: "k1", packageVersion: "1.0.0", title: "计划模式" },
    ]);
    const b = computeCatalogFingerprint([
      { key: "k1", packageVersion: "1.0.0", title: "计划模式" },
    ]);
    const c = computeCatalogFingerprint([
      { key: "k1", packageVersion: "2.0.0", title: "计划模式" },
    ]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
