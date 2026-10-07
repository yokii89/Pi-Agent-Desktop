import type { IpcResult } from "../../shared/ipc";

/**
 * 统一信封包装：handler 逻辑抛错时转换为 { ok: false, error }，
 * 禁止向渲染层直接 throw。
 */
export function envelope<T>(fn: () => T): IpcResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 异步版 envelope：用于 handler 内需要 await（对话框、子进程等）的场景。 */
export async function envelopeAsync<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
