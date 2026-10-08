import type { WebContents } from "electron";
import type {
  StylePatchDeclaration,
  StylePatchExportResult,
  StylePatchResult,
} from "../../shared/ipc";
import { sendCommand } from "./cdp";
import { ensureDocumentRequested } from "./inspectorCdp";

/**
 * 样式热更改写路径（docs/design/22 §5.1）——把用户在「样式」tab 拧出来的调整
 * 写进 **PiDesk 调整样式表**（CDP `CSS.createStyleSheet` + 整表 `setStyleSheetText`），
 * 页面立刻热更，不落盘、不碰作者规则与 DOM。
 *
 * 分层：本文件只持有「selector → 声明」意图并整表重写；协议形状在 `inspectorCdp.ts`，
 * 只读三件套在 `inspector.ts`。导航 / 切实例 / 退出会话时调用 `resetStylePatches()`。
 */

interface FrameTreeResult {
  frameTree: { frame: { id: string } };
}

interface CreateStyleSheetResult {
  styleSheetId: string;
}

interface ResolveNodeResult {
  object: { objectId: string };
}

interface CallFunctionOnResult {
  result: { type: string; value?: unknown };
}

/** selector → 声明列表（按 UI 顺序，含未启用项）。 */
const patches = new Map<string, StylePatchDeclaration[]>();
let overrideSheetId: string | null = null;

/** 是否仍有热更改挂着（退出拾取时决定要不要保住 CSS 域）。 */
export function hasStylePatches(): boolean {
  return patches.size > 0;
}

/** 文档替换 / 切实例 / 显式清空：丢弃样式表缓存与全部调整意图。 */
export function resetStylePatches(): void {
  patches.clear();
  overrideSheetId = null;
}

function enabledDecls(decls: StylePatchDeclaration[]): StylePatchDeclaration[] {
  return decls.filter((decl) => decl.enabled && decl.name.trim() && decl.value.trim());
}

function formatDeclaration(decl: StylePatchDeclaration): string {
  return `${decl.name.trim()}: ${decl.value.trim()}${decl.important ? " !important" : ""};`;
}

function buildRuleText(selector: string, decls: StylePatchDeclaration[]): string | null {
  const body = enabledDecls(decls);
  if (body.length === 0) return null;
  const lines = body.map((decl) => `  ${formatDeclaration(decl)}`).join("\n");
  return `${selector} {\n${lines}\n}`;
}

function buildSheetText(): string {
  const rules: string[] = [];
  for (const [selector, decls] of patches) {
    const text = buildRuleText(selector, decls);
    if (text) rules.push(text);
  }
  return rules.join("\n\n");
}

/**
 * 纯函数：把调整列表格式化为可读 CSS（与 UI「复制 CSS」一致）。
 * 导出供单测；`exportOverrideCss` 是它的模块状态包装。
 */
export function formatStylePatchCss(
  entries: Array<{ selector: string; declarations: StylePatchDeclaration[] }>,
  host: string,
): string {
  const blocks: string[] = [];
  const site = host.trim() || "本地页面";
  for (const { selector, declarations } of entries) {
    const text = buildRuleText(selector, declarations);
    if (!text) continue;
    blocks.push(`/* PiDesk 临时调整 · ${site} · ${selector} */\n${text}`);
  }
  return blocks.join("\n\n");
}

async function ensureOverrideSheet(wc: WebContents): Promise<string> {
  if (overrideSheetId) return overrideSheetId;
  // CSS 域可能因退出拾取被收掉；写路径自己拉起，不绑死 pick 会话
  await sendCommand(wc, "CSS.enable").catch(() => {});
  await ensureDocumentRequested(wc);
  const tree = await sendCommand<FrameTreeResult>(wc, "Page.getFrameTree");
  const frameId = tree.frameTree?.frame?.id;
  if (!frameId) throw new Error("页面 frame 不可用");
  const created = await sendCommand<CreateStyleSheetResult>(wc, "CSS.createStyleSheet", {
    frameId,
  });
  if (!created.styleSheetId) throw new Error("无法创建调整样式表");
  overrideSheetId = created.styleSheetId;
  return overrideSheetId;
}

async function flushSheet(wc: WebContents): Promise<void> {
  const styleSheetId = await ensureOverrideSheet(wc);
  await sendCommand(wc, "CSS.setStyleSheetText", {
    styleSheetId,
    text: buildSheetText(),
  });
}

/** 页面侧重算唯一 selector（与 browserPick.COLLECT_FN 同策略，供入参为空时回退）。 */
const SELECTOR_FN = `function () {
  var el = this;
  if (!el || el.nodeType !== 1) return "";
  var parts = [];
  var current = el;
  var depth = 0;
  while (current && current.nodeType === 1 && depth < 8) {
    var tag = current.nodeName.toLowerCase();
    if (tag === "html") break;
    if (current.id) { parts.unshift("#" + CSS.escape(current.id)); break; }
    var selector = tag;
    var classValue = typeof current.className === "string" ? current.className.trim() : "";
    if (classValue) {
      var classSelector = tag + "." + classValue.split(/\\s+/).map(function (c) { return CSS.escape(c); }).join(".");
      try {
        if (document.querySelectorAll(classSelector).length === 1) {
          parts.unshift(classSelector);
          break;
        }
      } catch (e) { /* 非法类名时回退 */ }
      selector += "." + classValue.split(/\\s+/).map(function (c) { return CSS.escape(c); }).join(".");
    }
    var parent = current.parentElement;
    if (parent) {
      var siblings = Array.prototype.filter.call(parent.children, function (c) {
        return c.nodeName === current.nodeName;
      });
      if (siblings.length > 1) {
        selector += ":nth-of-type(" + (Array.prototype.indexOf.call(siblings, current) + 1) + ")";
      }
    }
    parts.unshift(selector);
    current = parent;
    depth += 1;
  }
  return parts.join(" > ");
}`;

async function resolveSelector(wc: WebContents, nodeId: number, fallback: string): Promise<string> {
  const provided = fallback.trim();
  if (provided) return provided;
  await ensureDocumentRequested(wc);
  const resolved = await sendCommand<ResolveNodeResult>(wc, "DOM.resolveNode", { nodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) throw new Error("目标节点已脱离文档");
  const evaluated = await sendCommand<CallFunctionOnResult>(wc, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: SELECTOR_FN,
    returnByValue: true,
  });
  const value = typeof evaluated.result?.value === "string" ? evaluated.result.value : "";
  if (!value) throw new Error("无法解析元素 selector");
  return value;
}

function assertSafeDeclaration(decl: StylePatchDeclaration): void {
  const name = decl.name.trim();
  const value = decl.value.trim();
  if (!name || !value) throw new Error("属性名与值不能为空");
  // 声明写进规则体时用 `name: value;`，任一段带花括号/分号都会截断规则
  if (/[{};]/.test(name) || /[{};]/.test(value)) {
    throw new Error("属性名或值含有非法字符");
  }
}

/**
 * 全量替换某 selector 的调整声明并整表刷新（热更）。
 * 传入的 declarations 是 UI 权威列表（含未启用项）；写入规则时只保留 enabled。
 */
export async function applyStylePatch(
  wc: WebContents,
  nodeId: number,
  selector: string,
  declarations: StylePatchDeclaration[],
): Promise<StylePatchResult> {
  for (const decl of declarations) assertSafeDeclaration(decl);
  const resolved = await resolveSelector(wc, nodeId, selector);
  const next = declarations.map((decl) => ({
    name: decl.name.trim(),
    value: decl.value.trim(),
    important: Boolean(decl.important),
    enabled: decl.enabled !== false,
  }));
  if (next.length === 0) {
    patches.delete(resolved);
  } else {
    patches.set(resolved, next);
  }
  await flushSheet(wc);
  return { selector: resolved, applied: enabledDecls(next) };
}

/** 删除某 selector 的整条调整；selector 为 null 时清空全部。 */
export async function clearStylePatch(wc: WebContents, selector: string | null): Promise<void> {
  if (selector === null) {
    patches.clear();
  } else {
    patches.delete(selector.trim());
  }
  if (patches.size === 0) {
    if (overrideSheetId) {
      await sendCommand(wc, "CSS.setStyleSheetText", {
        styleSheetId: overrideSheetId,
        text: "",
      });
    }
    return;
  }
  await flushSheet(wc);
}

/** 导出当前调整为可读 CSS（与 UI「复制 CSS」一致）。 */
export function exportOverrideCss(host: string): StylePatchExportResult {
  return {
    css: formatStylePatchCss(
      [...patches.entries()].map(([selector, declarations]) => ({ selector, declarations })),
      host,
    ),
  };
}
