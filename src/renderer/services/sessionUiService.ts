import type { SessionUiPush, SessionUiRespondRequest } from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/**
 * 扩展 UI 子协议的 IPC 封装（docs/design/123）。
 * 渲染层只「收请求 + 作答」；关联 id、写 pi stdin、超时/退出结算全在主进程。
 */
export const sessionUiService = {
  onOutput(callback: (message: SessionUiPush) => void): () => void {
    const api = pideskApi()?.sessionUi;
    if (!api) return () => {};
    return api.onOutput(callback);
  },
  /** 作答；返回 false 表示该请求已被超时 / 会话结束先行结算。 */
  async respond(req: SessionUiRespondRequest): Promise<boolean> {
    const api = pideskApi()?.sessionUi;
    if (!api) return false;
    const result = await unwrap(api.respond(req));
    return result.settled;
  },
};
