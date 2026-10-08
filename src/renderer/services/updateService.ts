import type { UpdateStatus } from "../../shared/update";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 应用更新 IPC 封装（docs/design/35）；错误向上抛，调用方决定 toast / 状态展示。 */
export const updateService = {
  getVersion(): Promise<string> {
    const api = pideskApi();
    return api ? unwrap(api.update.getVersion()) : Promise.resolve("0.0.0-dev");
  },
  check(): Promise<UpdateStatus> {
    const api = pideskApi();
    return api
      ? unwrap(api.update.check())
      : Promise.resolve({ state: "error", message: "preload not ready" });
  },
  download(): Promise<UpdateStatus> {
    const api = pideskApi();
    return api
      ? unwrap(api.update.download())
      : Promise.resolve({ state: "error", message: "preload not ready" });
  },
  install(): Promise<void> {
    const api = pideskApi();
    return api ? unwrap(api.update.install()).then(() => undefined) : Promise.resolve();
  },
  getStatus(): Promise<UpdateStatus> {
    const api = pideskApi();
    return api ? unwrap(api.update.getStatus()) : Promise.resolve({ state: "idle" as const });
  },
  onStatus(callback: (status: UpdateStatus) => void): () => void {
    const api = pideskApi();
    return api ? api.update.onStatus(callback) : () => {};
  },
};
