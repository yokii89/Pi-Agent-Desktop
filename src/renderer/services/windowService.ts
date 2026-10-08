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
