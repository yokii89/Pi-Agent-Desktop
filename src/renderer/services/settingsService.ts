import type { AppIconId } from "../../shared/appIcon";
import type { ApplyAppIconResult, PideskSettings } from "../../shared/ipc";
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
  /**
   * 切换应用图标：主进程一次完成「落盘 + 换窗口/任务栏/托盘 + 同步快捷方式」，
   * 因此不需要重启；失败返回 null，UI 保持原选中。
   */
  applyAppIcon(id: AppIconId): Promise<ApplyAppIconResult | null> {
    const api = pideskApi();
    return api ? unwrap(api.settings.applyAppIcon(id)).catch(() => null) : Promise.resolve(null);
  },
};
