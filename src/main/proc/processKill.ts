import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { ManagedProcess, ProcStopResult } from "../../shared/ipc";
import type { ProcessSnapshot, ProcessSnapshotRow } from "./processWatch";

const execFileAsync = promisify(execFile);

/**
 * PID 复用防护：命令行与登记值不一致则拒绝 kill。
 * CreationDate 不一致同样拒绝（命令行可能被合法改写，创建时间不会）。
 */
export function isPidReuse(
  expected: Pick<ManagedProcess, "commandLine" | "startedAt">,
  actual: Pick<ProcessSnapshotRow, "commandLine" | "startedAt"> | null,
): boolean {
  if (!actual) return true;
  if (expected.commandLine && actual.commandLine) {
    if (normalizeCmd(expected.commandLine) !== normalizeCmd(actual.commandLine)) return true;
  }
  // startedAt 为 0 表示未知，不做时间校验
  if (expected.startedAt && actual.startedAt) {
    // 容差 2s：CIM 时间精度与本地时钟抖动
    if (Math.abs(expected.startedAt - actual.startedAt) > 2000) return true;
  }
  return false;
}

function normalizeCmd(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

const ENUM_SCRIPT = `
$ErrorActionPreference='Stop'
Get-CimInstance Win32_Process | ForEach-Object {
  $ms = 0
  if ($_.CreationDate) {
    try { $ms = [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } catch { $ms = 0 }
  }
  [pscustomobject]@{
    pid = [int]$_.ProcessId
    ppid = [int]$_.ParentProcessId
    name = [string]$_.Name
    commandLine = [string]$_.CommandLine
    startedAt = [long]$ms
    workingSet = [long]$_.WorkingSetSize
  }
} | ConvertTo-Json -Compress
`;

/** 最近一次成功枚举：详情轮询复用它，避免每次 3s 查询都重跑 CIM（~1.5s）。 */
let latestSnapshot: { at: number; snapshot: ProcessSnapshot } | null = null;

/**
 * 枚举系统进程快照。失败（权限/瞬时）返回 null，调用方跳过本轮。
 * 不抛到 UI——下轮 bash 边界再试（docs/design/37 §3.2）。
 */
export async function enumerateProcesses(): Promise<ProcessSnapshot | null> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ENUM_SCRIPT],
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = parseProcessJson(stdout);
    if (parsed) latestSnapshot = { at: Date.now(), snapshot: parsed };
    return parsed;
  } catch {
    return null;
  }
}

/** 不超过 maxAgeMs 的最近快照；没有/过期返回 null。 */
export function recentProcessSnapshot(maxAgeMs: number): ProcessSnapshot | null {
  if (!latestSnapshot) return null;
  return Date.now() - latestSnapshot.at <= maxAgeMs ? latestSnapshot.snapshot : null;
}

/** 优先复用新鲜快照，否则重新枚举（详情轮询与 5s 对账共用同一份枚举）。 */
export async function getProcessSnapshot(maxAgeMs = 0): Promise<ProcessSnapshot | null> {
  return recentProcessSnapshot(maxAgeMs) ?? enumerateProcesses();
}

/** 解析 PowerShell ConvertTo-Json 输出（单对象或数组）。可单测。 */
export function parseProcessJson(stdout: string): ProcessSnapshot | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const map = new Map<number, ProcessSnapshotRow>();
    for (const item of rows) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const pid = Number(r.pid);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      map.set(pid, {
        pid,
        ppid: Number(r.ppid) || 0,
        name: typeof r.name === "string" ? r.name : "",
        commandLine: typeof r.commandLine === "string" ? r.commandLine : "",
        startedAt: Number(r.startedAt) || 0,
        workingSet: Number(r.workingSet) || 0,
      });
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

/** 单 PID 存活查询（复核窗 / kill 前校验）。 */
export async function queryProcess(pid: number): Promise<ProcessSnapshotRow | null> {
  const snapshot = await enumerateProcesses();
  return snapshot?.get(pid) ?? null;
}

/** kill 前命令行防复用校验：不一致则拒绝。 */
export async function verifyBeforeKill(proc: ManagedProcess): Promise<ProcStopResult> {
  const actual = await queryProcess(proc.pid);
  if (!actual) {
    return { stillAlive: false, message: "进程已退出" };
  }
  if (isPidReuse(proc, actual)) {
    return { stillAlive: false, message: "进程已变化，未终止" };
  }
  return { stillAlive: true };
}

/**
 * 结束登记项（taskkill /T 连带子树）。
 * 校验失败不 kill，回报 message 供行内提示。
 */
export async function killManagedProcess(proc: ManagedProcess): Promise<ProcStopResult> {
  const check = await verifyBeforeKill(proc);
  if (!check.stillAlive) return check;
  try {
    await execFileAsync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
      windowsHide: true,
      timeout: 8_000,
    });
  } catch {
    // taskkill 对已退出进程返回非 0；再查一次确认
  }
  const after = await queryProcess(proc.pid);
  if (after && !isPidReuse(proc, after)) {
    return { stillAlive: true, message: "未能结束进程" };
  }
  return { stillAlive: false };
}

/** 退出路径的快照新鲜度：覆盖一轮 5s 对账 + 枚举耗时。 */
const QUIT_SNAPSHOT_MAX_AGE_MS = 15_000;

/** 退出路径的同步枚举（只在没有新鲜快照时兜底；最多阻塞几秒的退出）。 */
function enumerateProcessesSync(): ProcessSnapshot | null {
  try {
    const stdout = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ENUM_SCRIPT],
      {
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    const parsed = parseProcessJson(stdout);
    if (parsed) latestSnapshot = { at: Date.now(), snapshot: parsed };
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 退出批量结束的目标过滤：只留下快照里仍存在、且命令行/启动时间仍匹配的项。
 * 拿不到快照时返回空——宁可不杀，也不误杀 PID 复用后的无关进程。
 */
export function selectSyncKillTargets(
  procs: readonly ManagedProcess[],
  snapshot: ProcessSnapshot | null,
): ManagedProcess[] {
  if (!snapshot) return [];
  return procs.filter((proc) => {
    const actual = snapshot.get(proc.pid) ?? null;
    return actual !== null && !isPidReuse(proc, actual);
  });
}

/**
 * 应用 will-quit 同步批量结束（退出路径不能 await）。
 * 防复用校验优先复用 15s 内的快照；没有就同步枚举一次。快照失败则不杀。
 */
export function killManagedProcessesSync(procs: readonly ManagedProcess[]): number {
  const snapshot = recentProcessSnapshot(QUIT_SNAPSHOT_MAX_AGE_MS) ?? enumerateProcessesSync();
  const targets = selectSyncKillTargets(procs, snapshot);
  if (snapshot === null && procs.length > 0) {
    console.warn("[proc] 退出前无法校验后台进程，已跳过结束操作");
  }
  let stopped = 0;
  for (const proc of targets) {
    try {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
        windowsHide: true,
        timeout: 3_000,
      });
      stopped += 1;
    } catch {
      // 已退出或权限不足：忽略，继续下一条
    }
  }
  return stopped;
}
