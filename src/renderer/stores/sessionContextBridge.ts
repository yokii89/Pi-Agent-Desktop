/**
 * Session runtime context 桥（SessionProvider 在 ExtensionViewProvider 外层，
 * 不能直接调 extensionViewStore 的 hook；用模块级回调登记）。
 */

export interface SessionRuntimeContext {
  cwd?: string | null;
  sessionFile?: string | null;
  /** 会话 pi 进程是否存活（访问模式三态的 processAlive 兜底）。 */
  processAlive?: boolean;
}

type Binder = (sessionId: string, ctx: SessionRuntimeContext) => void;

let binder: Binder | null = null;

export function registerSessionContextBinder(fn: Binder): () => void {
  binder = fn;
  return () => {
    if (binder === fn) binder = null;
  };
}

export function notifySessionRuntimeContext(sessionId: string, ctx: SessionRuntimeContext): void {
  binder?.(sessionId, ctx);
}
