/**
 * Extension Worker 管理器（docs/design/16 Phase F / §9）。
 *
 * ## Spike 结论（选择性加载）
 * pi CLI **支持**按路径加载扩展、并关闭包发现：
 *   `--no-extensions` / `-ne`  禁用扩展发现（显式 `-e` 仍生效）
 *   `--extension` / `-e <path>`  加载指定扩展文件（可多次）
 * 因此 Worker 使用真正的选择性边界，而不是环境变量约定：
 *   `pi --mode rpc --no-session -ne --no-skills -np -ns --no-themes -e <worker-safe...>`
 * 若上游去掉 `-ne`/`-e`，本模块将 selectiveLoadSupported=false，
 * settings 只展示静态 Catalog + 诊断，**不**全量执行扩展。
 *
 * 生命周期：单实例 + lease 引用计数 + 宽限退出；不计入 maxParallelSessions。
 * auth 标记 role=worker；View Host 拒绝其 access-mode / session widget。
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ExtensionWorkerStatus, WorkerAcquireResult } from "../../shared/contribution";
import { RUNTIME_READY_TIMEOUT_MS, WORKER_GRACE_EXIT_MS } from "../../shared/contribution";
import { resolvePiCommand } from "../session/piLauncher";
import { getSettings } from "../settings/settings";
import { closeSessionViews, ensureViewHost, getViewHostRendezvousPath } from "../view/viewHost";
import { getCatalogSnapshot } from "./contributionCatalog";
import { buildWorkerArgs } from "./extensionWorkerArgs";
import { listWorkerSafeExtensionPaths } from "./workerSafe";

/** Worker 连接在 View Host 上的会话归属（非用户 SessionId）。 */
export const WORKER_SESSION_ID = "__extension_worker__";

/** pi 选择性加载能力探测结果。 */
export const WORKER_SELECTIVE_LOAD = {
  /** `-ne` + `-e` 已在本机 pi --help 验证。 */
  supported: true,
  evidence: "pi --help: --no-extensions/-ne; --extension/-e <path>",
} as const;

interface WorkerState {
  child: ChildProcessWithoutNullStreams | null;
  ready: boolean;
  leases: number;
  generation: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  nextRequestId: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  errorMessage?: string;
  extensionPaths: string[];
  starting: Promise<void> | null;
}

const state: WorkerState = {
  child: null,
  ready: false,
  leases: 0,
  generation: 0,
  pending: new Map(),
  nextRequestId: 0,
  graceTimer: null,
  extensionPaths: [],
  starting: null,
};

let stopping: Promise<void> = Promise.resolve();
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let restartAttempts = 0;

function scheduleRestart(): void {
  if (!state.leases || restartTimer || restartAttempts >= 3) return;
  restartAttempts += 1;
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    if (state.leases) void startWorker().catch(() => scheduleRestart());
  }, 1000 * restartAttempts);
  restartTimer.unref?.();
}

function pushWorkerLog(line: string): void {
  // 开发日志：与 Session pi 的 stderr 分开展示（设计 §9.6）
  console.warn(`[ExtensionWorker] ${line.slice(0, 500)}`);
}

function request(method: string, fields: Record<string, unknown> = {}): Promise<unknown> {
  const child = state.child;
  if (!child) {
    return Promise.reject(new Error("Extension Worker 未就绪"));
  }
  const id = ++state.nextRequestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      reject(new Error("Extension Worker RPC ready 超时"));
    }, RUNTIME_READY_TIMEOUT_MS);
    state.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      child.stdin.write(`${JSON.stringify({ type: method, ...fields, id })}\n`);
    } catch (err) {
      clearTimeout(timer);
      state.pending.delete(id);
      reject(err instanceof Error ? err : new Error("Worker stdin 写入失败"));
    }
  });
}

function buildArgs(extensionPaths: string[]): string[] {
  if (!WORKER_SELECTIVE_LOAD.supported) {
    // 上游不支持选择性加载时：不启动动态 Worker（由 status 暴露）
    throw new Error("当前 pi 不支持选择性扩展加载，Extension Worker 已禁用");
  }
  return buildWorkerArgs(extensionPaths);
}

async function bindWorkerIO(
  child: ChildProcessWithoutNullStreams,
  generation: number,
): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let lineBuffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    if (state.generation !== generation || state.child !== child) return;
    lineBuffer += decoder.write(chunk);
    let nl = lineBuffer.indexOf("\n");
    while (nl !== -1) {
      const line = lineBuffer.slice(0, nl).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(nl + 1);
      nl = lineBuffer.indexOf("\n");
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const rec = parsed as { type?: unknown; id?: unknown };
      if (rec.type === "response") {
        const id = typeof rec.id === "number" ? rec.id : -1;
        const pending = state.pending.get(id);
        if (!pending) continue;
        state.pending.delete(id);
        const body = parsed as { success?: unknown; data?: unknown; error?: unknown };
        if (body.success === true) pending.resolve(body.data);
        else {
          pending.reject(
            new Error(typeof body.error === "string" ? body.error : "Worker 请求失败"),
          );
        }
      }
    }
  });

  const stderrDecoder = new StringDecoder("utf8");
  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    if (state.generation !== generation) return;
    stderrBuf += stderrDecoder.write(chunk);
    let nl = stderrBuf.indexOf("\n");
    while (nl !== -1) {
      const line = stderrBuf.slice(0, nl).trim();
      stderrBuf = stderrBuf.slice(nl + 1);
      nl = stderrBuf.indexOf("\n");
      if (line) pushWorkerLog(line);
    }
  });

  child.on("error", (error) => {
    if (state.child !== child) return;
    state.errorMessage = error.message;
    for (const pending of state.pending.values()) pending.reject(error);
    state.pending.clear();
  });
  child.on("exit", () => {
    if (state.generation !== generation || state.child !== child) return;
    state.child = null;
    state.ready = false;
    for (const pending of state.pending.values()) {
      pending.reject(new Error("Extension Worker 已退出"));
    }
    state.pending.clear();
    closeSessionViews(WORKER_SESSION_ID, "session", true);
    state.errorMessage = "扩展设置进程已退出";
    scheduleRestart();
  });

  const response = await request("get_state");
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error("Worker 返回无效状态");
  if (state.child !== child || state.generation !== generation) throw new Error("Worker 已替换");
  state.ready = true;
}

async function startWorker(): Promise<void> {
  if (state.child && state.ready) return;
  if (state.starting) return state.starting;

  const run = (async () => {
    const requestedGeneration = state.generation;
    await stopping;
    if (state.leases === 0 || state.generation !== requestedGeneration) return;
    if (!WORKER_SELECTIVE_LOAD.supported) {
      state.errorMessage = "pi 不支持选择性扩展加载";
      throw new Error(state.errorMessage);
    }
    const extensionPaths = listWorkerSafeExtensionPaths(null);
    state.extensionPaths = extensionPaths;
    if (extensionPaths.length === 0) return;

    const cmd = resolvePiCommand(getSettings().piExecutablePath);
    const args = buildArgs(extensionPaths);
    // wrapCommand 已把 shim 包进 cmd.exe 时 file/args 已就绪
    const fullArgs = [...cmd.args, ...args];

    let viewEnv: Awaited<ReturnType<typeof ensureViewHost>> | null = null;
    try {
      viewEnv = await ensureViewHost();
    } catch {
      viewEnv = null;
    }
    if (state.leases === 0 || state.generation !== requestedGeneration) return;

    const env: NodeJS.ProcessEnv = { ...process.env };
    const keys = Object.fromEntries(
      getCatalogSnapshot(null)
        .entries.filter((entry) => entry.workerSafe && entry.placement === "settings")
        .map((entry) => [entry.id, entry.key]),
    );
    env.PIDESK_VIEW_CONTRIBUTION_KEYS = JSON.stringify(keys);
    env.PI_VIEW_CONTRIBUTION_KEYS = env.PIDESK_VIEW_CONTRIBUTION_KEYS;
    if (viewEnv) {
      const rendezvous = viewEnv.rendezvousPath ?? getViewHostRendezvousPath();
      env.PIDESK_VIEW_ENDPOINT = viewEnv.endpoint;
      env.PIDESK_VIEW_TOKEN = viewEnv.token;
      env.PIDESK_VIEW_PROTOCOL = viewEnv.protocol;
      env.PIDESK_VIEW_SESSION = WORKER_SESSION_ID;
      env.PIDESK_VIEW_ROLE = "worker";
      env.PIDESK_VIEW_RENDEZVOUS = rendezvous;
      env.PI_VIEW_ENDPOINT = viewEnv.endpoint;
      env.PI_VIEW_TOKEN = viewEnv.token;
      env.PI_VIEW_PROTOCOL = viewEnv.protocol;
      env.PI_VIEW_SESSION = WORKER_SESSION_ID;
      env.PI_VIEW_ROLE = "worker";
      env.PI_VIEW_RENDEZVOUS = rendezvous;
    }

    state.generation += 1;
    const generation = state.generation;
    state.ready = false;
    state.errorMessage = undefined;
    const child = spawn(cmd.file, fullArgs, {
      cwd: process.env.USERPROFILE || process.cwd(),
      env,
      windowsHide: true,
    });
    state.child = child;
    try {
      await bindWorkerIO(child, generation);
      state.errorMessage = undefined;
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
      try {
        child.kill();
      } catch {
        // ignore
      }
      if (state.child === child) {
        state.child = null;
        state.ready = false;
      }
      throw err;
    }
  })().finally(() => {
    if (state.starting === run) state.starting = null;
  });

  state.starting = run;
  return run;
}

function clearGraceTimer(): void {
  if (state.graceTimer) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }
}

function scheduleGraceExit(): void {
  clearGraceTimer();
  state.graceTimer = setTimeout(() => {
    state.graceTimer = null;
    if (state.leases > 0) return;
    disposeWorker();
  }, WORKER_GRACE_EXIT_MS);
  state.graceTimer.unref?.();
}

function disposeWorker(): void {
  clearGraceTimer();
  clearTimeout(restartTimer);
  restartTimer = undefined;
  state.generation += 1;
  const child = state.child;
  state.child = null;
  state.ready = false;
  state.starting = null;
  for (const pending of state.pending.values()) {
    pending.reject(new Error("Extension Worker 已释放"));
  }
  state.pending.clear();
  closeSessionViews(WORKER_SESSION_ID, "session", true);
  if (!child) return;
  stopping = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => child.kill(), 2000);
    timer.unref?.();
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    child.stdin.end();
  } catch {
    // ignore
  }
}

export function getWorkerStatus(): ExtensionWorkerStatus {
  return {
    running: state.child !== null,
    ready: state.ready,
    leases: state.leases,
    graceExitScheduled: state.graceTimer !== null,
    workerSafeExtensionCount: state.extensionPaths.length,
    selectiveLoadSupported: WORKER_SELECTIVE_LOAD.supported,
    extensionPaths: [...state.extensionPaths],
    errorMessage: state.errorMessage,
  };
}

/**
 * 获取 lease；必要时启动 Worker。
 * 失败时仍返回 status（含 errorMessage），不抛到渲染层崩溃边界。
 */
export async function acquireWorkerLease(): Promise<WorkerAcquireResult> {
  clearGraceTimer();
  if (state.leases === 0) restartAttempts = 0;
  state.leases += 1;
  if (!WORKER_SELECTIVE_LOAD.supported) {
    state.leases = Math.max(0, state.leases - 1);
    return {
      status: {
        ...getWorkerStatus(),
        errorMessage: "pi 不支持选择性扩展加载，设置页仅展示静态入口",
      },
    };
  }
  try {
    await startWorker();
  } catch (err) {
    state.errorMessage = err instanceof Error ? err.message : String(err);
  }
  return { status: getWorkerStatus() };
}

export function releaseWorkerLease(): ExtensionWorkerStatus {
  state.leases = Math.max(0, state.leases - 1);
  if (state.leases === 0) {
    scheduleGraceExit();
  }
  return getWorkerStatus();
}

/** 扩展变更后：无 busy action 时重启 Worker（settings 仍持 lease 时）。 */
export async function reloadWorkerForExtensionChange(): Promise<ExtensionWorkerStatus> {
  if (state.leases === 0 && !state.child) return getWorkerStatus();
  disposeWorker();
  if (state.leases > 0) {
    try {
      await startWorker();
    } catch (err) {
      state.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }
  return getWorkerStatus();
}

/** 应用退出清理。 */
export function disposeExtensionWorker(): void {
  state.leases = 0;
  disposeWorker();
}

/** 测试用。 */
export function __resetWorkerForTests(): void {
  state.leases = 0;
  disposeWorker();
  state.extensionPaths = [];
  state.errorMessage = undefined;
}
