import type { ViewBashJob, ViewBashWorkspaceNode, ViewNode } from "../../../shared/view";
import type { ExtensionViewEntry } from "../../stores/extensionViewStore";

export type BashWorkspacePanelEntry = Pick<
  ExtensionViewEntry,
  "id" | "panelId" | "sessionId" | "boundSessionId" | "title" | "root" | "values"
>;

export interface MonitorBashJob {
  entry: BashWorkspacePanelEntry;
  node: ViewBashWorkspaceNode;
  job: ViewBashJob;
}

export interface BashJobsProjection {
  jobs: MonitorBashJob[];
  workspaces: (BashWorkspacePanelEntry & { root: ViewBashWorkspaceNode })[];
  total: number;
}

const MONITOR_BASH_JOB_LIMIT = 5;

function belongsToSession(entry: BashWorkspacePanelEntry, sessionId: string): boolean {
  return entry.sessionId ? entry.sessionId === sessionId : entry.boundSessionId === sessionId;
}

function bashWorkspaceRoot(root: ViewNode): root is ViewBashWorkspaceNode {
  return root.type === "bash-workspace";
}

function isBashWorkspaceEntry(
  entry: BashWorkspacePanelEntry,
  sessionId: string,
): entry is BashWorkspacePanelEntry & { root: ViewBashWorkspaceNode } {
  return belongsToSession(entry, sessionId) && bashWorkspaceRoot(entry.root);
}

/** Project only the active session's live Bash workspaces and their currently visible jobs. */
export function projectBashJobs(
  entries: readonly BashWorkspacePanelEntry[],
  activeSessionId: string | null,
): BashJobsProjection {
  if (!activeSessionId) return { jobs: [], workspaces: [], total: 0 };
  const workspaces = entries.filter(
    (entry): entry is BashWorkspacePanelEntry & { root: ViewBashWorkspaceNode } =>
      isBashWorkspaceEntry(entry, activeSessionId),
  );
  const total = workspaces.reduce((count, entry) => count + entry.root.counts.total, 0);
  const jobs = workspaces.flatMap((entry) =>
    entry.root.jobs.map((job) => ({ entry, node: entry.root, job })),
  );
  return { jobs: jobs.slice(0, MONITOR_BASH_JOB_LIMIT), workspaces, total };
}

/** Revalidate a monitor click against the latest projected page before changing selection. */
export function findVisibleBashJob(
  entries: readonly BashWorkspacePanelEntry[],
  activeSessionId: string | null,
  entryId: string,
  jobId: string,
): MonitorBashJob | null {
  if (!activeSessionId) return null;
  const entry = entries.find(
    (candidate) => candidate.id === entryId && isBashWorkspaceEntry(candidate, activeSessionId),
  );
  if (!entry || entry.root.type !== "bash-workspace") return null;
  const node = entry.root;
  const job = node.jobs.find((candidate) => candidate.id === jobId);
  return job ? { entry, node, job } : null;
}
