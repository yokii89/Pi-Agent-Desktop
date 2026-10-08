import type { IpcResult } from "../../shared/ipc";

/**
 * 解包 IPC 统一信封：ok=false 时抛出携带 error 的异常。
 * 所有经 invoke 返回的 pidesk IPC 都应通过本函数解包。
 */
export async function unwrap<T>(call: Promise<IpcResult<T>>): Promise<T> {
  const result = await call;
  if (!result.ok) {
    throw Object.assign(new Error(result.error ?? "IPC 调用失败"), {
      details: result.errorDetails,
    });
  }
  return result.data as T;
}
