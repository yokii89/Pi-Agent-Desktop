/**
 * 零依赖模糊匹配（docs/design 30 §2.2：不引 fzf / fuse.js）。
 * 采用「空格分词 + 逐词子序列」策略：每个词都必须是 haystack 的子序列才算命中，
 * 命中分越高越靠前——奖励连续匹配、词首/串首命中，惩罚跨距与 haystack 长度。
 * 命中同时返回下标集合，供行内高亮（ZCode HighlightedMatchText 的对应物）。
 */

export interface FuzzyMatch {
  score: number;
  /** 命中字符在 text 中的下标（升序）；query 为空时为空数组。 */
  positions: number[];
}

interface TokenMatch {
  score: number;
  positions: number[];
}

/** 单词子序列打分；不是子序列返回 null。 */
function subsequenceMatch(haystack: string, token: string): TokenMatch | null {
  let score = 0;
  let cursor = 0;
  let streak = 0;
  const positions: number[] = [];
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    const idx = haystack.indexOf(ch, cursor);
    if (idx === -1) return null;

    let gain = 1;
    // 串首 / 分隔符后（词首）命中更值钱
    if (idx === 0 || /[\s\-_./\\]/.test(haystack[idx - 1] ?? "")) gain += 4;
    // 与上一个命中位置连续 → 累加连击奖励
    if (idx === cursor && streak > 0) {
      streak += 1;
      gain += streak * 2;
    } else {
      streak = 1;
    }
    // 跨距惩罚：跳过的字符越多越差
    gain -= Math.min(idx - cursor, 4) * 0.3;

    score += gain;
    positions.push(idx);
    cursor = idx + 1;
  }
  return { score, positions };
}

/**
 * 对单条文本打分并给出命中下标；query 为空视为命中（分数 0、无高亮位置）。
 * 任一分词不是子序列则整体不命中，返回 null。
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return { score: 0, positions: [] };
  const haystack = text.toLowerCase();
  const tokens = needle.split(/\s+/).filter(Boolean);
  let total = 0;
  const positions: number[] = [];
  for (const token of tokens) {
    const part = subsequenceMatch(haystack, token);
    if (part === null) return null;
    total += part.score;
    positions.push(...part.positions);
  }
  // 越短的文本同分下越靠前（轻微长度惩罚）
  return { score: total - haystack.length * 0.01, positions: positions.sort((a, b) => a - b) };
}

/** 只取分数的便捷形式（排序用）。 */
export function fuzzyScore(text: string, query: string): number | null {
  return fuzzyMatch(text, query)?.score ?? null;
}
