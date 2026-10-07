import type { PiInfo, PiShellProbe } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** pi 信息（版本 + 配置的默认模型），只读。 */
export const piService = {
  /** path 为空时按当前设置解析；用于设置页校验候选路径。 */
  info(path?: string | null): Promise<PiInfo | null> {
    const api = pideskApi();
    return api ? unwrap(api.pi.info(path)).catch(() => null) : Promise.resolve(null);
  },
  shell: {
    /** 探测 pi 将使用的 bash；失败返回 null。 */
    get(): Promise<PiShellProbe | null> {
      const api = pideskApi();
      return api ? unwrap(api.pi.shell.get()).catch(() => null) : Promise.resolve(null);
    },
    /** 写入 / 清除 pi 的 shellPath；ok=false 时抛错（携带 error），供调用方 toast。 */
    set(path: string | null): Promise<PiShellProbe | null> {
      const api = pideskApi();
      return api ? unwrap(api.pi.shell.set(path)) : Promise.reject(new Error("preload 未就绪"));
    },
  },
};
