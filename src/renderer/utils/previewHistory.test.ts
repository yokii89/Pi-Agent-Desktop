import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  emptyPreviewHistory,
  pushPreviewHistory,
  stepPreviewHistory,
} from "./previewHistory";

const entry = (path: string, focusLine: number | null = null, root = "D:\\proj") => ({
  root,
  path,
  focusLine,
});

describe("pushPreviewHistory", () => {
  it("首次打开建栈；不同文件依次追加", () => {
    let h = pushPreviewHistory(emptyPreviewHistory, entry("D:\\proj\\a.md"));
    expect(h).toEqual({ entries: [entry("D:\\proj\\a.md")], index: 0 });
    h = pushPreviewHistory(h, entry("D:\\proj\\b.md"));
    expect(h).toEqual({
      entries: [entry("D:\\proj\\a.md"), entry("D:\\proj\\b.md")],
      index: 1,
    });
  });

  it("当前文件重开原地替换 focusLine，不增长栈", () => {
    let h = pushPreviewHistory(emptyPreviewHistory, entry("D:\\proj\\a.md"));
    h = pushPreviewHistory(h, entry("d:/proj/A.md", 5));
    expect(h.entries).toHaveLength(1);
    expect(h.index).toBe(0);
    expect(h.entries[0].focusLine).toBe(5);
  });

  it("重新打开历史中更早的文件是新的入栈（对齐浏览器地址栏语义）", () => {
    let h = pushPreviewHistory(emptyPreviewHistory, entry("a.md"));
    h = pushPreviewHistory(h, entry("b.md"));
    h = pushPreviewHistory(h, entry("a.md", 5));
    expect(h.entries.map((e) => e.path)).toEqual(["a.md", "b.md", "a.md"]);
    expect(h.index).toBe(2);
  });

  it("同文件判定不区分大小写与斜杠方向", () => {
    let h = pushPreviewHistory(emptyPreviewHistory, entry("D:\\proj\\a.md"));
    h = pushPreviewHistory(h, entry("d:/proj/A.md", 3));
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0].focusLine).toBe(3);
  });

  it("处于历史中间时新打开截断「前进」分支", () => {
    let h = pushPreviewHistory(emptyPreviewHistory, entry("a.md"));
    h = pushPreviewHistory(h, entry("b.md"));
    h = pushPreviewHistory(h, entry("c.md"));
    // 退两步到 a.md，再打开新文件：b/c 被截断
    h = pushPreviewHistory({ entries: h.entries, index: 0 }, entry("d.md"));
    expect(h.entries.map((e) => e.path)).toEqual(["a.md", "d.md"]);
    expect(h.index).toBe(1);
  });
});

describe("stepPreviewHistory", () => {
  it("前进/后退返回目标条目与落位；越界返回 null", () => {
    let h = pushPreviewHistory(emptyPreviewHistory, entry("a.md"));
    h = pushPreviewHistory(h, entry("b.md"));
    h = pushPreviewHistory(h, entry("c.md"));

    expect(canGoBack(h)).toBe(true);
    expect(canGoForward(h)).toBe(false);
    expect(stepPreviewHistory(h, 1)).toBeNull();

    const back = stepPreviewHistory(h, -1);
    expect(back?.entry.path).toBe("b.md");
    expect(back?.index).toBe(1);

    const forward = stepPreviewHistory({ ...h, index: 0 }, 1);
    expect(forward?.entry.path).toBe("b.md");
    expect(forward?.index).toBe(1);
    expect(canGoBack({ entries: h.entries, index: 0 })).toBe(false);
  });

  it("空栈任何移动都返回 null", () => {
    expect(stepPreviewHistory(emptyPreviewHistory, -1)).toBeNull();
    expect(stepPreviewHistory(emptyPreviewHistory, 1)).toBeNull();
    expect(canGoBack(emptyPreviewHistory)).toBe(false);
    expect(canGoForward(emptyPreviewHistory)).toBe(false);
  });
});
