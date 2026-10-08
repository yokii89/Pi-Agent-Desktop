import { describe, expect, it } from "vitest";
import {
  buildContributionKey,
  computeContextId,
  contributionsFromPackage,
  parsePideskManifest,
} from "../extension/contributionSchema";

describe("runtime catalog integration helpers", () => {
  it("yoki-plan 静态 contribution 可被 Catalog 发现（不启动 pi）", () => {
    const contextId = computeContextId(null);
    const result = contributionsFromPackage(
      {
        packageId: "yoki-plan",
        sourceIdentity: "npm:yoki-plan",
        scope: "user",
        packageVersion: "0.1.0",
        pideskField: {
          contributes: {
            accessModes: [
              {
                id: "plan",
                title: "计划模式",
                description: "只读探索并产出执行计划",
                icon: "clipboard",
                accent: "warning",
                activation: "onAccessMode",
              },
            ],
          },
          worker: { safe: false },
        },
        enabled: true,
      },
      contextId,
    );

    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry?.placement).toBe("access-mode");
    expect(entry?.title).toBe("计划模式");
    expect(entry?.activation).toBe("onAccessMode");
    expect(entry?.workerSafe).toBe(false);
    expect(entry?.key).toBe(
      buildContributionKey({
        contextId,
        scope: "user",
        packageKey: "npm:yoki-plan",
        placement: "access-mode",
        id: "plan",
      }),
    );
  });

  it("user 与 project 同名包生成不同 contributionKey", () => {
    const userCtx = computeContextId(null);
    const projCtx = computeContextId("D:/Code/PI/pidesk");
    const manifest = {
      contributes: { accessModes: [{ id: "plan", title: "计划模式" }] },
    };
    const user = contributionsFromPackage(
      {
        packageId: "yoki-plan",
        sourceIdentity: "npm:yoki-plan",
        scope: "user",
        pideskField: manifest,
        enabled: true,
      },
      userCtx,
    );
    const project = contributionsFromPackage(
      {
        packageId: "yoki-plan",
        sourceIdentity: "npm:yoki-plan",
        scope: "project",
        projectDir: "D:/Code/PI/pidesk",
        pideskField: manifest,
        enabled: true,
      },
      projCtx,
    );
    expect(user.entries[0]?.key).not.toBe(project.entries[0]?.key);
  });

  it("parsePideskManifest 对空/非法输入安全", () => {
    expect(parsePideskManifest(null).accessModes).toEqual([]);
    expect(parsePideskManifest("nope").accessModes).toEqual([]);
    expect(parsePideskManifest({ contributes: { accessModes: "bad" } }).accessModes).toEqual([]);
  });
});
