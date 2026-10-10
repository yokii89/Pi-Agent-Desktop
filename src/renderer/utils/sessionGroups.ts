import type { PideskProject, SessionSummary } from "../../shared/ipc";
import { isSameOrInsideDir, normalizeDirPath } from "./paths";

/** 一个项目及其名下的历史会话（列表顺序与项目列表一致，无会话时为空数组）。 */
export interface ProjectSessionGroup {
  project: PideskProject;
  sessions: SessionSummary[];
}

/** 会话归属树：全局置顶提出单独成区，其余能映射到项目的进项目、剩下的进"任务"。 */
export interface SessionTree {
  /** 全局置顶的会话（按置顶顺序），从普通分组中提出，侧栏「置顶」分区展示（docs/design/45）。 */
  globalPinned: SessionSummary[];
  tasks: SessionSummary[];
  projectGroups: ProjectSessionGroup[];
}

/**
 * 找到会话工作目录归属的项目：多个项目嵌套时取路径最深（最具体）的一个；
 * 无 cwd 或不属于任何项目返回 null。侧栏分组与悬浮卡"所属空间"共用同一口径。
 */
export function findOwningProject(
  cwd: string | null,
  projects: readonly PideskProject[],
): PideskProject | null {
  if (!cwd) return null;
  let owner: PideskProject | null = null;
  let ownerDepth = -1;
  for (const project of projects) {
    const depth = normalizeDirPath(project.dir).length;
    if (depth > ownerDepth && isSameOrInsideDir(cwd, project.dir)) {
      owner = project;
      ownerDepth = depth;
    }
  }
  return owner;
}

/**
 * 置顶优先排序：置顶条目按"置顶顺序"（pinnedFiles 数组顺序）排在前面，
 * 其余保持入参的时间倒序。没有任何置顶时原样返回，避免无谓的重排。
 */
function sortByPin(sessions: SessionSummary[], pinnedFiles: readonly string[]): SessionSummary[] {
  if (pinnedFiles.length === 0) return sessions;
  const rank = new Map(pinnedFiles.map((file, index) => [file, index]));
  const pinned = sessions
    .filter((session) => rank.has(session.file))
    .sort((a, b) => (rank.get(a.file) ?? 0) - (rank.get(b.file) ?? 0));
  if (pinned.length === 0) return sessions;
  return [...pinned, ...sessions.filter((session) => !rank.has(session.file))];
}

/**
 * 按"会话工作目录 → 项目"把历史会话分组：
 * - 全局置顶会话从分组中提出，单独成区（"置顶"分区固定在侧栏最顶部，docs/design/45）；
 * - 其余 cwd 等于某项目目录或位于其内部 → 归入该项目；多个项目嵌套时归入路径最深（最具体）的一个；
 * - 无 cwd 或映射不到任何项目 → 归入顶层"任务"。
 * 每条会话只出现在一个位置；组内默认保持入参的时间倒序，工作区置顶会话提到该组最前。
 */
export function buildSessionTree(
  sessions: SessionSummary[],
  projects: PideskProject[],
  pinnedFiles: readonly string[] = [],
  globalPinnedFiles: readonly string[] = [],
): SessionTree {
  const globalRank = new Map(globalPinnedFiles.map((file, index) => [file, index]));
  const globalPinned = sessions
    .filter((session) => globalRank.has(session.file))
    .sort((a, b) => (globalRank.get(a.file) ?? 0) - (globalRank.get(b.file) ?? 0));
  const rest =
    globalRank.size === 0 ? sessions : sessions.filter((session) => !globalRank.has(session.file));

  const grouped = new Map<string, SessionSummary[]>();
  const tasks: SessionSummary[] = [];

  for (const session of rest) {
    const owner = findOwningProject(session.cwd, projects);
    if (owner) {
      const list = grouped.get(owner.id);
      if (list) {
        list.push(session);
      } else {
        grouped.set(owner.id, [session]);
      }
    } else {
      tasks.push(session);
    }
  }

  return {
    globalPinned,
    tasks: sortByPin(tasks, pinnedFiles),
    projectGroups: projects.map((project) => ({
      project,
      sessions: sortByPin(grouped.get(project.id) ?? [], pinnedFiles),
    })),
  };
}

/**
 * 剔除已归档会话（docs/design/32）：侧栏主列表（项目组 + 任务）只展示未归档条目，
 * 归档的在设置 → 已归档对话分区单独浏览。放在分组前过滤，悬浮卡 / 上下会话导航
 * 经 flattenSessionTree 自动继承。
 */
export function excludeArchivedSessions(
  sessions: SessionSummary[],
  archivedFiles: Readonly<Record<string, number>>,
): SessionSummary[] {
  if (Object.keys(archivedFiles).length === 0) return sessions;
  return sessions.filter((session) => archivedFiles[session.file] === undefined);
}

/** 把会话树拍平成侧栏展示顺序（置顶区在前、项目组次之、任务在后，组内保持既有排序）；上/下一个会话导航用。 */
export function flattenSessionTree(tree: SessionTree): SessionSummary[] {
  return [
    ...tree.globalPinned,
    ...tree.projectGroups.flatMap((group) => group.sessions),
    ...tree.tasks,
  ];
}
