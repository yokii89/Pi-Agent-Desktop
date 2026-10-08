import { describe, expect, it } from "vitest";
import type { ExtensionContribution } from "../../shared/contribution";
import {
  accessModeChipLabel,
  mergeAccessModeRows,
  resolveAccessModeSelection,
} from "./contributionProjection";

function cat(id: string, title: string, key?: string): ExtensionContribution {
  return {
    key: key ?? `ck:user:user:npm:yoki-plan:access-mode:${id}`,
    catalogContextId: "user",
    packageId: "yoki-plan",
    scope: "user",
    placement: "access-mode",
    id,
    title,
    activation: "onAccessMode",
    workerSafe: false,
  };
}

const baseOpts = {
  activationTxns: [] as never[],
  lastKnown: [] as never[],
  activeSessionId: "s1",
  runtimeReady: false,
};

describe("mergeAccessModeRows", () => {
  it("仅 Catalog → advertised", () => {
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("advertised");
    expect(rows[0]?.liveActive).toBe(false);
  });

  it("Catalog + live → live", () => {
    const key = cat("plan", "计划模式").key;
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [
        {
          id: "view-1",
          sessionId: "s1",
          contributionKey: key,
          mode: { id: "plan", title: "计划模式", active: true, detail: "已拦截写入" },
        },
      ],
    });
    expect(rows[0]?.state).toBe("live");
    expect(rows[0]?.liveActive).toBe(true);
    expect(rows[0]?.detail).toBe("已拦截写入");
  });

  it("live 关闭后 catalog 条目 → suspended，不消失", () => {
    const key = cat("plan", "计划模式").key;
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
      lastKnown: [
        {
          contributionKey: key,
          sessionId: "s1",
          title: "计划模式",
          active: true,
        },
      ],
    });
    expect(rows[0]?.state).toBe("suspended");
    expect(rows[0]?.suspendedLabel).toContain("已暂停");
  });

  it("激活事务 → activating；失败 → failed", () => {
    const key = cat("plan", "计划模式").key;
    const activating = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
      activationTxns: [
        {
          contributionKey: key,
          sessionId: "s1",
          actionId: "mode:activate",
          startedAt: Date.now(),
        },
      ],
    });
    expect(activating[0]?.state).toBe("activating");

    const failed = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
      activationTxns: [
        {
          contributionKey: key,
          sessionId: "s1",
          actionId: "mode:activate",
          startedAt: Date.now(),
          error: "扩展未响应",
        },
      ],
    });
    expect(failed[0]?.state).toBe("failed");
    expect(failed[0]?.error).toBe("扩展未响应");
  });

  it("legacy live（无 key）仍显示为 live", () => {
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [],
      liveEntries: [
        {
          id: "view-legacy",
          sessionId: "s1",
          mode: { id: "plan", title: "旧扩展模式", active: false },
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("live");
    expect(rows[0]?.key).toBe("view-legacy");
  });

  it("A/B 会话投影不串台", () => {
    const key = cat("plan", "计划模式").key;
    const rowsA = mergeAccessModeRows({
      ...baseOpts,
      activeSessionId: "sA",
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [
        {
          id: "v-b",
          sessionId: "sB",
          contributionKey: key,
          mode: { id: "plan", title: "计划模式", active: true },
        },
      ],
    });
    expect(rowsA[0]?.state).toBe("advertised");
    expect(rowsA[0]?.liveActive).toBe(false);
  });
});

describe("resolveAccessModeSelection", () => {
  it("cold + catalog → unresolved，不得确认完全访问", () => {
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
    });
    const sel = resolveAccessModeSelection({
      rows,
      runtimeReady: false,
      catalogHasAccessModes: true,
      anyActivating: false,
    });
    expect(sel).toBe("unresolved");
  });

  it("ready + 无 catalog 声明 → confirmed-full", () => {
    const sel = resolveAccessModeSelection({
      rows: [],
      runtimeReady: true,
      catalogHasAccessModes: false,
      anyActivating: false,
    });
    expect(sel).toBe("confirmed-full");
  });

  it("ready + catalog 但未注册 + 宽限未过 → unresolved", () => {
    const rows = mergeAccessModeRows({
      ...baseOpts,
      runtimeReady: true,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
    });
    const sel = resolveAccessModeSelection({
      rows,
      runtimeReady: true,
      catalogHasAccessModes: true,
      anyActivating: false,
      registrationSettled: false,
    });
    expect(sel).toBe("unresolved");
  });

  it("ready + catalog 但未注册 + 宽限已过仍 unresolved", () => {
    const rows = mergeAccessModeRows({
      ...baseOpts,
      runtimeReady: true,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [],
    });
    expect(rows[0]?.state).toBe("advertised");
    const sel = resolveAccessModeSelection({
      rows,
      runtimeReady: true,
      catalogHasAccessModes: true,
      anyActivating: false,
      registrationSettled: true,
    });
    expect(sel).toBe("unresolved");
  });

  it("live active → confirmed-extension", () => {
    const key = cat("plan", "计划模式").key;
    const rows = mergeAccessModeRows({
      ...baseOpts,
      runtimeReady: true,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [
        {
          id: "v1",
          sessionId: "s1",
          contributionKey: key,
          mode: { id: "plan", title: "计划模式", active: true },
        },
      ],
    });
    const sel = resolveAccessModeSelection({
      rows,
      runtimeReady: true,
      catalogHasAccessModes: true,
      anyActivating: false,
    });
    expect(sel).toBe("confirmed-extension");
  });

  it("ready + live 全 inactive → confirmed-full", () => {
    const key = cat("plan", "计划模式").key;
    const rows = mergeAccessModeRows({
      ...baseOpts,
      runtimeReady: true,
      catalogEntries: [cat("plan", "计划模式")],
      liveEntries: [
        {
          id: "v1",
          sessionId: "s1",
          contributionKey: key,
          mode: { id: "plan", title: "计划模式", active: false },
        },
      ],
    });
    const sel = resolveAccessModeSelection({
      rows,
      runtimeReady: true,
      catalogHasAccessModes: true,
      anyActivating: false,
    });
    expect(sel).toBe("confirmed-full");
  });
});

describe("accessModeChipLabel", () => {
  it("a live registration remains transitioning until confirmation completes", () => {
    const contribution = cat("plan", "Plan");
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [contribution],
      liveEntries: [
        {
          id: "v",
          sessionId: "s1",
          contributionKey: contribution.key,
          mode: { id: "plan", title: "Plan", active: false },
        },
      ],
      activationTxns: [
        {
          contributionKey: contribution.key,
          sessionId: "s1",
          actionId: "mode:activate",
          startedAt: 0,
        },
      ],
    });
    expect(rows[0]?.state).toBe("activating");
  });

  it("a missing declared registration prevents full access confirmation", () => {
    const first = cat("one", "One");
    const second = cat("two", "Two");
    const rows = mergeAccessModeRows({
      ...baseOpts,
      catalogEntries: [first, second],
      liveEntries: [
        {
          id: "v",
          sessionId: "s1",
          contributionKey: first.key,
          mode: { id: "one", title: "One", active: false },
        },
      ],
    });
    expect(
      resolveAccessModeSelection({
        rows,
        runtimeReady: true,
        catalogHasAccessModes: true,
        anyActivating: false,
      }),
    ).toBe("unresolved");
  });
  it("unresolved 无 last-known → 中性文案", () => {
    const label = accessModeChipLabel({ selection: "unresolved", rows: [] });
    expect(label.title).toBe("访问模式");
    expect(label.activeKey).toBeNull();
  });

  it("confirmed-extension → 显示模式标题", () => {
    const label = accessModeChipLabel({
      selection: "confirmed-extension",
      rows: [
        {
          key: "k",
          contributionKey: "k",
          title: "计划模式",
          state: "live",
          liveActive: true,
          detail: "只读",
        },
      ],
    });
    expect(label.title).toBe("计划模式");
    expect(label.subtitle).toBe("只读");
  });
});
