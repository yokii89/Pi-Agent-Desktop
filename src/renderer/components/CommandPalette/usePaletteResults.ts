import { ChatCircle, File, Folder } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import type { FsSearchHit, GitChange, GitStatusResult, SessionSummary } from "../../../shared/ipc";
import { ACTION_REGISTRY } from "../../actions/actionRegistry";
import { useActionContext } from "../../actions/useActionContext";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { gitService } from "../../services/gitService";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { excludeArchivedSessions } from "../../utils/sessionGroups";
import { formatShortRelativeTime } from "../../utils/time";
import { fuzzyMatch, fuzzyScore } from "./fuzzy";
import {
  clearPaletteSearchHistory,
  type PaletteSearchHistoryEntry,
  pushPaletteSearchHistory,
  readPaletteSearchHistory,
} from "./searchHistory";
import type {
  PaletteItem,
  PaletteItemHighlight,
  PaletteScope,
  PaletteSection,
  PaletteSectionId,
} from "./types";

/** 每区默认可见条数；超出折叠进「显示更多」。 */
const SECTION_LIMIT = 6;
/** 展开后单区最多渲染条数（避免一次性铺满超长列表）。 */
const SECTION_EXPANDED_LIMIT = 60;
/** 无查询时展示的最近会话数。 */
const RECENT_SESSION_LIMIT = 6;
/** 文件搜索防抖（ms）：边打字边搜，合并 IPC。 */
const FILE_SEARCH_DEBOUNCE_MS = 120;

const SECTION_TITLE_KEYS: Record<PaletteSectionId, string> = {
  commands: "palette.section.commands",
  sessions: "palette.section.sessions",
  files: "palette.section.files",
  changes: "palette.section.changes",
};

const EMPTY_SESSIONS: SessionSummary[] = [];
const EMPTY_TITLES: Record<string, string> = {};

/** 输入前缀 → 作用域（`>` 命令 / `#` 会话 / `@` 文件），与 ZCode resolveQueryScope 一致。 */
function resolveQueryScope(rawQuery: string): {
  query: string;
  scope: PaletteScope;
} {
  const trimmed = rawQuery.trimStart();
  const prefix = trimmed[0];
  if (prefix === ">") return { query: trimmed.slice(1).trimStart(), scope: "commands" };
  if (prefix === "#") return { query: trimmed.slice(1).trimStart(), scope: "sessions" };
  if (prefix === "@") return { query: trimmed.slice(1).trimStart(), scope: "files" };
  return { query: rawQuery.trim(), scope: "all" };
}

/** 作用域 → 输入前缀（点击 Tab / 历史 chip 时改写输入框）。 */
export function scopeToPrefix(scope: PaletteScope): string {
  if (scope === "commands") return ">";
  if (scope === "sessions") return "#";
  if (scope === "files") return "@";
  return "";
}

function baseName(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 按分数过滤 + 排序，并附行内高亮下标；query 为空时原样返回（无高亮）。 */
function filterByQuery(items: PaletteItem[], query: string): PaletteItem[] {
  if (!query.trim()) return items;
  const scored: { item: PaletteItem; score: number; highlight: PaletteItemHighlight }[] = [];
  for (const item of items) {
    const score = fuzzyScore(item.searchText, query);
    if (score === null) continue;
    // 检索文本含关键词，可能命中在标题/副标题之外；高亮按逐条文本尽力而为
    const titleMatch = fuzzyMatch(item.title, query);
    const subtitleMatch = item.subtitle ? fuzzyMatch(item.subtitle, query) : null;
    scored.push({
      item,
      score,
      highlight: {
        title: titleMatch?.positions,
        subtitle: subtitleMatch?.positions,
      },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ item, highlight }) => ({ ...item, highlight }));
}

/** git status 条目 → 右侧说明：有行数统计给 `+N -N`，否则退回状态标签。 */
function changeMeta(change: GitChange, t: TranslateFn): string {
  const counts = [
    change.additions !== null ? `+${change.additions}` : null,
    change.deletions !== null ? `-${change.deletions}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return counts || t(`palette.change.${change.status}`);
}

export interface PaletteResults {
  open: boolean;
  rawQuery: string;
  setRawQuery: (value: string) => void;
  scope: PaletteScope;
  query: string;
  selectScope: (scope: PaletteScope) => void;
  sections: PaletteSection[];
  flatItems: PaletteItem[];
  activeIndex: number;
  moveActive: (delta: number) => void;
  setActiveIndex: (index: number) => void;
  runItem: (item: PaletteItem) => void;
  runActive: () => void;
  filesLoading: boolean;
  filesError: boolean;
  historyEntries: PaletteSearchHistoryEntry[];
  clearHistory: () => void;
  expandedSections: ReadonlySet<PaletteSectionId>;
  expandSection: (id: PaletteSectionId) => void;
  close: () => void;
}

/**
 * 命令面板数据与导航中枢：合并「动作注册表 + 会话清单 + 文件搜索 + 最近改动」结果源，
 * 统一模糊匹配、分区限流、键盘导航、搜索历史。零新依赖（fuzzy 自实现子序列打分）。
 * 关闭态输入降级为空数组：会话流式输出期间不重建结果区（ZCode effectiveCommands 同款）。
 */
export function usePaletteResults(open: boolean): PaletteResults {
  const t = useT();
  // dispatch / openReview 供文件与最近改动结果源的打开请求使用（保持具体依赖，避免整包 ctx 触发重搜）；
  // 动作执行统一走 actionCtx，与全局快捷键共用装配
  const { dispatch, openReview, closeCommandPalette, showToast } = useUiStore();
  const { allSessions, archivedFiles, sessionTitles, sessionWorkingDir, openSessionFile } =
    useSessionMeta();
  const actionCtx = useActionContext();

  const [rawQuery, setRawQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState<ReadonlySet<PaletteSectionId>>(
    () => new Set(),
  );
  const [fileItems, setFileItems] = useState<PaletteItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(false);
  const [changeItems, setChangeItems] = useState<PaletteItem[]>([]);
  const [historyEntries, setHistoryEntries] = useState<PaletteSearchHistoryEntry[]>([]);
  const fileSeqRef = useRef(0);
  const changeSeqRef = useRef(0);

  const { query, scope } = useMemo(() => resolveQueryScope(rawQuery), [rawQuery]);
  /** 搜索历史按工作目录隔离；无工作目录时落 default 键。 */
  const workspaceKey = sessionWorkingDir ?? "";

  // 打开时复位输入 / 选中 / 展开态；读入本工作区的搜索历史
  useEffect(() => {
    if (!open) return;
    setRawQuery("");
    setActiveIndex(0);
    setExpandedSections(new Set());
    setFileItems([]);
    setFilesLoading(false);
    setFilesError(false);
    setChangeItems([]);
    setHistoryEntries(readPaletteSearchHistory(workspaceKey));
  }, [open, workspaceKey]);

  // 输入或作用域变化时回到首项、收起「显示更多」
  // biome-ignore lint/correctness/useExhaustiveDependencies: rawQuery/scope 是重置信号，不在闭包内读取
  useEffect(() => {
    setActiveIndex(0);
    setExpandedSections(new Set());
  }, [rawQuery, scope]);

  const commandItems = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    const items: PaletteItem[] = [];
    for (const action of ACTION_REGISTRY) {
      if (action.when && !action.when(actionCtx)) continue;
      const label = actionCtx.t(action.labelKey);
      items.push({
        id: `cmd:${action.id}`,
        section: "commands",
        title: label,
        icon: action.icon,
        // 可绑定动作展示当前键位（可能被用户改过）；纯面板命令不展示
        shortcut: action.defaultCombo ? actionCtx.shortcuts[action.id] : undefined,
        searchText: `${label} ${action.keywords}`.toLowerCase(),
        run: () => action.run(actionCtx),
      });
    }
    return items;
  }, [open, actionCtx]);

  // 命令面板是"主动工作集"：已归档会话只在设置 → 已归档对话出现，不进切换列表（docs/design/32）
  const effectiveSessions = open
    ? excludeArchivedSessions(allSessions, archivedFiles)
    : EMPTY_SESSIONS;
  const effectiveTitles = open ? sessionTitles : EMPTY_TITLES;

  const sessionItems = useMemo<PaletteItem[]>(() => {
    const sorted = [...effectiveSessions].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.map((session: SessionSummary) => {
      const title =
        effectiveTitles[session.file] ??
        (session.firstUserMessage?.trim() || t("palette.session.untitled"));
      const subtitle = session.cwd ?? undefined;
      return {
        id: `session:${session.file}`,
        section: "sessions" as const,
        title,
        subtitle,
        icon: ChatCircle,
        meta: formatShortRelativeTime(session.updatedAt),
        searchText: `${title} ${subtitle ?? ""} ${baseName(session.file)}`.toLowerCase(),
        run: () => void openSessionFile(session.file, session.cwd ?? undefined),
      };
    });
  }, [effectiveSessions, effectiveTitles, openSessionFile, t]);

  // 最近改动（空查询上下文分区）：git status 读侧，非 git 仓库时整区缺席
  useEffect(() => {
    if (!open || !sessionWorkingDir) {
      setChangeItems([]);
      return;
    }
    const seq = ++changeSeqRef.current;
    gitService
      .status(sessionWorkingDir)
      .then((status: GitStatusResult) => {
        if (changeSeqRef.current !== seq) return;
        if (!status.repoRoot) {
          setChangeItems([]);
          return;
        }
        const root = status.repoRoot.replace(/[\\/]+$/, "");
        setChangeItems(
          status.changes.map((change: GitChange) => {
            // change.path 是仓库相对路径；预览请求需要绝对路径
            const absolute = `${root}/${change.path}`;
            return {
              id: `change:${change.layer}:${change.path}`,
              section: "changes" as const,
              title: baseName(change.path),
              subtitle: change.path,
              icon: File,
              meta: changeMeta(change, t),
              searchText: `${change.path} ${baseName(change.path)}`.toLowerCase(),
              run: () => {
                // 删除/冲突没有可预览的文件，让位给审查面板看 diff
                if (change.status === "deleted" || change.status === "conflicted") {
                  openReview();
                  return;
                }
                dispatch({ type: "openFileInPanel", path: absolute });
              },
            };
          }),
        );
      })
      .catch(() => {
        if (changeSeqRef.current === seq) setChangeItems([]);
      });
  }, [open, sessionWorkingDir, t, dispatch, openReview]);

  // 文件搜索：仅在有查询且作用域含文件时触发，防抖 + 序号丢弃过期结果
  useEffect(() => {
    if (!open) return;
    const needFiles =
      (scope === "all" || scope === "files") && query.trim().length > 0 && !!sessionWorkingDir;
    if (!needFiles) {
      setFileItems([]);
      setFilesLoading(false);
      setFilesError(false);
      return;
    }
    const seq = ++fileSeqRef.current;
    setFilesLoading(true);
    setFilesError(false);
    const dir = sessionWorkingDir as string;
    const timer = setTimeout(() => {
      fsService
        .search(dir, query)
        .then((hits: FsSearchHit[]) => {
          if (fileSeqRef.current !== seq) return;
          setFileItems(
            hits.map((hit) => ({
              id: `file:${hit.path}`,
              section: "files" as const,
              title: baseName(hit.path),
              subtitle: hit.displayPath,
              icon: hit.kind === "dir" ? Folder : File,
              searchText: `${hit.displayPath} ${hit.path}`.toLowerCase(),
              run: () => {
                // 目录命中：打开文件面板并在树中定位（展开祖先链 + 滚动）
                if (hit.kind === "dir") dispatch({ type: "revealInFilePanel", path: hit.path });
                else dispatch({ type: "openFileInPanel", path: hit.path });
              },
            })),
          );
          setFilesLoading(false);
        })
        .catch(() => {
          if (fileSeqRef.current !== seq) return;
          setFileItems([]);
          setFilesError(true);
          setFilesLoading(false);
        });
    }, FILE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, scope, query, sessionWorkingDir, dispatch]);

  // 组装分区：空查询 = 上下文视图（最近改动 → 最近会话 → 命令，ZCode 同构）；
  // 有查询 = 搜索视图（命令 → 会话 → 文件）
  const sections = useMemo<PaletteSection[]>(() => {
    const buildSection = (id: PaletteSectionId, source: PaletteItem[]): PaletteSection => {
      const matched = filterByQuery(source, query);
      const limit = expandedSections.has(id) ? SECTION_EXPANDED_LIMIT : SECTION_LIMIT;
      return {
        id,
        titleKey: SECTION_TITLE_KEYS[id],
        items: matched.slice(0, limit),
        totalMatches: matched.length,
      };
    };

    const out: PaletteSection[] = [];
    if (!query.trim()) {
      if (scope === "all" || scope === "files") {
        out.push(buildSection("changes", changeItems));
      }
      if (scope === "all" || scope === "sessions") {
        out.push(buildSection("sessions", sessionItems.slice(0, RECENT_SESSION_LIMIT)));
      }
      if (scope === "all" || scope === "commands") {
        out.push(buildSection("commands", commandItems));
      }
    } else {
      if (scope === "all" || scope === "commands") {
        out.push(buildSection("commands", commandItems));
      }
      if (scope === "all" || scope === "sessions") {
        out.push(buildSection("sessions", sessionItems));
      }
      if (scope === "all" || scope === "files") {
        out.push(buildSection("files", fileItems));
      }
    }
    return out.filter((section) => section.items.length > 0);
  }, [scope, query, commandItems, sessionItems, fileItems, changeItems, expandedSections]);

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  // 结果变化后夹紧高亮索引
  useEffect(() => {
    setActiveIndex((prev) => (flatItems.length === 0 ? 0 : Math.min(prev, flatItems.length - 1)));
  }, [flatItems.length]);

  const runItem = useCallback(
    (item: PaletteItem): void => {
      // 搜索历史按命中分区记 scope（最近改动是上下文入口，不入历史）
      if (item.section !== "changes") {
        setHistoryEntries(pushPaletteSearchHistory({ workspaceKey, query, scope: item.section }));
      }
      closeCommandPalette();
      Promise.resolve(item.run()).catch((error: unknown) => {
        console.error("[CommandPalette] 命令执行失败", error);
        showToast(t("palette.commandFailed"));
      });
    },
    [closeCommandPalette, workspaceKey, query, showToast, t],
  );

  const runActive = useCallback((): void => {
    const item = flatItems[activeIndex];
    if (item) runItem(item);
  }, [flatItems, activeIndex, runItem]);

  const moveActive = useCallback(
    (delta: number): void => {
      setActiveIndex((prev) => {
        const len = flatItems.length;
        if (len === 0) return 0;
        return (prev + delta + len) % len;
      });
    },
    [flatItems.length],
  );

  const selectScope = useCallback(
    (next: PaletteScope): void => {
      const { query: currentQuery } = resolveQueryScope(rawQuery);
      setRawQuery(`${scopeToPrefix(next)}${currentQuery}`);
    },
    [rawQuery],
  );

  const clearHistory = useCallback((): void => {
    clearPaletteSearchHistory(workspaceKey);
    setHistoryEntries([]);
  }, [workspaceKey]);

  const expandSection = useCallback((id: PaletteSectionId): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  return {
    open,
    rawQuery,
    setRawQuery,
    scope,
    query,
    selectScope,
    sections,
    flatItems,
    activeIndex,
    moveActive,
    setActiveIndex,
    runItem,
    runActive,
    filesLoading,
    filesError,
    historyEntries,
    clearHistory,
    expandedSections,
    expandSection,
    close: closeCommandPalette,
  };
}
