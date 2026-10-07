import { Archive, DotsThree, FolderOpen, Pen, Trash } from "@phosphor-icons/react";
import { t as translate } from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { isPendingFile } from "../../stores/sessionStore";
import type { MenuItem } from "../ui/Menu";
import { Menu } from "../ui/Menu";
import { RevealOnRowHover } from "./RevealOnRowHover";
import styles from "./SideNav.module.css";

interface RowMenuProps {
  /** 无障碍标签（如"更多操作：pidesk"）；按钮 tooltip 固定为"更多操作"。 */
  label: string;
  /** 菜单条目；返回 null 的条件条目（如"没有工作目录就没有打开文件夹"）在此统一剔除。 */
  items: (MenuItem | null)[];
}

/**
 * 侧栏行内"更多操作"（⋯）：**项目行与历史条目共用同一个入口组件**——
 * 菜单形状、悬浮揭示、开合高亮、图标与文案间距都只在这里定义，避免两处各写一套后走样。
 *
 * 条件条目传 null 即可（本组件会过滤掉），调用处不必写展开语法。
 */
export function RowMenu({ label, items }: RowMenuProps) {
  const t = useT();
  const visible = items.filter((item): item is MenuItem => item !== null);
  return (
    <RevealOnRowHover>
      <Menu
        align="right"
        direction="bottom"
        trigger={({ open, onClick }) => (
          <button
            type="button"
            className={[styles.rowButton, open ? styles.rowButtonOpen : ""].join(" ")}
            title={t("sidenav.row.moreActions")}
            aria-label={label}
            aria-haspopup="menu"
            onClick={onClick}
          >
            <DotsThree size={16} weight="regular" />
          </button>
        )}
        items={visible}
      />
    </RevealOnRowHover>
  );
}

/**
 * 行内菜单的「打开文件夹」动作：失败把可读原因交给调用方提示，不静默——
 * 目录被移走/删掉是最常见的失败原因，静默会表现成"点了没反应"。
 */
export async function revealFolder(dir: string, onError: (message: string) => void): Promise<void> {
  try {
    await fsService.openPath(dir);
  } catch (err) {
    onError(err instanceof Error ? err.message : translate("sidenav.row.openFolderFailed"));
  }
}

/**
 * 「打开文件夹」条目；dir 为空（没有工作目录的历史条目）时返回 null = 整行不展示。
 * 图标、文案、动作都在这里定义：项目行与会话条目必须是同一个入口，不能一处一变。
 */
export function openFolderItem(
  dir: string | null,
  onError: (message: string) => void,
): MenuItem | null {
  if (!dir) return null;
  const target = dir;
  return {
    key: "reveal",
    label: translate("sidenav.session.openFolder"),
    icon: <FolderOpen size={16} weight="regular" />,
    onSelect: () => {
      void revealFolder(target, onError);
    },
  };
}

/** 「删除…」条目：文字与图标统一用危险色（tone 由 Menu 落到样式，调用处不要各写一套）。 */
export function deleteItem(label: string, onSelect: () => void): MenuItem {
  return {
    key: "remove",
    label,
    tone: "danger",
    icon: <Trash size={16} weight="regular" />,
    onSelect,
  };
}

/** 「重命名」条目（目前只有会话条目用）。 */
export function renameItem(onSelect: () => void): MenuItem {
  return {
    key: "rename",
    label: translate("sidenav.session.rename"),
    icon: <Pen size={16} weight="regular" />,
    onSelect,
  };
}

/**
 * 「归档」条目（docs/design/32）：归档可逆（设置 → 已归档对话可恢复），无需确认。
 * pending 占位行还没落盘 JSONL，无档可归，返回 null = 整行不展示。
 */
export function archiveItem(file: string, onSelect: () => void): MenuItem | null {
  if (isPendingFile(file)) return null;
  return {
    key: "archive",
    label: translate("sidenav.session.archive"),
    icon: <Archive size={16} weight="regular" />,
    onSelect,
  };
}
