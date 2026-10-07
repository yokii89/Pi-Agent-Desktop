import type { InspectorFloatHandoff, InspectorFloatStateMessage } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/**
 * 检查器系统级浮窗服务（docs/design/38）：打开/停靠/聚焦 + handoff 移交 + 加入对话意图。
 */
export const inspectorFloatService = {
  open(handoff?: InspectorFloatHandoff | null): Promise<boolean> {
    const api = pideskApi();
    if (!api) return Promise.resolve(false);
    return unwrap(api.inspectorFloat.open(handoff ?? null));
  },
  dock(handoff?: InspectorFloatHandoff | null): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.inspectorFloat.dock(handoff ?? null)).then(() => undefined);
  },
  /** 主窗占位条：让浮窗自己交草稿并停靠。 */
  requestDock(): Promise<boolean> {
    const api = pideskApi();
    if (!api) return Promise.resolve(false);
    return unwrap(api.inspectorFloat.requestDock());
  },
  focus(): Promise<boolean> {
    const api = pideskApi();
    if (!api) return Promise.resolve(false);
    return unwrap(api.inspectorFloat.focus());
  },
  takeHandoff(): Promise<InspectorFloatHandoff | null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.inspectorFloat.takeHandoff());
  },
  returnHandoff(handoff: InspectorFloatHandoff | null): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.inspectorFloat.returnHandoff(handoff)).then(() => undefined);
  },
  onRequestReturn(callback: () => void): () => void {
    const api = pideskApi();
    if (!api) return () => {};
    return api.inspectorFloat.onRequestReturn(callback);
  },
  onRequestDock(callback: () => void): () => void {
    const api = pideskApi();
    if (!api) return () => {};
    return api.inspectorFloat.onRequestDock(callback);
  },
  chatAdd(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.inspectorFloat.chatAdd()).then(() => undefined);
  },
  onState(callback: (message: InspectorFloatStateMessage) => void): () => void {
    const api = pideskApi();
    if (!api) return () => {};
    return api.inspectorFloat.onState(callback);
  },
};
