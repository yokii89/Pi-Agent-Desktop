import type { WebContents } from "electron";

/**
 * 浏览器面板的 CDP 访问收敛点（docs/design/05 §7.3 的「最小 CDP 域」边界）：
 * 拾取（browserPick）与检查器（inspector）共用同一份 debugger 会话，
 * 因此这里只提供「发起命令」这一件事，**不负责 attach / detach**
 * —— debugger 的挂载状态由 browserPick 单点持有，避免两个模块各自 attach 互相抢占。
 */

/** 发送一条 CDP 命令。debugger 未挂载时抛错（调用方按失效处理）。 */
export async function sendCommand<T>(
  wc: WebContents,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!wc.debugger.isAttached()) throw new Error("CDP 会话未开启");
  return (await wc.debugger.sendCommand(method, params)) as T;
}
