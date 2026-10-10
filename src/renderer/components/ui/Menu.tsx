import { Fragment, type ReactNode } from "react";
import styles from "./Menu.module.css";
import { Popover } from "./Popover";

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
  onSelect?: () => void;
}

interface MenuProps {
  /** 触发器渲染函数。 */
  trigger: (props: { open: boolean; onClick: () => void }) => React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  direction?: "top" | "bottom";
}

/** 菜单条目列表：Menu（锚定弹出）与 ContextMenu（右键定位）共用。 */
export function MenuList({
  items,
  afterSelect,
}: {
  items: MenuItem[];
  /** 选中任意（未禁用）条目后的收尾动作：弹出式菜单传 close，右键菜单传 onClose。 */
  afterSelect?: () => void;
}) {
  return (
    <div className={styles.list} role="menu">
      {items.map((item) => (
        <Fragment key={item.key}>
          {item.dividerBefore && <hr className={styles.separator} />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={[styles.item, item.tone === "danger" ? styles.itemDanger : ""].join(" ")}
            onClick={() => {
              item.onSelect?.();
              afterSelect?.();
            }}
          >
            {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
            <span>{item.label}</span>
            {item.hint && <span className={styles.hint}>{item.hint}</span>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** 基于 Popover 的菜单列表；选中条目后自动收起（条目自身若会卸载所在行则无需处理）。 */
export function Menu({ trigger, items, align = "left", direction = "bottom" }: MenuProps) {
  return (
    <Popover trigger={trigger} align={align} direction={direction}>
      {(close) => <MenuList items={items} afterSelect={close} />}
    </Popover>
  );
}
