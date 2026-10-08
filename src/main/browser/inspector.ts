import type { WebContents } from "electron";
import type {
  InspectorBoxModel,
  InspectorDomNode,
  InspectorDomTree,
  InspectorInvalidationReason,
  InspectorStyleData,
  InspectorStyleProperty,
  InspectorStyleRule,
} from "../../shared/ipc";
import { sendCommand } from "./cdp";
import {
  type CdpBoxModel,
  type CdpComputedStyleProperty,
  type CdpMatchedStyles,
  type CdpNode,
  type CdpRule,
  type CdpStyle,
  type CdpStyleSheetHeader,
  collectAncestors,
  resetDocumentCache,
  resolveChildNodeIds,
  resolvePathNodeIds,
} from "./inspectorCdp";
import { hasStylePatches, resetStylePatches } from "./inspectorEdit";

/**
 * 元素检查器（docs/design/06 §4.2）——**语义层**：把 CDP 协议形状翻译成渲染层好用的
 * **只读 DTO**，并持有「当前节点」与「样式来源映射」的生命周期。
 *
 * 分层：`cdp.ts`（发命令）→ `inspectorCdp.ts`（协议形状与 nodeId/路径解析，含那个
 * 「页面侧索引路径 + 逐级下钻」的祖先链方案）→ 本文件（会话、失效广播、三件套查询与裁剪）。
 * 与 browserPick 的分工：pick 管拾取会话、高亮 overlay 与元素采集；
 * inspector 只管「拿到 nodeId 之后」的查询与失效。
 * 这里也是「裁剪协议」的落点（§4.3）——`getMatchedStylesForNode` 的原始返回体可达数十 KB
 * 到上百 KB，必须在主进程裁成 DTO 再过 IPC，否则每次选中都要结构化克隆一整棵规则树。
 */

// ---------------------------------------------------------------------------
// 裁剪参数
// ---------------------------------------------------------------------------

/**
 * computed 白名单（§4.3「复用并扩展现有 STYLE_KEYS」）。
 *
 * ⚠️ 实测：`CSS.getComputedStyleForNode` 只返回**长属性**（本次实测 421 条，不含
 * `padding` / `margin` / `border-radius` / `overflow` / `gap` 这类简写）。
 * 因此白名单里一律写长属性，简写由下面的 SHORTHANDS 合成回来 —— 这样既省 IPC 体积，
 * 展示形态又和 DevTools 的 computed 面板一致。
 */
const COMPUTED_KEYS = [
  // 布局
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "float",
  "clear",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "justify-content",
  "align-items",
  "align-self",
  "order",
  "row-gap",
  "column-gap",
  "grid-template-columns",
  "grid-template-rows",
  // 盒模型 / 溢出
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "box-sizing",
  "overflow-x",
  "overflow-y",
  "aspect-ratio",
  // 排版
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "text-overflow",
  "white-space",
  "word-break",
  "vertical-align",
  // 视觉 / 边框
  "color",
  "background-color",
  "background-image",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "opacity",
  "visibility",
  "transform",
  "filter",
  "backdrop-filter",
  "object-fit",
  "cursor",
  "pointer-events",
] as const;

/** 需要从长属性合成回来的简写：`from[0]` 必须出现在 COMPUTED_KEYS 里（决定展示位置）。 */
const SHORTHANDS: Array<{ name: string; from: string[] }> = [
  { name: "margin", from: ["margin-top", "margin-right", "margin-bottom", "margin-left"] },
  { name: "padding", from: ["padding-top", "padding-right", "padding-bottom", "padding-left"] },
  {
    name: "border-width",
    from: ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
  },
  {
    name: "border-radius",
    from: [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ],
  },
  { name: "overflow", from: ["overflow-x", "overflow-y"] },
  { name: "gap", from: ["row-gap", "column-gap"] },
];

/** 单条规则的声明条数上限，防止个别巨型规则撑爆 IPC。 */
const MAX_PROPERTIES_PER_RULE = 60;
/** matched 规则总条数上限（含继承组）。 */
const MAX_MATCHED_RULES = 48;

// ---------------------------------------------------------------------------
// 模块状态
// ---------------------------------------------------------------------------

interface InspectorCallbacks {
  /** 数据失效（导航 / debugger 被抢占）→ 渲染层清空检查器并提示重新拾取。 */
  onInvalidated: (reason: InspectorInvalidationReason) => void;
}

let callbacks: InspectorCallbacks | null = null;
let sessionActive = false;
/** 当前检查器事件绑定的 WebContents；多页面实例切换时需要换绑。 */
let boundWc: WebContents | null = null;

/**
 * styleSheetId → 样式表头。
 * `CSS.getMatchedStylesForNode` 只给 styleSheetId，来源文件名与起始行必须靠
 * `CSS.styleSheetAdded` 事件累积（导航后必须清空，新文档会重新下发一遍）。
 */
const styleSheets = new Map<string, { sourceURL: string; startLine: number }>();

export function setInspectorCallbacks(next: InspectorCallbacks): void {
  callbacks = next;
}

export function isInspectorSessionActive(): boolean {
  return sessionActive;
}

function onDebuggerMessage(_event: Electron.Event, method: string, params: unknown): void {
  if (method === "CSS.styleSheetAdded") {
    const header = (params as { header?: CdpStyleSheetHeader }).header;
    if (header?.styleSheetId) {
      styleSheets.set(header.styleSheetId, {
        sourceURL: header.sourceURL ?? "",
        startLine: header.startLine ?? 0,
      });
    }
  } else if (method === "CSS.styleSheetRemoved") {
    const id = (params as { styleSheetId?: string }).styleSheetId;
    if (id) styleSheets.delete(id);
  } else if (method === "DOM.documentUpdated") {
    // 文档被整体替换：DOM 映射被重置 + 样式表全部作废，重新累积
    styleSheets.clear();
    resetDocumentCache();
  }
}

function onDebuggerDetach(): void {
  boundWc = null;
  invalidateInspector("detached");
}

function unbindInspector(wc: WebContents | null): void {
  if (!wc) return;
  try {
    wc.debugger.removeListener("message", onDebuggerMessage);
    wc.debugger.removeListener("detach", onDebuggerDetach);
  } catch {
    // webContents 已销毁时忽略；debugger detach 由 browserPick 统一处理
  }
}

/**
 * 监听检查器关心的 CDP 事件。与 browserPick 各自持有一份 `debugger.on("message")`
 * 监听（互不干扰），职责边界比集中式分发更清楚。
 * 多页面：绑定跟到当前活跃实例的 WebContents。
 */
export function bindInspector(wc: WebContents): void {
  if (boundWc === wc) return;
  unbindInspector(boundWc);
  boundWc = wc;
  wc.debugger.on("message", onDebuggerMessage);
  wc.debugger.on("detach", onDebuggerDetach);
}

// ---------------------------------------------------------------------------
// 会话开合
// ---------------------------------------------------------------------------

/** 开启检查器会话：CSS 域随拾取会话开关，DOM 域由 browserPick 管理。 */
export async function startInspectorSession(wc: WebContents): Promise<void> {
  sessionActive = true;
  styleSheets.clear();
  // 仍有热更改时不要重置文档缓存：getDocument 会作废已有 nodeId，调整规则也依赖当前文档
  if (!hasStylePatches()) {
    resetDocumentCache();
  }
  await sendCommand(wc, "DOM.enable");
  await sendCommand(wc, "CSS.enable");
}

/** 关闭检查器会话（退出拾取）。任一步失败都要走完，避免残留域继续推事件。 */
export async function stopInspectorSession(wc: WebContents): Promise<void> {
  if (!sessionActive) return;
  sessionActive = false;
  styleSheets.clear();
  // 22：退出拾取但仍有热更改时保住 CSS 域、调整表与文档映射，避免预览瞬间消失；
  // 导航 / 切实例仍走 invalidateInspector → resetStylePatches。
  if (hasStylePatches()) return;
  resetDocumentCache();
  await sendCommand(wc, "CSS.disable").catch((err) => {
    console.warn("[inspector] CSS.disable 失败", err);
  });
}

/**
 * 清空检查器状态并广播失效。
 * 触发点（§5.1）：`did-navigate`（含热重载整页刷新）与 `debugger` detach；
 * 页面内 SPA 路由（`did-navigate-in-page`）**不清空**（DOM 未重建）。
 */
export function invalidateInspector(reason: InspectorInvalidationReason): void {
  styleSheets.clear();
  resetDocumentCache();
  // 热更改随文档销毁（22 §六）：调整意图与样式表缓存一并丢弃
  resetStylePatches();
  callbacks?.onInvalidated(reason);
}

// ---------------------------------------------------------------------------
// 只读查询
// ---------------------------------------------------------------------------

/** `button.btn-primary`（与托盘条目里的 label 同格式）。 */
function labelOf(nodeName: string, classes: string[]): string {
  const tag = nodeName.toLowerCase();
  return classes.length > 0 ? `${tag}.${classes.join(".")}` : tag;
}

function readAttributes(attributes: string[] | undefined): {
  id: string | null;
  classes: string[];
} {
  const result: { id: string | null; classes: string[] } = { id: null, classes: [] };
  if (!attributes) return result;
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    if (attributes[i] === "id") result.id = attributes[i + 1] || null;
    else if (attributes[i] === "class") {
      result.classes = attributes[i + 1].split(/\s+/).filter(Boolean);
    }
  }
  return result;
}

/**
 * CDP 节点 → DTO。
 * `resolvedNodeId` 用于传入「额外解析出来的前端 id」：`describeNode` 返回的嵌套子节点
 * 通常不带 nodeId（0），需要单独推送后回填。
 */
function toDomNode(
  node: CdpNode,
  withChildren: boolean,
  resolvedNodeId?: number | null,
): InspectorDomNode {
  const { id, classes } = readAttributes(node.attributes);
  const elementChildren = (node.children ?? []).filter((child) => child.nodeType === 1);
  const rawNodeId = typeof node.nodeId === "number" && node.nodeId > 0 ? node.nodeId : null;
  const result: InspectorDomNode = {
    nodeId: resolvedNodeId ?? rawNodeId,
    nodeType: node.nodeType,
    nodeName: node.nodeName,
    id,
    classes,
    childCount: withChildren ? elementChildren.length : (node.childNodeCount ?? 0),
  };
  if (withChildren) result.children = elementChildren.map((child) => toDomNode(child, false));
  return result;
}

/**
 * 样式表来源（末段文件名）与起始行。
 * ⚠️ 内联 `style` 属性也会带一个合成的 styleSheetId，但它不在 `CSS.styleSheetAdded` 里，
 * 因此取不到来源 —— 此时 source 与 baseLine 一律为 null，UI 不显示「文件:行号」。
 */
function sourceOf(style: CdpStyle | undefined): {
  source: string | null;
  baseLine: number | null;
} {
  const id = style?.styleSheetId;
  if (!id) return { source: null, baseLine: null };
  const header = styleSheets.get(id);
  if (!header?.sourceURL) return { source: null, baseLine: null };
  return { source: header.sourceURL.split("/").at(-1) ?? null, baseLine: header.startLine };
}

function toProperties(style: CdpStyle | undefined): InspectorStyleProperty[] {
  const raw = style?.cssProperties;
  if (!raw || raw.length === 0) return [];
  const { source, baseLine } = sourceOf(style);
  // 带 styleSheetId 的作者规则里，只有「真正写在规则里」的声明带 range；
  // 简写展开出的合成长属性没有 range，是纯噪声，先按 range 过滤。
  const declaredOnly = Boolean(style?.styleSheetId);
  const build = (rangedOnly: boolean): InspectorStyleProperty[] => {
    const properties: InspectorStyleProperty[] = [];
    for (const property of raw) {
      if (!property.name || !property.value) continue;
      if (rangedOnly && declaredOnly && !property.range) continue;
      properties.push({
        name: property.name,
        value: property.value,
        important: property.important === true,
        source,
        // SourceRange 与样式表头 startLine 都是 0 基，展示用 1 基
        line:
          source !== null && baseLine !== null && property.range
            ? baseLine + property.range.startLine + 1
            : null,
      });
      if (properties.length >= MAX_PROPERTIES_PER_RULE) break;
    }
    return properties;
  };
  const ranged = build(true);
  // 兜底：该规则整体没有 range 信息时（UA 样式表即如此），退回不过滤
  return ranged.length > 0 ? ranged : build(false);
}

function mapOrigin(origin: string | undefined): InspectorStyleRule["origin"] {
  if (origin === "user-agent") return "user-agent";
  if (origin === "injected" || origin === "inspector") return "inspected";
  return "user";
}

function toRule(rule: CdpRule, inheritedFrom: string | null): InspectorStyleRule | null {
  const properties = toProperties(rule.style);
  if (properties.length === 0) return null;
  return {
    selector: rule.selectorList?.text?.trim() || "(未知选择器)",
    origin: mapOrigin(rule.origin),
    inheritedFrom,
    properties,
  };
}

/** 四边/双边值收敛成 CSS 简写形态（与 DevTools 的 computed 展示一致）。 */
function collapseShorthand(values: string[]): string {
  if (values.length === 2) {
    return values[0] === values[1] ? values[0] : `${values[0]} ${values[1]}`;
  }
  const [top, right, bottom, left] = values;
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

function pickComputed(raw: CdpComputedStyleProperty[]): Array<{ name: string; value: string }> {
  const byName = new Map<string, string>();
  for (const item of raw) byName.set(item.name, item.value);
  const consumed = new Set<string>();
  const picked: Array<{ name: string; value: string }> = [];
  for (const key of COMPUTED_KEYS) {
    if (consumed.has(key)) continue;
    const shorthand = SHORTHANDS.find((entry) => entry.from[0] === key);
    if (shorthand) {
      const values = shorthand.from.map((name) => byName.get(name));
      if (values.every((value) => value !== undefined && value !== "")) {
        for (const name of shorthand.from) consumed.add(name);
        picked.push({ name: shorthand.name, value: collapseShorthand(values as string[]) });
        continue;
      }
    }
    const value = byName.get(key);
    if (value !== undefined && value !== "") picked.push({ name: key, value });
  }
  return picked;
}

export async function getStyles(wc: WebContents, nodeId: number): Promise<InspectorStyleData> {
  const [computed, matched, described, ancestors] = await Promise.all([
    sendCommand<{ computedStyle: CdpComputedStyleProperty[] }>(wc, "CSS.getComputedStyleForNode", {
      nodeId,
    }),
    sendCommand<CdpMatchedStyles>(wc, "CSS.getMatchedStylesForNode", { nodeId }),
    sendCommand<{ node: CdpNode }>(wc, "DOM.describeNode", { nodeId, depth: 0 }),
    collectAncestors(wc, nodeId),
  ]);

  const { classes } = readAttributes(described.node.attributes);
  const rules: InspectorStyleRule[] = [];

  const inline = toRule(
    { style: matched.inlineStyle, origin: "inspector", selectorList: { text: "element.style" } },
    null,
  );
  if (inline) rules.push(inline);

  for (const match of matched.matchedCSSRules ?? []) {
    const rule = toRule(match.rule, null);
    if (rule) rules.push(rule);
    if (rules.length >= MAX_MATCHED_RULES) break;
  }

  // inherited[0] 是最近的祖先；祖先链是 root → 最近，因此从尾部往上取
  const inherited = matched.inherited ?? [];
  for (let i = 0; i < inherited.length && rules.length < MAX_MATCHED_RULES; i += 1) {
    const probe = ancestors.at(-1 - i);
    const inheritedFrom = probe ? labelOf(probe.nodeName, probe.classes) : null;
    const entry = inherited[i];
    const entryInline = toRule(
      { style: entry.inlineStyle, origin: "inspector", selectorList: { text: "element.style" } },
      inheritedFrom,
    );
    if (entryInline) rules.push(entryInline);
    for (const match of entry.matchedCSSRules ?? []) {
      const rule = toRule(match.rule, inheritedFrom);
      if (rule) rules.push(rule);
      if (rules.length >= MAX_MATCHED_RULES) break;
    }
  }

  return {
    nodeId,
    label: labelOf(described.node.nodeName, classes),
    computed: pickComputed(computed.computedStyle ?? []),
    matched: rules,
  };
}

/** quad → 四边中点，用于算各区的厚度。 */
function sideEdges(quad: number[]): { top: number; right: number; bottom: number; left: number } {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = quad;
  return {
    top: (y1 + y2) / 2,
    right: (x2 + x3) / 2,
    bottom: (y3 + y4) / 2,
    left: (x1 + x4) / 2,
  };
}

/** 外框减内框得到一圈厚度（顺序 top / right / bottom / left），负值按 0 处理。 */
function band(outer: number[], inner: number[]): [number, number, number, number] {
  const o = sideEdges(outer);
  const i = sideEdges(inner);
  const round = (value: number): number => Math.max(0, Math.round(value));
  return [
    round(i.top - o.top),
    round(o.right - i.right),
    round(o.bottom - i.bottom),
    round(i.left - o.left),
  ];
}

export async function getBoxModel(wc: WebContents, nodeId: number): Promise<InspectorBoxModel> {
  // 注意：盒模型在 CDP 里属于 DOM 域（CSS 域没有 getBoxModel）
  const res = await sendCommand<{ model: CdpBoxModel }>(wc, "DOM.getBoxModel", { nodeId });
  const model = res.model;
  return {
    nodeId,
    // 四区坐标（quad）只用于算数值，不进渲染层
    margin: band(model.margin, model.border),
    border: band(model.border, model.padding),
    padding: band(model.padding, model.content),
    content: { width: Math.round(model.width), height: Math.round(model.height) },
  };
}

export async function getDomTree(wc: WebContents, nodeId: number): Promise<InspectorDomTree> {
  const [described, probes] = await Promise.all([
    sendCommand<{ node: CdpNode }>(wc, "DOM.describeNode", { nodeId, depth: 1 }),
    collectAncestors(wc, nodeId),
  ]);
  const elementChildren = (described.node.children ?? []).filter((child) => child.nodeType === 1);
  const [childIds, ancestorIds] = await Promise.all([
    resolveChildNodeIds(wc, elementChildren),
    resolvePathNodeIds(wc, probes),
  ]);
  const ancestors: InspectorDomNode[] = probes.map((probe) => ({
    nodeId: probe.path ? (ancestorIds.get(probe.path.join(",")) ?? null) : null,
    nodeType: 1,
    nodeName: probe.nodeName,
    id: probe.id,
    classes: probe.classes,
    childCount: probe.childCount,
  }));
  const self = toDomNode(described.node, true);
  self.children = elementChildren.map((child, index) => toDomNode(child, false, childIds[index]));
  return { nodeId, ancestors, self };
}
