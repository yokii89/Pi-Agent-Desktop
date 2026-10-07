/**
 * Pure protocol helpers for the View Host (docs/design/08 §5.1 / §5.3):
 * placement decisions, open-ack shape, and the untrusted-tree sanitizer.
 * Extracted so Host protocol decisions can be unit-tested without Electron.
 */
import type {
  HeaderSide,
  ViewAction,
  ViewNode,
  ViewOpenedPayload,
  ViewOption,
  ViewPatchOp,
  ViewPlacement,
  ViewTab,
  ViewTableColumn,
  ViewTableRow,
} from "../../shared/view";
import { IMPLEMENTED_VIEW_PLACEMENTS, VIEW_LIMITS } from "../../shared/view";

/**
 * 已知槽位表。写成 `Record<ViewPlacement, true>` 而不是 `||` 比较链：给
 * `ViewPlacement` 加成员却漏更新这里会直接编译失败——旧的手写链没有这层保护，
 * 新槽位会被静默折成 `modal`。
 */
const KNOWN_VIEW_PLACEMENTS: Record<ViewPlacement, true> = {
  modal: true,
  stream: true,
  widget: true,
  panel: true,
  sidebar: true,
  header: true,
  settings: true,
  "access-mode": true,
};

function isKnownPlacement(raw: unknown): raw is ViewPlacement {
  return typeof raw === "string" && Object.hasOwn(KNOWN_VIEW_PLACEMENTS, raw);
}

export function normalizePlacement(raw: unknown): ViewPlacement {
  return isKnownPlacement(raw) ? raw : "modal";
}

/**
 * placement 判定（docs/design/08 §5.3.3）。
 *
 * `placementRequired: true` 的契约是「给不了我要求的槽位就别打开」，两种情况都会拒绝：
 * 1. 显式写了不在 `ViewPlacement` 枚举里的值（含拼错的槽位名）；
 * 2. 槽位在枚举里但 Host 尚未实现完整 UI（当前八槽位全部已实现，故为将来预留）。
 *
 * 两种情况在 required 非 true 时都降级 `modal`。**缺省不写 `placement` 不算未知值**：
 * §5.3.4 规定缺省即 `modal`，那是合法请求而不是扩展写错，required 不该把它判死。
 */
export function resolvePlacement(
  requested: unknown,
  required: unknown,
): { ok: true; placement: ViewPlacement } | { ok: false; message: string } {
  const isRequired = required === true;
  if (!isKnownPlacement(requested)) {
    if (isRequired && requested !== undefined && requested !== null) {
      return {
        ok: false,
        message: `placement ${JSON.stringify(requested)} 不是已知槽位且 placementRequired=true`,
      };
    }
    return { ok: true, placement: "modal" };
  }
  if (IMPLEMENTED_VIEW_PLACEMENTS.has(requested)) {
    return { ok: true, placement: requested };
  }
  if (isRequired) {
    return { ok: false, message: `placement "${requested}" 尚未实现且 placementRequired=true` };
  }
  return { ok: true, placement: "modal" };
}

/** panel 槽稳定 id：优先请求值，缺省 `ext-<viewId>`。 */
export function resolvePanelId(viewId: string, requested: string | undefined): string {
  return requested && requested.length > 0 ? requested : `ext-${viewId}`;
}

/** header 侧别；非法/缺省按 left（与协议一致）。 */
export function resolveHeaderSide(raw: unknown): HeaderSide {
  if (raw === "center" || raw === "right" || raw === "left") return raw;
  return "left";
}

/**
 * 槽位表 key：panel/sidebar/settings 各自命名空间，
 * panel「cfg」与 settings「cfg」互不顶替（docs/design/08 §5.3.2）。
 */
export function slotKey(placement: ViewPlacement, panelId: string): string {
  return `${placement}:${panelId}`;
}

/** open ack payload（Host → Client）。header 槽附带最终侧别。 */
export function buildOpenedPayload(
  placement: ViewPlacement,
  panelId?: string,
  headerSide?: unknown,
): ViewOpenedPayload {
  const payload: ViewOpenedPayload = { placement };
  if (panelId !== undefined) payload.panelId = panelId;
  if (placement === "header") payload.headerSide = resolveHeaderSide(headerSide);
  return payload;
}

/**
 * UTF-8 字节上限内截断；按 0.9 递减以避开代理对中间。
 * 导出给宿主其它 sanitize 分支复用。
 */
export function truncateString(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= VIEW_LIMITS.maxStringBytes) return value;
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > VIEW_LIMITS.maxStringBytes) {
    end = Math.floor(end * 0.9);
  }
  return value.slice(0, end);
}

export function sanitizeOptions(raw: unknown): ViewOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewOption[] = [];
  for (const item of raw.slice(0, VIEW_LIMITS.maxOptionItems)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { value?: unknown; label?: unknown; description?: unknown };
    if (typeof record.value !== "string") continue;
    out.push({
      value: truncateString(record.value),
      label: truncateString(typeof record.label === "string" ? record.label : record.value),
      description:
        typeof record.description === "string" ? truncateString(record.description) : undefined,
    });
  }
  return out;
}

export function sanitizeActions(raw: unknown): ViewAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      id?: unknown;
      label?: unknown;
      variant?: unknown;
      kind?: unknown;
      disabled?: unknown;
    };
    if (typeof record.id !== "string" || typeof record.label !== "string") continue;
    const variant =
      record.variant === "primary" || record.variant === "danger" || record.variant === "ghost"
        ? record.variant
        : undefined;
    out.push({
      id: truncateString(record.id),
      label: truncateString(record.label),
      variant,
      kind: record.kind === "event" ? "event" : "submit",
      disabled: record.disabled === true,
    });
  }
  return out;
}

/** 列 key 必须唯一，否则 `cells` 索引歧义。 */
function sanitizeTableColumns(raw: unknown): ViewTableColumn[] {
  if (!Array.isArray(raw)) return [];
  const out: ViewTableColumn[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, VIEW_LIMITS.maxTableColumns)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { key?: unknown; label?: unknown; width?: unknown; align?: unknown };
    if (typeof record.key !== "string" || record.key.length === 0) continue;
    if (seen.has(record.key)) continue;
    seen.add(record.key);
    const width =
      typeof record.width === "number" && Number.isFinite(record.width) && record.width > 0
        ? record.width
        : undefined;
    const align =
      record.align === "left" || record.align === "center" || record.align === "right"
        ? record.align
        : undefined;
    out.push({
      key: truncateString(record.key),
      label: truncateString(typeof record.label === "string" ? record.label : record.key),
      width,
      align,
    });
  }
  return out;
}

/** 只保留协议声明的原始值；未声明列的 key 丢弃，避免用单元格塞任意数据。 */
function sanitizeTableCells(
  raw: unknown,
  keys: Set<string>,
): Record<string, string | number | boolean | null> {
  const cells: Record<string, string | number | boolean | null> = {};
  if (!raw || typeof raw !== "object") return cells;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.has(key)) continue;
    const value = record[key];
    if (value === null) cells[key] = null;
    else if (typeof value === "string") cells[key] = truncateString(value);
    else if (typeof value === "boolean") cells[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) cells[key] = value;
    else cells[key] = null;
  }
  return cells;
}

/** 已记过日志的未知节点 type，避免同一 type 在 update 循环里刷屏。 */
const loggedUnknownTypes = new Set<string>();

/**
 * Client 送来的任意树 → 协议合法树（docs/design/08 §5.1）。
 * 非法控件降级为 `unknown` 占位（不截断兄弟节点）；仅深度/节点数超限才整树报错。
 */
export function sanitizeTree(raw: unknown): { root: ViewNode } | { error: string } {
  let nodeCount = 0;
  let overflow: "depth" | "nodes" | null = null;

  const walk = (value: unknown, depth: number): ViewNode | null => {
    if (depth > VIEW_LIMITS.maxDepth) {
      overflow = "depth";
      return null;
    }
    if (!value || typeof value !== "object") {
      return { type: "text", content: "", variant: "caption" };
    }
    nodeCount += 1;
    if (nodeCount > VIEW_LIMITS.maxNodes) {
      overflow = "nodes";
      return null;
    }

    const record = value as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";

    const walkChildren = (rawChildren: unknown): ViewNode[] => {
      if (!Array.isArray(rawChildren)) return [];
      const children: ViewNode[] = [];
      for (const child of rawChildren) {
        const next = walk(child, depth + 1);
        if (next === null) return children;
        children.push(next);
      }
      return children;
    };

    switch (type) {
      case "text": {
        const variant =
          record.variant === "caption" || record.variant === "heading" ? record.variant : "body";
        return {
          type: "text",
          content: truncateString(typeof record.content === "string" ? record.content : ""),
          variant,
        };
      }
      case "markdown":
        return {
          type: "markdown",
          content: truncateString(typeof record.content === "string" ? record.content : ""),
        };
      case "divider":
        return { type: "divider" };
      case "column":
      case "row": {
        const gap =
          typeof record.gap === "number" && Number.isFinite(record.gap) ? record.gap : undefined;
        return type === "column"
          ? { type: "column", children: walkChildren(record.children), gap }
          : { type: "row", children: walkChildren(record.children), gap };
      }
      case "card":
        return {
          type: "card",
          title: typeof record.title === "string" ? truncateString(record.title) : undefined,
          children: walkChildren(record.children),
        };
      case "button": {
        // 缺 id/label：降级为诊断占位，不得截断兄弟节点或伪装成深度超限
        if (typeof record.id !== "string" || typeof record.label !== "string") {
          return { type: "unknown", originalType: "button" };
        }
        const variant =
          record.variant === "primary" || record.variant === "danger" || record.variant === "ghost"
            ? record.variant
            : undefined;
        return {
          type: "button",
          id: truncateString(record.id),
          label: truncateString(record.label),
          variant,
          disabled: record.disabled === true,
        };
      }
      case "input": {
        if (typeof record.id !== "string") {
          return { type: "unknown", originalType: "input" };
        }
        return {
          type: "input",
          id: truncateString(record.id),
          label: typeof record.label === "string" ? truncateString(record.label) : undefined,
          placeholder:
            typeof record.placeholder === "string" ? truncateString(record.placeholder) : undefined,
          value: typeof record.value === "string" ? truncateString(record.value) : undefined,
          multiline: record.multiline === true,
        };
      }
      case "select": {
        if (typeof record.id !== "string") {
          return { type: "unknown", originalType: "select" };
        }
        return {
          type: "select",
          id: truncateString(record.id),
          label: typeof record.label === "string" ? truncateString(record.label) : undefined,
          options: sanitizeOptions(record.options),
          value: typeof record.value === "string" ? truncateString(record.value) : undefined,
        };
      }
      case "checkbox": {
        if (typeof record.id !== "string" || typeof record.label !== "string") {
          return { type: "unknown", originalType: "checkbox" };
        }
        return {
          type: "checkbox",
          id: truncateString(record.id),
          label: truncateString(record.label),
          checked: record.checked === true,
        };
      }
      case "list": {
        if (typeof record.id !== "string") {
          return { type: "unknown", originalType: "list" };
        }
        const rawValue = record.value;
        let value: string | string[] | undefined;
        if (typeof rawValue === "string") value = truncateString(rawValue);
        else if (Array.isArray(rawValue)) {
          value = rawValue
            .filter((v): v is string => typeof v === "string")
            .slice(0, VIEW_LIMITS.maxOptionItems)
            .map(truncateString);
        }
        return {
          type: "list",
          id: truncateString(record.id),
          items: sanitizeOptions(record.items),
          value,
          multiple: record.multiple === true,
        };
      }
      case "progress": {
        const rawValue = record.value;
        const value =
          typeof rawValue === "number" && Number.isFinite(rawValue)
            ? Math.min(1, Math.max(0, rawValue))
            : undefined;
        return {
          type: "progress",
          value,
          label: typeof record.label === "string" ? truncateString(record.label) : undefined,
        };
      }
      case "tabs": {
        if (typeof record.id !== "string") {
          return { type: "unknown", originalType: "tabs" };
        }
        const rawTabs = Array.isArray(record.tabs) ? record.tabs : [];
        const tabs: ViewTab[] = [];
        for (const item of rawTabs.slice(0, VIEW_LIMITS.maxOptionItems)) {
          if (!item || typeof item !== "object") continue;
          // 每个页签计入节点预算，防止空页签绕过 maxNodes
          nodeCount += 1;
          if (nodeCount > VIEW_LIMITS.maxNodes) {
            overflow = "nodes";
            break;
          }
          const tab = item as Record<string, unknown>;
          if (typeof tab.id !== "string" || typeof tab.label !== "string") continue;
          const status =
            tab.status === "answered" || tab.status === "attention" ? tab.status : undefined;
          tabs.push({
            id: truncateString(tab.id),
            label: truncateString(tab.label),
            status,
            children: walkChildren(tab.children),
          });
        }
        return {
          type: "tabs",
          id: truncateString(record.id),
          tabs,
          activeTab:
            typeof record.activeTab === "string" ? truncateString(record.activeTab) : undefined,
        };
      }
      case "table": {
        if (typeof record.id !== "string") {
          return { type: "unknown", originalType: "table" };
        }
        const columns = sanitizeTableColumns(record.columns);
        // 零有效列的表建立不起网格，占位比渲染空壳诚实
        if (columns.length === 0) {
          return { type: "unknown", originalType: "table" };
        }
        const keys = new Set(columns.map((column) => column.key));
        const rawRows = Array.isArray(record.rows) ? record.rows : [];
        const rows: ViewTableRow[] = [];
        for (const item of rawRows.slice(0, VIEW_LIMITS.maxTableRows)) {
          if (!item || typeof item !== "object") continue;
          const row = item as Record<string, unknown>;
          if (typeof row.id !== "string") continue;
          // 每行计 1 个节点（单元格不单独计，docs/design/19 §3.2.1 预算口径）
          nodeCount += 1;
          if (nodeCount > VIEW_LIMITS.maxNodes) {
            overflow = "nodes";
            break;
          }
          rows.push({
            id: truncateString(row.id),
            cells: sanitizeTableCells(row.cells, keys),
          });
        }
        const rawMaxRows = record.maxRows;
        const maxRows =
          typeof rawMaxRows === "number" && Number.isFinite(rawMaxRows)
            ? Math.min(Math.max(0, Math.floor(rawMaxRows)), VIEW_LIMITS.maxTableRows)
            : undefined;
        return {
          type: "table",
          id: truncateString(record.id),
          columns,
          rows,
          emptyText:
            typeof record.emptyText === "string" ? truncateString(record.emptyText) : undefined,
          maxRows,
        };
      }
      default: {
        // 未知 type：占位 + 记日志（docs/design/08 §5.1），不断连
        const originalType = truncateString(type || "?");
        if (!loggedUnknownTypes.has(originalType)) {
          loggedUnknownTypes.add(originalType);
          console.warn(`[ViewHost] 未知 ViewNode type "${originalType}"，已降级为诊断占位`);
        }
        return { type: "unknown", originalType };
      }
    }
  };

  const root = walk(raw, 1);
  // walk 仅在深度/节点数超限时返回 null；非法控件已降级为 unknown
  if (root === null || overflow) {
    if (overflow === "nodes" || nodeCount > VIEW_LIMITS.maxNodes) {
      return { error: `视图节点数超过上限 ${VIEW_LIMITS.maxNodes}` };
    }
    return { error: `视图树深度超过上限 ${VIEW_LIMITS.maxDepth}` };
  }
  return { root };
}

// ---------------------------------------------------------------------------
// patch（docs/design/19 §10.3）
// ---------------------------------------------------------------------------

/** column / row / card 才能作为 path 中间层继续下标。 */
function patchChildrenOf(node: ViewNode): ViewNode[] | null {
  if (node.type === "column" || node.type === "row" || node.type === "card") {
    return node.children;
  }
  return null;
}

/**
 * 在 `root` 的深拷贝上按 `path` 替换子树，全部成功才返回新树。
 *
 * path 语义：
 * - `[]` — 替换整棵 root；
 * - 每段下标进入 `column`/`row`/`card` 的 `children`；
 * - 遇到 `tabs` 时，**下一段**是 tab 下标，再下一段起进入该 tab 的 `children`。
 *
 * 任一 op 失败 → `{ error }`（调用方保持原树；不部分应用）。
 */
export function applyPatch(
  root: ViewNode,
  ops: ViewPatchOp[],
): { root: ViewNode } | { error: string } {
  let next: ViewNode;
  try {
    next = structuredClone(root);
  } catch {
    return { error: "patch 源树无法复制" };
  }

  for (const [index, op] of ops.entries()) {
    if (!op || typeof op !== "object" || !Array.isArray(op.path)) {
      return { error: `patch.ops[${index}] 无效` };
    }
    if (op.path.some((seg) => !Number.isInteger(seg) || seg < 0)) {
      return { error: `patch.ops[${index}].path 非法` };
    }
    if (!op.node || typeof op.node !== "object" || typeof (op.node as ViewNode).type !== "string") {
      return { error: `patch.ops[${index}].node 无效` };
    }
    const replacement = op.node as ViewNode;

    if (op.path.length === 0) {
      next = replacement;
      continue;
    }

    const result = replaceAtPath(next, op.path, replacement, index);
    if ("error" in result) return result;
    next = result.root;
  }

  return { root: next };
}

function replaceAtPath(
  root: ViewNode,
  path: number[],
  replacement: ViewNode,
  opIndex: number,
): { root: ViewNode } | { error: string } {
  // 定位「存放 replacement 的数组 + 下标」
  let holder: ViewNode[] | null = null;
  let slot = -1;
  let cursor: ViewNode = root;
  let i = 0;

  while (i < path.length) {
    if (cursor.type === "tabs") {
      const tab = cursor.tabs[path[i]];
      if (!tab) return { error: `patch.ops[${opIndex}].path 越界` };
      i += 1;
      if (i >= path.length) {
        return { error: `patch.ops[${opIndex}].path 不能停在 tabs 层` };
      }
      // 剩余 path 落在 tab.children（内部可再遇 container / tabs）
      return replaceInChildren(tab.children, path.slice(i), replacement, opIndex, 0, root);
    }

    const children = patchChildrenOf(cursor);
    if (!children) {
      return { error: `patch.ops[${opIndex}].path 经过非容器节点` };
    }
    if (i === path.length - 1) {
      holder = children;
      slot = path[i];
      break;
    }
    const child = children[path[i]];
    if (!child) return { error: `patch.ops[${opIndex}].path 越界` };
    cursor = child;
    i += 1;
  }

  if (!holder || slot < 0) {
    return { error: `patch.ops[${opIndex}].path 无法定位` };
  }
  if (slot === holder.length) {
    holder.push(replacement);
  } else if (slot < holder.length) {
    holder[slot] = replacement;
  } else {
    return { error: `patch.ops[${opIndex}].path 越界` };
  }
  return { root };
}

/**
 * 在给定 children 数组上按剩余 path 就地替换。
 * `root` 仅用于成功时原样返回（mutations 已发生在同一棵树上）。
 */
function replaceInChildren(
  children: ViewNode[],
  path: number[],
  replacement: ViewNode,
  opIndex: number,
  depth: number,
  root: ViewNode,
): { root: ViewNode } | { error: string } {
  if (path.length === 0) {
    return { error: `patch.ops[${opIndex}].path 无法定位` };
  }
  if (depth === path.length - 1) {
    const seg = path[depth];
    if (seg === children.length) {
      children.push(replacement);
      return { root };
    }
    if (seg < 0 || seg > children.length) {
      return { error: `patch.ops[${opIndex}].path 越界` };
    }
    children[seg] = replacement;
    return { root };
  }

  const seg = path[depth];
  const child = children[seg];
  if (!child) return { error: `patch.ops[${opIndex}].path 越界` };

  if (child.type === "tabs") {
    const tab = child.tabs[path[depth + 1]];
    if (!tab) return { error: `patch.ops[${opIndex}].path 越界` };
    if (depth + 2 >= path.length) {
      return { error: `patch.ops[${opIndex}].path 不能停在 tabs 层` };
    }
    return replaceInChildren(tab.children, path, replacement, opIndex, depth + 2, root);
  }

  const nextChildren = patchChildrenOf(child);
  if (!nextChildren) return { error: `patch.ops[${opIndex}].path 经过非容器节点` };
  return replaceInChildren(nextChildren, path, replacement, opIndex, depth + 1, root);
}
