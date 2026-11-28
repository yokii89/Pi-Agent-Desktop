import { describe, expect, it } from "vitest";
import { addableFeatures, buildSidebarFeatures, type SidebarFeatureInput } from "./sidebarFeatures";

const t = (key: string): string => key;

function input(overrides: Partial<SidebarFeatureInput> = {}): SidebarFeatureInput {
  return {
    tabs: [],
    browserEnabled: true,
    reviewWindowOpen: false,
    shortcuts: { openFiles: "Ctrl+P", openReview: "Ctrl+Alt+R" },
    catalogRows: [],
    visiblePanels: [],
    allPanels: [],
    t,
    ...overrides,
  };
}

describe("buildSidebarFeatures", () => {
  it("内置功能按文件/浏览器/审阅排序，关闭浏览器开关后移除浏览器", () => {
    const all = buildSidebarFeatures(input());
    expect(all.map((feature) => feature.id)).toEqual(["files", "browser", "review"]);
    expect(all[0]?.shortcut).toBe("Ctrl+P");
    expect(all[0]?.title).toBe("panels.context.openFiles");
    expect(all[0]?.tabTitle).toBe("panels.context.files");
    expect(all[1]?.shortcut).toBeUndefined();

    const noBrowser = buildSidebarFeatures(input({ browserEnabled: false }));
    expect(noBrowser.map((feature) => feature.id)).toEqual(["files", "review"]);
  });

  it("Catalog 行按 id 作为页签身份，live 面板不再生成第二枚页签", () => {
    const features = buildSidebarFeatures(
      input({
        catalogRows: [
          {
            key: "ck:tg",
            contributionKey: "ck:tg",
            id: "telegram-bridge",
            title: "Telegram",
            description: "Bridge",
            icon: "chat-circle",
            state: "live",
          },
        ],
        visiblePanels: [
          {
            id: "view-1",
            panelId: "telegram-bridge",
            title: "Live Telegram",
            contributionKey: "ck:tg",
          },
        ],
        allPanels: [{ id: "view-1", panelId: "telegram-bridge", title: "Live Telegram" }],
      }),
    );
    const extension = features.filter((feature) => feature.source === "extension");
    expect(extension).toHaveLength(1);
    expect(extension[0]?.id).toBe("ext:telegram-bridge");
    expect(extension[0]?.title).toBe("Telegram");
    expect(extension[0]?.live).toBe(true);
  });

  it("只有 live、没有 Catalog 的扩展面板也会出现在启动页", () => {
    const features = buildSidebarFeatures(
      input({
        visiblePanels: [{ id: "view-2", panelId: "scratch", title: "Scratch" }],
        allPanels: [{ id: "view-2", panelId: "scratch", title: "Scratch" }],
      }),
    );
    const extension = features.find((feature) => feature.id === "ext:scratch");
    expect(extension?.title).toBe("Scratch");
    expect(extension?.catalog).toBeUndefined();
    expect(extension?.live).toBe(true);
  });

  it("页签开着但 live 属于其它会话：仍保留可渲染的标题与图标", () => {
    const features = buildSidebarFeatures(
      input({
        tabs: ["ext:other-session"],
        visiblePanels: [],
        allPanels: [{ id: "view-3", panelId: "other-session", title: "Other session panel" }],
      }),
    );
    const extension = features.find((feature) => feature.id === "ext:other-session");
    expect(extension?.title).toBe("Other session panel");
    expect(extension?.open).toBe(true);
    expect(extension?.live).toBe(false);
  });

  it("加号菜单排除已打开页签与审查浮窗", () => {
    const features = buildSidebarFeatures(
      input({
        tabs: ["files", "ext:queue"],
        reviewWindowOpen: true,
        visiblePanels: [{ id: "view-4", panelId: "queue", title: "Queue" }],
        allPanels: [{ id: "view-4", panelId: "queue", title: "Queue" }],
      }),
    );
    expect(addableFeatures(features).map((feature) => feature.id)).toEqual(["browser"]);
  });

  it("live 面板的 placementHint.panelBadge 透传为页签/启动页徽章（docs/06 R7）", () => {
    const badge = { tone: "attention" as const, count: 1, label: "失败" };
    const features = buildSidebarFeatures(
      input({
        tabs: ["ext:telegram-bridge"],
        visiblePanels: [
          {
            id: "view-1",
            panelId: "telegram-bridge",
            title: "Telegram",
            placementHint: { panelBadge: badge },
          },
        ],
        allPanels: [
          {
            id: "view-1",
            panelId: "telegram-bridge",
            title: "Telegram",
            placementHint: { panelBadge: badge },
          },
        ],
      }),
    );
    expect(features.find((feature) => feature.id === "ext:telegram-bridge")?.badge).toEqual(badge);
    expect(features.find((feature) => feature.id === "files")?.badge).toBeUndefined();
  });
});
