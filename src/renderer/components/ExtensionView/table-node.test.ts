import { describe, expect, it } from "vitest";
import {
  formatCell,
  resolveAlign,
  resolveColumnWeights,
  truncationLabel,
  windowTableRows,
} from "./table-node";

function col(
  over: Partial<{
    key: string;
    label: string;
    width?: number;
    align?: "left" | "center" | "right";
  }> = {},
) {
  return { key: over.key ?? "k", label: over.label ?? "L", width: over.width, align: over.align };
}

function row(id: string, cells: Record<string, string | number | boolean | null> = {}) {
  return { id, cells };
}

describe("resolveColumnWeights", () => {
  it("splits evenly when no column declares a width", () => {
    const weights = resolveColumnWeights([col(), col(), col()]);
    expect(weights).toHaveLength(3);
    for (const weight of weights) expect(weight).toBeCloseTo(100 / 3, 8);
  });

  it("gives a weighted column its proportional share", () => {
    const weights = resolveColumnWeights([col({ width: 3 }), col()]);
    expect(weights[0]).toBeCloseTo(75);
    expect(weights[1]).toBeCloseTo(25);
  });

  it("treats a missing width as one share alongside explicit weights", () => {
    const weights = resolveColumnWeights([col({ width: 2 }), col(), col()]);
    expect(weights[0]).toBeCloseTo(50);
    expect(weights[1]).toBeCloseTo(25);
  });

  it("sums to 100 across mixed valid and invalid declarations", () => {
    const weights = resolveColumnWeights([
      col({ width: 0 }),
      col({ width: Number.NaN }),
      col({ width: -5 }),
      col({ width: 4 }),
    ]);
    expect(weights).toHaveLength(4);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it("falls back to even split instead of dividing by zero", () => {
    // 全 0 权重已被 Host sanitize 拦掉，但渲染层不得因此产出 NaN 布局
    expect(resolveColumnWeights([col({ width: 0 }), col({ width: 0 })])).toEqual([50, 50]);
  });

  it("handles the empty and single-column cases", () => {
    expect(resolveColumnWeights([])).toEqual([]);
    expect(resolveColumnWeights([col()])).toEqual([100]);
  });
});

describe("resolveAlign", () => {
  it("defaults to left and passes through valid values", () => {
    expect(resolveAlign(col())).toBe("left");
    expect(resolveAlign(col({ align: "right" }))).toBe("right");
    expect(resolveAlign(col({ align: "center" }))).toBe("center");
  });

  it("rejects anything the protocol does not define", () => {
    expect(resolveAlign(col({ align: "justify" as "right" }))).toBe("left");
  });
});

describe("windowTableRows", () => {
  it("passes rows through when maxRows is absent", () => {
    const rows = [row("a"), row("b")];
    expect(windowTableRows(rows, undefined)).toEqual({ rows, hidden: 0, total: 2 });
  });

  it("truncates to maxRows and reports the hidden count", () => {
    const rows = [row("a"), row("b"), row("c")];
    expect(windowTableRows(rows, 2)).toEqual({ rows: rows.slice(0, 2), hidden: 1, total: 3 });
  });

  it("is a no-op when the window covers every row", () => {
    const rows = [row("a")];
    expect(windowTableRows(rows, 10)).toEqual({ rows, hidden: 0, total: 1 });
  });

  it("renders no rows for maxRows=0 but still reports the total", () => {
    // 作者显式收起到 0 行时，统计行仍须说明有多少数据被藏起来
    const rows = [row("a"), row("b")];
    expect(windowTableRows(rows, 0)).toEqual({ rows: [], hidden: 2, total: 2 });
  });

  it("does not mutate or alias the caller's array", () => {
    const rows = [row("a"), row("b")];
    const window = windowTableRows(rows, undefined);
    window.rows.push(row("c"));
    expect(rows).toHaveLength(2);
  });
});

describe("formatCell", () => {
  it("renders declared primitives as literal text", () => {
    expect(formatCell("text")).toBe("text");
    expect(formatCell(42)).toBe("42");
    expect(formatCell(true)).toBe("true");
    expect(formatCell(false)).toBe("false");
  });

  it("renders null and absent cells as empty so the row keeps its grid slot", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
  });
});

describe("truncationLabel", () => {
  it("states shown vs. total", () => {
    expect(truncationLabel(200, 640)).toBe("显示 200 / 共 640");
  });
});
