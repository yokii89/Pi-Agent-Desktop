interface RefreshWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** 审阅刷新调度：同一时刻只读一次 Git，期间的新请求合并为一次后续读取。 */
export function createReviewRefreshScheduler(run: () => Promise<void>) {
  let running = false;
  let deadline: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiters: RefreshWaiter[] = [];

  const arm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (running || deadline === null) return;
    timer = setTimeout(start, Math.max(0, deadline - Date.now()));
  };

  const start = (): void => {
    timer = null;
    if (running || deadline === null) return;
    deadline = null;
    running = true;
    const batch = waiters;
    waiters = [];
    // 延后一拍调用，保证同步抛错也进入收尾路径。
    void Promise.resolve()
      .then(run)
      .then(
        () => finish(false),
        (error: unknown) => finish(true, error),
      );
    function finish(failed: boolean, error?: unknown): void {
      running = false;
      for (const waiter of batch) {
        if (failed) waiter.reject(error);
        else waiter.resolve();
      }
      arm();
    }
  };

  const schedule = (delayMs: number): void => {
    const next = Date.now() + delayMs;
    // 后来的事件只能提前截止时间，不能让持续写盘一直饿死刷新。
    deadline = deadline === null ? next : Math.min(deadline, next);
    arm();
  };

  return {
    schedule,
    /** 显式刷新会等待覆盖此次请求的读取完成，包括在途读取之后的补刷。 */
    refresh(): Promise<void> {
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
        schedule(0);
      });
    },
    /** 换域时撤销尚未执行的刷新；在途读取由调用方的会话/轮次序号作废。 */
    reset(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      deadline = null;
      for (const waiter of waiters) waiter.resolve();
      waiters = [];
    },
    isPending(): boolean {
      return running || deadline !== null;
    },
  };
}
