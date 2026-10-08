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
};
