import type { PideskProject, SessionSummary } from "../../shared/ipc";
import { isSameOrInsideDir, normalizeDirPath } from "./paths";

/** 一个项目及其名下的历史会话（列表顺序与项目列表一致，无会话时为空数组）。 */
export interface ProjectSessionGroup {
  project: PideskProject;
  sessions: SessionSummary[];
}

/** 会话归属树：能映射到项目的进项目，其余（无 cwd / 目录不属任何项目）进"任务"。 */
export interface SessionTree {
  tasks: SessionSummary[];
  projectGroups: ProjectSessionGroup[];
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
 * - cwd 等于某项目目录或位于其内部 → 归入该项目；多个项目嵌套时归入路径最深（最具体）的一个；
 * - 无 cwd 或映射不到任何项目 → 归入顶层"任务"。
 * 每条会话只出现在一个位置；组内默认保持入参的时间倒序，置顶会话提到该组最前。
 */
export function buildSessionTree(
  sessions: SessionSummary[],
  projects: PideskProject[],
  pinnedFiles: readonly string[] = [],
): SessionTree {
  // 嵌套目录的项目需先匹配更深的，避免会话被上层项目"截走"（按归一化后路径长度比较）
  const byDepth = [...projects].sort(
    (a, b) => normalizeDirPath(b.dir).length - normalizeDirPath(a.dir).length,
  );
  const grouped = new Map<string, SessionSummary[]>();
  const tasks: SessionSummary[] = [];

  for (const session of sessions) {
    const cwd = session.cwd;
    const owner = cwd ? byDepth.find((p) => isSameOrInsideDir(cwd, p.dir)) : undefined;
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

/** 把会话树拍平成侧栏展示顺序（项目组在前、任务在后，组内保持既有排序）；上/下一个会话导航用。 */
export function flattenSessionTree(tree: SessionTree): SessionSummary[] {
  return [...tree.projectGroups.flatMap((group) => group.sessions), ...tree.tasks];
}
