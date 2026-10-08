import { describe, expect, it } from "vitest";
import { VIEW_LIMITS } from "../../shared/view";
import {
  applyPatch,
  buildOpenedPayload,
  normalizePlacement,
  resolveHeaderSide,
  resolvePanelId,
  resolvePlacement,
  sanitizeTree,
  slotKey,
} from "./viewHostProtocol";

describe("normalizePlacement", () => {
  it("passes through implemented slots", () => {
    expect(normalizePlacement("modal")).toBe("modal");
    expect(normalizePlacement("stream")).toBe("stream");
    expect(normalizePlacement("widget")).toBe("widget");
    expect(normalizePlacement("panel")).toBe("panel");
    expect(normalizePlacement("sidebar")).toBe("sidebar");
    expect(normalizePlacement("header")).toBe("header");
    expect(normalizePlacement("settings")).toBe("settings");
    expect(normalizePlacement("access-mode")).toBe("access-mode");
  });

  it("falls back to modal for unknown values", () => {
    expect(normalizePlacement(undefined)).toBe("modal");
    expect(normalizePlacement("drawer")).toBe("modal");
    expect(normalizePlacement(42)).toBe("modal");
  });
});

describe("resolvePlacement", () => {
  it("accepts every implemented placement", () => {
    for (const p of [
      "modal",
      "stream",
      "widget",
      "panel",
      "sidebar",
      "header",
      "settings",
      "access-mode",
    ] as const) {
      expect(resolvePlacement(p, false)).toEqual({ ok: true, placement: p });
      expect(resolvePlacement(p, true)).toEqual({ ok: true, placement: p });
    }
  });

  it("rejects an explicit unknown slot when placementRequired is set", () => {
    // docs/design/20 §6.2 选了「收紧契约」：required 的含义是「给不了我要求的槽位就别打开」，
    // 所以拼错的槽位名不能被静默折成 modal 后照常渲染。
    expect(resolvePlacement("nope", true)).toEqual({
      ok: false,
      message: 'placement "nope" 不是已知槽位且 placementRequired=true',
    });
    // 非字符串同样按「显式写了未知值」处理
    expect(resolvePlacement(42, true)).toMatchObject({ ok: false });
  });

  it("degrades unknown values to modal when placementRequired is not set", () => {
    expect(resolvePlacement("nope", false)).toEqual({ ok: true, placement: "modal" });
    expect(resolvePlacement("nope", undefined)).toEqual({ ok: true, placement: "modal" });
  });

  it("keeps an omitted placement on the documented modal default, even when required", () => {
    // 缺省 ≠ 未知值：08 §5.3.4 规定 `placement` 缺省即 modal，required 不该把它判死
    expect(resolvePlacement(undefined, true)).toEqual({ ok: true, placement: "modal" });
    expect(resolvePlacement(null, true)).toEqual({ ok: true, placement: "modal" });
  });

  it("defaults missing placement to modal", () => {
    expect(resolvePlacement(undefined, undefined)).toEqual({ ok: true, placement: "modal" });
  });
});

describe("resolvePanelId", () => {
  it("prefers a non-empty requested id", () => {
    expect(resolvePanelId("view-1", "my-panel")).toBe("my-panel");
  });

  it("falls back to ext-<viewId>", () => {
    expect(resolvePanelId("view-1", undefined)).toBe("ext-view-1");
    expect(resolvePanelId("view-1", "")).toBe("ext-view-1");
  });
});

describe("slotKey", () => {
  it("namespaces by placement so panel and settings ids do not collide", () => {
    expect(slotKey("panel", "cfg")).toBe("panel:cfg");
    expect(slotKey("settings", "cfg")).toBe("settings:cfg");
    expect(slotKey("sidebar", "cfg")).toBe("sidebar:cfg");
    expect(slotKey("panel", "cfg")).not.toBe(slotKey("settings", "cfg"));
  });
});

describe("resolveHeaderSide", () => {
  it("accepts left/center/right", () => {
    expect(resolveHeaderSide("left")).toBe("left");
    expect(resolveHeaderSide("center")).toBe("center");
    expect(resolveHeaderSide("right")).toBe("right");
  });

  it("defaults illegal or missing values to left", () => {
    expect(resolveHeaderSide(undefined)).toBe("left");
    expect(resolveHeaderSide("top")).toBe("left");
    expect(resolveHeaderSide(1)).toBe("left");
  });
});

describe("buildOpenedPayload", () => {
  it("omits panelId for non-panel slots", () => {
    expect(buildOpenedPayload("modal")).toEqual({ placement: "modal" });
    expect(buildOpenedPayload("widget")).toEqual({ placement: "widget" });
  });

  it("includes panelId when provided", () => {
    expect(buildOpenedPayload("panel", "ext-x")).toEqual({
      placement: "panel",
      panelId: "ext-x",
    });
  });

  it("includes normalized headerSide only for header placement", () => {
    expect(buildOpenedPayload("header", undefined, "center")).toEqual({
      placement: "header",
      headerSide: "center",
    });
    expect(buildOpenedPayload("header", undefined, "bogus")).toEqual({
      placement: "header",
      headerSide: "left",
    });
    expect(buildOpenedPayload("header", undefined)).toEqual({
      placement: "header",
      headerSide: "left",
    });
    expect(buildOpenedPayload("modal", undefined, "right")).toEqual({ placement: "modal" });
  });
});

/** Structural view of a sanitized table — assertions stay readable without unions. */
type TableLike = {
  type: string;
  originalType?: string;
  id?: string;
  columns?: Array<{ key: string; label: string; width?: number; align?: string }>;
  rows?: Array<{ id: string; cells: Record<string, unknown> }>;
  emptyText?: string;
  maxRows?: number;
  children?: TableLike[];
  content?: string;
};

function sanitized(raw: unknown): TableLike {
  const result = sanitizeTree(raw);
  if ("error" in result) throw new Error(`unexpected sanitize error: ${result.error}`);
  return result.root as unknown as TableLike;
}

function tableParts(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "table",
    id: "t",
    columns: [{ key: "a", label: "A" }],
    rows: [],
    ...over,
  };
}

describe("sanitizeTree — table (docs/design/19 §3.2.1)", () => {
  it("keeps a well-formed table intact", () => {
    const root = sanitized(
      tableParts({
        id: "threads",
        columns: [
          { key: "name", label: "Thread", width: 2 },
          { key: "slot", label: "Slot", align: "center" },
        ],
        rows: [{ id: "t1", cells: { name: "Axial", slot: "A" } }],
        emptyText: "尚未创建 thread",
        maxRows: 20,
      }),
    );
    expect(root.type).toBe("table");
    expect(root.id).toBe("threads");
    expect(root.columns).toEqual([
      { key: "name", label: "Thread", width: 2 },
      { key: "slot", label: "Slot", align: "center" },
    ]);
    expect(root.rows).toEqual([{ id: "t1", cells: { name: "Axial", slot: "A" } }]);
    expect(root.emptyText).toBe("尚未创建 thread");
    expect(root.maxRows).toBe(20);
  });

  it("keeps an empty table as a table — the empty state is a rendered case, not an error", () => {
    const root = sanitized(tableParts({ rows: [], emptyText: "暂无" }));
    expect(root.type).toBe("table");
    expect(root.rows).toEqual([]);
  });

  it("degrades a table without an id to a placeholder without dropping siblings", () => {
    const root = sanitized({
      type: "column",
      children: [
        { type: "table", columns: [{ key: "a", label: "A" }] },
        { type: "text", content: "after" },
      ],
    });
    expect(root.children?.[0]).toEqual({ type: "unknown", originalType: "table" });
    expect(root.children?.[1]?.content).toBe("after");
  });

  it("degrades a table that cannot build a grid to a placeholder", () => {
    expect(sanitized(tableParts({ columns: [] })).type).toBe("unknown");
    expect(sanitized(tableParts({ columns: undefined })).type).toBe("unknown");
    // 无 key 的列无法索引 cells
    expect(sanitized(tableParts({ columns: [{ label: "A" }] })).type).toBe("unknown");
    // 重复列只剩一列，但仍有列 → 不是占位
    const deduped = sanitized(
      tableParts({
        columns: [
          { key: "a", label: "A" },
          { key: "a", label: "dup" },
        ],
      }),
    );
    expect(deduped.columns?.map((column) => column.key)).toEqual(["a"]);
  });

  it("drops cells for undeclared columns instead of rendering arbitrary data", () => {
    const root = sanitized(
      tableParts({
        columns: [
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ],
        rows: [{ id: "r", cells: { a: "1", b: "2", token: "secret" } }],
      }),
    );
    expect(root.rows?.[0].cells).toEqual({ a: "1", b: "2" });
  });

  it("normalizes non-primitive cell values to null", () => {
    const root = sanitized(
      tableParts({
        columns: [
          { key: "n", label: "N" },
          { key: "b", label: "B" },
          { key: "o", label: "O" },
          { key: "x", label: "X" },
        ],
        rows: [
          {
            id: "r",
            cells: { n: 3, b: true, o: { nested: 1 }, x: Number.NaN },
          },
        ],
      }),
    );
    expect(root.rows?.[0].cells).toEqual({ n: 3, b: true, o: null, x: null });
  });

  it("skips rows without a string id (row identity is required for full-tree update)", () => {
    const root = sanitized(
      tableParts({
        rows: [{ cells: { a: "x" } }, { id: "ok", cells: { a: "y" } }, null],
      }),
    );
    expect(root.rows).toEqual([{ id: "ok", cells: { a: "y" } }]);
  });

  it("caps rows at the protocol ceiling", () => {
    const root = sanitized(
      tableParts({
        rows: Array.from({ length: 500 }, (_, index) => ({ id: `r${index}`, cells: { a: index } })),
      }),
    );
    expect(root.rows).toHaveLength(VIEW_LIMITS.maxTableRows);
  });

  it("counts a row as one node, not one per cell", () => {
    // 预算口径（docs/design/19 §3.2.1）：200 行 × 8 列 ≈ 201 节点，仍在 512 内
    const result = sanitizeTree(
      tableParts({
        columns: Array.from({ length: 8 }, (_, index) => ({
          key: `c${index}`,
          label: `C${index}`,
        })),
        rows: Array.from({ length: VIEW_LIMITS.maxTableRows }, (_, index) => ({
          id: `r${index}`,
          cells: Object.fromEntries(
            Array.from({ length: 8 }, (_, column) => [`c${column}`, column]),
          ),
        })),
      }),
    );
    expect("root" in result).toBe(true);
  });

  it("counts rows against maxNodes so a wide table cannot bypass the budget", () => {
    const result = sanitizeTree({
      type: "column",
      children: [
        ...Array.from({ length: 450 }, (_, index) => ({ type: "text", content: `t${index}` })),
        tableParts({
          rows: Array.from({ length: 100 }, (_, index) => ({
            id: `r${index}`,
            cells: { a: index },
          })),
        }),
      ],
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain(String(VIEW_LIMITS.maxNodes));
  });

  it("clamps maxRows into the legal range and ignores non-numeric values", () => {
    expect(sanitized(tableParts({ maxRows: 9999 })).maxRows).toBe(VIEW_LIMITS.maxTableRows);
    expect(sanitized(tableParts({ maxRows: -5 })).maxRows).toBe(0);
    expect(sanitized(tableParts({ maxRows: 20.7 })).maxRows).toBe(20);
    expect(sanitized(tableParts({ maxRows: "20" })).maxRows).toBeUndefined();
    expect(sanitized(tableParts({ maxRows: Number.NaN })).maxRows).toBeUndefined();
  });

  it("normalizes column layout inputs", () => {
    const root = sanitized(
      tableParts({
        columns: [
          { key: "a", label: "A", width: 0 },
          { key: "b", label: "B", width: -3, align: "justify" },
          { key: "c" },
        ],
      }),
    );
    expect(root.columns).toEqual([
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "c" },
    ]);
  });

  it("caps the column count", () => {
    const root = sanitized(
      tableParts({
        columns: Array.from({ length: 40 }, (_, index) => ({
          key: `c${index}`,
          label: `C${index}`,
        })),
      }),
    );
    expect(root.columns).toHaveLength(VIEW_LIMITS.maxTableColumns);
  });
});

describe("applyPatch (docs/design/19 §10.3)", () => {
  const tree = () => ({
    type: "column" as const,
    children: [
      { type: "text" as const, content: "a" },
      {
        type: "card" as const,
        title: "queue",
        children: [{ type: "text" as const, content: "old" }],
      },
      { type: "text" as const, content: "tail" },
    ],
  });

  it("path [] replaces the whole root", () => {
    const result = applyPatch(tree(), [{ path: [], node: { type: "text", content: "fresh" } }]);
    expect(result).toEqual({ root: { type: "text", content: "fresh" } });
  });

  it("replaces a child subtree without touching siblings", () => {
    const result = applyPatch(tree(), [
      { path: [1, 0], node: { type: "text", content: "new-row" } },
    ]);
    expect("root" in result).toBe(true);
    if (!("root" in result)) return;
    const root = result.root;
    expect(root.type).toBe("column");
    if (root.type !== "column") return;
    expect(root.children[0]).toEqual({ type: "text", content: "a" });
    const card = root.children[1];
    expect(card.type).toBe("card");
    if (card.type !== "card") return;
    expect(card.children[0]).toEqual({ type: "text", content: "new-row" });
  });

  it("appends when the final index equals children.length", () => {
    const result = applyPatch(tree(), [{ path: [3], node: { type: "text", content: "extra" } }]);
    expect("root" in result).toBe(true);
    if (!("root" in result)) return;
    if (result.root.type !== "column") return;
    expect(result.root.children).toHaveLength(4);
  });

  it("rejects out-of-range paths and leaves the source tree untouched", () => {
    const source = tree();
    const result = applyPatch(source, [{ path: [9], node: { type: "text", content: "x" } }]);
    expect(result).toHaveProperty("error");
    expect(source.children).toHaveLength(3);
  });

  it("rejects paths that walk through non-containers", () => {
    const result = applyPatch(tree(), [{ path: [0, 0], node: { type: "text", content: "x" } }]);
    expect(result).toHaveProperty("error");
  });

  it("does not partially apply when a later op fails", () => {
    const source = tree();
    const result = applyPatch(source, [
      { path: [0], node: { type: "text", content: "ok-first" } },
      { path: [99], node: { type: "text", content: "boom" } },
    ]);
    expect(result).toHaveProperty("error");
    // source unchanged (ops run on a clone; failure discards the clone)
    expect(source.children[0]).toEqual({ type: "text", content: "a" });
  });

  it("replaces into tabs[i].children", () => {
    const root = {
      type: "tabs" as const,
      id: "t",
      tabs: [
        { id: "one", label: "One", children: [{ type: "text" as const, content: "x" }] },
        { id: "two", label: "Two", children: [{ type: "text" as const, content: "y" }] },
      ],
    };
    const result = applyPatch(root, [{ path: [1, 0], node: { type: "text", content: "patched" } }]);
    expect("root" in result).toBe(true);
    if (!("root" in result)) return;
    if (result.root.type !== "tabs") return;
    expect(result.root.tabs[1]?.children[0]).toEqual({ type: "text", content: "patched" });
    expect(result.root.tabs[0]?.children[0]).toEqual({ type: "text", content: "x" });
  });
});
