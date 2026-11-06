import { peekFavicon, requestFavicon } from "../../services/faviconService";
import iconStyles from "../../styles/linkIcon.module.css";
import { EL_ID_ATTR, FILE_ID_ATTR, SLASH_CMD_ATTR } from "../../utils/composerDom";
import { splitMessageUrls } from "../../utils/linkify";
import styles from "./Composer.module.css";

/**
 * 输入栏草稿区的 URL 就地装饰：把 http(s) URL 包进「站点图标 + 下划线」的 span，
 * 同时保持逐字节可编辑——这是它与 @ / 斜杠原子芯片的本质区别：
 * - 链接 span 是普通可编辑元素（不设 contentEditable=false），readComposerDom 递归
 *   文本节点时对它完全透明，`text` 与 `root.textContent` 逐字节不变
 *   （历史召回「未编辑」逐字判据、发送读出不受影响的前提）；
 * - 图标壳（favicon img / 兜底 Globe）自挂 contentEditable=false，是唯一的原子点，
 *   同时也是 textBeforeCaret 的 @ token 边界（与芯片同一口径）；
 * - 不做点击导航：草稿区链接只表达「识别到了」，点击仍是光标定位。
 *
 * 重排由 Composer 在输入静默（LINKIFY_DEBOUNCE_MS）后触发，输入法组合期绝不触碰 DOM；
 * 每次改写前按「之前的纯文本字符数」记下光标书签（芯片子树计 0），改写后按书签还原——
 * 装饰从不增删任何字符，书签在改写前后语义一致，光标不会跳位。
 */

/** 输入静默多久后才重排（每次敲字重置计时）。 */
export const LINKIFY_DEBOUNCE_MS = 120;

const LINK_ATTR = "data-composer-link";
const ICON_ATTR = "data-link-icon";
const ICON_FALLBACK_ATTR = "data-link-icon-fallback";
const CHIP_SELECTOR = `[${EL_ID_ATTR}], [${FILE_ID_ATTR}], [${SLASH_CMD_ATTR}]`;

export interface ComposerLinkOptions {
  /** 兜底图标的克隆源（Composer 隐藏图标库里的 Phosphor Globe）。 */
  fallbackIcon?: Node | null;
}

/** 是否在原子芯片子树里：芯片文字不参与光标计数，重排也绝不触碰。 */
function insideChip(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(el?.closest(CHIP_SELECTOR));
}

/** 子树内的纯文本字符数（芯片子树计 0；img/svg 里没有文本节点，天然计 0）。 */
function countTextChars(node: Node): number {
  if (insideChip(node)) return 0;
  if (node instanceof Text) return node.data.length;
  let sum = 0;
  for (const child of node.childNodes) sum += countTextChars(child);
  return sum;
}

/** 文档序收集 root 下的文本节点（跳过芯片子树；是否在链接 span 里由调用方自行过滤）。 */
function collectTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!insideChip(node)) out.push(node as Text);
  }
  return out;
}

/**
 * 把 (node, offset) 位置换算成「之前的纯文本字符数」书签。
 * 位置落在芯片子树内（正常编辑不会出现）时返回 null，调用方放弃这次重排。
 */
function positionCharOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  if (insideChip(node)) return null;
  if (node === root) {
    let sum = 0;
    let i = 0;
    for (const child of root.childNodes) {
      if (i++ >= offset) break;
      sum += countTextChars(child);
    }
    return sum;
  }
  let acc = 0;
  let done = false;
  const walk = (parent: Node): void => {
    for (const child of parent.childNodes) {
      if (done) return;
      if (child === node) {
        if (node instanceof Text) {
          acc += offset;
        } else {
          let i = 0;
          for (const c of node.childNodes) {
            if (i++ >= offset) break;
            acc += countTextChars(c);
          }
        }
        done = true;
        return;
      }
      if (child.contains(node)) walk(child);
      else acc += countTextChars(child);
    }
  };
  walk(root);
  return done ? acc : null;
}

/** 书签 → 新树里的位置：文档序取第一个覆盖该字符数的位置（边界偏向更早的文本节点）。 */
function caretPositionFor(root: HTMLElement, target: number): { node: Node; offset: number } {
  let acc = 0;
  for (const text of collectTextNodes(root)) {
    if (target <= acc + text.data.length) return { node: text, offset: target - acc };
    acc += text.data.length;
  }
  return { node: root, offset: root.childNodes.length };
}

function buildFaviconImg(dataUrl: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "";
  img.draggable = false;
  return img;
}

/** 图标壳：原子（contentEditable=false）。favicon 已知挂 img；未知先占兜底并异步回填。
 * 盒子尺寸用公共配方（styles/linkIcon.module.css），与气泡、文档流同一格。 */
function buildLinkIcon(url: string, fallbackIcon: Node | null): HTMLElement {
  const shell = document.createElement("span");
  shell.className = iconStyles.linkIcon;
  shell.setAttribute(ICON_ATTR, "");
  shell.contentEditable = "false";
  shell.setAttribute("aria-hidden", "true");
  const favicon = peekFavicon(url);
  if (favicon) {
    shell.appendChild(buildFaviconImg(favicon));
    return shell;
  }
  shell.setAttribute(ICON_FALLBACK_ATTR, "");
  if (fallbackIcon) shell.appendChild(fallbackIcon.cloneNode(true));
  // favicon 抓到后原地升级；shell 已被用户删掉或已升级则不动（不复活被删的图标）
  void requestFavicon(url).then((dataUrl) => {
    if (!dataUrl || !shell.isConnected || !shell.hasAttribute(ICON_FALLBACK_ATTR)) return;
    shell.replaceChildren(buildFaviconImg(dataUrl));
    shell.removeAttribute(ICON_FALLBACK_ATTR);
  });
  return shell;
}

function buildLinkSpan(url: string, fallbackIcon: Node | null): HTMLElement {
  const span = document.createElement("span");
  span.className = styles.composerLink;
  span.setAttribute(LINK_ATTR, "");
  span.append(buildLinkIcon(url, fallbackIcon), document.createTextNode(url));
  return span;
}

/** 文本是否恰好是一个完整 URL（被修剪的尾部标点会归入其后 text 片段，则不算整体 URL）。 */
function isWholeUrl(text: string): boolean {
  if (!text) return false;
  const parts = splitMessageUrls(text);
  return parts.length === 1 && parts[0].kind === "url" && parts[0].value === text;
}

/**
 * 对编辑器做一次幂等重排：非法链接 span 摊平、纯文本里的 URL 包 span、
 * favicon 到位的兜底图标原地升级。只改写命中的节点，其余 DOM 一律不碰。
 */
export function relayoutComposerLinks(root: HTMLElement, options: ComposerLinkOptions = {}): void {
  if (!root.isContentEditable) return;

  // 光标书签先行：记不住（位置在芯片子树里等）就宁可不重排
  const selection = window.getSelection();
  let anchor: number | null = null;
  let focus: number | null = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (root.contains(range.startContainer) && root.contains(range.endContainer)) {
      anchor = positionCharOffset(root, range.startContainer, range.startOffset);
      focus = positionCharOffset(root, range.endContainer, range.endOffset);
      if (anchor === null || focus === null) return;
    }
  }

  // 1) 既有链接 span：结构碎裂 / 混进芯片或换行 / 文本不再是完整 URL → 摊平
  //    （文本节点本体保留、字符一个不动）；合法但文本节点被编辑拆碎 → 合并回一个
  for (const span of Array.from(root.querySelectorAll<HTMLElement>(`[${LINK_ATTR}]`))) {
    if (!span.isConnected) continue;
    const parent = span.parentNode;
    if (!parent) continue;
    const icon = span.querySelector<HTMLElement>(`[${ICON_ATTR}]`);
    const broken = span.querySelector(CHIP_SELECTOR) || span.querySelector("br");
    const textParts = Array.from(span.childNodes).filter(
      (child): child is Text => child instanceof Text && child.data.length > 0,
    );
    const structural =
      !broken &&
      Array.from(span.childNodes).every((child) => child instanceof Text || child === icon);
    const joined = textParts.map((part) => part.data).join("");
    if (structural && isWholeUrl(joined)) {
      if (textParts.length > 1) {
        textParts[0].data = joined;
        for (const part of textParts.slice(1)) part.remove();
      }
      continue;
    }
    for (const child of Array.from(span.childNodes)) {
      if (child === icon) continue;
      parent.insertBefore(child, span);
    }
    span.remove();
  }

  // 2) 纯文本节点里的 URL：拆段包 span。切片按 splitMessageUrls（尾部标点留在 span 外）；
  //    每次只处理单个文本节点——文本节点天然不跨芯片，span 不可能吞掉相邻芯片
  for (const text of collectTextNodes(root)) {
    if (text.parentElement?.closest(`[${LINK_ATTR}]`)) continue;
    const parts = splitMessageUrls(text.data);
    if (!parts.some((part) => part.kind === "url")) continue;
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (part.kind === "text") {
        frag.appendChild(document.createTextNode(part.value));
      } else {
        frag.appendChild(buildLinkSpan(part.value, options.fallbackIcon ?? null));
      }
    }
    text.replaceWith(frag);
  }

  // 3) 兜底图标升级：favicon 已到位的壳原地换 img（只升级兜底壳，不复活被删的图标）
  for (const shell of Array.from(root.querySelectorAll<HTMLElement>(`[${ICON_FALLBACK_ATTR}]`))) {
    const span = shell.closest<HTMLElement>(`[${LINK_ATTR}]`);
    if (!span) continue;
    const favicon = peekFavicon(span.textContent ?? "");
    if (!favicon) continue;
    shell.replaceChildren(buildFaviconImg(favicon));
    shell.removeAttribute(ICON_FALLBACK_ATTR);
  }

  // 4) 按书签还原光标（纯文本字符数在改写前后不变）
  if (selection && anchor !== null && focus !== null) {
    const a = caretPositionFor(root, anchor);
    const range = document.createRange();
    if (anchor === focus) {
      range.setStart(a.node, a.offset);
      range.collapse(true);
    } else {
      const f = caretPositionFor(root, focus);
      if (anchor < focus) {
        range.setStart(a.node, a.offset);
        range.setEnd(f.node, f.offset);
      } else {
        range.setStart(f.node, f.offset);
        range.setEnd(a.node, a.offset);
      }
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
