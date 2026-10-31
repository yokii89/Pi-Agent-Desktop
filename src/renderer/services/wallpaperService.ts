import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 本地壁纸：系统文件选择器（图片 / 视频）；取消或 preload 缺失时返回 null。 */
export const wallpaperService = {
  pick(): Promise<string | null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.wallpaper.pick()).catch(() => null);
  },
};
