/**
 * watch 事件真伪校验：维护受监听目录 `.ts` 文件的 mtime 基线，供 dev.mjs 在事件防抖后
 * 重扫比对。Windows 递归 fs.watch 会在无任何源码写入时连发事件（filename 常为 null，
 * 杀软 / 索引器 / 目录元数据变动都可能触发），直接把事件当「有变更」会误重启 Electron，
 * 把运行中的会话连着 pi 子进程一起杀掉——所以事件必须过 mtime 校验才算数。
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * 递归收集 dirs（相对 root）下所有 `.ts` 文件的「POSIX 相对路径 → mtimeMs」快照。
 * 只认 `.ts`：tsc 的编译输入就是它们（`.tsbuildinfo` 不匹配 `.ts`，tsc 自己写它不该触发重启）。
 * stat 失败（如被杀软短暂锁住）记为 null：与正常值不等按有变处理（宁可多编译一次），
 * 连续失败则两次都为 null，不会造成重编译循环。
 */
export async function scanSourceMtimes(root, dirs) {
  const result = new Map();
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // 目录暂时不可读（极少见）：该子树按缺失处理，宁可多编译一次。
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".ts")) continue;
      const relative = path.relative(root, fullPath).replaceAll("\\", "/");
      try {
        result.set(relative, (await stat(fullPath)).mtimeMs);
      } catch {
        result.set(relative, null);
      }
    }
  };
  for (const dir of dirs) await walk(path.join(root, dir));
  return result;
}

/**
 * 与基线比对，返回新增 / 删除 / mtime 有变化的文件相对路径；空数组 = 无真实变更。
 * 用「不等」而不是「更新」比较：时钟回拨（NTP 校时）也不会漏报。
 */
export function changedSourceFiles(baseline, current) {
  const changed = [];
  for (const [file, mtime] of current) {
    if (baseline.get(file) !== mtime) changed.push(file);
  }
  for (const file of baseline.keys()) {
    if (!current.has(file)) changed.push(file);
  }
  return changed;
}
