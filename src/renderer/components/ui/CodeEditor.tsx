import { type Ref, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type {
  CodeEditorHandle,
  CodeEditorMountHandle,
  CodeScrollAnchor,
  CodeSearchQuery,
  CodeSearchResult,
} from "../../editor/codeEditorTypes";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import styles from "./CodeEditor.module.css";

const EMPTY_SEARCH_RESULT: CodeSearchResult = { count: 0, current: 0, valid: false };

interface CodeEditorProps {
  /** 文档身份（路径）：只用于推断语法高亮语言。 */
  filePath: string;
  /** 挂载时的文档内容。换文件 / 外部重载请换 `key`（本组件不受控）。 */
  doc: string;
  readOnly: boolean;
  /** 挂载后恢复的阅读锚点。 */
  scrollAnchor?: CodeScrollAnchor;
  /** 脏判定基线：保存成功后父层传入新内容。 */
  baseline: string;
  /** `path:line` 打开时滚到该行（1-based）。 */
  focusLine?: number | null;
  /** 编辑器就绪前的占位文案（懒加载 chunk 的第一帧）。 */
  loadingLabel: string;
  /** 懒加载失败时的占位文案（chunk 缺失 / 资源被清掉）。 */
  failedLabel: string;
  ariaLabel: string;
  onDirtyChange: (dirty: boolean) => void;
  onSave: () => void;
  onFind: () => void;
}

/**
 * 文件源码视图：CodeMirror 6 在首次打开源码时懒加载，读写模式共用同一个实例。
 *
 * 不受控：文档由编辑器自己持有，父组件保存时才 `getValue()` 取全文，
 * 避免每次按键都让 FilePanel 带着整份草稿重渲染。
 */
export function CodeEditor({
  filePath,
  doc,
  readOnly,
  scrollAnchor,
  baseline,
  focusLine,
  loadingLabel,
  failedLabel,
  ariaLabel,
  onDirtyChange,
  onSave,
  onFind,
  ref,
}: CodeEditorProps & { ref?: Ref<CodeEditorHandle> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CodeEditorMountHandle | null>(null);
  const selectionListeners = useRef(new Set<() => void>());
  const searchListeners = useRef(new Set<() => void>());
  const searchQueryRef = useRef<CodeSearchQuery | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const theme = useResolvedTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // 挂载参数取挂载时刻的值：后续变化走下面的基线 / 主题同步（换文件由 key 重建）
  const mountRef = useRef({
    doc,
    readOnly,
    filePath,
    focusLine,
    scrollAnchor,
    ariaLabel,
    onDirtyChange,
    onSave,
    onFind,
  });
  mountRef.current = {
    doc,
    readOnly,
    filePath,
    focusLine,
    scrollAnchor,
    ariaLabel,
    onDirtyChange,
    onSave,
    onFind,
  };

  // 生命周期只与挂载相关：换文件由 key 重建，主题 / 基线走下面的独立同步效果
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    void import("../../editor/codeEditor")
      .then((mod) => {
        if (cancelled) return;
        // Loading may overlap a mode change or disk reload; mount the latest props.
        const current = mountRef.current;
        handleRef.current = mod.mountCodeEditor({
          parent: host,
          doc: current.doc,
          readOnly: current.readOnly,
          filePath: current.filePath,
          focusLine: current.focusLine ?? null,
          scrollAnchor: current.scrollAnchor,
          ariaLabel: current.ariaLabel,
          dark: themeRef.current === "dark",
          onDirtyChange: (dirty) => mountRef.current.onDirtyChange(dirty),
          onSave: () => mountRef.current.onSave(),
          onSelectionChange: () => {
            for (const listener of selectionListeners.current) listener();
          },
          onFind: () => mountRef.current.onFind(),
          onSearchChange: () => {
            for (const listener of searchListeners.current) listener();
          },
        });
        if (searchQueryRef.current) handleRef.current.setSearchQuery(searchQueryRef.current);
        setStatus("ready");
        for (const listener of searchListeners.current) listener();
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    handleRef.current?.setReadOnly(readOnly);
  }, [readOnly]);

  useEffect(() => {
    handleRef.current?.setBaseline(baseline);
  }, [baseline]);

  useEffect(() => {
    handleRef.current?.setTheme(theme === "dark");
  }, [theme]);

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => handleRef.current?.getValue() ?? "",
      isReady: () => handleRef.current !== null,
      getSelectedText: () => handleRef.current?.getSelectedText() ?? "",
      getSelection: () => handleRef.current?.getSelection() ?? null,
      subscribeSelection: (listener) => {
        selectionListeners.current.add(listener);
        return () => {
          selectionListeners.current.delete(listener);
        };
      },
      selectAll: () => handleRef.current?.selectAll(),
      clearSelection: () => handleRef.current?.clearSelection(),
      openFind: () => mountRef.current.onFind(),
      getSearchResult: () => handleRef.current?.getSearchResult() ?? EMPTY_SEARCH_RESULT,
      subscribeSearch: (listener) => {
        searchListeners.current.add(listener);
        return () => {
          searchListeners.current.delete(listener);
        };
      },
      setSearchQuery: (query) => {
        searchQueryRef.current = query;
        handleRef.current?.setSearchQuery(query);
      },
      stepSearch: (delta) => handleRef.current?.stepSearch(delta),
      replaceSearch: (all) => handleRef.current?.replaceSearch(all),
      selectSearchMatches: () => handleRef.current?.selectSearchMatches(),
      closeFind: () => {
        searchQueryRef.current = null;
        handleRef.current?.closeFind();
      },
      resetDocument: (text) => handleRef.current?.resetDocument(text),
      isDirty: () => handleRef.current?.isDirty() ?? false,
      recomputeDirty: () => handleRef.current?.recomputeDirty(),
      setBaseline: (text: string) => handleRef.current?.setBaseline(text),
      getScrollAnchor: () => handleRef.current?.getScrollAnchor() ?? { line: 1, offset: 0 },
      focus: () => handleRef.current?.focus(),
    }),
    [],
  );

  return (
    // data-selectable-text：body 是 user-select:none，编辑区正文必须放开（AGENTS「只读正文可选」条款）
    <div className={styles.host} data-selectable-text="">
      <div className={styles.mount} ref={hostRef} />
      {status !== "ready" && (
        <p className={styles.placeholder}>{status === "failed" ? failedLabel : loadingLabel}</p>
      )}
    </div>
  );
}
