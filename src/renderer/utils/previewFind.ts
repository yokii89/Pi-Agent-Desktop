/**
 * 面板内查找的命中定位（Ctrl+F）。
 *
 * 两层：`findMatchOffsets` 是纯字符串定位（可测），`collectMatchRanges` 把命中映射回 DOM Range，
 * 交给 CSS Custom Highlight API 上色——不改 DOM，Markdown 预览那种「React 拥有节点」的渲染面
 * 也不会被打断。
 */

/**
 * 大小写不敏感的全部命中区间 `[start, end)`，互不重叠（命中后跳到末尾继续找）。
 * 大小写折叠会改变长度的极端字符（如 `İ`）退回原文比较，避免偏移错位。
 */
export function findMatchOffsets(haystack: string, query: string): Array<[number, number]> {
  if (!query) return [];
  const lowered = haystack.toLowerCase();
  const needle = query.toLowerCase();
  const hay = lowered.length === haystack.length ? lowered : haystack;
  const target = lowered.length === haystack.length ? needle : query;
  const out: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(target, from);
    if (at < 0) break;
    out.push([at, at + target.length]);
    from = at + target.length;
  }
  return out;
}

/** 文本节点在拼接串里的位置（Range 映射用）。 */
interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

/** 上限：命中过多时只取前 N 个（高亮几万个 Range 会卡住渲染）。 */
const MAX_MATCHES = 2000;

/**
 * 在 `root` 子树的文本节点里查找 query，返回可直接交给 `new Highlight(...ranges)` 的 Range 列表。
 * 空白文本节点跳过（不影响偏移，因为它们不参与拼接）。
 */
export function collectMatchRanges(root: Node, query: string, limit = MAX_MATCHES): Range[] {
  if (!query) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: TextSegment[] = [];
  let haystack = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const value = text.nodeValue ?? "";
    if (value.trim().length === 0) continue;
    segments.push({ node: text, start: haystack.length, end: haystack.length + value.length });
    haystack += value;
  }
  const offsets = findMatchOffsets(haystack, query).slice(0, limit);
  const ranges: Range[] = [];
  let segIndex = 0;
  for (const [start, end] of offsets) {
    while (segIndex < segments.length && segments[segIndex].end <= start) segIndex += 1;
    const from = segments[segIndex];
    if (!from) break;
    // 命中可以跨节点（一个词被 <span> 切开的常见情况）：末端另找所在节点
    let endIndex = segIndex;
    while (endIndex < segments.length && segments[endIndex].end < end) endIndex += 1;
    const to = segments[endIndex];
    if (!to) break;
    const range = document.createRange();
    range.setStart(from.node, start - from.start);
    range.setEnd(to.node, Math.min(end - to.start, to.end - to.start));
    ranges.push(range);
  }
  return ranges;
}
