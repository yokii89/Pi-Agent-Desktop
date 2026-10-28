import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { useGlidePill } from "../../hooks/useGlidePill";
import styles from "./GlideList.module.css";

/** 一次行激活的来源：二级菜单要用行元素当锚点，键盘激活还要把焦点交进子列表。 */
export interface OptionActivation {
  row: HTMLButtonElement;
  viaKeyboard: boolean;
}

export interface OptionRow {
  key: string;
  /** 行内容；行容器（按钮、行序、点击契约）由 OptionList 负责。 */
  node: ReactNode;
  /** 行的附加类名（尺寸/图标排版等外观仍归调用方）。 */
  className?: string;
  disabled?: boolean;
  title?: string;
  /** 覆盖行的可访问名称（行内只有徽章/图标时用）。 */
  ariaLabel?: string;
  /** 当前值所在行：aria-selected，并作为打开时药丸的瞬移落点。 */
  selected?: boolean;
  /** typeahead 匹配用文本；缺省取行内容。 */
  text?: string;
  /** 分组分隔线：不占行序，也不可点。 */
  separator?: boolean;
  /** 行会展开浮层（二级菜单等）：告诉读屏这是一个可展开的条目。 */
  hasPopup?: "menu" | "listbox" | "dialog";
  expanded?: boolean;
}

/** 键盘导航入口：焦点在触发器上时，由它把光标交接到某一行。 */
export interface OptionListHandle {
  /** 把 DOM 焦点交给第 index 行（方向键 / 打开即定位到当前值）。 */
  focusRow(index: number): void;
  /** 相对当前聚焦行移动焦点，越界夹住。 */
  moveCursor(delta: number): void;
  toEdge(edge: "first" | "last"): void;
  /** 首字符匹配，从当前行向后环形查找。 */
  typeahead(char: string): void;
  /** 只移动高亮不移动焦点：焦点必须留在别处的场景（输入框内的 @ 补全）。 */
  highlight(index: number | null, instant?: boolean): void;
  count(): number;
}

interface OptionListProps {
  rows: OptionRow[];
  /** 第二参数是激活来源：二级菜单要按行矩形定位，需要行元素本身。 */
  onSelect: (index: number, activation: OptionActivation) => void;
  /** listbox 用于"选一个值"的选取器，menu 用于动作菜单。 */
  role?: "menu" | "listbox";
  ariaLabel?: string;
  /** 容器的附加类名（宽度、内滚、分组间距等）。 */
  className?: string;
  rememberPosition?: boolean;
  /**
   * 行高亮变化（指针悬停 / 行焦点 / 移出）：预览面板等本地 UI 跟随。
   * `null` 表示指针离开列表；常驻列表的预览应忽略它，保留最后一个落点。
   */
  onActiveChange?: (index: number | null) => void;
  /** 行上的按键委托给调用方：方向键移动光标、单字符做首字符匹配。 */
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  /** 列表内部滚动：锚在行上的二级菜单随之失效，由调用方收起。 */
  onScroll?: () => void;
  /** 挂载后把焦点交给第 n 行：键盘打开下拉时，光标要直接落在当前值上。 */
  focusOnMount?: number | null;
  /** 多选 listbox：告诉读屏这是一个可多选的选择列表（单选不要传）。 */
  multiple?: boolean;
  /**
   * 指针按下不夺焦点：焦点必须留在列表之外的输入框里（@ 补全、属性名建议）。
   * 只挂在行上，容器与滚动条不受影响。
   */
  preventFocusOnPointer?: boolean;
  ref?: Ref<OptionListHandle>;
}

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/**
 * 下拉/菜单的选项列表：一行一个条目，高亮由滑动的药丸承担（docs/design/51）。
 *
 * 行不再各自写 `:hover` 底色——连续擦选时逐行闪动会糊成一片，
 * 「指向哪一行」这件事统一交给 useGlidePill 的单处 translateY 补间。
 * 键盘走"行本身可聚焦"（roving focus）：焦点移到哪，药丸就跟到哪，
 * Enter/Space 由按钮自己的 click 完成，不需要再维护一份光标状态。
 */
export function OptionList({
  rows,
  onSelect,
  role = "menu",
  ariaLabel,
  className,
  rememberPosition,
  onActiveChange,
  onKeyDown,
  onScroll,
  focusOnMount,
  multiple,
  preventFocusOnPointer,
  ref,
}: OptionListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activate = useRef(onSelect);
  activate.current = onSelect;
  const pill = useGlidePill(listRef, {
    // 擦选松手没有 click 事件：行本身从列表里按行序捞，来源仍算指针
    onPick: (index) => {
      const row = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-glide-index="${index}"]`,
      );
      if (row) activate.current(index, { row, viaKeyboard: false });
    },
    rememberPosition,
    onActiveChange,
  });

  // 行序只数可点的行：分隔线不占 index，否则药丸会停到线上去
  let line = 0;
  const indexed = rows.map((row) => {
    if (row.separator) return { row, index: -1 };
    const index = line;
    line += 1;
    return { row, index };
  });
  const selectedIndex = indexed.find(({ row }) => row.selected)?.index ?? -1;

  // 打开时把药丸瞬移到当前值：让它从第 0 行滑过来会被读成"选错了项"
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || selectedIndex < 0) return;
    seeded.current = true;
    pill.jumpTo(selectedIndex);
  }, [selectedIndex, pill]);

  // 键盘打开的下拉：面板刚挂载，只能在这里把焦点交给当前值那一行
  const handedOver = useRef(false);
  useLayoutEffect(() => {
    if (handedOver.current || focusOnMount === null || focusOnMount === undefined) return;
    handedOver.current = true;
    const list = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-glide-index]") ?? [])];
    if (list.length === 0) return;
    list[clamp(focusOnMount, list.length - 1)]?.focus();
  }, [focusOnMount]);

  useImperativeHandle(ref, () => {
    const list = () => [
      ...(listRef.current?.querySelectorAll<HTMLElement>("[data-glide-index]") ?? []),
    ];
    const focused = (): number => {
      const active = document.activeElement;
      return active instanceof HTMLElement ? list().indexOf(active) : -1;
    };
    const focusAt = (index: number): void => {
      const rows = list();
      if (rows.length === 0) return;
      rows[clamp(index, rows.length - 1)]?.focus();
    };
    return {
      focusRow: focusAt,
      moveCursor: (delta) => {
        const from = focused();
        // 焦点还在触发器上时，第一次按方向键从首行/末行接管
        focusAt(from < 0 ? (delta > 0 ? 0 : 1e6) : from + delta);
      },
      toEdge: (edge) => focusAt(edge === "first" ? 0 : 1e6),
      typeahead: (char) => {
        const rows = list();
        const needle = char.toLowerCase();
        const from = focused();
        for (let step = 1; step <= rows.length; step++) {
          const row = rows[(from + step + rows.length) % rows.length];
          const text = (row?.dataset.glideLabel ?? row?.textContent ?? "").trim().toLowerCase();
          if (text.startsWith(needle) && row) {
            focusAt(Number(row.dataset.glideIndex));
            return;
          }
        }
      },
      highlight: (index, instant) => pill.highlight(index, instant),
      count: () => list().length,
    };
  }, [pill]);

  // role 由调用方决定，ARIA 属性必须跟着 role 走；Biome 的 a11y 规则读不懂动态 role，
  // 这里用展开表明「属性与 role 是一个整体」，不要把 role 拆成字面量写死。
  const containerAria = {
    role,
    "aria-label": ariaLabel,
    ...(multiple ? { "aria-multiselectable": true } : {}),
  };

  return (
    <div
      ref={listRef}
      {...containerAria}
      className={[styles.track, className].filter(Boolean).join(" ")}
      onScroll={onScroll}
      {...pill.listProps}
    >
      <span ref={pill.pillRef} className={styles.pill} aria-hidden="true" />
      {indexed.map(({ row, index }) =>
        row.separator ? (
          <hr key={row.key} className={styles.separator} />
        ) : (
          <button
            key={row.key}
            type="button"
            {...(role === "listbox"
              ? { role: "option", "aria-selected": row.selected === true }
              : {
                  role: "menuitem",
                  ...(row.hasPopup ? { "aria-haspopup": row.hasPopup } : {}),
                  ...(row.hasPopup ? { "aria-expanded": row.expanded === true } : {}),
                })}
            onMouseDown={preventFocusOnPointer ? (event) => event.preventDefault() : undefined}
            disabled={row.disabled}
            title={row.title}
            aria-label={row.ariaLabel}
            onKeyDown={onKeyDown}
            data-glide-index={index}
            data-glide-label={row.text}
            className={[styles.row, row.className].filter(Boolean).join(" ")}
            onClick={(event) => {
              // 绕回原行松手的擦选已由药丸代为实现，别让同一次点击激活两遍
              if (pill.consumeClick(event.detail)) return;
              onSelect(index, {
                row: event.currentTarget,
                viaKeyboard: event.detail === 0,
              });
            }}
          >
            {row.node}
          </button>
        ),
      )}
    </div>
  );
}
