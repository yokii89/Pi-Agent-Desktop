import type { WindowCloseDecision } from "../../shared/windowClose";

interface ClosePromptCallbacks {
  request: (id: number) => void;
  settled: (id: number) => void;
  execute: (action: WindowCloseDecision["action"], remember: boolean) => void;
  fallback: () => void;
}

/** 关闭握手：重复关闭合并、只对显示回执计时，旧请求不能影响新请求。 */
export class ClosePromptProtocol {
  private sequence = 0;
  private pending: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly callbacks: ClosePromptCallbacks) {}

  /** 即使设置在询问期间变化，也不得绕过当前决策。 */
  get isPending(): boolean {
    return this.pending !== null;
  }

  /** 请求一次询问，已有询问时保持原请求。 */
  request(): void {
    if (this.pending !== null) return;
    const id = ++this.sequence;
    this.pending = id;
    this.timer = setTimeout(() => this.fail(), 2_000);
    try {
      this.callbacks.request(id);
    } catch {
      this.fail();
    }
  }

  /** 界面挂载后停止超时，保留 pending 等待用户。 */
  ready(id: unknown): void {
    if (id !== this.pending || this.pending === null) return;
    this.clearTimer();
  }

  /** 非法动作按取消处理；只接受当前请求的一次应答。 */
  decide(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const decision = raw as Partial<WindowCloseDecision>;
    if (this.pending === null || decision.id !== this.pending) return;
    const action =
      decision.action === "tray" || decision.action === "quit" ? decision.action : "cancel";
    // 执行失败时仍保留询问，允许用户改选或取消。
    this.callbacks.execute(action, decision.remember === true);
    this.finish();
  }

  /** 渲染层重载/崩溃时收尾，避免已回 ready 的询问永久挂起。 */
  fail(): void {
    if (this.pending === null) return;
    this.finish();
    this.callbacks.fallback();
  }

  /** 窗口销毁时仅清理状态，不再触发关闭动作。 */
  dispose(): void {
    this.clearTimer();
    this.pending = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private finish(): void {
    const id = this.pending;
    this.dispose();
    if (id !== null) this.callbacks.settled(id);
  }
}
