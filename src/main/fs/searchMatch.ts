/**
 * 文件名 / 相对路径的模糊匹配（docs/design 30 §2.2）。
 * 子序列语义：「记不全名也能搜到」——查询按空白分词，每个词都必须是
 * 名称或相对路径的（大小写不敏感）子序列才算命中。
 * 主进程负责召回，渲染层 fuzzy.ts 只对召回结果排序，两边口径兼容：
 * 词是 relPath 的子序列 ⇒ 也是渲染层拼接检索文本的子序列，不会被二次过滤掉。
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

/**
 * 单个候选（文件/目录）是否命中查询。
 * 空查询视为命中（@ 浏览模式）；relPath 以 name 结尾，故「词是 name 的子序列」
 * 恒蕴含「是 relPath 的子序列」，二选一即可。
 */
export function matchesFileQuery(name: string, relPath: string, keyword: string): boolean {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return true;
  const nameLower = name.toLowerCase();
  const relLower = relPath.toLowerCase();
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => isSubsequence(token, nameLower) || isSubsequence(token, relLower));
}
