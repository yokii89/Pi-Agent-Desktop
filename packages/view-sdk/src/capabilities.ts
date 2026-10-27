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
  /** Row label to lead each degraded line with; defaults to the first cell. */
  labelKey?: string;
}

function cellText(row: ViewTableRow, key: string): string {
  const value = row.cells[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Equivalent `column`-of-`row`s tree for hosts without `view-table`.
 * Exported because extensions sometimes need the fallback unconditionally (e.g.
 * a narrow sidebar where a table would be unreadable anyway).
 */
export function tableViewFallback(options: TableViewOptions): ViewNode {
  const columns = options.columns;
  const header: ViewNode = {
    type: "row",
    children: columns.map((column) => ({
      type: "text",
      content: column.label,
      variant: "caption" as const,
    })),
  };
  const lines: ViewNode[] = [header];
  const limit = options.maxRows ?? Number.POSITIVE_INFINITY;
  for (const row of options.rows.slice(0, limit)) {
    const key = options.labelKey ?? columns[0]?.key;
    const cells = key === undefined ? [] : [cellText(row, key)];
    lines.push({
      type: "row",
      children: cells.map((content) => ({ type: "text", content })),
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
