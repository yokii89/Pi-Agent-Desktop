/**
 * sessionId → cwd 轻量登记（docs/design/16）。
 * 独立小模块，避免 viewHost ↔ piSession ↔ runtimeCoordinator 循环依赖。
 */

const cwdBySession = new Map<string, string | null>();

export function noteSessionCwd(sessionId: string, cwd: string | null): void {
  cwdBySession.set(sessionId, cwd);
}

export function getSessionCwd(sessionId: string | undefined): string | null {
  if (!sessionId) return null;
  return cwdBySession.get(sessionId) ?? null;
}

export function clearSessionCwd(sessionId: string): void {
  cwdBySession.delete(sessionId);
}
