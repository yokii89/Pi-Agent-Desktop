import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import type { McpProbeResult, McpServerReport } from "../../shared/ipc";
import { resolvePiCommand } from "../session/piLauncher";
import { getSettings } from "../settings/settings";

/**
 * `pi mcp list --json` 一次性探测：独立进程连接所有 enabled server 并输出
 * ServerReport[]（对齐 pi extensions/mcp/cli.ts）。RPC 模式没有 MCP 状态查询/推送
 * 命令面（docs/design/39 §1），面板状态全部来自本探测。
 *
 * 连接 server 可能触发 npx 冷启动，比较慢：默认 60s 超时；同一工作目录同一时刻
 * 只允许一个探测进程（single-flight），并发调用共享同一个结果。
 * cwd 传当前项目目录，pi 才能读到项目级 .pi/mcp.json（未信任项目由 note 表达）。
 */

const PROBE_TIMEOUT_MS = 60_000;

let inFlight: { key: string; promise: Promise<McpProbeResult> } | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Windows 下 cmd shim（pi.CMD）→ node → npx 是多层进程树，直接 kill 只死父进程，
 * 会留下占用连接的孤儿；taskkill /T 连带子树（对齐 proc/processKill.ts 的做法）。
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
        windowsHide: true,
        timeout: 5_000,
      });
      return;
    } catch {
      // 进程已退出或权限不足：回落 kill
    }
  }
  try {
    process.kill(pid);
  } catch {
    // 已退出
  }
}

/**
 * pi 已知连接状态（对齐 pi extensions/mcp 的状态机）：白名单外的值兜底为 unknown，
 * 避免 UI 直接把未来新增状态的原样键名暴露成 `mcp.state.<str>`（docs/design/40 优化 13）。
 */
const KNOWN_STATES = new Set([
  "connected",
  "connecting",
  "disconnected",
  "needs-auth",
  "failed",
  "closed",
]);

/** 宽松归一化一条 ServerReport：字段缺失不炸，保持面板可渲染。导出仅供测试。 */
export function normalizeReport(raw: unknown): McpServerReport | null {
  if (!isRecord(raw) || typeof raw.name !== "string") return null;
  return {
    name: raw.name,
    scope: typeof raw.scope === "string" ? raw.scope : "global",
    source: typeof raw.source === "string" ? raw.source : "",
    override: typeof raw.override === "string" ? raw.override : undefined,
    enabled: raw.enabled !== false,
    exposure: typeof raw.exposure === "string" ? raw.exposure : "codemode",
    transport: typeof raw.transport === "string" ? raw.transport : "",
    state: typeof raw.state === "string" && KNOWN_STATES.has(raw.state) ? raw.state : "unknown",
    tools: Array.isArray(raw.tools)
      ? raw.tools.filter((t): t is string => typeof t === "string")
      : [],
    toolExposure: isRecord(raw.toolExposure)
      ? (raw.toolExposure as Record<string, string>)
      : undefined,
    resources: typeof raw.resources === "number" ? raw.resources : undefined,
    resourceTemplates:
      typeof raw.resourceTemplates === "number" ? raw.resourceTemplates : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

function runProbeOnce(cwd: string | null): Promise<McpProbeResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const { file, args } = resolvePiCommand(getSettings().piExecutablePath);
    const child = spawn(file, [...args, "mcp", "list", "--json"], {
      // 目录不存在时退回主进程 cwd（spawn 对非法 cwd 直接报错）
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child.pid);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error("探测 MCP 状态超时（server 连接可能较慢，请稍后重试）")));
    }, PROBE_TIMEOUT_MS);

    const decoder = new StringDecoder("utf8");
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += decoder.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += decoder.write(chunk);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(parseProbeOutput(stdout, stderr));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("pi mcp list 输出解析失败"));
      }
    });
  });
}

/** 解析 `pi mcp list --json` 的 stdout；失败抛错（附 stderr 末尾便于定位）。 */
function parseProbeOutput(stdout: string, stderr: string): McpProbeResult {
  // list --json 总是输出完整 JSON（部分 server 未连接时以退出码 1 表达，不算失败）
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const tail = stderr.trim().split(/\r?\n/).slice(-3).join("\n");
    throw new Error(tail ? `pi mcp list 输出解析失败：${tail}` : "pi mcp list 输出解析失败");
  }
  if (!isRecord(parsed)) throw new Error("pi mcp list 返回了意外结构");
  return {
    servers: Array.isArray(parsed.servers)
      ? parsed.servers.map(normalizeReport).filter((s): s is McpServerReport => s !== null)
      : [],
    errors: Array.isArray(parsed.errors)
      ? parsed.errors.filter((e): e is string => typeof e === "string")
      : [],
    note: typeof parsed.note === "string" ? parsed.note : undefined,
    probedAt: Date.now(),
  };
}

/** 探测当前 MCP 配置的真实连接状态；同 cwd 进行中的探测直接复用。 */
export function probeMcpServers(cwd?: string | null): Promise<McpProbeResult> {
  const key = cwd ?? "";
  if (!inFlight || inFlight.key !== key) {
    inFlight = {
      key,
      promise: runProbeOnce(cwd ?? null).finally(() => {
        if (inFlight?.key === key) inFlight = null;
      }),
    };
  }
  return inFlight.promise;
}
