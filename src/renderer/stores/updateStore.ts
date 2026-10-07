import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "../../shared/update";
import { updateService } from "../services/updateService";

/**
 * 更新状态的轻量外部存储（docs/design/35）：
 * 设置导航角标与 About 面板共用，不进 uiStore，避免设置域膨胀。
 */
let status: UpdateStatus = { state: "idle" };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const updateStore = {
  get(): UpdateStatus {
    return status;
  },
  set(next: UpdateStatus): void {
    status = next;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** 订阅主进程推送并保持快照一致；在应用根挂载一次即可。 */
export function useUpdateStatus(): UpdateStatus {
  return useSyncExternalStore(updateStore.subscribe, updateStore.get);
}

/**
 * 接线主进程状态推送 + 拉一次快照对账。
 * 需在渲染层启动时调用一次（App 根组件）。
 *
 * 顺序：先订阅再取快照。若快照 resolve 前已收到推送，忽略陈旧快照，
 * 避免 getStatus 把刚 push 的 available/downloading 打回旧值。
 */
export function bindUpdateStatusStream(): () => void {
  let receivedPush = false;
  const unsubscribe = updateService.onStatus((next) => {
    receivedPush = true;
    updateStore.set(next);
  });
  void updateService
    .getStatus()
    .then((snapshot) => {
      if (!receivedPush) updateStore.set(snapshot);
    })
    .catch(() => {});
  return unsubscribe;
}
