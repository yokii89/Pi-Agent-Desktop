import type { PideskSettings } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 用户设置读写（userData/settings.json，主进程集中管理）。 */
export const settingsService = {
  get(): Promise<PideskSettings | null> {
    const api = pideskApi();
    return api ? unwrap(api.settings.get()).catch(() => null) : Promise.resolve(null);
  },
  /** 合并更新设置，失败时静默（UI 不因持久化失败打崩）。 */
  set(patch: Partial<PideskSettings>): Promise<PideskSettings | null> {
    const api = pideskApi();
    return api ? unwrap(api.settings.set(patch)).catch(() => null) : Promise.resolve(null);
  },
};
