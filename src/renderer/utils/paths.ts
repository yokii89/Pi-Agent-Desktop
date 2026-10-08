/**
 * Windows 路径归一化与包含判断（纯字符串运算，渲染层可用）。
 * 会话工作目录来自 pi JSONL，项目目录来自用户选择，两者格式不可控：
 * 大小写、\ 与 /、尾部斜杠都可能不同，匹配前必须先归一化。
 */

/**
 * 目录路径归一化：分隔符统一为 /、折叠重复分隔符、去尾部斜杠、转小写
 * （Windows 文件系统大小写不敏感）。盘符根（"C:\"）归一化为 "c:"。
 */
export function normalizeDirPath(dir: string): string {
  return dir
    .trim()
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** 取路径最后一段（文件名或末级目录）；无分隔符时原样返回。 */
export function pathBasename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * 判断 target 是否等于或位于 parentDir 内部（目录前缀匹配）。
 * 归一化后按 "parent/" 前缀比较，避免 "D:/a/bc" 误匹配 "D:/a/b"。
 */
export function isSameOrInsideDir(target: string, parentDir: string): boolean {
  const t = normalizeDirPath(target);
  const p = normalizeDirPath(parentDir);
  if (t.length === 0 || p.length === 0) return false;
  return t === p || t.startsWith(`${p}/`);
}
