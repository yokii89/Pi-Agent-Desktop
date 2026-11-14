import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Copy,
  Eye,
  EyeSlash,
  FloppyDisk,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isHtmlPath,
  isMarkdownPath,
  isNotebookPath,
  isTabularPath,
} from "../../../../shared/fileKinds";
import type { TranslateFn } from "../../../../shared/i18n";
import type { FsReadResult, FsSearchHit } from "../../../../shared/ipc";
import { applyLineEnding, toSavedContent } from "../../../../shared/lineEndings";
import type { CodeEditorHandle, CodeScrollAnchor } from "../../../editor/codeEditorTypes";
import { usePreviewFind } from "../../../hooks/usePreviewFind";
import { useT } from "../../../hooks/useT";
import { fsService } from "../../../services/fsService";
import { useBrowserStore } from "../../../stores/browserStore";
import { useComposerStore } from "../../../stores/composerStore";
import { useExtensionViewStore } from "../../../stores/extensionViewStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useSessionMeta } from "../../../stores/sessionStore";
import { useUiStore } from "../../../stores/uiStore";
import { copyTextToClipboard } from "../../../utils/clipboard";
import {
  normalizePathKey,
  parseLineCol,
  pathBasename,
  relativeToPath,
  resolveForPreview,
  resolvePath,
  toNativePath,
} from "../../../utils/fileOpen";
import { formatJsonPreview } from "../../../utils/jsonPreview";
import { normalizeDirPath, parentDirPath } from "../../../utils/paths";
import {
  canGoBack,
  canGoForward,
  emptyPreviewHistory,
  type PreviewHistory,
  pushPreviewHistory,
  stepPreviewHistory,
} from "../../../utils/previewHistory";
import { SelectionToolbar } from "../../SessionArea/SelectionToolbar";
import { WorkdirChip } from "../../SessionArea/WorkdirChip";
import { CodeEditor } from "../../ui/CodeEditor";
import { CodeHighlight, countCodeLines } from "../../ui/CodeHighlight";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { ContextMenu } from "../../ui/ContextMenu";
import { IconButton } from "../../ui/IconButton";
import type { MenuItem } from "../../ui/Menu";
import styles from "../ContextSidebar.module.css";
import { DelimitedPreview } from "./DelimitedPreview";
import panelStyles from "./FilePanel.module.css";
import { FileTree } from "./FileTree";
import { MarkdownPreview, type MarkdownViewMode } from "./MarkdownPreview";
import { NotebookPreview } from "./NotebookPreview";
import { PdfPreview } from "./PdfPreview";
import { PreviewFindBar } from "./PreviewFindBar";

interface PreviewState {
  /** 所属项目根目录：项目切换后旧预览/搜索结果直接失效，避免误展示。 */
  root: string;
  path: string;
  result: FsReadResult;
  /** `path:line` 打开时的目标行（1-based）；树/搜索打开为 null。 */
  focusLine: number | null;
}

interface MatchState {
  root: string;
  hits: FsSearchHit[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 标题栏右侧元信息：文本看行数，图片/二进制看体积（图片加载后补分辨率）。 */
function previewMeta(result: FsReadResult, imageSize: string | null, t: TranslateFn): string {
  if (result.kind === "text") {
    return t("panels.files.lineCount", {
      count: countCodeLines(result.content),
    });
  }
  if (result.kind === "image") return imageSize ?? formatBytes(result.byteLength);
  return formatBytes(result.byteLength);
}

/** 刚写完盘的一小段时间内，目录 watch 的回推视为自己引发的（不是外部改动）。 */
const SELF_WRITE_GRACE_MS = 600;

/** 可以在侧栏就地编辑的预览（docs/design/141）。 */
function isTextEditable(preview: PreviewState, mdMode: MarkdownViewMode): boolean {
  // 截断过的文本只读到 1MB 那一段，回写等于把后文删掉
  if (preview.result.kind !== "text" || preview.result.truncated) return false;
  // 表格 / Notebook 的专用预览是排版结果，与源码不是一一对应的字符流
  if (isTabularPath(preview.path) || isNotebookPath(preview.path)) return false;
  // Markdown 文档流同理：要编辑得先切到源码态
  if (isMarkdownPath(preview.path)) return mdMode === "source";
  return true;
}

/** 编辑器文档形态：CodeMirror 按 `\n` 切行，基线必须同一形态才能干净地比脏。 */
function toEditorText(text: string): string {
  return applyLineEnding(text, "lf");
}

function previewScrollElement(panel: HTMLElement): HTMLElement {
  const code = panel.querySelector<HTMLElement>("[data-code-preview-scroll]");
  return code && code.scrollHeight > code.clientHeight ? code : panel;
}

function readPreviewScrollAnchor(panel: HTMLElement): CodeScrollAnchor {
  const scrollElement = previewScrollElement(panel);
  const viewportTop = scrollElement.getBoundingClientRect().top;
  const lines = panel.querySelectorAll<HTMLElement>(
    "[data-code-preview-scroll] .line, [data-code-line]",
  );
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && line.getBoundingClientRect().bottom > viewportTop) {
      return { line: index + 1, offset: line.getBoundingClientRect().top - viewportTop };
    }
  }
  return { line: 1, offset: 0 };
}

function restorePreviewScrollAnchor(panel: HTMLElement, anchor: CodeScrollAnchor): boolean {
  const scrollElement = previewScrollElement(panel);
  const line = panel.querySelectorAll<HTMLElement>(
    "[data-code-preview-scroll] .line, [data-code-line]",
  )[Math.max(0, anchor.line - 1)];
  if (!line) return false;
  scrollElement.scrollTop +=
    line.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top - anchor.offset;
  return true;
}

/** 右侧"文件"Tab：快速打开搜索 + 项目文件树 + 只读预览 / 就地编辑（docs/design/03 §5）。 */
export function FilePanel({ active = true }: { active?: boolean }) {
  const t = useT();
  const { showToast, fileSearchTick, fileOpenRequest, fileRevealRequest, browserEnabled } =
    useUiStore();
  const browserStore = useBrowserStore();
  const { currentProject } = useProjectStore();
  const { sessionWorkingDir, activeSessionId, switchingTo } = useSessionMeta();
  const { quoteComposer } = useComposerStore();
  const { hasBlockingViewFor } = useExtensionViewStore();
  const rootDir = currentProject?.dir ?? null;

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<MatchState | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [imageSize, setImageSize] = useState<string | null>(null);
  /** Markdown 预览/源码两态：提升到面板层，跨文件切换与返回文件树后保持。 */
  const [mdViewMode, setMdViewMode] = useState<MarkdownViewMode>("preview");
  /** 预览回退/前进历史：项目切换即整体失效。 */
  const [history, setHistory] = useState<PreviewHistory>(emptyPreviewHistory);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchSeqRef = useRef(0);
  /** 编辑态（docs/design/141）：与预览体互斥渲染，草稿归 CodeMirror 所有。 */
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  /** 编辑器基线（LF 形态，与编辑器文档同形）；预览内容是磁盘原文，可能是 CRLF。 */
  const [editorBaseline, setEditorBaseline] = useState("");
  /** 编辑器重挂载信号：外部版本落到编辑器 = 换实例（撤销历史随之作废）。 */
  const [editorReloadTick, setEditorReloadTick] = useState(0);
  /** 磁盘已变而本地有未保存改动：头部提示，真正拦截在保存时。 */
  const [externalChanged, setExternalChanged] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const previewScrollAnchorRef = useRef<CodeScrollAnchor>({ line: 1, offset: 0 });
  const previewRestorePendingRef = useRef(false);
  const wasEditingRef = useRef(editing);
  /** 脏内容离开时暂存的动作：放弃 / 保存并继续后再执行。 */
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  /** 自己刚写盘的时刻：目录 watch 会回推同一次改动，别把自家保存读成外部改动。 */
  const selfWriteAtRef = useRef(0);
  /** 预览内容落在 panelBody 里：划选工具条容器、全选与右键菜单都按它取范围。 */
  const panelBodyRef = useRef<HTMLDivElement>(null);
  /** 预览区右键菜单（光标坐标 + 右键时已有的选区文本）。 */
  const [previewMenu, setPreviewMenu] = useState<{
    x: number;
    y: number;
    selected: string;
  } | null>(null);
  /** 预览读取序号：丢弃过期读取结果（快速连开文件 / 历史导航连点）。 */
  const previewSeqRef = useRef(0);
  /** 预览/打开请求的 root 标记：无项目时用 ""，切项目后旧预览失效。 */
  const rootKey = rootDir ?? "";
  /** 上一次已提交的项目根目录；项目切换也必须经过脏草稿离开保护。 */
  const previousRootRef = useRef(rootKey);
  /** 当前有效的预览；项目切换确认期间暂时保留旧预览，避免编辑器先卸载导致草稿丢失。 */
  const activePreview =
    preview && (preview.root === rootKey || (editing && preview.root !== rootKey)) ? preview : null;
  const activePreviewRef = useRef(activePreview);
  activePreviewRef.current = activePreview;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  /** 内容身份：换文件 / md 预览与源码切换时查找条自行收起并重算。 */
  const findContentKey =
    preview && preview.root === rootKey ? `${preview.path}:${mdViewMode}` : null;
  const find = usePreviewFind(panelBodyRef, findContentKey);
  const restorePreviewAfterCodeLayout = useCallback((stable: boolean): void => {
    if (!previewRestorePendingRef.current || !panelBodyRef.current) return;
    restorePreviewScrollAnchor(panelBodyRef.current, previewScrollAnchorRef.current);
    if (stable) previewRestorePendingRef.current = false;
  }, []);

  // Ctrl+F 在预览内容里查找（渲染层没有浏览器级查找条，不抢就没人接这个键）
  const openFind = find.openFind;
  const hasActivePreview = preview !== null && preview.root === rootKey;
  useEffect(() => {
    if (!active || !hasActivePreview) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // 编辑态归 CodeMirror 的查找面板（它自己 preventDefault 过，这里也不再抢）
      if (editing || event.defaultPrevented) return;
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      openFind();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, hasActivePreview, openFind, editing]);

  // Ctrl+P 打开/重复触发时聚焦搜索框（fileSearchTick 每次触发都递增）
  useEffect(() => {
    if (fileSearchTick >= 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [fileSearchTick]);

  // 搜索防抖（快速打开：主进程递归文件名匹配）
  useEffect(() => {
    if (!rootDir) return;
    const keyword = query.trim();
    if (!keyword) {
      setMatches(null);
      return;
    }
    const seq = ++searchSeqRef.current;
    const timer = window.setTimeout(() => {
      fsService.search(rootDir, keyword).then((hits) => {
        if (searchSeqRef.current === seq) setMatches({ root: rootDir, hits });
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, rootDir]);

  const openPreview = useCallback(
    (
      path: string,
      preloaded?: FsReadResult,
      focusLine: number | null = null,
      mode: "push" | "silent" = "push",
    ): void => {
      setSelectedPath(path);
      setPreviewLoading(true);
      previewRestorePendingRef.current = false;
      setImageSize(null);
      // 换文件即退出编辑：草稿只属于当前文件（脏内容已在 guardLeave 里问过）
      setEditing(false);
      setDirty(false);
      setExternalChanged(false);
      // 序号守卫：快速连开两个文件时，慢的旧读取不得覆盖新内容/历史
      const seq = ++previewSeqRef.current;
      const load = preloaded ? Promise.resolve(preloaded) : fsService.read(path);
      load
        .then((result) => {
          if (seq !== previewSeqRef.current) return;
          setPreview({ root: rootKey, path, result, focusLine });
          // 历史导航（silent）不重复入栈；读取失败同样不入栈
          if (mode === "push") {
            setHistory((h) => pushPreviewHistory(h, { root: rootKey, path, focusLine }));
          }
        })
        .catch((err: unknown) => {
          if (seq !== previewSeqRef.current) return;
          const message = err instanceof Error ? err.message : t("panels.files.readFailed");
          showToast(message);
          setPreview(null);
        })
        .finally(() => {
          if (seq === previewSeqRef.current) setPreviewLoading(false);
        });
    },
    [rootKey, showToast, t],
  );

  // ---- 就地编辑（docs/design/141）----

  /** 有未保存改动吗：以编辑器文档为准（去抖的 dirty 只是给头部看的一个影子）。 */
  const hasUnsavedDraft = useCallback((): boolean => {
    const editor = editorRef.current;
    if (!editingRef.current || !editor) return false;
    editor.recomputeDirty();
    return editor.isDirty();
  }, []);

  /**
   * 离开当前编辑（换文件 / 收起预览 / 回文件树 / 退出编辑）：
   * 有脏内容先把动作挂起，交给确认框决定「放弃」「保存并继续」还是「继续编辑」。
   */
  const guardLeave = useCallback(
    (action: () => void): boolean => {
      if (!hasUnsavedDraft()) {
        action();
        return true;
      }
      pendingLeaveRef.current = action;
      setLeaveOpen(true);
      return false;
    },
    [hasUnsavedDraft],
  );

  /** 退出编辑态、保留预览（不带确认的那一步）。 */
  const dropEditing = useCallback((): void => {
    if (editingRef.current && editorRef.current) {
      previewScrollAnchorRef.current = editorRef.current.getScrollAnchor();
    }
    setEditing(false);
    setDirty(false);
    setExternalChanged(false);
  }, []);

  useLayoutEffect(() => {
    if (!wasEditingRef.current || editing || !panelBodyRef.current) {
      wasEditingRef.current = editing;
      return;
    }
    previewRestorePendingRef.current = true;
    restorePreviewAfterCodeLayout(false);
    wasEditingRef.current = editing;
  }, [editing, restorePreviewAfterCodeLayout]);

  // 项目切换后浏览历史整体失效；有脏草稿时必须先确认再清掉旧预览
  useEffect(() => {
    if (previousRootRef.current === rootKey) return;
    previousRootRef.current = rootKey;
    setHistory(emptyPreviewHistory);

    if (editingRef.current && hasUnsavedDraft()) {
      pendingLeaveRef.current = () => {
        dropEditing();
        setPreview(null);
        setExternalChanged(false);
      };
      setLeaveOpen(true);
      return;
    }

    setEditing(false);
    setDirty(false);
    setExternalChanged(false);
    setPreview(null);
  }, [rootKey, dropEditing, hasUnsavedDraft]);

  /** 保存草稿。 */
  const saveDraft = useCallback(
    async (force = false): Promise<boolean> => {
      const editor = editorRef.current;
      const target = activePreviewRef.current;
      if (!editor || !target || target.result.kind !== "text") return false;
      const edited = editor.getValue();
      // 写盘内容还原原文件的换行风格；编辑器文档本身是纯 LF 形态（基线同形）
      const content = toSavedContent(edited, target.result.content);
      setSaveBusy(true);
      try {
        const result = await fsService.saveText({
          path: target.path,
          content,
          expectedMtimeMs: target.result.mtimeMs,
          force,
        });
        if (result.status === "conflict") {
          setConflictOpen(true);
          return false;
        }
        selfWriteAtRef.current = Date.now();
        setPreview((prev) =>
          prev &&
          prev.result.kind === "text" &&
          normalizePathKey(prev.path) === normalizePathKey(target.path)
            ? {
                ...prev,
                result: {
                  ...prev.result,
                  content,
                  byteLength: result.byteLength,
                  mtimeMs: result.mtimeMs,
                },
              }
            : prev,
        );
        editor.setBaseline(edited);
        setEditorBaseline(edited);
        setDirty(false);
        setExternalChanged(false);
        showToast(t("panels.files.savedToast"));
        return true;
      } catch (err) {
        showToast(
          t("panels.files.saveFailed", {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        return false;
      } finally {
        setSaveBusy(false);
      }
    },
    [showToast, t],
  );
  /** Ctrl+S 监听器只注册一次，通过 ref 取最新的保存函数。 */
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;

  /** 把磁盘上的新版本落到面板：无脏内容就静默换，有脏内容只挂提示。 */
  const applyDiskVersion = useCallback(async (): Promise<void> => {
    const target = activePreviewRef.current;
    if (!target) return;
    const result = await fsService.read(target.path).catch(() => null);
    if (!result) {
      showToast(t("panels.files.fileGone"));
      return;
    }
    // 读完再确认一次目标：期间可能已经切走 / 关了预览
    const latest = activePreviewRef.current;
    if (!latest || normalizePathKey(latest.path) !== normalizePathKey(target.path)) return;

    if (
      latest.result.kind === "text" &&
      result.kind === "text" &&
      result.content === latest.result.content
    ) {
      // 内容没变（常见于自家写入的回推）→ 只同步基线 mtime，免得下次保存误报冲突
      setPreview((prev) =>
        prev &&
        prev.result.kind === "text" &&
        normalizePathKey(prev.path) === normalizePathKey(target.path)
          ? { ...prev, result: { ...prev.result, mtimeMs: result.mtimeMs } }
          : prev,
      );
      return;
    }

    if (editingRef.current && (editorRef.current?.isDirty() ?? false)) {
      setExternalChanged(true);
      return;
    }

    setPreview({ ...latest, result });
    setExternalChanged(false);
    if (!editingRef.current) return;
    if (result.kind === "text") {
      setEditorBaseline(toEditorText(result.content));
      if (editorRef.current) {
        previewScrollAnchorRef.current = editorRef.current.getScrollAnchor();
      }
      setEditorReloadTick((n) => n + 1);
      setDirty(false);
      return;
    }
    // 文件在磁盘上变成了二进制 / 图片：编辑态失效
    dropEditing();
  }, [dropEditing, showToast, t]);

  // 预览打开期间监听所在目录（主进程按引用计数复用文件树已有的 watcher）
  const previewPath = activePreview?.path ?? null;
  useEffect(() => {
    if (!previewPath) return;
    const dir = parentDirPath(previewPath);
    if (!dir) return;
    void fsService.watch(dir);
    return () => {
      void fsService.unwatch(dir);
    };
  }, [previewPath]);

  useEffect(() => {
    const unsubscribe = fsService.onChanged((message) => {
      const target = activePreviewRef.current;
      if (!target || message.dirs.length === 0) return;
      if (
        message.paths &&
        !message.paths.some((file) => normalizePathKey(file) === normalizePathKey(target.path))
      ) {
        return;
      }
      // 自家保存的回推（watcher 是异步的）：不当外部改动处理
      if (Date.now() - selfWriteAtRef.current < SELF_WRITE_GRACE_MS) return;
      const dirKey = normalizeDirPath(parentDirPath(target.path));
      if (!message.dirs.some((dir) => normalizeDirPath(dir) === dirKey)) return;
      void applyDiskVersion();
    });
    return unsubscribe;
  }, [applyDiskVersion]);

  /** 冲突框里的「重新加载」：丢掉本地草稿，换成磁盘版本。 */
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    setConflictOpen(false);
    const target = activePreviewRef.current;
    if (!target) return;
    const result = await fsService.read(target.path).catch(() => null);
    if (!result) {
      showToast(t("panels.files.fileGone"));
      return;
    }
    setPreview((prev) =>
      prev && normalizePathKey(prev.path) === normalizePathKey(target.path)
        ? { ...prev, result }
        : prev,
    );
    setExternalChanged(false);
    if (result.kind !== "text") {
      dropEditing();
      return;
    }
    if (!editingRef.current) return;
    setEditorBaseline(toEditorText(result.content));
    if (editorRef.current) {
      previewScrollAnchorRef.current = editorRef.current.getScrollAnchor();
    }
    setEditorReloadTick((n) => n + 1);
    setDirty(false);
  }, [dropEditing, showToast, t]);

  /** 进编辑态：查找条让位，基线取当前磁盘内容。 */
  const beginEdit = (): void => {
    const target = activePreviewRef.current;
    if (!target) return;
    if (target.result.kind !== "text") return;
    find.close();
    previewRestorePendingRef.current = false;
    const previewBody = panelBodyRef.current;
    previewScrollAnchorRef.current = previewBody
      ? readPreviewScrollAnchor(previewBody)
      : { line: 1, offset: 0 };
    setEditorBaseline(toEditorText(target.result.content));
    setDirty(false);
    setExternalChanged(false);
    setEditing(true);
  };

  /** 退出编辑（脏内容先确认）。 */
  const requestExitEdit = (): void => {
    guardLeave(dropEditing);
  };

  // Ctrl+S 保存：编辑器内部也绑了 Mod-s（它 preventDefault 过，这里靠 defaultPrevented 让位）
  useEffect(() => {
    if (!active || !editing) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveDraftRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, editing]);

  /** 历史导航（后退/前进）：重读目标文件并恢复 :line 定位。 */
  const navigateHistory = useCallback(
    (delta: number): void => {
      const step = stepPreviewHistory(history, delta);
      if (!step) return;
      guardLeave(() => {
        setHistory({ entries: history.entries, index: step.index });
        openPreview(step.entry.path, undefined, step.entry.focusLine, "silent");
      });
    },
    [history, openPreview, guardLeave],
  );

  /** 关闭预览回到文件树：浏览历史一并作废，下次打开重新建栈。 */
  const closePreview = useCallback((): void => {
    setPreview(null);
    setHistory(emptyPreviewHistory);
    dropEditing();
  }, [dropEditing]);

  /** 多命中时退回快速打开列表，不瞎开第一个。 */
  const showSearchMatches = useCallback(
    (hits: FsSearchHit[], keyword: string): void => {
      setPreview(null);
      setHistory(emptyPreviewHistory);
      setPreviewLoading(false);
      setSelectedPath(null);
      setQuery(keyword);
      setMatches({ root: rootDir ?? "", hits });
      window.setTimeout(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      }, 0);
    },
    [rootDir],
  );

  // 会话区 FileLink 等发起的打开请求（docs/design/03 §5.1）
  // 只响应 tick 递增：root/cwd 变化不重放同一请求
  const openTick = fileOpenRequest?.tick;
  const openRequestRef = useRef(fileOpenRequest);
  openRequestRef.current = fileOpenRequest;
  const lastOpenTickRef = useRef<number | null>(null);

  useEffect(() => {
    if (openTick === undefined || openTick === lastOpenTickRef.current) return;
    lastOpenTickRef.current = openTick;
    const raw = openRequestRef.current?.path;
    if (!raw) return;
    let cancelled = false;
    setPreviewLoading(true);
    setImageSize(null);

    resolveForPreview(raw, sessionWorkingDir, rootDir)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved.status === "ok") {
          const { line } = parseLineCol(raw);
          // 有未保存草稿时先问一次，读取结果先挂着（多读一次文件无害）
          if (!guardLeave(() => openPreview(resolved.path, resolved.result, line))) {
            setPreviewLoading(false);
          }
          return;
        }
        setPreviewLoading(false);
        if (resolved.status === "ambiguous") {
          guardLeave(() =>
            showSearchMatches(resolved.hits, pathBasename(resolvePath(raw, sessionWorkingDir))),
          );
          return;
        }
        setPreviewLoading(false);
        guardLeave(() => {
          setPreview(null);
          showToast(t("panels.files.notFound", { path: raw }));
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewLoading(false);
          showToast(t("panels.files.openFailed", { path: raw }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    openTick,
    sessionWorkingDir,
    rootDir,
    openPreview,
    showSearchMatches,
    showToast,
    t,
    guardLeave,
  ]);

  // 树定位请求（命令面板目录命中）：退回树视图（预览/搜索列表让位），由 FileTree 展开定位
  const revealTick = fileRevealRequest?.tick;
  const lastRevealTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (revealTick === undefined || revealTick === lastRevealTickRef.current) return;
    lastRevealTickRef.current = revealTick;
    guardLeave(() => {
      setPreview(null);
      setMatches(null);
      setQuery("");
      dropEditing();
    });
  }, [revealTick, guardLeave, dropEditing]);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && matches && matches.root === rootDir && matches.hits.length > 0) {
      guardLeave(() => openPreview(matches.hits[0].path));
    }
  };

  const openInSystem = (path: string): void => {
    fsService.openPath(path).catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : t("panels.files.systemOpenFailed"));
    });
  };

  /** HTML 交由侧栏浏览器渲染（file:// 专用通道）：store 内聚了「打开 + 切 Tab」。 */
  const openInSideBrowser = (filePath: string): void => {
    void browserStore.openLocalFile(filePath);
  };

  const activeMatches = matches && matches.root === (rootDir ?? "") ? matches.hits : null;
  /** 可复制的全文：仅文本类预览有（图片/PDF/二进制不提供「复制全文」）。 */
  const previewText = activePreview?.result.kind === "text" ? activePreview.result.content : null;
  /** 当前预览能不能就地编辑（纯文本 + 未截断 + 非表格/Notebook；md 需源码态）。 */
  const editablePreview = activePreview !== null && isTextEditable(activePreview, mdViewMode);

  // 划选工具条的引用落点在输入栏：与会话区同一套置灰口径（切换中 / 阻断浮层 / 无会话）
  const hasBlockingView = hasBlockingViewFor(activeSessionId);
  const quoteDisabled = switchingTo !== null || hasBlockingView || activeSessionId === null;
  const quoteDisabledHint =
    switchingTo !== null
      ? t("session.restoringShort")
      : hasBlockingView
        ? t("session.blockedByOverlay")
        : activeSessionId === null
          ? t("panels.files.quoteNoSession")
          : "";

  /** 写剪贴板 + 双向反馈（与会话区同一范式）。 */
  const copyToClipboard = useCallback(
    (text: string): void => {
      void copyTextToClipboard(text).then((ok) =>
        showToast(ok ? t("toast.copied") : t("toast.copyFailed")),
      );
    },
    [showToast, t],
  );

  /** 「全选预览内容」：直接对滚动容器建选区，不依赖用户光标位置。 */
  const selectAllPreview = useCallback((): void => {
    const body = panelBodyRef.current;
    const selection = window.getSelection();
    if (!body || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(body);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  /**
   * 预览区右键：先抑掉 Chromium 默认菜单，再开自绘菜单（与会话区 docs/design/12 同口径）。
   * 没有预览时（文件树 / 搜索结果）只抑制，不给菜单——那些位置由各自的行菜单负责。
   */
  const openPreviewMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    // 编辑态交回 Chromium 原生菜单：剪切 / 粘贴是编辑的刚需，自绘菜单还没有剪贴板读写通道
    if (editing) return;
    event.preventDefault();
    if (!activePreview) return;
    const selection = window.getSelection();
    const body = panelBodyRef.current;
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const insideSelection =
      body !== null &&
      selection !== null &&
      range !== null &&
      !selection.isCollapsed &&
      body.contains(range.commonAncestorContainer);
    setPreviewMenu({
      x: event.clientX,
      y: event.clientY,
      selected: insideSelection ? selection.toString() : "",
    });
  };

  const previewMenuItems: MenuItem[] = previewMenu
    ? [
        {
          key: "selection",
          label: t("panels.files.copySelection"),
          disabled: previewMenu.selected.trim().length === 0,
          onSelect: () => copyToClipboard(previewMenu.selected),
        },
        { key: "selectAll", label: t("panels.files.selectAll"), onSelect: selectAllPreview },
        ...(editablePreview
          ? [{ key: "edit", label: t("panels.files.edit"), onSelect: beginEdit }]
          : []),
        ...(activePreview
          ? [
              {
                key: "copyPath",
                label: t("panels.files.copyPath"),
                dividerBefore: true,
                onSelect: () => copyToClipboard(toNativePath(activePreview.path)),
              },
              {
                key: "openSystem",
                label: t("panels.files.openInSystem"),
                onSelect: () => openInSystem(activePreview.path),
              },
            ]
          : []),
      ]
    : [];

  /**
   * 引用到输入栏：引用块首行标出来源文件，后面跟选中文本。
   * 不标行号 —— 划选是字符偏移，换算回行号要重新数行，得不偿失；文件路径已足够定位。
   */
  const quoteFromPreview = useCallback(
    (text: string): void => {
      if (!activePreview) return;
      const source = toNativePath(relativeToPath(rootDir ?? "", activePreview.path));
      quoteComposer(`${source}\n${text}`);
    },
    [activePreview, quoteComposer, rootDir],
  );

  return (
    <>
      {activePreview ? (
        <div className={panelStyles.previewHeader}>
          {!editing && (
            <>
              <IconButton
                title={
                  canGoBack(history) ? t("panels.files.backPrevious") : t("panels.files.backToTree")
                }
                onClick={() =>
                  guardLeave(() => (canGoBack(history) ? navigateHistory(-1) : closePreview()))
                }
              >
                <ArrowLeft size={16} weight="regular" />
              </IconButton>
              <IconButton
                title={t("panels.files.forwardNext")}
                disabled={!canGoForward(history)}
                onClick={() => guardLeave(() => navigateHistory(1))}
              >
                <ArrowRight size={16} weight="regular" />
              </IconButton>
            </>
          )}
          <span className={panelStyles.previewPath} title={activePreview.path}>
            {activePreview.path}
          </span>
          <span
            className={[
              panelStyles.previewMeta,
              editing && externalChanged
                ? panelStyles.warnMeta
                : editing && dirty
                  ? panelStyles.dirtyMeta
                  : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {editing
              ? externalChanged
                ? t("panels.files.externalChanged")
                : dirty
                  ? t("panels.files.unsaved")
                  : ""
              : previewMeta(activePreview.result, imageSize, t)}
          </span>
          {editing ? (
            <>
              <IconButton
                title={t("panels.files.saveHint")}
                disabled={saveBusy || !dirty}
                onClick={() => void saveDraft()}
              >
                <FloppyDisk size={16} weight="regular" />
              </IconButton>
              <IconButton title={t("panels.files.exitEdit")} onClick={requestExitEdit}>
                <X size={16} weight="regular" />
              </IconButton>
            </>
          ) : (
            <>
              {isMarkdownPath(activePreview.path) && (
                <IconButton
                  title={t("panels.files.mdToggle", {
                    mode:
                      mdViewMode === "preview"
                        ? t("panels.files.mdSource")
                        : t("panels.files.mdPreview"),
                  })}
                  onClick={() => setMdViewMode(mdViewMode === "preview" ? "source" : "preview")}
                >
                  {mdViewMode === "preview" ? (
                    <Eye size={16} weight="regular" />
                  ) : (
                    <EyeSlash size={16} weight="regular" />
                  )}
                </IconButton>
              )}
              {isHtmlPath(activePreview.path) && browserEnabled && (
                <IconButton
                  title={t("panels.files.openInBrowser")}
                  onClick={() => openInSideBrowser(activePreview.path)}
                >
                  <Globe size={16} weight="regular" />
                </IconButton>
              )}
              {previewText !== null && (
                <IconButton
                  title={t("panels.files.copyContent")}
                  onClick={() => copyToClipboard(previewText)}
                >
                  <Copy size={16} weight="regular" />
                </IconButton>
              )}
              {editablePreview && (
                <IconButton title={t("panels.files.edit")} onClick={beginEdit}>
                  <PencilSimple size={16} weight="regular" />
                </IconButton>
              )}
              <IconButton
                title={t("panels.files.openInSystem")}
                onClick={() => openInSystem(activePreview.path)}
              >
                <ArrowSquareOut size={16} weight="regular" />
              </IconButton>
            </>
          )}
        </div>
      ) : (
        <div className={panelStyles.searchToolbar}>
          <div className={panelStyles.searchRow}>
            <MagnifyingGlass size={16} weight="regular" className={panelStyles.searchIcon} />
            <input
              ref={searchRef}
              className={panelStyles.searchInput}
              placeholder={t("panels.files.quickOpenPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              disabled={!rootDir}
            />
          </div>
          {rootDir && <WorkdirChip dir={rootDir} />}
        </div>
      )}
      {activePreview && find.open && !editing && (
        <PreviewFindBar
          query={find.query}
          count={find.count}
          current={find.current}
          onQuery={find.setQuery}
          onStep={find.step}
          onClose={find.close}
        />
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 预览是只读阅读面，右键只用来开复制菜单/抑制浏览器默认菜单，不伪装成交互 role */}
      <div
        className={[styles.panelBody, editing ? panelStyles.panelBodyEditing : ""]
          .filter(Boolean)
          .join(" ")}
        ref={panelBodyRef}
        onContextMenu={openPreviewMenu}
      >
        {editing && activePreview ? (
          <CodeEditor
            key={`${activePreview.path}#${editorReloadTick}`}
            ref={editorRef}
            filePath={activePreview.path}
            doc={
              activePreview.result.kind === "text" ? toEditorText(activePreview.result.content) : ""
            }
            baseline={editorBaseline}
            focusLine={activePreview.focusLine}
            scrollAnchor={previewScrollAnchorRef.current}
            loadingLabel={t("panels.files.editorLoading")}
            failedLabel={t("panels.files.editorFailed")}
            ariaLabel={t("panels.files.editorAria", { path: activePreview.path })}
            onDirtyChange={setDirty}
            onSave={() => void saveDraftRef.current()}
          />
        ) : !rootDir && !activePreview ? (
          <p className={panelStyles.noMatch}>{t("panels.files.selectProject")}</p>
        ) : activePreview ? (
          <FilePreviewBody
            preview={activePreview}
            onImageSize={setImageSize}
            onOpenInSystem={() => openInSystem(activePreview.path)}
            mdMode={mdViewMode}
            onCodeLayout={restorePreviewAfterCodeLayout}
          />
        ) : previewLoading ? (
          <p className={panelStyles.noMatch}>{t("panels.files.loading")}</p>
        ) : activeMatches !== null ? (
          activeMatches.length > 0 ? (
            <ul className={panelStyles.matchList}>
              {activeMatches.map((hit) => (
                <li key={hit.path}>
                  <button
                    type="button"
                    className={[
                      panelStyles.matchItem,
                      selectedPath !== null &&
                      normalizePathKey(selectedPath) === normalizePathKey(hit.path)
                        ? panelStyles.selected
                        : "",
                    ].join(" ")}
                    onClick={() => guardLeave(() => openPreview(hit.path))}
                  >
                    <span className={panelStyles.matchName}>
                      {hit.displayPath.split("/").at(-1)}
                    </span>
                    <span className={panelStyles.matchPath}>{hit.displayPath}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={panelStyles.noMatch}>{t("panels.files.noMatch")}</p>
          )
        ) : null}
        {rootDir && (
          <div hidden={activePreview !== null || previewLoading || activeMatches !== null}>
            <FileTree
              rootDir={rootDir}
              selectedPath={selectedPath}
              onSelectFile={(path) => guardLeave(() => openPreview(path))}
              active={active && activePreview === null && !previewLoading && activeMatches === null}
              revealRequest={fileRevealRequest}
            />
          </div>
        )}
      </div>
      {previewMenu && (
        <ContextMenu
          position={{ x: previewMenu.x, y: previewMenu.y }}
          items={previewMenuItems}
          onClose={() => setPreviewMenu(null)}
        />
      )}
      {/* 常驻挂载：自身按 selectionchange 命令式显隐，划选预览正文才出现（docs/design/81）。
          编辑态撤掉：工具条会压在正当输入的文本上 */}
      {!editing && (
        <SelectionToolbar
          containerRef={panelBodyRef}
          quoteDisabled={quoteDisabled}
          quoteDisabledHint={quoteDisabledHint}
          onCopy={copyToClipboard}
          onQuote={quoteFromPreview}
        />
      )}
      <ConfirmDialog
        open={leaveOpen}
        title={t("panels.files.discardTitle")}
        message={t("panels.files.discardMessage", { path: activePreview?.path ?? "" })}
        confirmLabel={t("panels.files.discardConfirm")}
        secondaryLabel={t("panels.files.saveAndContinue")}
        cancelLabel={t("panels.files.keepEditing")}
        tone="danger"
        busy={saveBusy}
        onConfirm={() => {
          const action = pendingLeaveRef.current;
          pendingLeaveRef.current = null;
          setLeaveOpen(false);
          dropEditing();
          action?.();
        }}
        onSecondary={() => {
          const action = pendingLeaveRef.current;
          pendingLeaveRef.current = null;
          setLeaveOpen(false);
          void saveDraft().then((saved) => {
            if (saved) action?.();
          });
        }}
        onCancel={() => {
          pendingLeaveRef.current = null;
          setLeaveOpen(false);
        }}
      />
      <ConfirmDialog
        open={conflictOpen}
        title={t("panels.files.conflictTitle")}
        message={t("panels.files.conflictMessage", { path: activePreview?.path ?? "" })}
        confirmLabel={t("panels.files.conflictOverwrite")}
        secondaryLabel={t("panels.files.conflictReload")}
        cancelLabel={t("panels.files.keepEditing")}
        busy={saveBusy}
        onConfirm={() => {
          setConflictOpen(false);
          void saveDraft(true);
        }}
        onSecondary={() => void reloadFromDisk()}
        onCancel={() => setConflictOpen(false)}
      />
    </>
  );
}

/** 预览本体：按读取结果 kind 分流（代码高亮 / 图片 / 二进制占位 / Markdown 文档流）。 */
function FilePreviewBody({
  preview,
  onImageSize,
  onOpenInSystem,
  mdMode,
  onCodeLayout,
}: {
  preview: PreviewState;
  onImageSize: (size: string | null) => void;
  onOpenInSystem: () => void;
  mdMode: MarkdownViewMode;
  onCodeLayout: (stable: boolean) => void;
}) {
  const t = useT();
  const { result } = preview;

  if (result.kind === "image") {
    return (
      <div className={panelStyles.imageWrap}>
        <img
          className={panelStyles.image}
          src={result.dataUrl}
          alt={preview.path}
          draggable={false}
          onLoad={(event) => {
            const img = event.currentTarget;
            onImageSize(`${img.naturalWidth}×${img.naturalHeight}`);
          }}
          onError={() => onImageSize(null)}
        />
      </div>
    );
  }

  if (result.kind === "pdf") {
    return <PdfPreview result={result} />;
  }

  if (result.kind === "binary") {
    return (
      <div className={panelStyles.binaryWrap}>
        <p className={panelStyles.binaryTitle}>{t("panels.files.cannotPreview")}</p>
        <p className={panelStyles.binaryMeta}>
          {formatBytes(result.byteLength)} · {t("panels.files.binaryFile")}
        </p>
        <button type="button" className={panelStyles.binaryAction} onClick={onOpenInSystem}>
          <ArrowSquareOut size={16} weight="regular" />
          {t("panels.files.openInSystem")}
        </button>
      </div>
    );
  }

  // Markdown 按文档流渲染（预览/源码切换）；其余文本走源码高亮
  if (isMarkdownPath(preview.path)) {
    return (
      <MarkdownPreview
        path={preview.path}
        content={result.content}
        truncated={result.truncated}
        mode={mdMode}
        focusLine={preview.focusLine}
      />
    );
  }

  if (isTabularPath(preview.path)) {
    return (
      <DelimitedPreview
        path={preview.path}
        content={result.content}
        sourceTruncated={result.truncated}
      />
    );
  }

  if (isNotebookPath(preview.path)) {
    return <NotebookPreview path={preview.path} content={result.content} />;
  }

  return (
    <>
      {result.truncated && (
        <p className={panelStyles.truncatedNote}>{t("panels.files.truncatedNote")}</p>
      )}
      <CodeHighlight
        key={`${preview.path}:${preview.focusLine ?? 0}`}
        code={formatJsonPreview(preview.path, result.content, result.truncated)}
        filePath={preview.path}
        className={panelStyles.previewContent}
        focusLine={preview.focusLine}
        onLayout={onCodeLayout}
      />
    </>
  );
}
