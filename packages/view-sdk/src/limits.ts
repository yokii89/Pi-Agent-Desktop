/**
 * Outbound budget pre-flight (docs/design/20 O3).
 *
 * Why this exists in the SDK: the Host enforces `VIEW_LIMITS` by either
 * rejecting the frame (`error` + `closed(limit)`) or silently truncating it,
 * and until now an extension could only learn which by reading README prose and
 * hand-copying the counting rules — `pi-telegram-main` did exactly that and got
 * the `tabs` branch wrong (rows/tabs budget accounting, docs/design/19 §3.2.1).
 *
 * `measureViewTree` therefore mirrors Host `sanitizeTree`'s *accounting*, not a
 * approximation of it: same per-node increments, same tab and row truncation.
 * A lockstep regression (`src/main/view/viewBudgetLockstep.test.ts`) fails if
 * the two ever disagree, so the copy here cannot silently drift.
 */

import type { ViewLimits, ViewNode } from "./types.js";

/** What the Host would see for a tree: post-truncation node count and max depth. */
export interface ViewTreeBudget {
  /** Node count under the Host's budget rules (truncated rows/tabs included). */
  nodes: number;
  /** Deepest nesting reached (the Host rejects at `maxDepth`). */
  depth: number;
  /** Nodes dropped by `maxTableRows` before the Host ever counts them. */
  truncatedRows: number;
  /** Nodes dropped by `maxOptionItems` (select options / list items / tabs). */
  truncatedOptionItems: number;
  /** Whether any container child was dropped because the node budget was hit. */
  hitNodeBudget: boolean;
}

/** Limits to measure against: `hello.limits` when the Host sent it, else compile-time defaults. */
export type ViewBudgetLimits = Pick<
  ViewLimits,
  "maxDepth" | "maxNodes" | "maxOptionItems" | "maxTableRows" | "maxTableColumns"
>;

const CONTAINER_TYPES = new Set(["column", "row", "card"]);

function asRecord(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" ? (node as Record<string, unknown>) : null;
}

/**
 * Count a tree the way `sanitizeTree` does.
 *
 * Deliberately total and non-throwing: it runs on trees the caller is about to
 * send, including malformed ones, and must never be the reason an `open()` fails.
 */
export function measureViewTree(root: ViewNode, limits: ViewBudgetLimits): ViewTreeBudget {
  const budget: ViewTreeBudget = {
    nodes: 0,
    depth: 0,
    truncatedRows: 0,
    truncatedOptionItems: 0,
    hitNodeBudget: false,
  };

  const walk = (value: unknown, depth: number): void => {
    budget.depth = Math.max(budget.depth, depth);
    if (depth > limits.maxDepth) return;
    // The Host substitutes an empty text leaf for a non-object *without*
    // charging it against the node budget — mirroring that exactly is the whole
    // point of this function, so the counter must not move here either.
    const record = asRecord(value);
    if (!record) return;
    budget.nodes += 1;
    if (budget.nodes > limits.maxNodes) {
      budget.hitNodeBudget = true;
      return;
    }

    const type = typeof record.type === "string" ? record.type : "";

    const walkChildren = (children: unknown): void => {
      if (!Array.isArray(children)) return;
      for (const child of children) {
        if (budget.hitNodeBudget) return;
        walk(child, depth + 1);
      }
    };

    if (CONTAINER_TYPES.has(type)) {
      walkChildren(record.children);
      return;
    }

    if (type === "tabs") {
      const tabs = Array.isArray(record.tabs) ? record.tabs : [];
      if (tabs.length > limits.maxOptionItems) {
        budget.truncatedOptionItems += tabs.length - limits.maxOptionItems;
      }
      for (const item of tabs.slice(0, limits.maxOptionItems)) {
        // The Host counts each tab itself against the node budget.
        budget.nodes += 1;
        if (budget.nodes > limits.maxNodes) {
          budget.hitNodeBudget = true;
          return;
        }
        const tab = asRecord(item);
        walkChildren(tab?.children);
      }
      return;
    }

    if (type === "table") {
      const rows = Array.isArray(record.rows) ? record.rows : [];
      if (rows.length > limits.maxTableRows) {
        budget.truncatedRows += rows.length - limits.maxTableRows;
      }
      const keptRows = Math.min(rows.length, limits.maxTableRows);
      for (let i = 0; i < keptRows; i += 1) {
        // One row costs one node (cells are not counted, docs/design/19 §3.2.1).
        budget.nodes += 1;
        if (budget.nodes > limits.maxNodes) {
          budget.hitNodeBudget = true;
          return;
        }
      }
      return;
    }

    if (type === "select" || type === "list") {
      const items = record.options ?? record.items;
      if (Array.isArray(items) && items.length > limits.maxOptionItems) {
        budget.truncatedOptionItems += items.length - limits.maxOptionItems;
      }
    }
  };

  walk(root, 1);
  return budget;
}

/** Why a frame is over budget. `rejected` = the Host would refuse or drop it. */
export type ViewBudgetViolation =
  | { kind: "rejected"; limit: "maxDepth" | "maxNodes" | "maxMessageBytes"; measured: number }
  | { kind: "truncated"; limit: "maxTableRows" | "maxOptionItems"; dropped: number };

/**
 * Pre-flight a frame the client is about to write.
 *
 * Only `rejected`-kind violations are actionable — those are the limits where
 * the Host either answers `error(limit)` (and the panel silently stops
 * updating) or destroys the socket (taking every other view on the connection
 * with it). `truncated`-kind is advisory: the Host clips the tree and keeps
 * going, so callers get the numbers but the SDK never fails for them.
 */
export function frameBudgetViolations(input: {
  /** Exact serialized line, so the byte check costs one stringify, not two. */
  line: string;
  /** Root tree to count, when the frame carries one. */
  root?: ViewNode;
  limits: ViewBudgetLimits;
  maxMessageBytes: number;
}): ViewBudgetViolation[] {
  const bytes = Buffer.byteLength(input.line, "utf8");
  const violations: ViewBudgetViolation[] = [];
  if (bytes > input.maxMessageBytes) {
    violations.push({ kind: "rejected", limit: "maxMessageBytes", measured: bytes });
  }
  if (input.root) {
    const tree = measureViewTree(input.root, input.limits);
    if (tree.depth > input.limits.maxDepth) {
      violations.push({ kind: "rejected", limit: "maxDepth", measured: tree.depth });
    }
    if (tree.nodes > input.limits.maxNodes) {
      violations.push({ kind: "rejected", limit: "maxNodes", measured: tree.nodes });
    }
    if (tree.truncatedRows > 0) {
      violations.push({ kind: "truncated", limit: "maxTableRows", dropped: tree.truncatedRows });
    }
    if (tree.truncatedOptionItems > 0) {
      violations.push({
        kind: "truncated",
        limit: "maxOptionItems",
        dropped: tree.truncatedOptionItems,
      });
    }
  }
  return violations;
}

/** True when the Host would not accept the frame at all. */
export function hasRejectableViolation(violations: ViewBudgetViolation[]): boolean {
  return violations.some((v) => v.kind === "rejected");
}

/** Human-readable summary for the thrown error message. */
export function describeBudgetViolations(violations: ViewBudgetViolation[]): string {
  return violations
    .map((v) =>
      v.kind === "rejected"
        ? `${v.limit} exceeded (measured ${v.measured})`
        : `${v.limit} would drop ${v.dropped} item(s)`,
    )
    .join("; ");
}
