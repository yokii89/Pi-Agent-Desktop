import type { UsageQuery, UsageReport } from "../../shared/usage";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** 用量统计 IPC 封装；失败返回 null（调用方展示空态/错误态）。 */
export const usageService = {
  async query(req: UsageQuery): Promise<UsageReport | null> {
    const api = pideskApi();
    if (!api) return null;
    try {
      return await unwrap(api.usage.query(req));
    } catch {
      return null;
    }
  },
};
