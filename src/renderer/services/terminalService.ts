import type { TerminalPushMessage } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 单终端实例积压缓冲上限（字符数）。 */
const MAX_BACKLOG_CHARS = 512 * 1024;

const backlogs = new Map<string, string>();
const dataListeners = new Map<string, Set<(chunk: string) => void>>();
const exitListeners = new Map<string, Set<(exitCode: number) => void>>();
let bound = false;

function ensureBound(): void {
  const api = pideskApi();
  if (bound || !api) return;
  bound = true;
  api.terminal.onOutput((message: TerminalPushMessage) => {
    const { id, type, payload } = message;
    if (type === "data" && typeof payload === "string") {
      const previous = backlogs.get(id) ?? "";
      backlogs.set(id, (previous + payload).slice(-MAX_BACKLOG_CHARS));
      for (const listener of dataListeners.get(id) ?? []) listener(payload);
    } else if (type === "exit") {
      for (const listener of exitListeners.get(id) ?? []) listener(Number(payload));
      backlogs.delete(id);
      dataListeners.delete(id);
      exitListeners.delete(id);
    }
  });
}

/** 独立终端实例（底部面板，每 Tab 一个 pty）。 */
export const terminalService = {
  create(cwd?: string): Promise<string | null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.terminal.create({ cwd })).catch(() => null);
  },
  write(id: string, data: string): void {
    const api = pideskApi();
    api?.terminal.input(id, data).catch(() => {});
  },
  resize(id: string, cols: number, rows: number): void {
    const api = pideskApi();
    api?.terminal.resize(id, cols, rows).catch(() => {});
  },
  dispose(id: string): void {
    const api = pideskApi();
    backlogs.delete(id);
    dataListeners.delete(id);
    exitListeners.delete(id);
    api?.terminal.dispose(id).catch(() => {});
  },
  /** 订阅指定实例的数据 chunk。 */
  subscribeData(id: string, callback: (chunk: string) => void): () => void {
    ensureBound();
    let listeners = dataListeners.get(id);
    if (!listeners) {
      listeners = new Set();
      dataListeners.set(id, listeners);
    }
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  /** 订阅指定实例的退出事件（关闭确认等场景）。 */
  subscribeExit(id: string, callback: (exitCode: number) => void): () => void {
    ensureBound();
    let listeners = exitListeners.get(id);
    if (!listeners) {
      listeners = new Set();
      exitListeners.set(id, listeners);
    }
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  /** 指定实例的积压输出（挂载 xterm 时回放）。 */
  peekBacklog(id: string): string {
    ensureBound();
    return backlogs.get(id) ?? "";
  },
};
