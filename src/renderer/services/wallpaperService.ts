import { t } from "../../shared/i18n";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 本地壁纸：取消返回 null；选择或保存失败交给界面明确提示。 */
export const wallpaperService = {
  async pick(): Promise<string | null> {
    const api = pideskApi();
    if (!api) throw new Error(t("settings.personalization.wallpaper.unavailable"));
    return unwrap(api.wallpaper.pick());
  },
  /** 先写入主进程设置，再切换渲染源，避免媒体协议仍读到上一张壁纸。 */
  async save(path: string | null): Promise<string | null> {
    const api = pideskApi();
    if (!api) throw new Error(t("settings.personalization.wallpaper.unavailable"));
    const settings = await unwrap(api.settings.set({ wallpaperPath: path }));
    if (settings.wallpaperPath !== path) {
      throw new Error(t("settings.personalization.wallpaper.invalidPath"));
    }
    return settings.wallpaperPath;
  },
};
