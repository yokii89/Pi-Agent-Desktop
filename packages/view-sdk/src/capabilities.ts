/**
 * Capability-gated construction helpers (docs/design/20 O3).
 *
 * The Host advertises four capabilities but only two had SDK-side consumers, so
 * every extension re-implemented the probe (`pi-telegram-main` named it
 * `supportsCapability`, `desktop-view.ts` declared its own
 * `VIEW_TABLE_CAPABILITY` constant) and, worse, every extension wrote its own
 * second rendering path for the degraded case. `tableView` owns that fork once:
 * authors ask for a table and get either a `table` node or the equivalent
 * `column`/`row` tree, per 准则 §7.1's "two rendering paths belong in the SDK".
 */

import type { DesktopViewClient } from "./client.js";
import type {
  ViewHostCapability,
  ViewLimits,
  ViewNode,
  ViewTableColumn,
  ViewTableRow,
} from "./types.js";
import { VIEW_LIMITS } from "./types.js";

/**
 * Effective protocol budget: the Host's live numbers when `hello.limits` is
 * present, else the compile-time defaults this SDK was built against.
 */
export function viewLimits(client: DesktopViewClient | null | undefined): ViewLimits {
  return client?.hello?.limits ?? VIEW_LIMITS;
}

/** Capability probe that tolerates a null client (TUI fallback path). */
export function supportsCapability(
  client: DesktopViewClient | null | undefined,
  capability: ViewHostCapability,
): boolean {
  if (!client) return false;
  return client.hello?.capabilities?.includes(capability) === true;
}

/** `table` nodes render as an `unknown` placeholder on hosts without `view-table`. */
export function supportsTable(client: DesktopViewClient | null | undefined): boolean {
  return supportsCapability(client, "view-table");
}

/** `patch` soft-fails to `false` on hosts without `view-patch`. */
export function supportsPatch(client: DesktopViewClient | null | undefined): boolean {
  return supportsCapability(client, "view-patch");
}

/**
 * `ViewListOption.preview` renders beside a `list` on hosts with
 * `view-option-preview` (docs/design/79). Older hosts drop the field in
 * `sanitizeOptions`, so extensions that need the preview must keep their
 * sibling-`markdown` fallback until this returns true.
 */
export function supportsOptionPreview(client: DesktopViewClient | null | undefined): boolean {
  return supportsCapability(client, "view-option-preview");
}

/**
 * `list.readonly` renders a non-selectable list on hosts with
 * `view-readonly-list` (docs/06 R1). Older hosts drop the field, which turns
 * the rows back into clickable options that write `values` and draw an active
 * bar without any consumer — probe this before sending the field.
 */
export function supportsReadonlyList(client: DesktopViewClient | null | undefined): boolean {
  return supportsCapability(client, "view-readonly-list");
}

/**
 * The Host renders panel contributions as launcher features + closable tabs
 * (docs/design/66).
 *
 * When false (legacy Host), every Catalog `panel` entry occupies a resident tab
 * even before the user opens it. When true, Catalog entries are only listed on
 * the right sidebar's launcher/add menu; opening one is a user action, and
 * closing its tab hides the panel without sending `dismiss`.
 *
 * A user-closed panel stays suppressed: later `open()` / reconnect attempts do
 * not steal the tab back; the user reopens it from the launcher or add menu.
 *
 * Extensions that need a panel visible without a user click should call
 * `openPanel` after their session is ready. That call is harmless on both
 * generations of Hosts (it replaces the resident slot on legacy Hosts), but it
 * does not override a tab the user closed on a `panel-launcher` Host.
 */
export function supportsPanelLauncher(client: DesktopViewClient | null | undefined): boolean {
  return supportsCapability(client, "panel-launcher");
}

export interface TableViewOptions {
  id: string;
  columns: ViewTableColumn[];
  rows: ViewTableRow[];
  emptyText?: string;
  /** Max rendered rows before the Host truncates and shows the overflow count. */
  maxRows?: number;
  /**
   * Column that leads each degraded row. The leading cell is rendered as `body`
   * and comes first; the remaining columns follow in their declared order as
   * `caption`. It no longer filters the other cells out (docs/06 R3).
   */
  labelKey?: string;
  /**
   * Legacy narrow list: one line per row, only the lead column. Use this when a
   * rail is too narrow for key/value pairs instead of relying on the old
   * `labelKey`-filters-everything accident.
   */
  compact?: boolean;
}

function cellText(row: ViewTableRow, key: string): string {
  const value = row.cells[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function cellOrder(columns: ViewTableColumn[], labelKey: string | undefined): number[] {
  const all = columns.map((_, index) => index);
  if (labelKey === undefined) return all;
  const lead = columns.findIndex((column) => column.key === labelKey);
  return lead > 0 ? [lead, ...all.filter((index) => index !== lead)] : all;
}

/**
 * Equivalent `column`-of-`row`s tree for hosts without `view-table`.
 * Exported because extensions sometimes need the fallback unconditionally (e.g.
 * a narrow sidebar where a table would be unreadable anyway).
 *
 * Every data row keeps **all** cells (docs/06 R3): the header promises N
 * columns, so a degraded row that carries one cell silently drops data. The
 * lead cell is `body`, the rest `caption`; `compact` opts back into the old
 * single-cell line for genuinely narrow rails.
 */
export function tableViewFallback(options: TableViewOptions): ViewNode {
  const columns = options.columns;
  const order = cellOrder(columns, options.labelKey);
  const lead = order.length > 0 ? columns[order[0]] : undefined;
  // compact 是一行一单元格的窄列表：表头也只列领读列，别让表头承诺不存在的列
  const headerColumns = options.compact ? (lead ? [lead] : []) : columns;
  const header: ViewNode = {
    type: "row",
    children: headerColumns.map((column) => ({
      type: "text",
      content: column.label,
      variant: "caption" as const,
    })),
  };
  const lines: ViewNode[] = [header];
  const limit = options.maxRows ?? Number.POSITIVE_INFINITY;
  for (const row of options.rows.slice(0, limit)) {
    const keys = options.compact ? order.slice(0, 1) : order;
    lines.push({
      type: "row",
      children: keys.map((columnIndex, position) => {
        const column = columns[columnIndex];
        return {
          type: "text" as const,
          content: column ? cellText(row, column.key) : "",
          variant: position === 0 ? ("body" as const) : ("caption" as const),
        };
      }),
    });
  }
  if (options.rows.length === 0) {
    lines.push({
      type: "text",
      content: options.emptyText ?? "",
      variant: "caption",
    });
  }
  return { type: "column", children: lines };
}

/**
 * A table when the Host supports it, an equivalent text tree when it does not.
 *
 * ```ts
 * const root = column([
 *   text("Telegram bridge"),
 *   tableView(desktop, { id: "queue", columns, rows }),
 * ]);
 * ```
 */
export function tableView(
  client: DesktopViewClient | null | undefined,
  options: TableViewOptions,
): ViewNode {
  if (!supportsTable(client)) return tableViewFallback(options);
  return {
    type: "table",
    id: options.id,
    columns: options.columns,
    rows: options.rows,
    emptyText: options.emptyText,
    maxRows: options.maxRows,
  };
}
