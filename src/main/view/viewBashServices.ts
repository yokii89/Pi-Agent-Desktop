import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { shell } from "electron";
import { readProcessDetail } from "../proc/processDetail";
import { getProcessSnapshot } from "../proc/processKill";
import { procService } from "../proc/procService";
import { getPiAgentDir } from "../session/piInfo";
import { getSessionPid } from "../session/piSession";
import { BashJobAccess } from "./bashJobAccess";
import { getBashJobContext } from "./viewHost";

/** Reject symlinks escaping the dedicated log tree before invoking the system file handler. */
async function openSavedLog(path: string, logsRoot: string): Promise<void> {
  const [root, target, info] = await Promise.all([realpath(logsRoot), realpath(path), stat(path)]);
  const child = relative(root, target);
  if (!info.isFile() || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error("Saved log is outside the job log directory");
  }
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

export const bashJobAccess = new BashJobAccess({
  resolve: getBashJobContext,
  snapshot: () => getProcessSnapshot(10_000),
  sessionPid: getSessionPid,
  processes: (sessionId) => procService.list(sessionId),
  detail: readProcessDetail,
  agentDir: getPiAgentDir,
  openLog: openSavedLog,
});
