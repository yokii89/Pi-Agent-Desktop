import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 系统剪贴板写入与原生粘贴。文本复制仍走 navigator.clipboard。 */
export const clipboardService = {
  /** 在调用方聚焦输入框后执行系统粘贴，内容由输入框的 paste 事件接收。 */
  async paste(): Promise<void> {
    const api = pideskApi();
    if (!api) throw new Error("预加载 API 不可用");
    await unwrap(api.clipboard.paste());
  },
  /** 把后台渲染好的 PNG 写入系统剪贴板；无预加载 API 时抛出可展示错误。 */
  async writeImageDataUrl(dataUrl: string): Promise<void> {
    const api = pideskApi();
    if (!api) throw new Error("预加载 API 不可用");
    await unwrap(api.clipboard.writeImage(dataUrl));
  },
};
