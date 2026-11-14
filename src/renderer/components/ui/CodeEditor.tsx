import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import type {
  CodeEditorHandle,
  CodeEditorMountHandle,
  CodeScrollAnchor,
} from "../../editor/codeEditorTypes";
import { useResolvedTheme } from "../../hooks/useResolvedTheme";
import styles from "./CodeEditor.module.css";

interface CodeEditorProps {
  /** 文档身份（路径）：只用于推断语法高亮语言。 */
  filePath: string;
  /** 挂载时的文档内容。换文件 / 外部重载请换 `key`（本组件不受控）。 */
  doc: string;
  /** 挂载后恢复的阅读锚点。 */
  scrollAnchor: CodeScrollAnchor;
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
}

/**
 * 侧栏就地编辑器（docs/design/141）：CodeMirror 6 经动态 `import()` 懒加载，
 * 只有真正进入编辑态才下载编辑器与语言包——文件面板默认是只读预览，不该为它付启动成本。
 *
 * 不受控：文档由编辑器自己持有，父组件保存时才 `getValue()` 取全文，
 * 避免每次按键都让 FilePanel 带着整份草稿重渲染。
 */
export function CodeEditor({
  filePath,
  doc,
  scrollAnchor,
  baseline,
  focusLine,
  loadingLabel,
  failedLabel,
  ariaLabel,
  onDirtyChange,
  onSave,
  ref,
}: CodeEditorProps & { ref?: Ref<CodeEditorHandle> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CodeEditorMountHandle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const theme = useResolvedTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // 挂载参数取挂载时刻的值：后续变化走下面的基线 / 主题同步（换文件由 key 重建）
  const mountRef = useRef({
    doc,
    filePath,
    focusLine,
    scrollAnchor,
    ariaLabel,
    onDirtyChange,
    onSave,
  });
  mountRef.current = { doc, filePath, focusLine, scrollAnchor, ariaLabel, onDirtyChange, onSave };

  // 生命周期只与挂载相关：换文件由 key 重建，主题 / 基线走下面的独立同步效果
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const current = mountRef.current;
    void import("../../editor/codeEditor")
      .then((mod) => {
        if (cancelled) return;
        handleRef.current = mod.mountCodeEditor({
          parent: host,
          doc: current.doc,
          filePath: current.filePath,
          focusLine: current.focusLine ?? null,
          scrollAnchor: current.scrollAnchor,
          ariaLabel: current.ariaLabel,
          dark: themeRef.current === "dark",
          onDirtyChange: (dirty) => mountRef.current.onDirtyChange(dirty),
          onSave: () => mountRef.current.onSave(),
        });
        setStatus("ready");
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
