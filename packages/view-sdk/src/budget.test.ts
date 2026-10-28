/**
 * Budget mirror + capability helpers (docs/design/20 O3).
 *
 * The counting assertions below are the SDK half of a pair:
 * `src/main/view/viewBudgetLockstep.test.ts` asserts the same trees produce the
 * same verdict through Host `sanitizeTree`. Neither alone proves the mirror.
 */

import { describe, expect, it } from "vitest";
import {
  supportsCapability,
  supportsOptionPreview,
  supportsPanelLauncher,
  supportsPatch,
  supportsReadonlyList,
  supportsTable,
  tableView,
  tableViewFallback,
  viewLimits,
} from "./capabilities.js";
import type { DesktopViewClient } from "./client.js";
import { describeBudgetViolations, frameBudgetViolations, measureViewTree } from "./limits.js";
import type {
  ViewHelloPayload,
  ViewLimits,
  ViewNode,
  ViewTableColumn,
  ViewTableRow,
} from "./types.js";
import { VIEW_LIMITS } from "./types.js";

const LIMITS: ViewLimits = VIEW_LIMITS;

function txt(content: string): ViewNode {
  return { type: "text", content };
}

function col(...children: ViewNode[]): ViewNode {
  return { type: "column", children };
}

function tableWithRows(count: number): ViewNode {
  const columns: ViewTableColumn[] = [{ key: "a", label: "A" }];
  const rows: ViewTableRow[] = Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    cells: { a: `v${i}` },
  }));
  return { type: "table", id: "t", columns, rows };
}

function tabsWithCount(count: number): ViewNode {
  return {
    type: "tabs",
    id: "tabs",
    tabs: Array.from({ length: count }, (_, i) => ({
      id: `t${i}`,
      label: `T${i}`,
      children: [txt(`body ${i}`)],
    })),
  };
}

function nestDepth(depth: number): ViewNode {
  let node = txt("leaf");
  for (let i = 1; i < depth; i += 1) node = col(node);
  return node;
}

function frameOf(root: ViewNode): string {
  return JSON.stringify({ v: "view/v1", type: "update", id: "view-x", payload: { root } });
}

function violationsFor(root: ViewNode, limits: ViewLimits = LIMITS) {
  return frameBudgetViolations({
    line: frameOf(root),
    root,
    limits,
    maxMessageBytes: limits.maxMessageBytes,
  });
}

describe("measureViewTree mirrors Host accounting", () => {
  it("counts plain containers as one node plus their subtree", () => {
    expect(measureViewTree(txt("a"), LIMITS).nodes).toBe(1);
    expect(measureViewTree(col(txt("a"), txt("b")), LIMITS).nodes).toBe(3);
  });

  it("counts a table as 1 + rows (cells are free, docs/design/19 §3.2.1)", () => {
    expect(measureViewTree(tableWithRows(50), LIMITS).nodes).toBe(51);
  });

  it("counts each tab itself, which the extension-side copy of this rule omitted", () => {
    const tree = tabsWithCount(4);
    const measured = measureViewTree(tree, LIMITS);
    // tabs node + one per tab + one text body per tab
    expect(measured.nodes).toBe(1 + 4 + 4);
    // The hand-rolled version in pi-telegram-main/lib/desktop-view.ts returns 5.
    expect(measured.nodes).not.toBe(1 + 4);
  });

  it("does not count table rows the Host slices away", () => {
    const tree = tableWithRows(LIMITS.maxTableRows + 100);
    const measured = measureViewTree(tree, LIMITS);
    expect(measured.truncatedRows).toBe(100);
    expect(measured.nodes).toBe(1 + LIMITS.maxTableRows);
  });

  it("reports depth, including the over-budget level", () => {
    expect(measureViewTree(nestDepth(5), LIMITS).depth).toBe(5);
    const deep = nestDepth(LIMITS.maxDepth + 3);
    expect(measureViewTree(deep, LIMITS).depth).toBeGreaterThan(LIMITS.maxDepth);
  });

  it("stops counting once the node budget is blown", () => {
    const wide = col(...Array.from({ length: LIMITS.maxNodes + 50 }, (_, i) => txt(`n${i}`)));
    const measured = measureViewTree(wide, LIMITS);
    expect(measured.hitNodeBudget).toBe(true);
    expect(measured.nodes).toBe(LIMITS.maxNodes + 1);
  });

  it("never throws on shapes the Host degrades rather than rejects", () => {
    const junk = { type: "mystery", children: "not-an-array" } as unknown as ViewNode;
    expect(() => measureViewTree(junk, LIMITS)).not.toThrow();
    expect(measureViewTree(junk, LIMITS).nodes).toBe(1);
  });
});

describe("frameBudgetViolations separates 'Host would reject' from 'Host would clip'", () => {
  it("flags over-node trees as rejectable, with the measured count", () => {
    const wide = col(...Array.from({ length: LIMITS.maxNodes }, (_, i) => txt(`n${i}`)));
    const violations = violationsFor(wide);
    const nodes = violations.find((v) => v.limit === "maxNodes");
    expect(nodes?.kind).toBe("rejected");
    expect((nodes as { measured: number }).measured).toBeGreaterThan(LIMITS.maxNodes);
  });

  it("flags over-deep trees as rejectable", () => {
    const violations = violationsFor(nestDepth(LIMITS.maxDepth + 2));
    expect(violations.some((v) => v.limit === "maxDepth" && v.kind === "rejected")).toBe(true);
  });

  it("flags an oversized frame as rejectable (the Host destroys the socket for it)", () => {
    const violations = frameBudgetViolations({
      line: "x".repeat(2048),
      limits: LIMITS,
      maxMessageBytes: 1024,
    });
    const bytes = violations.find((v) => v.limit === "maxMessageBytes");
    expect(bytes?.kind).toBe("rejected");
    expect((bytes as { measured: number }).measured).toBe(2048);
    expect(describeBudgetViolations(violations)).toContain(
      "maxMessageBytes exceeded (measured 2048)",
    );
  });

  it("treats row overflow as truncation, never a rejection", () => {
    const violations = violationsFor(tableWithRows(LIMITS.maxTableRows + 40));
    expect(violations.every((v) => v.kind === "truncated")).toBe(true);
    expect(describeBudgetViolations(violations)).toContain("would drop 40 item(s)");
  });

  it("leaves a normal frame clean", () => {
    expect(violationsFor(col(txt("hello"), txt("world")))).toEqual([]);
  });
});

describe("capability probes and the table fallback fork", () => {
  const helloWith = (overrides: Partial<ViewHelloPayload>): DesktopViewClient =>
    ({
      hello: {
        protocol: "view/v1",
        placements: ["modal"],
        ...overrides,
      },
    }) as unknown as DesktopViewClient;

  it("answers false for a null client instead of throwing", () => {
    expect(supportsCapability(null, "view-table")).toBe(false);
    expect(supportsTable(undefined)).toBe(false);
    expect(supportsPatch(null)).toBe(false);
    expect(supportsPanelLauncher(null)).toBe(false);
    expect(supportsOptionPreview(null)).toBe(false);
    expect(supportsReadonlyList(null)).toBe(false);
  });

  it("reads capabilities straight off hello", () => {
    const withCaps = helloWith({ capabilities: ["view-patch"] });
    expect(supportsCapability(withCaps, "view-patch")).toBe(true);
    expect(supportsTable(withCaps)).toBe(false);
    expect(supportsPanelLauncher(withCaps)).toBe(false);
    expect(supportsOptionPreview(withCaps)).toBe(false);
    expect(supportsReadonlyList(withCaps)).toBe(false);

    const launched = helloWith({ capabilities: ["panel-launcher"] });
    expect(supportsPanelLauncher(launched)).toBe(true);

    const preview = helloWith({ capabilities: ["view-option-preview"] });
    expect(supportsOptionPreview(preview)).toBe(true);

    const readonly = helloWith({ capabilities: ["view-readonly-list"] });
    expect(supportsReadonlyList(readonly)).toBe(true);
  });

  it("falls back to compile-time limits when an old Host sends no limits", () => {
    expect(viewLimits(null)).toBe(VIEW_LIMITS);
    const live = { maxNodes: 128 } as ViewLimits;
    expect(viewLimits(helloWith({ limits: live }))).toBe(live);
  });

  it("builds a real table when the Host advertises view-table", () => {
    const client = helloWith({ capabilities: ["view-table"] });
    const node = tableView(client, {
      id: "queue",
      columns: [
        { key: "lane", label: "车道" },
        { key: "summary", label: "内容" },
      ],
      rows: [{ id: "r1", cells: { lane: "默认", summary: "hi" } }],
    });
    expect(node.type).toBe("table");
  });

  it("degrades to a column/row tree that never renders as 'unknown'", () => {
    const node = tableView(null, {
      id: "queue",
      columns: [
        { key: "lane", label: "车道" },
        { key: "summary", label: "内容" },
      ],
      rows: [{ id: "r1", cells: { lane: "默认", summary: "hi" } }],
    });
    expect(node.type).toBe("column");
    if (node.type !== "column") return;
    expect(node.children.map((c) => c.type)).toEqual(["row", "row"]);
    const header = node.children[0];
    if (header.type !== "row") return;
    expect(header.children).toEqual([
      { type: "text", content: "车道", variant: "caption" },
      { type: "text", content: "内容", variant: "caption" },
    ]);
  });

  it("keeps every data cell in the degraded rows (docs/06 R3)", () => {
    const node = tableViewFallback({
      id: "queue",
      columns: [
        { key: "lane", label: "车道" },
        { key: "summary", label: "摘要" },
      ],
      rows: [
        { id: "r1", cells: { lane: "控", summary: "把 README 翻成英文" } },
        { id: "r2", cells: { lane: "默", summary: "跑测试" } },
      ],
    });
    if (node.type !== "column") throw new Error("expected column");
    const rows = node.children.filter((child) => child.type === "row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      type: "row",
      children: [
        { type: "text", content: "控", variant: "body" },
        { type: "text", content: "把 README 翻成英文", variant: "caption" },
      ],
    });
    expect(rows[1]).toEqual({
      type: "row",
      children: [
        { type: "text", content: "默", variant: "body" },
        { type: "text", content: "跑测试", variant: "caption" },
      ],
    });
  });

  it("labelKey leads the row instead of filtering the other columns", () => {
    const node = tableViewFallback({
      id: "threads",
      columns: [
        { key: "state", label: "状态" },
        { key: "title", label: "线程" },
      ],
      rows: [{ id: "r1", cells: { state: "active", title: "build" } }],
      labelKey: "title",
    });
    if (node.type !== "column") throw new Error("expected column");
    const row = node.children[1];
    if (row.type !== "row") throw new Error("expected row");
    expect(row.children).toEqual([
      { type: "text", content: "build", variant: "body" },
      { type: "text", content: "active", variant: "caption" },
    ]);
  });

  it("pays one extra node per non-lead cell, still far under maxNodes", () => {
    // 2 列 × 2 行：column + header row + 2 header texts + 2 data rows + 4 data texts
    const node = tableViewFallback({
      id: "queue",
      columns: [
        { key: "lane", label: "车道" },
        { key: "summary", label: "摘要" },
      ],
      rows: [
        { id: "r1", cells: { lane: "控", summary: "a" } },
        { id: "r2", cells: { lane: "默", summary: "b" } },
      ],
    });
    const budget = measureViewTree(node, VIEW_LIMITS);
    expect(budget.nodes).toBe(10);
    expect(budget.hitNodeBudget).toBe(false);
  });

  it("compact opts back into a single-cell line for narrow rails", () => {
    const node = tableViewFallback({
      id: "queue",
      columns: [
        { key: "lane", label: "车道" },
        { key: "summary", label: "摘要" },
      ],
      rows: [{ id: "r1", cells: { lane: "控", summary: "跑测试" } }],
      compact: true,
    });
    if (node.type !== "column") throw new Error("expected column");
    const header = node.children[0];
    if (header.type !== "row") throw new Error("expected header row");
    expect(header.children).toEqual([{ type: "text", content: "车道", variant: "caption" }]);
    const row = node.children[1];
    if (row.type !== "row") throw new Error("expected row");
    expect(row.children).toEqual([{ type: "text", content: "控", variant: "body" }]);
  });

  it("renders an empty state instead of a header-only husk", () => {
    const node = tableViewFallback({
      id: "t",
      columns: [{ key: "a", label: "A" }],
      rows: [],
      emptyText: "暂无排队",
    });
    if (node.type !== "column") return;
    expect(node.children).toContainEqual({ type: "text", content: "暂无排队", variant: "caption" });
  });
});
