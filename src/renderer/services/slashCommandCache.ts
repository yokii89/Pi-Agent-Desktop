import type { PiSlashCommand } from "../../shared/ipc";

/**
 * cwd 级斜杠命令缓存（docs/会话进程懒加载方案 §5.2）：
 * get_commands 的内容由 pi 配置 + cwd 下的扩展 / skills / prompt 模板决定，
 * 与会话内容无关，同 cwd 的实例列表一致——冷会话可借同 cwd 存活实例拉取或
 * 直接命中缓存，避免「为一个菜单 spawn 整个进程」。模块级单例，不进 React state；
 * 扩展安装后的主动失效本期不做，TTL 到期兜底。
 */

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  commands: PiSlashCommand[];
  at: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * cwd 归一化：`\` → `/` + 小写。
 * Windows 下同一项目可能以 `D:\a`、`d:/a` 两种写法出现，
 * 不归一的话借用比较与缓存命中都会永远失败。
 */
export function normalizeCwdKey(cwd: string | null | undefined): string | null {
  const trimmed = cwd?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\/g, "/").toLowerCase();
}

/** TTL 内命中返回命令列表，过期视为未命中（顺带清掉陈旧条目）。 */
export function readSlashCommandCache(cwd: string | null | undefined): PiSlashCommand[] | null {
  const key = normalizeCwdKey(cwd);
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.commands;
}

/** 回写缓存；空列表不写（多为 getCommands 失败的兜底返回，不值得污染缓存）。 */
export function writeSlashCommandCache(
  cwd: string | null | undefined,
  commands: PiSlashCommand[],
): void {
  const key = normalizeCwdKey(cwd);
  if (!key || commands.length === 0) return;
  cache.set(key, { commands, at: Date.now() });
}
