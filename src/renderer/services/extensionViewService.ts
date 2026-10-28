import type { ExtensionViewPush, ViewEvent } from "../../shared/view";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

let pushListenersBound = false;
const pushListeners = new Set<(message: ExtensionViewPush) => void>();

function ensureBound(): void {
  const api = pideskApi();
  if (pushListenersBound || !api) return;
  pushListenersBound = true;
  api.view.onOutput((message) => {
    for (const listener of pushListeners) listener(message);
  });
}

/** 扩展 View 协议渲染层服务（docs/design/08）。 */
export const extensionViewService = {
  subscribe(listener: (message: ExtensionViewPush) => void): () => void {
    ensureBound();
    pushListeners.add(listener);
    return () => {
      pushListeners.delete(listener);
    };
  },
  sendEvent(id: string, event: ViewEvent): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.view.sendEvent({ id, event })).then(() => undefined);
  },
  /**
   * 面板内容盒尺寸回传（docs/06 R5）。失败只说明视图已关闭或连接断开，
   * 下一次观察会重试，不向 UI 冒错。
   */
  reportLayout(id: string, width: number, height?: number): void {
    const api = pideskApi();
    if (!api) return;
    void unwrap(api.view.reportLayout({ id, width, height })).catch(() => {});
  },
};
