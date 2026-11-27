/** null 表示尚未询问后台进程的退出策略。 */
let policy: "kill" | "keep" | null = null;

/** 读取本次应用退出的后台进程策略。 */
export function getQuitProcPolicy(): "kill" | "keep" | null {
  return policy;
}

/** 退出询问已包含进程处置选择时，跳过重复确认。 */
export function setQuitProcPolicy(next: "kill" | "keep"): void {
  policy = next;
}
