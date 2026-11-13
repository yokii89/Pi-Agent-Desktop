import type { FsSearchHit } from "../../shared/ipc";

/**
 * 文件名 / 相对路径的模糊匹配（docs/design 30 §2.2）。
 * 子序列语义：「记不全名也能搜到」——查询按空白分词，每个词都必须是
 * 名称或相对路径的（大小写不敏感）子序列才算命中。
 */

/** needle 是否为 haystack 的子序列。 */
export function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (let i = 0; i < needle.length; i += 1) {
    const idx = haystack.indexOf(needle[i], cursor);
    if (idx === -1) return false;
    cursor = idx + 1;
  }
  return true;
}

interface MatchWeights {
  exact: number;
  prefix: number;
  contains: number;
  subsequence: number;
  startPenalty: number;
  gapPenalty: number;
}

const NAME_MATCH: MatchWeights = {
  exact: 12_000,
  prefix: 11_000,
  contains: 9_000,
  subsequence: 7_000,
  startPenalty: 20,
  gapPenalty: 5,
};

const PATH_MATCH: MatchWeights = {
  exact: 6_000,
  prefix: 5_000,
  contains: 4_000,
  subsequence: 2_500,
  startPenalty: 4,
  gapPenalty: 1,
};

function textMatchScore(needle: string, haystack: string, weights: MatchWeights): number | null {
  if (haystack === needle) return weights.exact;
  if (haystack.startsWith(needle)) return weights.prefix;
  const index = haystack.indexOf(needle);
  if (index >= 0) return weights.contains - index;

  let cursor = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < needle.length; i += 1) {
    const found = haystack.indexOf(needle[i] ?? "", cursor);
    if (found < 0) return null;
    if (first < 0) first = found;
    last = found;
    cursor = found + 1;
  }
  const gaps = last - first + 1 - needle.length;
  return Math.max(
    1,
    weights.subsequence - first * weights.startPenalty - gaps * weights.gapPenalty,
  );
}

/** 返回候选相关度；任一查询词都未命中时返回 null。 */
export function scoreFileQuery(name: string, relPath: string, keyword: string): number | null {
  const tokens = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  const nameLower = name.toLowerCase();
  const relLower = relPath.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    const nameScore = textMatchScore(token, nameLower, NAME_MATCH);
    const pathScore = textMatchScore(token, relLower, PATH_MATCH);
    if (nameScore === null && pathScore === null) return null;
    total += Math.max(nameScore ?? 0, pathScore ?? 0);
  }
  return total;
}

/** 按文件名相关度优先排序；同分时保留文件夹优先与路径字母序。 */
export function rankFileSearchHits<T extends Pick<FsSearchHit, "displayPath" | "kind">>(
  hits: T[],
  keyword: string,
): T[] {
  const query = keyword.trim().toLowerCase();
  const score = (hit: T): number => {
    const name = hit.displayPath.split("/").pop() ?? hit.displayPath;
    return scoreFileQuery(name, hit.displayPath, query) ?? Number.NEGATIVE_INFINITY;
  };

  return [...hits].sort((a, b) => {
    const scoreA = score(a);
    const scoreB = score(b);
    if (scoreA !== scoreB) return scoreB > scoreA ? 1 : -1;
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.displayPath.localeCompare(b.displayPath);
  });
}

/** 单个候选（文件/目录）是否命中查询。 */
export function matchesFileQuery(name: string, relPath: string, keyword: string): boolean {
  const tokens = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const nameLower = name.toLowerCase();
  const relLower = relPath.toLowerCase();
  return tokens.every((token) => isSubsequence(token, nameLower) || isSubsequence(token, relLower));
}
