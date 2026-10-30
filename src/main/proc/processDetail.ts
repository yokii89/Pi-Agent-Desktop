import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ManagedProcess, ProcDetail, ProcDetailRow, ProcEndpoint } from "../../shared/ipc";
import { enumerateProcesses, getProcessSnapshot, isPidReuse } from "./processKill";
import type { ProcessSnapshot, ProcessSnapshotRow } from "./processWatch";

const execFileAsync = promisify(execFile);

/** 详情展示上限：异常进程树/大量连接不能撑爆侧栏。 */
export const DETAIL_LIMITS = {
  descendants: 48,
  ports: 24,
} as const;

/**
 * 详情轮询复用 5s 存活对账的进程快照：对账本身要跑 ~1.5s CIM，
 * 窗口取 10s 才能覆盖「5s 间隔 + 本次枚举耗时」，让详情轮询基本不重跑 CIM。
 * 进程是否还活着由登记表 push 决定，快照只用于详情字段。
 */
const SNAPSHOT_MAX_AGE_MS = 10_000;

interface DescendantScan {
  rows: ProcDetailRow[];
  /** 全部子孙数（不受展示上限影响）。 */
  count: number;
  /** 全部子孙工作集合计（不受展示上限影响）。 */
  memoryBytes: number;
  /** 全部子孙 pid（端口过滤用，不受展示上限影响）。 */
  pids: Set<number>;
}

/** 一次遍历同时产出展示行、总数、内存与端口过滤集合；上限只截展示行，不影响统计。 */
function scanDescendants(
  snapshot: ProcessSnapshot,
  rootPid: number,
  limit: number,
): DescendantScan {
  const children = new Map<number, ProcessSnapshotRow[]>();
  for (const row of snapshot.values()) {
    const list = children.get(row.ppid);
    if (list) list.push(row);
    else children.set(row.ppid, [row]);
  }
  for (const list of children.values()) list.sort((a, b) => a.pid - b.pid);

  const rows: ProcDetailRow[] = [];
  const pids = new Set<number>();
  let count = 0;
  let memoryBytes = 0;
  const visited = new Set<number>([rootPid]);
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const child of children.get(parent) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      count += 1;
      pids.add(child.pid);
      memoryBytes += child.workingSet ?? 0;
      if (rows.length < limit) {
        rows.push({
          pid: child.pid,
          ppid: child.ppid,
          name: child.name,
          commandLine: child.commandLine,
          startedAt: child.startedAt,
        });
      }
      queue.push(child.pid);
    }
  }
  return { rows, count, memoryBytes, pids };
}

/**
 * 从进程快照里取 rootPid 的子孙（BFS，不含根，展示行上限默认 48）。
 * 纯函数：环（异常 ppid）用 visited 截断，结果按发现顺序稳定输出。
 */
export function buildDescendants(
  snapshot: ProcessSnapshot,
  rootPid: number,
  limit: number = DETAIL_LIMITS.descendants,
): ProcDetailRow[] {
  return scanDescendants(snapshot, rootPid, limit).rows;
}

/** `host:port` → [host, port]；IPv6 形如 `[::1]:5173`。 */
export function parseHostPort(text: string): { address: string; port: number } | null {
  const idx = text.lastIndexOf(":");
  if (idx <= 0) return null;
  const port = Number(text.slice(idx + 1));
  if (!Number.isFinite(port) || port <= 0) return null;
  let address = text.slice(0, idx);
  if (address.startsWith("[") && address.endsWith("]")) address = address.slice(1, -1);
  return { address, port };
}

/**
 * 解析 `netstat -ano -p TCP` 输出。
 *
 * 不用 Get-NetTCPConnection：本机实测它 2.6s，netstat 63ms（差 40 倍）；
 * 状态串是英文 LISTENING/ESTABLISHED（系统头行本地化，但不以 TCP 开头，天然被跳过）。
 */
export function parseNetstatOutput(stdout: string): ProcEndpoint[] {
  const out: ProcEndpoint[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("TCP")) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 5) continue;
    const local = parseHostPort(fields[1] ?? "");
    const remote = parseHostPort(fields[2] ?? "");
    const pid = Number(fields[4]);
    if (!local || !Number.isFinite(pid) || pid <= 0) continue;
    out.push({
      pid,
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote ? remote.address : null,
      remotePort: remote ? remote.port : null,
      state: fields[3] ?? "",
    });
  }
  return out;
}

/** 监听端点在先，其次按端口；只保留归属 pids 的项并截断。 */
export function selectPorts(
  ports: readonly ProcEndpoint[],
  pids: ReadonlySet<number>,
  limit: number = DETAIL_LIMITS.ports,
): ProcEndpoint[] {
  return ports
    .filter((port) => pids.has(port.pid))
    .sort((a, b) => {
      const aListen = a.state.toLowerCase().startsWith("listen") ? 0 : 1;
      const bListen = b.state.toLowerCase().startsWith("listen") ? 0 : 1;
      if (aListen !== bListen) return aListen - bListen;
      if (a.localPort !== b.localPort) return a.localPort - b.localPort;
      return a.pid - b.pid;
    })
    .slice(0, limit);
}

export interface BuildProcDetailInput {
  proc: ManagedProcess;
  snapshot: ProcessSnapshot;
  /** 全量端点（未过滤）；build 内按子树 pid 过滤并截断。 */
  ports: readonly ProcEndpoint[];
  /** 端口查询是否成功；false 时 ports 为空不代表「没有端点」。 */
  portsReadable?: boolean;
  now?: number;
}

/** 汇总一次详情快照（纯函数，便于不启 PowerShell 直接断言）。 */
export function buildProcDetail(input: BuildProcDetailInput): ProcDetail {
  const { proc, snapshot } = input;
  const root = snapshot.get(proc.pid) ?? null;
  const alive = root !== null && !isPidReuse(proc, root);
  const scan = alive
    ? scanDescendants(snapshot, proc.pid, DETAIL_LIMITS.descendants)
    : { rows: [], count: 0, memoryBytes: 0, pids: new Set<number>() };

  // 根已消失 / PID 被别的进程复用时，那份内存不属于登记项，按 0 计
  const memoryBytes = alive ? (root?.workingSet ?? 0) + scan.memoryBytes : 0;
  const pids = new Set<number>([proc.pid, ...scan.pids]);

  return {
    at: input.now ?? Date.now(),
    alive,
    descendants: scan.rows,
    ports: alive ? selectPorts(input.ports, pids) : [],
    memoryBytes,
    processCount: alive ? 1 + scan.count : 0,
    portsReadable: input.portsReadable ?? true,
  };
}

/** 查询全部 TCP 端点（netstat）；失败返回 null（与「没有端点」区分）。 */
export async function queryTcpEndpoints(): Promise<ProcEndpoint[] | null> {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseNetstatOutput(stdout);
  } catch {
    return null;
  }
}

/**
 * 读取进程详情：进程快照优先复用 5s 对账的新鲜结果，TCP 端点每次用 netstat 现查。
 * 快照查询失败直接抛出（详情确实无从谈起）；端口失败只降级该区块。
 */
export async function readProcessDetail(proc: ManagedProcess): Promise<ProcDetail> {
  let snapshot = await getProcessSnapshot(SNAPSHOT_MAX_AGE_MS);
  // 快照可能早于该进程启动（刚登记、缓存里还没有这个 PID）：强制重枚举一次，
  // 否则会把刚起的进程误判成「已退出」。
  if (snapshot && !snapshot.has(proc.pid)) {
    snapshot = (await enumerateProcesses()) ?? snapshot;
  }
  if (!snapshot) throw new Error("读取进程信息失败");
  const root = snapshot.get(proc.pid) ?? null;
  const alive = root !== null && !isPidReuse(proc, root);
  const ports = alive ? await queryTcpEndpoints() : [];
  return buildProcDetail({
    proc,
    snapshot,
    ports: ports ?? [],
    portsReadable: ports !== null,
    now: Date.now(),
  });
}
