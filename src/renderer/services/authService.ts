import type { PiApiKeyProviderOption, PiAuthSnapshot, PiAuthUpsertRequest } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 命名凭据（同 provider 可多条）：读写走主进程，渲染层只见掩码。 */
export const authService = {
  list(): Promise<PiAuthSnapshot | null> {
    const api = pideskApi();
    return api ? unwrap(api.pi.auth.list()).catch(() => null) : Promise.resolve(null);
  },
  listApiKeyProviders(): Promise<PiApiKeyProviderOption[]> {
    const api = pideskApi();
    return api ? unwrap(api.pi.auth.listApiKeyProviders()).catch(() => []) : Promise.resolve([]);
  },
  /** 新增 / 更新命名凭据；失败抛错（携带中文 error），供 toast。 */
  upsert(req: PiAuthUpsertRequest): Promise<PiAuthSnapshot | null> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.pi.auth.upsert(req));
  },
  /** 激活凭据（写入 auth.json 标准键 + pi defaultProvider / defaultModel）。 */
  setActive(id: string): Promise<PiAuthSnapshot | null> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.pi.auth.setActive(id));
  },
  remove(id: string): Promise<PiAuthSnapshot | null> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("preload 未就绪"));
    return unwrap(api.pi.auth.remove(id));
  },
};
