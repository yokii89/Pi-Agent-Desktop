import { describe, expect, it } from "vitest";
import type { ExtensionContribution } from "../../shared/contribution";
import type { ActivationTxn, LastKnownMode } from "./contributionProjection";
import { projectPanelCatalogRows } from "./panelCatalog";

function panel(overrides: Partial<ExtensionContribution> = {}): ExtensionContribution {
  return {
    key: "ck:user:user:npm:demo:panel:queue",
    catalogContextId: "user",
    packageId: "npm:demo",
    scope: "user",
    placement: "panel",
    id: "queue",
    title: "Queue",
    activation: "onSessionView",
    workerSafe: false,
    ...overrides,
  };
}

function txn(overrides: Partial<ActivationTxn> = {}): ActivationTxn {
  return {
    contributionKey: "ck:user:user:npm:demo:panel:queue",
    sessionId: "s1",
    actionId: "view:open",
    startedAt: 1,
    ...overrides,
  };
}

const base = {
  catalogEntries: [panel()],
  visiblePanels: [],
  activationTxns: [],
  lastKnownModes: [],
  activeSessionId: "s1",
} as const;

describe("projectPanelCatalogRows", () => {
  it("没有 live 时为 advertised，并透传描述与图标", () => {
    const [row] = projectPanelCatalogRows({
      ...base,
      catalogEntries: [panel({ description: "队列面板", icon: "list-checks" })],
    });
    expect(row).toMatchObject({
      id: "queue",
      title: "Queue",
      description: "队列面板",
      icon: "list-checks",
      state: "advertised",
    });
  });

  it("按 panelId 或 contributionKey 对上 live，状态为 live", () => {
    const byId = projectPanelCatalogRows({
      ...base,
      visiblePanels: [{ id: "view-1", panelId: "queue" }],
    });
    expect(byId[0]?.state).toBe("live");

    const byKey = projectPanelCatalogRows({
      ...base,
      visiblePanels: [
        { id: "view-2", panelId: "other", contributionKey: base.catalogEntries[0].key },
      ],
    });
    expect(byKey[0]?.state).toBe("live");
  });

  it("live 属于其它会话时不算 live：Catalog 仍可再次打开", () => {
    const rows = projectPanelCatalogRows({
      ...base,
      visiblePanels: [],
      lastKnownModes: [
        {
          contributionKey: base.catalogEntries[0].key,
          sessionId: "s2",
          title: "Queue",
          active: false,
        } satisfies LastKnownMode,
      ],
    });
    expect(rows[0]?.state).toBe("suspended");
  });

  it("激活事务区分进行中与失败，且只认当前会话", () => {
    const activating = projectPanelCatalogRows({
      ...base,
      activationTxns: [txn()],
    });
    expect(activating[0]?.state).toBe("activating");

    const failed = projectPanelCatalogRows({
      ...base,
      activationTxns: [txn({ error: "启动失败" })],
    });
    expect(failed[0]?.state).toBe("failed");
    expect(failed[0]?.error).toBe("启动失败");

    const otherSession = projectPanelCatalogRows({
      ...base,
      activationTxns: [txn({ sessionId: "s2" })],
    });
    expect(otherSession[0]?.state).toBe("advertised");
  });

  it("非 panel placement 不进入列表", () => {
    const rows = projectPanelCatalogRows({
      ...base,
      catalogEntries: [
        panel(),
        panel({ key: "ck:settings", placement: "settings", id: "cfg", title: "Settings" }),
      ],
    });
    expect(rows.map((row) => row.id)).toEqual(["queue"]);
  });
});
