const sessions = new Map<string | null, number>();

/** 同步建立发送屏障，覆盖 React 尚未提交禁用状态的窗口。 */
export function beginModeTransition(sessionId: string | null): () => void {
  sessions.set(sessionId, (sessions.get(sessionId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (sessions.get(sessionId) ?? 1) - 1;
    if (remaining === 0) sessions.delete(sessionId);
    else sessions.set(sessionId, remaining);
  };
}

/** 无 id 的事务正在创建渲染桶，此阶段暂时阻断发送。 */
export function isModeTransitioning(sessionId: string | null): boolean {
  return sessions.has(null) || sessions.has(sessionId);
}
