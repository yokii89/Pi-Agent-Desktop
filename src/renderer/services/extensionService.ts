import type {
  ExtensionPushMessage,
  PiPackageInstallRequest,
  PiPackageRemoveRequest,
  PiPackageSetEnabledRequest,
  PiPackageSetResourceEnabledRequest,
  PiPackagesSnapshot,
} from "../../shared/ipc";
import { unwrap } from "./ipc";

function api() {
  const a = window.pidesk?.extension;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

/** 扩展页与 pi packages 的渲染层服务。 */
export const extensionService = {
  async list(projectDir?: string | null): Promise<PiPackagesSnapshot> {
    return unwrap(api().list(projectDir));
  },
  async install(req: PiPackageInstallRequest): Promise<void> {
    await unwrap(api().install(req));
  },
  async remove(req: PiPackageRemoveRequest): Promise<void> {
    await unwrap(api().remove(req));
  },
  async setEnabled(req: PiPackageSetEnabledRequest): Promise<void> {
    await unwrap(api().setEnabled(req));
  },
  async setResourceEnabled(req: PiPackageSetResourceEnabledRequest): Promise<void> {
    await unwrap(api().setResourceEnabled(req));
  },
  onOutput(callback: (message: ExtensionPushMessage) => void): () => void {
    return api().onOutput(callback);
  },
};
