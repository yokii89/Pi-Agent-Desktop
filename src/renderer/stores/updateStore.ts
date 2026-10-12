import { useSyncExternalStore } from "react";
import type { UpdateStatus } from "../../shared/update";
import { updateService } from "../services/updateService";

/**
 * 更新状态的轻量外部存储（docs/design/35）：
 * 设置导航角标、About 面板与侧栏更新按钮共用，不进 uiStore，避免设置域膨胀。
 */
let status: UpdateStatus = { state: "idle" };
/**
 * 最近一次「有更新」能否就地安装；null = 本次运行从未发现过更新。
 *
 * 必须存这里而不是组件 state：侧栏按钮在折叠/展开时会被卸载重建，About 面板在
 * 设置浮窗关闭时同理，而 `error` 态已经离开 `available`，状态里不再带 canInstall。
 */
let offerCanInstall: boolean | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const updateStore = {
  get(): UpdateStatus {
    return status;
  },
  /** 供给记忆；与 `get()` 在同一次 `set` 里更新，渲染期一起读不会读到错配。 */
  getOfferCanInstall(): boolean | null {
    return offerCanInstall;
  },
  set(next: UpdateStatus): void {
    if (next.state === "available") offerCanInstall = next.canInstall;
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
