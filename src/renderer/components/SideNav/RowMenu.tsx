import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  DotsThree,
  EnvelopeSimple,
  Export,
  FileHtml,
  FileMd,
  FolderOpen,
  Pen,
  PushPin,
  PushPinSimple,
  PushPinSimpleSlash,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react";
import { useEffect } from "react";
import { t as translate } from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { sessionService } from "../../services/sessionService";
import { isPendingFile } from "../../stores/sessionStore";
import type { MenuItem } from "../ui/Menu";
import { Menu } from "../ui/Menu";
import { RevealOnRowHover } from "./RevealOnRowHover";
import styles from "./SideNav.module.css";

/**
 * 行菜单图标只创建一次：React 元素不可变，可在多行/多次渲染间复用。
 * 历史列表每次重渲染都会重建菜单条目，按行新建 Phosphor 元素是这里的主要分配开销。
 */
const ICONS = {
  more: <DotsThree size={16} weight="regular" />,
  copy: <Copy size={16} weight="regular" />,
  rename: <Pen size={16} weight="regular" />,
  folder: <FolderOpen size={16} weight="regular" />,
  export: <Export size={16} weight="regular" />,
  exportHtml: <FileHtml size={16} weight="regular" />,
  exportMarkdown: <FileMd size={16} weight="regular" />,
  pinGlobal: <PushPin size={16} weight="regular" />,
  unpinGlobal: <PushPinSlash size={16} weight="regular" />,
  pinWorkspace: <PushPinSimple size={16} weight="regular" />,
  unpinWorkspace: <PushPinSimpleSlash size={16} weight="regular" />,
  unread: <EnvelopeSimple size={16} weight="regular" />,
  archive: <Archive size={16} weight="regular" />,
  trash: <Trash size={16} weight="regular" />,
  moveUp: <ArrowUp size={16} weight="regular" />,
  moveDown: <ArrowDown size={16} weight="regular" />,
} as const;

interface RowMenuProps {
  /** 无障碍标签（如"更多操作：pidesk"）；按钮 tooltip 固定为"更多操作"。 */
  label: string;
  /** 菜单条目；返回 null 的条件条目（如"没有工作目录就没有打开文件夹"）在此统一剔除。 */
  items: (MenuItem | null)[];
  /** 菜单开合回调（HistoryItem 借此在菜单打开时收起悬浮详情卡，避免卡片压住菜单）。 */
  onOpenChange?: (open: boolean) => void;
}

/** 把 Popover 的 open 状态转成回调（trigger 是渲染函数，hook 不能写在里面）。 */
function OpenNotifier({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  useEffect(() => {
    onChange(open);
  }, [open, onChange]);
  return null;
}

/**
 * 侧栏行内"更多操作"（⋯）：**项目行与历史条目共用同一个入口组件**——
 * 菜单形状、悬浮揭示、开合高亮、图标与文案间距都只在这里定义，避免两处各写一套后走样。
 *
 * 条件条目传 null 即可（本组件会过滤掉），调用处不必写展开语法。
 */
export function RowMenu({ label, items, onOpenChange }: RowMenuProps) {
  const t = useT();
  const visible = items.filter((item): item is MenuItem => item !== null);
  return (
    <RevealOnRowHover>
      <Menu
        align="right"
        direction="bottom"
        hideScrollbar
        trigger={({ open, onClick }) => (
          <>
            {onOpenChange ? <OpenNotifier open={open} onChange={onOpenChange} /> : null}
            <button
              type="button"
              className={[styles.rowButton, open ? styles.rowButtonOpen : ""].join(" ")}
              title={t("sidenav.row.moreActions")}
              aria-label={label}
              aria-haspopup="menu"
              onClick={onClick}
            >
              {ICONS.more}
            </button>
          </>
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
    icon: ICONS.folder,
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
    icon: ICONS.trash,
    onSelect,
  };
}

/**
 * 「上移 / 下移」条目（docs/design/108 / 109）：长按拖拽排序的键盘/读屏等价入口，
 * 到列表首尾时禁用（不隐藏——隐藏会让菜单项位置随条目位置跳动）。
 */
export function moveItem(
  direction: "up" | "down",
  disabled: boolean,
  onSelect: () => void,
): MenuItem {
  return {
    key: `move-${direction}`,
    label: translate(direction === "up" ? "sidenav.row.moveUp" : "sidenav.row.moveDown"),
    icon: direction === "up" ? ICONS.moveUp : ICONS.moveDown,
    disabled,
    onSelect,
  };
}

/** 「重命名」条目（目前只有会话条目用）。 */
export function renameItem(onSelect: () => void): MenuItem {
  return {
    key: "rename",
    label: translate("sidenav.session.rename"),
    icon: ICONS.rename,
    onSelect,
  };
}

/** 「复制任务 ID」条目：复制 pi 会话 id（JSONL 头部 id；未落盘的新会话为运行时 id）。 */
export function copyTaskIdItem(taskId: string, showToast: (message: string) => void): MenuItem {
  return {
    key: "copy-id",
    label: translate("sidenav.session.copyTaskId"),
    icon: ICONS.copy,
    onSelect: () => {
      void navigator.clipboard
        .writeText(taskId)
        .then(() => showToast(translate("sidenav.session.idCopied")))
        .catch(() => showToast(translate("session.copyFailed")));
    },
  };
}

/** 导出结果提示：成功才提示，取消（null）不打扰；失败把可读原因交给 toast。 */
function runExport(
  run: () => Promise<{ path: string } | null>,
  showToast: (message: string) => void,
): void {
  void run()
    .then((result) => {
      if (result) showToast(translate("session.export.done"));
    })
    .catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : translate("sidenav.session.exportFailed"));
    });
}

/**
 * 「导出记录」条目（docs/design/45）：点击展开二级菜单，由用户选格式。
 * Markdown 是 PiDesk 自研转换；HTML 交给 pi 原生导出（存活会话走 RPC，冷会话走 CLI）。
 * 未落盘的新会话没有可导出的文件，返回 null = 整行不展示。
 */
export function exportItem(
  file: string,
  title: string,
  showToast: (message: string) => void,
): MenuItem | null {
  if (isPendingFile(file)) return null;
  return {
    key: "export",
    label: translate("sidenav.session.export"),
    icon: ICONS.export,
    submenu: [
      {
        key: "export-html",
        label: translate("sidenav.session.exportHtml"),
        icon: ICONS.exportHtml,
        onSelect: () => runExport(() => sessionService.exportHtml(file, title), showToast),
      },
      {
        key: "export-markdown",
        label: translate("sidenav.session.exportMarkdown"),
        icon: ICONS.exportMarkdown,
        onSelect: () => runExport(() => sessionService.exportMarkdown(file, title), showToast),
      },
    ],
  };
}

/** 「全局置顶」开关条目（docs/design/45）：条目从原分组提出，进入侧栏顶部「置顶」分区。 */
export function pinGlobalItem(pinned: boolean, onSelect: () => void): MenuItem {
  return {
    key: "pin-global",
    label: pinned
      ? translate("sidenav.session.unpinGlobal")
      : translate("sidenav.session.pinGlobal"),
    icon: pinned ? ICONS.unpinGlobal : ICONS.pinGlobal,
    onSelect,
  };
}

/** 「在工作区内置顶」开关条目：条目固定在其所属列表最前（不离开原分组）。 */
export function pinWorkspaceItem(pinned: boolean, onSelect: () => void): MenuItem {
  return {
    key: "pin-workspace",
    label: pinned
      ? translate("sidenav.session.unpinWorkspace")
      : translate("sidenav.session.pinWorkspace"),
    icon: pinned ? ICONS.unpinWorkspace : ICONS.pinWorkspace,
    onSelect,
  };
}

/** 「标记为未读」条目：active 且正在浏览的会话会被清除副作用立刻消化，此时禁用并标注原因。 */
export function markUnreadItem(options: { disabled: boolean; onSelect: () => void }): MenuItem {
  return {
    key: "mark-unread",
    label: translate("sidenav.session.markUnread"),
    icon: ICONS.unread,
    disabled: options.disabled,
    hint: options.disabled ? translate("sidenav.session.markUnreadCurrent") : undefined,
    onSelect: options.onSelect,
  };
}

/**
 * 「归档」条目（docs/design/32）：归档可逆（设置 → 已归档对话可恢复），无需确认。
 * 设计图把它作为分隔线之下的收尾动作，用危险色提示"会从侧栏收起"（docs/design/45）。
 * pending 占位行还没落盘 JSONL，无档可归，返回 null = 整行不展示。
 */
export function archiveItem(file: string, onSelect: () => void): MenuItem | null {
  if (isPendingFile(file)) return null;
  return {
    key: "archive",
    label: translate("sidenav.session.archive"),
    icon: ICONS.archive,
    tone: "danger",
    dividerBefore: true,
    onSelect,
  };
}
