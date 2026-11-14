/** null 表示尚未询问后台进程的退出策略。 */
let policy: "kill" | "keep" | null = null;

/** 读取本次应用退出的后台进程策略。 */
export function getQuitProcPolicy(): "kill" | "keep" | null {
  return policy;
}

/** 关闭询问已解释进程处置代价时，跳过第二次原生确认。 */
export function setQuitProcPolicy(next: "kill" | "keep"): void {
  policy = next;
}
