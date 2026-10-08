/**
 * Contribution key 软绑定与 env 映射纯逻辑（docs/design/16 Phase A 闭环）。
 */

import { describe, expect, it } from "vitest";
import type { ExtensionContribution } from "../../shared/contribution";

/** 与 viewHost.softBindContributionKey 对齐的精简匹配。 */
function softBindKey(
  entries: ExtensionContribution[],
  modeId: string | undefined,
): string | undefined {
  if (!modeId) return undefined;
  const hits = entries.filter((e) => e.placement === "access-mode" && e.id === modeId);
  if (hits.length === 1) return hits[0]?.key;
  return undefined;
}

/** 与 piSession env 注入对齐：access-mode/panel/settings 全量注入；同 id 多 key 视为 ambiguous，不注入。 */
function buildEnvKeyMap(entries: ExtensionContribution[]): Record<string, string> {
  const keyById: Record<string, string> = {};
  const ambiguous = new Set<string>();
  for (const entry of entries) {
    if (ambiguous.has(entry.id)) continue;
    if (keyById[entry.id] && keyById[entry.id] !== entry.key) {
      delete keyById[entry.id];
      ambiguous.add(entry.id);
      continue;
    }
    keyById[entry.id] = entry.key;
  }
  return keyById;
}

function cat(id: string, key: string): ExtensionContribution {
  return {
    key,
    catalogContextId: "user",
    packageId: "@yoki/yoki-plan",
    scope: "user",
    placement: "access-mode",
    id,
    title: "计划模式",
    activation: "onAccessMode",
    workerSafe: false,
  };
}

describe("yoki-plan contribution soft-bind", () => {
  it("package.json id 与 live 注册 id 对齐时可绑定", () => {
    const key = "ck:user:user:npm:@yoki/yoki-plan:access-mode:yoki-plan";
    expect(softBindKey([cat("yoki-plan", key)], "yoki-plan")).toBe(key);
  });

  it("mode.id 不一致时无法绑定（legacy）", () => {
    const key = "ck:user:user:npm:@yoki/yoki-plan:access-mode:yoki-plan";
    expect(softBindKey([cat("yoki-plan", key)], "plan")).toBeUndefined();
  });

  it("同 id 多作用域时不软绑定，避免串台", () => {
    const userKey = "ck:ctx:user:npm:@yoki/yoki-plan:access-mode:yoki-plan";
    const projKey = "ck:ctx:project:npm:@yoki/yoki-plan:access-mode:yoki-plan";
    expect(
      softBindKey([cat("yoki-plan", userKey), cat("yoki-plan", projKey)], "yoki-plan"),
    ).toBeUndefined();
  });

  it("env 映射在唯一 id 时写入，歧义时剔除", () => {
    const k1 = "ck:user:user:npm:@yoki/yoki-plan:access-mode:yoki-plan";
    const map1 = buildEnvKeyMap([cat("yoki-plan", k1)]);
    expect(map1["yoki-plan"]).toBe(k1);

    const map2 = buildEnvKeyMap([
      cat("yoki-plan", k1),
      cat("yoki-plan", "ck:ctx:project:npm:@yoki/yoki-plan:access-mode:yoki-plan"),
    ]);
    expect(map2["yoki-plan"]).toBeUndefined();
  });
});
