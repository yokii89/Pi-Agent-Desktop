import type { WindowCloseDecision, WindowCloseRequest } from "../../shared/windowClose";

interface ClosePromptCallbacks {
  request: (id: number, kind: WindowCloseRequest["kind"]) => void;
  settled: (id: number) => void;
  execute: (decision: WindowCloseDecision) => void;
  fallback: (kind: WindowCloseRequest["kind"]) => void;
}

/** 关闭握手：重复请求合并、只对显示回执计时，旧请求不能影响新请求。 */
export class ClosePromptProtocol {
  private sequence = 0;
  private pending: { id: number; kind: WindowCloseRequest["kind"] } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly callbacks: ClosePromptCallbacks) {}

  /** 即使设置在询问期间变化，也不得绕过当前决策。 */
  get isPending(): boolean {
    return this.pending !== null;
  }

  /** 请求一次询问；进程退出询问可接管尚未完成的普通关窗询问。 */
  request(kind: WindowCloseRequest["kind"] = "window"): void {
    if (this.pending !== null) {
      if (this.pending.kind === kind || kind === "window") return;
      this.finish();
    }
    const id = ++this.sequence;
    this.pending = { id, kind };
    this.timer = setTimeout(() => this.fail(), 2_000);
    try {
      this.callbacks.request(id, kind);
    } catch {
      this.fail();
    }
  }

  /** 界面挂载后停止超时，保留 pending 等待用户。 */
  ready(id: unknown): void {
    if (id !== this.pending?.id) return;
    this.clearTimer();
  }

  /** 非法动作按取消处理；只接受当前请求的一次应答。 */
  decide(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const decision = raw as {
      id?: unknown;
      kind?: unknown;
      action?: unknown;
      remember?: unknown;
    };
    const pending = this.pending;
    if (!pending || decision.id !== pending.id || decision.kind !== pending.kind) return;

    if (pending.kind === "window") {
      const action =
        decision.action === "tray" || decision.action === "quit" ? decision.action : "cancel";
      this.callbacks.execute({
        kind: "window",
        id: pending.id,
        action,
        remember: decision.remember === true,
      });
    } else {
      const action =
        decision.action === "kill" || decision.action === "keep" ? decision.action : "cancel";
      this.callbacks.execute({ kind: "process-quit", id: pending.id, action });
    }
    // 执行失败时仍保留询问，允许用户改选或取消。
    this.finish();
  }

  /** 渲染层重载/崩溃时收尾，避免已回 ready 的询问永久挂起。 */
  fail(): void {
    if (this.pending === null) return;
    const kind = this.pending.kind;
    this.finish();
    this.callbacks.fallback(kind);
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
    const id = this.pending?.id;
    this.dispose();
    if (id !== undefined) this.callbacks.settled(id);
  }
}
