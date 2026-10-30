/**
 * 「后台进程」详情页签的纯派生逻辑：选中项解析、来源 bash 调用查找、
 * 字节/端点展示与子进程缩进。组件只负责渲染与轮询。
 */
import type { ManagedProcess, ProcDetailRow } from "../../../../shared/ipc";
import type { SessionEntry, ToolAssistantBlock } from "../../../stores/sessionTranscript";

/**
 * 显式选中 → 首个存活 → 最近登记的已结束项；被忽略的登记项不参与。
 * 不依赖传入顺序（列表本身已按 orderProcesses 排过）。
 */
export function resolveSelectedProc(
  processes: readonly ManagedProcess[],
  selectedId: string | null,
): ManagedProcess | null {
  const visible = processes.filter((proc) => proc.status !== "ignored");
  if (selectedId) {
    const selected = visible.find((proc) => proc.id === selectedId);
    if (selected) return selected;
  }
  const alive = visible.find((proc) => proc.status === "alive");
  if (alive) return alive;
  return [...visible].sort((a, b) => b.registeredAt - a.registeredAt)[0] ?? null;
}

/** 按 toolCallId 在会话文档流里找来源 bash 工具块（历史会话同样可用）。 */
export function findSourceToolBlock(
  entries: readonly SessionEntry[],
  toolCallId: string | undefined,
): ToolAssistantBlock | null {
  if (!toolCallId) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "assistant") continue;
    for (const block of entry.blocks) {
      if (block.kind === "tool" && block.toolCallId === toolCallId) return block;
    }
  }
  return null;
}

/** 来源 bash 调用参数里的 timeout（秒）；缺失/非法返回 null。 */
export function readTimeoutSeconds(args: unknown): number | null {
  if (!args || typeof args !== "object") return null;
  const value = (args as { timeout?: unknown }).timeout;
  const seconds = typeof value === "number" ? value : Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** 工作集展示（进程详情用；与文件面板同一口径）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** 启动时间（窄栏两列格）：同年省年份，只到分钟；完整时间放 title。 */
export function formatStartTime(timestampMs: number, now = Date.now()): string {
  if (!timestampMs) return "—";
  const at = new Date(timestampMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const date = `${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return at.getFullYear() === new Date(now).getFullYear()
    ? `${date} ${clock}`
    : `${at.getFullYear()}-${date}`;
}

/** `地址:端口`；IPv6 加方括号，空地址用 `*`。 */
export function formatEndpointAddress(address: string, port: number): string {
  const host = address.includes(":") ? `[${address}]` : address || "*";
  return `${host}:${port}`;
}

/** 子进程相对根的深度（BFS 行序保证父先于子）；根为 0。 */
export function descendantDepth(
  rootPid: number,
  rows: readonly ProcDetailRow[],
): Map<number, number> {
  const depth = new Map<number, number>([[rootPid, 0]]);
  for (const row of rows) {
    depth.set(row.pid, (depth.get(row.ppid) ?? 0) + 1);
  }
  return depth;
}
