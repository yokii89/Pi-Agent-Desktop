import { X } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import type { TerminalTab as TerminalTabData } from "../../stores/terminalStore";
import styles from "./TerminalPanel.module.css";

interface TerminalTabProps {
  tab: TerminalTabData;
  active: boolean;
  /** 内联重命名中：标题替换为输入框。 */
  renaming: boolean;
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onStartRename: () => void;
  onRenameCommit: (title: string) => void;
  onRenameCancel: () => void;
}

/**
 * 终端 Tab 头：标题 + Tab 内关闭 ×。
 * 右键弹出实例菜单；双击标题进入内联重命名（Enter/失焦提交，Escape 取消）。
 * Tab 内 × 是真正的进程销毁，与面板隐藏严格区分。
 */
export function TerminalTab({
  tab,
  active,
  renaming,
  onSelect,
  onClose,
  onContextMenu,
  onStartRename,
  onRenameCommit,
  onRenameCancel,
}: TerminalTabProps) {
  const t = useT();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Tab 容器承接右键实例菜单，选择/关闭的交互语义由内部按钮承担
    <div
      className={[styles.tab, active ? styles.tabActive : ""].join(" ")}
      onContextMenu={onContextMenu}
    >
      {renaming ? (
        <input
          className={styles.renameInput}
          defaultValue={tab.title}
          maxLength={40}
          aria-label={t("terminal.renameAria")}
          // 挂载即聚焦并全选，直接输入新名字
          ref={(el) => {
            if (!el) return;
            el.focus();
            el.select();
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRenameCommit(event.currentTarget.value);
            else if (event.key === "Escape") onRenameCancel();
          }}
          onBlur={(event) => onRenameCommit(event.currentTarget.value)}
        />
      ) : (
        <button
          type="button"
          className={styles.tabTitle}
          title={tab.cwd}
          aria-current={active ? "true" : undefined}
          onClick={onSelect}
          onDoubleClick={onStartRename}
        >
          {tab.title}
        </button>
      )}
      <button
        type="button"
        className={styles.tabClose}
        title={t("terminal.closeTabTitle")}
        aria-label={t("terminal.closeTabAria", { title: tab.title })}
        onClick={onClose}
      >
        <X size={12} weight="regular" />
      </button>
    </div>
  );
}
