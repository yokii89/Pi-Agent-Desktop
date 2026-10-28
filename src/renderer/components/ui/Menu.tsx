import { CaretRight } from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import styles from "./Menu.module.css";
import { type OptionActivation, OptionList, type OptionRow } from "./OptionList";
import { Popover, type PopoverTriggerProps } from "./Popover";

/** 二级面板与父菜单行的水平间隔。 */
const SUBMENU_GAP = 4;
/** 二级面板贴视口边缘的安全距离。 */
const VIEWPORT_MARGIN = 8;

export interface MenuItem {
  key: string;
  label: string;
  /** 项首图标（如"移除"的垃圾桶）；由调用方传入已设好尺寸的 Phosphor 图标。 */
  icon?: ReactNode;
  disabled?: boolean;
  /** 项尾的辅助说明（如快捷键、禁用原因）。 */
  hint?: string;
  /** 标签旁的视觉徽章；语义请同时写进 ariaLabel。 */
  badge?: ReactNode;
  /** 覆盖条目的可访问名称（徽章/图标无法自述时用）。 */
  ariaLabel?: string;
  /** 危险操作（删除类）：文字与图标用危险色。 */
  tone?: "danger";
  /** 在该条目之前渲染一条分隔线（把危险/收尾动作与常规动作分组）。 */
  dividerBefore?: boolean;
  /** 当前值所在条目：打开时高亮药丸瞬移到这里（选取器菜单用，动作菜单不用）。 */
  selected?: boolean;
  /**
   * 二级菜单：该条目不是动作，点击后在行右侧展开（如「导出记录」）。
   * 选中子项才执行动作并收起整张菜单；子项数组里同样可以再放分隔线。
   */
  submenu?: MenuItem[];
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
 *
 * 二级菜单与父列表同处一个浮层面板：不做 portal，父面板收起时它会一起退场，
 * 外部点击也天然落在父面板的判定范围内。列表内部滚动时二级菜单会失去锚点，
 * 因此由 OptionList 的 onScroll 收起。定位按视口坐标（外壳是 fixed）。
 */
export function MenuList({
  items,
  afterSelect,
  hideScrollbar,
  focusOnMount = null,
  onKeyDown,
}: {
  items: MenuItem[];
  /** 选中任意（未禁用）条目后的收尾动作：弹出式菜单传 close，右键菜单传 onClose。 */
  afterSelect?: () => void;
  hideScrollbar?: boolean;
  /** 键盘打开二级菜单时把焦点交给子列表首行（鼠标打开不抢焦点）。 */
  focusOnMount?: number | null;
  /** 行按键的额外处理（二级菜单用 ArrowLeft 收起并交还焦点）。 */
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const [submenu, setSubmenu] = useState<{
    key: string;
    items: MenuItem[];
    anchor: HTMLButtonElement;
    viaKey: boolean;
  } | null>(null);

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
      ariaLabel: item.ariaLabel,
      className: item.tone === "danger" ? styles.itemDanger : undefined,
      hasPopup: item.submenu ? "menu" : undefined,
      expanded: submenu?.key === item.key,
      node: (
        <>
          {item.icon && <span className={styles.itemIcon}>{item.icon}</span>}
          <span>{item.label}</span>
          {item.badge}
          {item.hint && <span className={styles.hint}>{item.hint}</span>}
          {item.submenu ? (
            <span className={styles.submenuChevron} aria-hidden="true">
              <CaretRight size={16} weight="regular" />
            </span>
          ) : null}
        </>
      ),
    });
  }

  const closeAll = (): void => {
    setSubmenu(null);
    afterSelect?.();
  };

  const select = (index: number, activation: OptionActivation): void => {
    const item = items[index];
    if (!item) return;
    if (item.submenu) {
      const anchor = activation.row;
      const submenuItems = item.submenu;
      setSubmenu((current) =>
        current?.key === item.key
          ? null
          : { key: item.key, items: submenuItems, anchor, viaKey: activation.viaKeyboard },
      );
      return;
    }
    closeAll();
    item.onSelect?.();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = Number(event.currentTarget.dataset.glideIndex);
    const item = items[index];
    if (!item?.submenu) return;
    event.preventDefault();
    if (event.key === "ArrowRight") {
      setSubmenu({
        key: item.key,
        items: item.submenu,
        anchor: event.currentTarget,
        viaKey: true,
      });
    } else {
      setSubmenu(null);
    }
  };

  const dismissSubmenu = (): void => {
    submenu?.anchor.focus({ preventScroll: true });
    setSubmenu(null);
  };

  // 每个条目恰好占一个可点行（分隔线不占行序），所以 OptionList 的行序就是 items 下标
  return (
    <>
      <OptionList
        rows={rows}
        role="menu"
        className={[styles.list, hideScrollbar ? styles.listNoScrollbar : ""]
          .filter(Boolean)
          .join(" ")}
        focusOnMount={focusOnMount}
        onKeyDown={handleKeyDown}
        onScroll={() => setSubmenu(null)}
        onSelect={select}
      />
      {submenu && (
        <MenuSubmenu
          key={submenu.key}
          anchor={submenu.anchor}
          items={submenu.items}
          autoFocus={submenu.viaKey}
          afterSelect={closeAll}
          onDismiss={dismissSubmenu}
        />
      )}
    </>
  );
}

interface MenuSubmenuProps {
  /** 父行按钮：定位锚点，也是 ArrowLeft 收起后的焦点落点。 */
  anchor: HTMLButtonElement;
  items: MenuItem[];
  autoFocus: boolean;
  afterSelect: () => void;
  onDismiss: () => void;
}

/** 二级菜单面板：与父菜单同处一个浮层，按视口坐标贴在父行右侧（放不下时翻到左侧）。 */
function MenuSubmenu({ anchor, items, autoFocus, afterSelect, onDismiss }: MenuSubmenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlay = useGlideOverlay(panelRef);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = anchor.getBoundingClientRect();
    // 量布局盒：入场缩放中的 rect 会小一档
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    // 首行与父行对齐：抵消外壳的 padding + border（数值随浮层配方走，不写死）
    const shell = getComputedStyle(panel);
    const insetY =
      (Number.parseFloat(shell.paddingTop) || 0) + (Number.parseFloat(shell.borderTopWidth) || 0);

    let left = rect.right + SUBMENU_GAP;
    let originX: "left" | "right" = "left";
    if (left + width > viewportW - VIEWPORT_MARGIN) {
      left = rect.left - SUBMENU_GAP - width;
      originX = "right";
    }
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportW - width - VIEWPORT_MARGIN));
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.top - insetY, viewportH - height - VIEWPORT_MARGIN),
    );

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    // 从贴着父行的那条边展开，而不是原地呼吸
    panel.style.transformOrigin = `${originX} top`;
    overlay.prime();
    overlay.enter();
  }, [anchor, overlay]);

  return (
    <div ref={panelRef} className={styles.submenu}>
      <MenuList
        items={items}
        afterSelect={afterSelect}
        hideScrollbar
        focusOnMount={autoFocus ? 0 : null}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft") return;
          event.preventDefault();
          onDismiss();
        }}
      />
    </div>
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
