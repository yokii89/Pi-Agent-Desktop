import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Globe,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isHtmlPath, isMarkdownPath } from "../../../../shared/fileKinds";
import type { TranslateFn } from "../../../../shared/i18n";
import type { FsReadResult, FsSearchHit } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import { fsService } from "../../../services/fsService";
import { useBrowserStore } from "../../../stores/browserStore";
import { useProjectStore } from "../../../stores/projectStore";
import { useSessionMeta } from "../../../stores/sessionStore";
import { useUiStore } from "../../../stores/uiStore";
import {
  normalizePathKey,
  parseLineCol,
  pathBasename,
  resolveForPreview,
  resolvePath,
} from "../../../utils/fileOpen";
import {
  canGoBack,
  canGoForward,
  emptyPreviewHistory,
  type PreviewHistory,
  pushPreviewHistory,
  stepPreviewHistory,
} from "../../../utils/previewHistory";
import { CodeHighlight, countCodeLines } from "../../ui/CodeHighlight";
import { IconButton } from "../../ui/IconButton";
import styles from "../ContextSidebar.module.css";
import panelStyles from "./FilePanel.module.css";
import { FileTree } from "./FileTree";
import { MarkdownPreview, type MarkdownViewMode } from "./MarkdownPreview";

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

/** 右侧"文件"Tab：快速打开搜索 + 项目文件树 + 只读预览（docs/design/03 §5）。 */
export function FilePanel({ active = true }: { active?: boolean }) {
  const t = useT();
  const { showToast, fileSearchTick, fileOpenRequest, fileRevealRequest, browserEnabled } =
    useUiStore();
  const browserStore = useBrowserStore();
  const { currentProject } = useProjectStore();
  const { sessionWorkingDir } = useSessionMeta();
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
  /** 预览读取序号：丢弃过期读取结果（快速连开文件 / 历史导航连点）。 */
  const previewSeqRef = useRef(0);
  /** 预览/打开请求的 root 标记：无项目时用 ""，切项目后旧预览失效。 */
  const rootKey = rootDir ?? "";

  // Ctrl+P 打开/重复触发时聚焦搜索框（fileSearchTick 每次触发都递增）
  useEffect(() => {
    if (fileSearchTick >= 0) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [fileSearchTick]);

  // 项目切换后浏览历史整体失效（条目里的旧 root 不再可达）
  // biome-ignore lint/correctness/useExhaustiveDependencies: rootKey 是重置信号，效果体内不直接引用
  useEffect(() => {
    setHistory(emptyPreviewHistory);
  }, [rootKey]);

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
      setImageSize(null);
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

  /** 历史导航（后退/前进）：重读目标文件并恢复 :line 定位。 */
  const navigateHistory = useCallback(
    (delta: number): void => {
      const step = stepPreviewHistory(history, delta);
      if (!step) return;
      setHistory({ entries: history.entries, index: step.index });
      openPreview(step.entry.path, undefined, step.entry.focusLine, "silent");
    },
    [history, openPreview],
  );

  /** 关闭预览回到文件树：浏览历史一并作废，下次打开重新建栈。 */
  const closePreview = useCallback((): void => {
    setPreview(null);
    setHistory(emptyPreviewHistory);
  }, []);

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
          openPreview(resolved.path, resolved.result, line);
          return;
        }
        setPreviewLoading(false);
        if (resolved.status === "ambiguous") {
          showSearchMatches(resolved.hits, pathBasename(resolvePath(raw, sessionWorkingDir)));
          return;
        }
        setPreview(null);
        showToast(t("panels.files.notFound", { path: raw }));
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
  }, [openTick, sessionWorkingDir, rootDir, openPreview, showSearchMatches, showToast, t]);

  // 树定位请求（命令面板目录命中）：退回树视图（预览/搜索列表让位），由 FileTree 展开定位
  const revealTick = fileRevealRequest?.tick;
  const lastRevealTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (revealTick === undefined || revealTick === lastRevealTickRef.current) return;
    lastRevealTickRef.current = revealTick;
    setPreview(null);
    setMatches(null);
    setQuery("");
  }, [revealTick]);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && matches && matches.root === rootDir && matches.hits.length > 0) {
      openPreview(matches.hits[0].path);
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

  const activePreview = preview && preview.root === rootKey ? preview : null;
  const activeMatches = matches && matches.root === (rootDir ?? "") ? matches.hits : null;

  return (
    <>
      {activePreview ? (
        <div className={panelStyles.previewHeader}>
          <IconButton
            title={
              canGoBack(history) ? t("panels.files.backPrevious") : t("panels.files.backToTree")
            }
            onClick={() => (canGoBack(history) ? navigateHistory(-1) : closePreview())}
          >
            <ArrowLeft size={16} weight="regular" />
          </IconButton>
          <IconButton
            title={t("panels.files.forwardNext")}
            disabled={!canGoForward(history)}
            onClick={() => navigateHistory(1)}
          >
            <ArrowRight size={16} weight="regular" />
          </IconButton>
          <span className={panelStyles.previewPath} title={activePreview.path}>
            {activePreview.path}
          </span>
          <span className={panelStyles.previewMeta}>
            {previewMeta(activePreview.result, imageSize, t)}
          </span>
          {isHtmlPath(activePreview.path) && browserEnabled && (
            <IconButton
              title={t("panels.files.openInBrowser")}
              onClick={() => openInSideBrowser(activePreview.path)}
            >
              <Globe size={16} weight="regular" />
            </IconButton>
          )}
          <IconButton
            title={t("panels.files.openInSystem")}
            onClick={() => openInSystem(activePreview.path)}
          >
            <ArrowSquareOut size={16} weight="regular" />
          </IconButton>
        </div>
      ) : (
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
      )}
      <div className={styles.panelBody}>
        {!rootDir && !activePreview ? (
          <p className={panelStyles.noMatch}>{t("panels.files.selectProject")}</p>
        ) : activePreview ? (
          <FilePreviewBody
            preview={activePreview}
            onImageSize={setImageSize}
            onOpenInSystem={() => openInSystem(activePreview.path)}
            mdMode={mdViewMode}
            onMdModeChange={setMdViewMode}
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
                    onClick={() => openPreview(hit.path)}
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
        ) : (
          <FileTree
            rootDir={rootDir ?? ""}
            selectedPath={selectedPath}
            onSelectFile={(path) => openPreview(path)}
            active={active}
            revealRequest={fileRevealRequest}
          />
        )}
      </div>
    </>
  );
}

/** 预览本体：按读取结果 kind 分流（代码高亮 / 图片 / 二进制占位 / Markdown 文档流）。 */
function FilePreviewBody({
  preview,
  onImageSize,
  onOpenInSystem,
  mdMode,
  onMdModeChange,
}: {
  preview: PreviewState;
  onImageSize: (size: string | null) => void;
  onOpenInSystem: () => void;
  mdMode: MarkdownViewMode;
  onMdModeChange: (mode: MarkdownViewMode) => void;
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
        onModeChange={onMdModeChange}
        focusLine={preview.focusLine}
      />
    );
  }

  return (
    <>
      {result.truncated && (
        <p className={panelStyles.truncatedNote}>{t("panels.files.truncatedNote")}</p>
      )}
      <CodeHighlight
        key={`${preview.path}:${preview.focusLine ?? 0}`}
        code={result.content}
        filePath={preview.path}
        className={panelStyles.previewContent}
        focusLine={preview.focusLine}
      />
    </>
  );
}
