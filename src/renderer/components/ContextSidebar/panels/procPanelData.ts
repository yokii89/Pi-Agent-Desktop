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

/** 监听端口的服务启发式（#12）：命中常见 dev server 端口才标提示，不假装精确。 */
const DEV_SERVER_PORTS = new Set([3000, 3001, 4200, 5173, 8000, 8080, 9000]);

export function isDevServerPort(port: number): boolean {
  return DEV_SERVER_PORTS.has(port);
}

/**
 * 端点归属名（#11）：`name #pid`；归属进程不在详情树里（快照竞态）时退回 `#pid`。
 * proc 传根或子孙行均可。
 */
export function portOwnerName(
  pid: number,
  proc: { pid: number; name: string },
  descendants: readonly ProcDetailRow[],
): string {
  if (pid === proc.pid) return `${proc.name} #${proc.pid}`;
  const row = descendants.find((item) => item.pid === pid);
  return row ? `${row.name || `PID ${row.pid}`} #${row.pid}` : `#${pid}`;
}

/** 监听端点的本机 URL（浏览器打开 / 复制用）：绑定到通配或回环都走 localhost。 */
export function localPortUrl(port: number): string {
  return `http://localhost:${port}`;
}

/** CPU 使用率展示：首轮采样无差值为 null → 「—」；数值保留主进程取整后的一位小数。 */
export function formatCpuPercent(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "—";
  return `${percent}%`;
}

/**
 * 内存走势 sparkline 的 polyline 点串（#16）：样本等宽分布、纵轴按样本范围拉伸，
 * 全相等时压成中位线。viewBox 由调用方定（w × h），这里只产出 `x,y x,y …`。
 */
export function sparklinePoints(
  samples: readonly number[],
  width: number,
  height: number,
  pad = 2,
): string {
  if (samples.length < 2) return "";
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min;
  const innerH = height - pad * 2;
  const stepX = width / (samples.length - 1);
  return samples
    .map((value, index) => {
      const x = index * stepX;
      const y = span === 0 ? height / 2 : pad + innerH - ((value - min) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
