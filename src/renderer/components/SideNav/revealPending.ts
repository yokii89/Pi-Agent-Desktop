import type { SessionSummary } from "../../../shared/ipc";
import { isPendingFile } from "../../stores/sessionStore";

/**
 * 记下本批会话里「首次出现的未落盘行」，返回是否出现了新行。
 *
 * 记账用会话 id 而不是文件 key：未落盘行会从 pending:<id> 换成认领到的真实 JSONL，
 * 但同一条会话的 id 不变，因此换 key 不会被当成又一条新会话、把分组再展开一次。
 * 只认未落盘行也是启动基线：磁盘历史随首次 listAll 大量涌入，不能据此展开分组。
 */
export function noteNewPendingSessions(
  sessions: readonly SessionSummary[],
  seen: Set<string>,
): boolean {
  let revealed = false;
  for (const session of sessions) {
    if (!isPendingFile(session.file) || seen.has(session.id)) continue;
    seen.add(session.id);
    revealed = true;
  }
  return revealed;
}
