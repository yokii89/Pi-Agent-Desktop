import type { WindowCloseDecision, WindowCloseRequest } from "../../shared/windowClose";
import type { PideskGlobalApi } from "../global.d";
import { unwrap } from "./ipc";

function api(): PideskGlobalApi["window"] | null {
  return window.pidesk?.window ?? null;
}

/**
 * 窗口控制（自绘标题栏）。封装 window.pidesk.window，供组件调用。
 * preload 未就绪/加载失败时安全降级，不允许抛错打崩 UI。
 */
export const windowService = {
  minimize(): Promise<void> {
    const w = api();
    return w ? unwrap(w.minimize()).then(() => undefined) : Promise.resolve();
  },
  /** 切换最大化/还原，返回切换后的最大化状态。 */
  toggleMaximize(): Promise<boolean> {
    const w = api();
    return w ? unwrap(w.toggleMaximize()) : Promise.resolve(false);
  },
  close(): Promise<void> {
    const w = api();
    return w ? unwrap(w.close()).then(() => undefined) : Promise.resolve();
  },
  /** 订阅主进程的关窗快照。 */
  onCloseRequest(callback: (request: WindowCloseRequest) => void): () => void {
    return api()?.onCloseRequest(callback) ?? (() => {});
  },
  /** 订阅询问结束，清除超时或重载留下的界面。 */
  onCloseSettled(callback: (id: number) => void): () => void {
    return api()?.onCloseSettled(callback) ?? (() => {});
  },
  /** 确认弹窗已挂载，停止显示回执超时。 */
  closeReady(id: number): Promise<void> {
    const w = api();
    return w ? unwrap(w.closeReady(id)).then(() => undefined) : Promise.resolve();
  },
  /** 提交当前询问的一次选择。 */
  closeDecision(decision: WindowCloseDecision): Promise<void> {
    const w = api();
    return w ? unwrap(w.closeDecision(decision)).then(() => undefined) : Promise.resolve();
  },
  isMaximized(): Promise<boolean> {
    const w = api();
    return w ? unwrap(w.isMaximized()) : Promise.resolve(false);
  },
  /** 订阅最大化状态变化，返回取消订阅函数。 */
  onWindowStateChange(callback: (isMaximized: boolean) => void): () => void {
    const w = api();
    return w ? w.onWindowStateChange(callback) : () => {};
  },
};
