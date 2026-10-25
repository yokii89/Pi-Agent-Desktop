import { describe, expect, it } from "vitest";
import {
  closeSidebarTab,
  extensionPanelIdOf,
  openSidebarTab,
  type SidebarTabsState,
} from "./sidebarTabs";

function state(overrides: Partial<SidebarTabsState> = {}): SidebarTabsState {
  return {
    rightSidebarOpen: true,
    rightSidebarTabs: [],
    rightSidebarTab: null,
    hiddenSidebarPanelIds: [],
    ...overrides,
  };
}

describe("openSidebarTab", () => {
  it("新页签追加到末尾并激活，同时展开侧栏", () => {
    const next = openSidebarTab(
      state({ rightSidebarOpen: false, rightSidebarTabs: ["files"], rightSidebarTab: "files" }),
      "browser",
    );
    expect(next.rightSidebarTabs).toEqual(["files", "browser"]);
    expect(next.rightSidebarTab).toBe("browser");
    expect(next.rightSidebarOpen).toBe(true);
  });

  it("已存在但未激活时只聚焦，不重复追加", () => {
    const next = openSidebarTab(
      state({ rightSidebarTabs: ["files", "browser"], rightSidebarTab: "browser" }),
      "files",
    );
    expect(next.rightSidebarTabs).toEqual(["files", "browser"]);
    expect(next.rightSidebarTab).toBe("files");
  });

  it("完全无变化时返回原引用，避免无谓提交", () => {
    const current = state({ rightSidebarTabs: ["files"], rightSidebarTab: "files" });
    expect(openSidebarTab(current, "files")).toBe(current);
  });

  it("打开扩展页签会解除用户关闭抑制", () => {
    const next = openSidebarTab(state({ hiddenSidebarPanelIds: ["queue", "other"] }), "ext:queue");
    expect(next.hiddenSidebarPanelIds).toEqual(["other"]);
  });
});

describe("closeSidebarTab", () => {
  it("关闭活动页签时右侧邻页接管，没有则左侧", () => {
    const right = closeSidebarTab(
      state({ rightSidebarTabs: ["files", "browser", "review"], rightSidebarTab: "browser" }),
      "browser",
    );
    expect(right.rightSidebarTabs).toEqual(["files", "review"]);
    expect(right.rightSidebarTab).toBe("review");

    const left = closeSidebarTab(
      state({ rightSidebarTabs: ["files", "browser"], rightSidebarTab: "browser" }),
      "browser",
    );
    expect(left.rightSidebarTab).toBe("files");
  });

  it("关闭唯一页签回启动页", () => {
    const next = closeSidebarTab(
      state({ rightSidebarTabs: ["files"], rightSidebarTab: "files" }),
      "files",
    );
    expect(next.rightSidebarTabs).toEqual([]);
    expect(next.rightSidebarTab).toBeNull();
    expect(next.rightSidebarOpen).toBe(true);
  });

  it("关闭非活动页签不改变当前页签", () => {
    const next = closeSidebarTab(
      state({ rightSidebarTabs: ["files", "browser"], rightSidebarTab: "files" }),
      "browser",
    );
    expect(next.rightSidebarTabs).toEqual(["files"]);
    expect(next.rightSidebarTab).toBe("files");
  });

  it("关闭扩展页签只记 panelId 抑制，内置页签不记", () => {
    const ext = closeSidebarTab(
      state({ rightSidebarTabs: ["ext:queue"], rightSidebarTab: "ext:queue" }),
      "ext:queue",
    );
    expect(ext.hiddenSidebarPanelIds).toEqual(["queue"]);

    const builtin = closeSidebarTab(
      state({ rightSidebarTabs: ["files"], rightSidebarTab: "files" }),
      "files",
    );
    expect(builtin.hiddenSidebarPanelIds).toEqual([]);
  });

  it("重复关闭同一扩展页签不重复记录抑制", () => {
    const next = closeSidebarTab(
      state({
        rightSidebarTabs: ["ext:queue"],
        rightSidebarTab: "ext:queue",
        hiddenSidebarPanelIds: ["queue"],
      }),
      "ext:queue",
    );
    expect(next.hiddenSidebarPanelIds).toEqual(["queue"]);
    expect(next.rightSidebarTab).toBeNull();
  });

  it("关闭不存在的页签返回原引用", () => {
    const current = state({ rightSidebarTabs: ["files"], rightSidebarTab: "files" });
    expect(closeSidebarTab(current, "browser")).toBe(current);
  });
});

describe("extensionPanelIdOf", () => {
  it("只解析 ext: 前缀", () => {
    expect(extensionPanelIdOf("ext:queue")).toBe("queue");
    expect(extensionPanelIdOf("files")).toBeNull();
    expect(extensionPanelIdOf("review")).toBeNull();
  });
});
