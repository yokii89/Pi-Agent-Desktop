import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { resolvePath } from "../../utils/fileOpen";
import styles from "./FileLink.module.css";

interface FileLinkProps {
  /** Windows / POSIX 路径，可带 :line[:column]。 */
  path: string;
  /** 展示文案；缺省时显示完整 path。 */
  label?: string;
  className?: string;
  /** tooltip 文案；缺省时展示完整 path。 */
  title?: string;
  /**
   * 覆盖主点击动作（缺省 = 在右侧文件面板预览）。
   * Ctrl/Cmd+点击不受影响，始终交系统默认程序。
   */
  onOpen?: () => void;
}

/**
 * 可点击文件路径：主点击在右侧文件面板预览（或由 onOpen 接管，如编辑汇总卡跳审阅）；
 * Ctrl/Cmd+点击保留系统默认程序打开。
 */
export function FileLink({ path: rawPath, label, className, title, onOpen }: FileLinkProps) {
  const t = useT();
  const { sessionWorkingDir } = useSessionMeta();
  const { dispatch, showToast } = useUiStore();

  const open = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      const resolved = resolvePath(rawPath, sessionWorkingDir);
      void fsService.openPath(resolved).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : t("session.fileLink.openFailed"));
      });
      return;
    }
    if (onOpen) {
      onOpen();
      return;
    }
    dispatch({ type: "openFileInPanel", path: rawPath });
  };

  return (
    <button
      type="button"
      className={`${styles.link} ${className ?? ""}`}
      onClick={open}
      title={title ?? t("session.fileLink.title", { path: rawPath })}
    >
      {label ?? rawPath}
    </button>
  );
}

/** 判断一段 code 文本是否更像文件路径（供 Markdown code renderer 分流）。 */
export function looksLikeFilePath(text: string): boolean {
  if (text.includes(" ") || text.includes("\n")) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/^[a-zA-Z]:[\\/].+/.test(text)) return true;
  // `@/components/Foo.tsx` 等别名前缀
  if (/^@\//.test(text) && /[\w./-]+\.[a-zA-Z]+$/.test(text)) return true;
  if (/^[\w.-]+\/[\w./-]+$/.test(text) && text.includes(".")) return true;
  if (
    /^[\w./\\-]+\.(ts|tsx|js|jsx|css|json|md|py|rs|go|java|c|cpp|h|html|svg|yml|yaml|vue|svelte|astro|scss|less)$/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/^[\w./\\-]+:\d+/.test(text)) return true;
  return false;
}
