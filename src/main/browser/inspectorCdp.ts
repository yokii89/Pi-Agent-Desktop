import type { WebContents } from "electron";
import { sendCommand } from "./cdp";

/**
 * **CDP 协议层**（docs/design/06 §4.3）：`DOM` / `CSS` 域的原始形状声明，
 * 以及「nodeId / backendNodeId / 索引路径」这三套 id 语义的解析。
 *
 * 这一层存在的意义是把「实测出来的协议脾气」全部收在一处：
 * 任何 nodeId 操作前必须 `DOM.getDocument`（且它会重置前端映射）、
 * `describeNode` 的 children 跳过文本节点但保留 doctype、
 * `parentId` 与 `pushNodeByPathToFrontend` 都不可用 —— 详见各函数上的注释。
 * 检查器的业务语义（会话、失效、DTO 裁剪）在 `inspector.ts`。
 */

/** 祖先链最大层数；与 browserPick 里 `uniqueSelector` 的深度上限对齐（§4.3）。 */
const MAX_ANCESTOR_DEPTH = 8;

// ---------------------------------------------------------------------------
// CDP 返回体的最小形状（只声明我们真正读取的字段）
// ---------------------------------------------------------------------------

export interface CdpNode {
  nodeId?: number;
  backendNodeId?: number;
  nodeType: number;
  nodeName: string;
  attributes?: string[];
  childNodeCount?: number;
  children?: CdpNode[];
}

export interface CdpSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** `CSS.StyleProperty`（CSSStyle.cssProperties 的元素）。 */
export interface CdpStyleProperty {
  name: string;
  value: string;
  important?: boolean;
  range?: CdpSourceRange;
}

export interface CdpStyle {
  styleSheetId?: string;
  cssProperties?: CdpStyleProperty[];
}

export interface CdpRule {
  selectorList?: { text?: string };
  origin?: string;
  style?: CdpStyle;
}

export interface CdpRuleMatch {
  rule: CdpRule;
  matchingSelectors?: number[];
}

export interface CdpInheritedEntry {
  inlineStyle?: CdpStyle;
  matchedCSSRules?: CdpRuleMatch[];
}

export interface CdpMatchedStyles {
  inlineStyle?: CdpStyle;
  attributesStyle?: CdpStyle;
  matchedCSSRules?: CdpRuleMatch[];
  inherited?: CdpInheritedEntry[];
}

export interface CdpStyleSheetHeader {
  styleSheetId: string;
  sourceURL?: string;
  startLine?: number;
}

export interface CdpComputedStyleProperty {
  name: string;
  value: string;
}

/**
 * 盒模型四区。注意 CDP 的 `Quad` 就是 8 个数字的数组（左上、右上、右下、左下，顺时针），
 * 不是 `{ quad: [...] }` 对象 —— 这里只读数值，坐标不进渲染层。
 */
export interface CdpBoxModel {
  content: number[];
  padding: number[];
  border: number[];
  margin: number[];
  width: number;
  height: number;
}

/** 页面侧祖先链采集结果（见 ANCESTOR_FN）。 */
export interface AncestorProbe {
  nodeName: string;
  id: string | null;
  classes: string[];
  childCount: number;
  /** 从文档根开始的子节点索引路径；阴影 DOM / 跨文档时为 null。 */
  path: number[] | null;
}

/**
 * 已「请求」过的文档根 nodeId。
 * CDP 的 DOM 域要求先 `DOM.getDocument` 再使用任何 nodeId/backendNodeId 操作
 * （否则报 "Document needs to be requested first"）。该调用会**重置前端的 DOM 映射**，
 * 所以只在文档刚换过、我们手上没有有效 nodeId 时才触发（见 ensureDocumentRequested）。
 */
let documentRootNodeId: number | null = null;

/** 文档被替换 / 会话重开时清掉缓存（与 inspector 的失效广播同步调用）。 */
export function resetDocumentCache(): void {
  documentRootNodeId = null;
}

// ---------------------------------------------------------------------------
// 节点 id 解析
// ---------------------------------------------------------------------------

/**
 * 确保当前文档已被 DOM 域「请求」，并返回文档根节点（`#document`）的 nodeId。
 * CDP 要求先 `DOM.getDocument` 才能使用任何 nodeId/backendNodeId 操作，
 * 否则报 "Document needs to be requested first"。该调用会重置前端的 DOM 映射，
 * 因此只在文档刚换过、我们手上没有有效 nodeId 时执行一次。
 */
export async function ensureDocumentRequested(wc: WebContents): Promise<number> {
  if (documentRootNodeId !== null) return documentRootNodeId;
  const res = await sendCommand<{ root?: CdpNode }>(wc, "DOM.getDocument", { depth: 0 });
  const rootNodeId = res.root?.nodeId;
  if (typeof rootNodeId !== "number" || rootNodeId <= 0) throw new Error("文档根节点不可用");
  documentRootNodeId = rootNodeId;
  return rootNodeId;
}

/** `backendNodeId` 批量 → `nodeId`；无法解析的位置为 null。 */
export async function pushBackendNodeIds(
  wc: WebContents,
  backendNodeIds: number[],
): Promise<Array<number | null>> {
  const result: Array<number | null> = backendNodeIds.map(() => null);
  if (backendNodeIds.length === 0) return result;
  await ensureDocumentRequested(wc);
  const res = await sendCommand<{ nodeIds: number[] }>(wc, "DOM.pushNodesByBackendIdsToFrontend", {
    backendNodeIds,
  });
  (res.nodeIds ?? []).forEach((nodeId, index) => {
    if (typeof nodeId === "number" && nodeId > 0) result[index] = nodeId;
  });
  return result;
}

/**
 * `backendNodeId` → `nodeId`：`Overlay.inspectNodeRequested` 给的是前者，
 * 而 `CSS.*` 一律要后者（§4.3）。拿不到返回 null（检查器对该元素不可用，不影响托盘）。
 */
export async function resolveNodeId(
  wc: WebContents,
  backendNodeId: number,
): Promise<number | null> {
  try {
    const [nodeId] = await pushBackendNodeIds(wc, [backendNodeId]);
    return nodeId ?? null;
  } catch (err) {
    console.warn("[inspector] backendNodeId 转 nodeId 失败", err);
    return null;
  }
}

async function resolveObjectId(wc: WebContents, nodeId: number): Promise<string> {
  const res = await sendCommand<{ object?: { objectId?: string } }>(wc, "DOM.resolveNode", {
    nodeId,
  });
  const objectId = res.object?.objectId;
  if (!objectId) throw new Error("目标节点已脱离文档");
  return objectId;
}

/**
 * 在页面内采集祖先链（§4.3 风险点的落地回退方案）。
 *
 * ⚠️ 索引语义实测（Electron 33 / Chromium 130）：
 * `DOM.describeNode` 返回的 `children` **跳过文本节点、但保留 doctype**。
 * 例如 `body.childNodes` 是 `#text/DIV/#text/BUTTON/#text/SCRIPT/#text`，
 * 而 describeNode 只给 `DIV/BUTTON/SCRIPT`；`#document` 的 children 则是 `doctype, html`。
 * 所以路径下标必须按「前置兄弟中跳过文本节点」计数，用 `childNodes` 或
 * `firstElementChild` 都会错位一层（前者把文本算进去，后者把 doctype 漏掉）。
 *
 * 这是纯数据采集，不向页面注入任何 DOM 或全局对象（05 §7.3 边界）。
 */
const ANCESTOR_FN = `function () {
  var el = this;
  var empty = { ancestors: [] };
  if (!el || el.nodeType !== 1) return empty;
  // documentElement.contains 不穿透阴影边界，且天然排除跨文档节点
  if (!document.documentElement.contains(el)) return empty;
  function cdpIndex(node) {
    var parent = node.parentNode;
    var index = 0;
    for (var n = parent.firstChild; n && n !== node; n = n.nextSibling) {
      if (n.nodeType === 3) continue;
      index += 1;
    }
    return index;
  }
  function pathFromRoot(node) {
    var path = [];
    var current = node;
    while (current && current.nodeType === 1) {
      var parent = current.parentNode;
      if (!parent) return null;
      // 阴影根 / 文档片段无法用从文档根开始的路径表达
      if (parent.nodeType !== 1 && parent.nodeType !== 9) return null;
      path.unshift(cdpIndex(current));
      if (parent.nodeType === 9) break;
      current = parent;
    }
    return path;
  }
  var ancestors = [];
  var current = el.parentElement;
  var depth = 0;
  while (current && depth < ${MAX_ANCESTOR_DEPTH}) {
    var cls = typeof current.className === "string" ? current.className.trim() : "";
    ancestors.push({
      nodeName: current.nodeName,
      id: current.id || null,
      classes: cls ? cls.split(/\\s+/) : [],
      childCount: current.childElementCount,
      path: pathFromRoot(current)
    });
    current = current.parentElement;
    depth += 1;
  }
  ancestors.reverse();
  return { ancestors: ancestors };
}`;

export async function collectAncestors(wc: WebContents, nodeId: number): Promise<AncestorProbe[]> {
  try {
    await ensureDocumentRequested(wc);
    const objectId = await resolveObjectId(wc, nodeId);
    const res = await sendCommand<{ result?: { value?: unknown } }>(wc, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: ANCESTOR_FN,
      returnByValue: true,
    });
    const value = res.result?.value as { ancestors?: AncestorProbe[] } | undefined;
    return value?.ancestors ?? [];
  } catch (err) {
    console.warn("[inspector] 祖先链采集失败", err);
    return [];
  }
}

/**
 * 祖先链 nodeId 解析（§4.3 风险点 R3 的落地结论）。
 *
 * 实测（Electron 33 / Chromium 130）：
 * 1. `DOM.describeNode` 的 `parentId` 只在父节点已被推到前端时才有值，而我们只推目标节点；
 * 2. `DOM.pushNodeByPathToFrontend` 在该内核下**返回的是文档根**（path "0" 与 "1" 都给
 *    `#document`），不可用；
 * 3. `DOM.getDocument({ depth: -1 })` 能把整棵树推一遍从而让 parentId 可用，但会重置前端
 *    映射（刚拿到的 nodeId 全失效）且大页面响应体可达数 MB。
 *
 * 因此采用：页面侧算「CDP 语义下的索引路径」（ANCESTOR_FN），
 * 再**从文档根沿路径逐级下钻**——每级一次 `describeNode(depth: 1)` 拿到子节点的
 * backendNodeId，就地换成 nodeId。祖先共享路径前缀，所以总代价是 O(层数)，
 * 既没有整树序列化，也不重置已有 nodeId。
 *
 * 每级都用返回的 nodeName 与页面侧采集的 nodeName 做一次校验：
 * 索引语义万一变化，宁可让该祖先「不可点击」也不要指向错误的节点。
 */
export async function resolvePathNodeIds(
  wc: WebContents,
  probes: AncestorProbe[],
): Promise<Map<string, number | null>> {
  const resolved = new Map<string, number | null>();
  const known = new Map<string, string>();
  for (const probe of probes) {
    if (probe.path) known.set(probe.path.join(","), probe.nodeName);
  }
  const paths = [...known.keys()].map((key) => key.split(",").map(Number));
  if (paths.length === 0) return resolved;
  // 祖先共享前缀：只下钻最长的那条，沿途顺手记下所有需要的节点
  const longest = paths.reduce((a, b) => (b.length > a.length ? b : a));
  try {
    let current = await ensureDocumentRequested(wc);
    const prefix: number[] = [];
    for (const index of longest) {
      const described = await sendCommand<{ node: CdpNode }>(wc, "DOM.describeNode", {
        nodeId: current,
        depth: 1,
      });
      const child = (described.node.children ?? [])[index];
      if (!child || typeof child.backendNodeId !== "number") break;
      prefix.push(index);
      const key = prefix.join(",");
      const expected = known.get(key);
      if (expected !== undefined && expected !== child.nodeName) {
        // 索引错位：不记录、也不再继续下钻（越往下越不可信）
        resolved.set(key, null);
        break;
      }
      const [childNodeId] = await pushBackendNodeIds(wc, [child.backendNodeId]);
      resolved.set(key, childNodeId ?? null);
      if (childNodeId == null) break;
      current = childNodeId;
    }
  } catch (err) {
    console.warn("[inspector] 祖先链 nodeId 解析失败", err);
  }
  return resolved;
}

/** 子节点补全 nodeId：`describeNode` 返回的嵌套子节点通常没有前端 id（nodeId 为 0）。 */
export async function resolveChildNodeIds(
  wc: WebContents,
  nodes: CdpNode[],
): Promise<Array<number | null>> {
  const resolved: Array<number | null> = nodes.map((node) =>
    typeof node.nodeId === "number" && node.nodeId > 0 ? node.nodeId : null,
  );
  const pending: Array<{ index: number; backendNodeId: number }> = [];
  nodes.forEach((node, index) => {
    if (resolved[index] !== null) return;
    if (typeof node.backendNodeId === "number" && node.backendNodeId > 0) {
      pending.push({ index, backendNodeId: node.backendNodeId });
    }
  });
  if (pending.length === 0) return resolved;
  try {
    const nodeIds = await pushBackendNodeIds(
      wc,
      pending.map((item) => item.backendNodeId),
    );
    nodeIds.forEach((nodeId, i) => {
      const target = pending[i];
      if (target && nodeId !== null) resolved[target.index] = nodeId;
    });
  } catch (err) {
    console.warn("[inspector] 子节点 nodeId 解析失败", err);
  }
  return resolved;
}
