import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { ProcessOrigin } from "../../shared/ipc";

/**
 * 后台进程登记项落盘（userData/managed-processes.json），实现 docs/design/37 §5.4 P1。
 *
 * 放 settings 模块而不是 proc/ 目录：AGENTS.md 数据持久化条款要求集中收口，禁止业务代码
 * 散落 fs.writeFile。不并入 settings.json——登记项随进程生命周期变化，写频率远高于用户设置。
 *
 * 只用于「重启后把还活着的进程重新认回来」：条目按来源会话 JSONL 路径归属，启动时逐个做
 * 防 PID 复用校验（见 procService.adoptSurvivors），校验不过就当它不存在。
 */

const PROC_REGISTRY_FILENAME = "managed-processes.json";
const FILE_VERSION = 1;

/** 一条待收养的登记项。`sessionFile` 是归属锚点：会话 id 每次启动都换，JSONL 路径不换。 */
export interface PersistedProc {
  sessionFile: string;
  pid: number;
  ppid: number;
  name: string;
  commandLine: string;
  startedAt: number;
  registeredAt: number;
  origin: ProcessOrigin;
}

/** 用户点过「忽略」的项：重开后不重新出现在列表里（否则忽略按钮形同失效）。 */
export interface PersistedIgnored {
  sessionFile: string;
  pid: number;
  commandLine: string;
  startedAt: number;
}

export interface ProcRegistryFile {
  version: number;
  entries: PersistedProc[];
  ignored: PersistedIgnored[];
}

/** 忽略项的身份键：同一会话里 pid + 创建时间唯一确定一个进程。 */
export function procIdentity(sessionFile: string, pid: number, startedAt: number): string {
  return `${sessionFile}|${pid}|${startedAt}`;
}

function filePath(): string {
  return path.join(app.getPath("userData"), PROC_REGISTRY_FILENAME);
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 单条收成合法形态；缺归属会话或缺 pid 的条目不可用，返回 null 由调用方丢弃。 */
function normalizeEntry(raw: unknown): PersistedProc | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sessionFile = asText(record.sessionFile);
  const pid = asNumber(record.pid);
  if (!sessionFile || pid <= 0) return null;
  return {
    sessionFile,
    pid,
    ppid: asNumber(record.ppid),
    name: asText(record.name),
    commandLine: asText(record.commandLine),
    startedAt: asNumber(record.startedAt),
    registeredAt: asNumber(record.registeredAt),
    origin: record.origin === "job" ? "job" : "service",
  };
}

function normalizeIgnored(raw: unknown): PersistedIgnored | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sessionFile = asText(record.sessionFile);
  const pid = asNumber(record.pid);
  if (!sessionFile || pid <= 0) return null;
  return {
    sessionFile,
    pid,
    commandLine: asText(record.commandLine),
    startedAt: asNumber(record.startedAt),
  };
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 读失败或字段损坏一律回退空表（console.warn），不让进程域因脏文件拒启动。 */
export function loadProcRegistry(envFile = filePath()): ProcRegistryFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(envFile, "utf8"));
    if (!parsed || typeof parsed !== "object")
      return { version: FILE_VERSION, entries: [], ignored: [] };
    const record = parsed as Record<string, unknown>;
    return {
      version: FILE_VERSION,
      entries: asList(record.entries)
        .map(normalizeEntry)
        .filter((entry): entry is PersistedProc => entry !== null),
      ignored: asList(record.ignored)
        .map(normalizeIgnored)
        .filter((ignored): ignored is PersistedIgnored => ignored !== null),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn("[proc] managed-processes.json 读取失败，按空登记表处理", error);
    }
    return { version: FILE_VERSION, entries: [], ignored: [] };
  }
}

/** 写失败只记日志：登记表的真相在内存与系统进程里，落盘只是重启的线索。 */
export function saveProcRegistry(snapshot: ProcRegistryFile, envFile = filePath()): void {
  try {
    fs.writeFileSync(
      envFile,
      JSON.stringify({ ...snapshot, version: FILE_VERSION }, null, 2),
      "utf8",
    );
  } catch (error) {
    console.warn("[proc] managed-processes.json 写入失败", error);
  }
}
