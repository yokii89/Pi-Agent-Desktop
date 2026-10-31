import type { PiNestedToolCall, PiNestedToolCalls } from "./ipc";

/** pi 的嵌套调用记录上限（packages/coding-agent/src/core/nested-tool-calls.ts 的 maxCalls）。 */
const MAX_CALLS = 256;

/**
 * 从 pi 的 `nestedCalls` 记录中收窄出监控用的 name/status。
 * 参数与结果不留在会话条目里：监控卡只关心「调了谁、成没成」，
 * 而磁盘读取是主进程按白名单逐字段映射的，收窄点放在共享层保证两条路径同口径。
 */
export function sanitizeNestedToolCalls(value: unknown): PiNestedToolCalls | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { calls?: unknown; complete?: unknown };
  if (!Array.isArray(record.calls)) return null;
  const calls: PiNestedToolCall[] = [];
  for (const raw of record.calls) {
    if (calls.length >= MAX_CALLS) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { name?: unknown; status?: unknown };
    if (typeof item.name !== "string" || item.name.length === 0) continue;
    const status =
      item.status === "ok" || item.status === "error" || item.status === "unfinished"
        ? item.status
        : undefined;
    calls.push(status ? { name: item.name, status } : { name: item.name });
  }
  if (calls.length === 0) return null;
  return record.complete === false ? { calls, complete: false } : { calls };
}
