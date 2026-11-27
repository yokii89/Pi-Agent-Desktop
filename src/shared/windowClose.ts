/** 用户主动选择的关窗行为；旧设置与未知值均回退询问。 */
export type CloseAction = "ask" | "tray" | "quit";

/** 校验持久化与 IPC 中的关窗偏好。 */
export function isCloseAction(value: unknown): value is CloseAction {
  return value === "ask" || value === "tray" || value === "quit";
}

/** 主窗口常规关窗时的询问快照。 */
export interface WindowClosePromptRequest {
  kind: "window";
  id: number;
  sessions: number;
  terminals: number;
  procs: number;
  trayAvailable: boolean;
}

/** 应用退出时处理仍运行后台进程的快照。 */
export interface ProcessQuitRequest {
  kind: "process-quit";
  id: number;
  procs: number;
  commands: Array<{ pid: number; command: string }>;
}

/** 所有关窗与退出流程共用的主进程推送。 */
export type WindowCloseRequest = WindowClosePromptRequest | ProcessQuitRequest;

/** 关闭窗口或应用退出时用户的一次选择。 */
export type WindowCloseDecision =
  | { kind: "window"; id: number; action: "cancel" | "tray" | "quit"; remember: boolean }
  | { kind: "process-quit"; id: number; action: "cancel" | "kill" | "keep" };
