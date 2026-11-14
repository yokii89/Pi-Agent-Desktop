/** 用户主动选择的关窗行为；旧设置与未知值均回退询问。 */
export type CloseAction = "ask" | "tray" | "quit";

/** 校验持久化与 IPC 中的关窗偏好。 */
export function isCloseAction(value: unknown): value is CloseAction {
  return value === "ask" || value === "tray" || value === "quit";
}

/** 一次关闭询问的主进程快照；id 隔离超时后到达的旧应答。 */
export interface WindowCloseRequest {
  id: number;
  sessions: number;
  terminals: number;
  procs: number;
  trayAvailable: boolean;
}

/** ready 只确认弹窗已挂载，用户作答没有时间限制。 */
export interface WindowCloseDecision {
  id: number;
  action: "cancel" | "tray" | "quit";
  remember: boolean;
}
