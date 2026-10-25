import type { ReactNode } from "react";
import styles from "./Menu.module.css";
import { OptionList, type OptionRow } from "./OptionList";
import { Popover, type PopoverTriggerProps } from "./Popover";

export interface MenuItem {
  key: string;
  label: string;
  /** 项首图标（如"移除"的垃圾桶）；由调用方传入已设好尺寸的 Phosphor 图标。 */
  icon?: ReactNode;
  disabled?: boolean;
  /** 项尾的辅助说明（如快捷键、禁用原因）。 */
  hint?: string;
  /** 危险操作（删除类）：文字与图标用危险色。 */
  tone?: "danger";
  /** 在该条目之前渲染一条分隔线（把危险/收尾动作与常规动作分组）。 */
  dividerBefore?: boolean;
  /** 当前值所在条目：打开时高亮药丸瞬移到这里（选取器菜单用，动作菜单不用）。 */
  selected?: boolean;
  onSelect?: () => void;
}

interface MenuProps {
  /** 触发器渲染函数。 */
  trigger: (props: PopoverTriggerProps) => React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  direction?: "top" | "bottom";
  /** 根节点类名，见 Popover。 */
  rootClassName?: string;
  /** 隐藏列表滚动条（仍可滚动）；用于内容可能很多、但不希望出现轨道感的动作菜单。 */
  hideScrollbar?: boolean;
  /** 显示前准备（如抑制原生浏览器视图），见 Popover。 */
  beforeOpen?: () => Promise<void> | void;
  /** 开合完成回调，见 Popover。 */
  onOpenChange?: (open: boolean) => void;
}

/**
 * 菜单条目列表：Menu（锚定弹出）与 ContextMenu（右键定位）共用。
 * 行容器、悬停高亮与擦选由 ui/OptionList 负责，这里只做条目模型 → 行的映射。
 */
export function MenuList({
  items,
  afterSelect,
  hideScrollbar,
}: {
  items: MenuItem[];
  /** 选中任意（未禁用）条目后的收尾动作：弹出式菜单传 close，右键菜单传 onClose。 */
  afterSelect?: () => void;
  hideScrollbar?: boolean;
}) {
  const rows: OptionRow[] = [];
  for (const item of items) {
    if (item.dividerBefore) {
      rows.push({ key: `${item.key}:divider`, node: null, separator: true });
    }
    rows.push({
      key: item.key,
      disabled: item.disabled,
      selected: item.selected,
      text: item.label,
      className: item.tone === "danger" ? styles.itemDanger : undefined,
      node: (
        <>
          {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
          <span>{item.label}</span>
          {item.hint && <span className={styles.hint}>{item.hint}</span>}
        </>
      ),
    });
  }

  // 每个条目恰好占一个可点行（分隔线不占行序），所以 OptionList 的行序就是 items 下标
  return (
    <OptionList
      rows={rows}
      role="menu"
      className={[styles.list, hideScrollbar ? styles.listNoScrollbar : ""]
        .filter(Boolean)
        .join(" ")}
      onSelect={(index) => {
        items[index]?.onSelect?.();
        afterSelect?.();
      }}
    />
  );
}

/** 基于 Popover 的菜单列表；选中条目后自动收起（条目自身若会卸载所在行则无需处理）。 */
export function Menu({
  trigger,
  items,
  align = "left",
  direction = "bottom",
  rootClassName,
  hideScrollbar,
  beforeOpen,
  onOpenChange,
}: MenuProps) {
  return (
    <Popover
      trigger={trigger}
      align={align}
      direction={direction}
      rootClassName={rootClassName}
      beforeOpen={beforeOpen}
      onOpenChange={onOpenChange}
    >
      {(close) => <MenuList items={items} afterSelect={close} hideScrollbar={hideScrollbar} />}
    </Popover>
  );
}
