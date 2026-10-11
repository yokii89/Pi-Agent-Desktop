import { Plus } from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useGlideOverlay } from "../../../../../hooks/useGlideOverlay";
import { useT } from "../../../../../hooks/useT";
import { OptionList, type OptionListHandle, type OptionRow } from "../../../../ui/OptionList";
import { resolvePropertyMeta, searchCatalog } from "./propertyCatalog";
import styles from "./styleEdit.module.css";

/**
 * 添加属性（UI 重设计）：幽灵声明行 `name: value`，聚焦即实线，Enter 提交。
 * 目录建议是自绘列表（滑动药丸 + 定帧进出），portal 到 body 挂在声明行下方；
 * 焦点始终留在属性名输入框，方向键只挪药丸不交焦点。未命中目录按文本写入。
 */

/** propertyCatalog 的 group 是 UI 分类标签；按原中文映射到文案 key。 */
const GROUP_LABEL_KEYS: Record<string, string> = {
  盒模型: "browser.styles.group.boxModel",
  边框: "browser.styles.group.border",
  布局: "browser.styles.group.layout",
  Flex: "browser.styles.group.flex",
  排版: "browser.styles.group.typography",
  视觉: "browser.styles.group.visual",
  定位: "browser.styles.group.position",
  其他: "browser.styles.group.other",
};

/** 自定义属性区分大小写，其余按小写与已添加集合比对。 */
const suggestKey = (propName: string): string =>
  propName.startsWith("--") ? propName : propName.toLowerCase();

/** 浮层与声明行的间隔、贴视口边缘的安全距离（与 Popover 同一档）。 */
const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;

export interface AddPropertyFormProps {
  existingNames: string[];
  compact?: boolean;
  onAdd: (name: string, value: string) => void;
}

export function AddPropertyForm({ existingNames, compact, onAdd }: AddPropertyFormProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  /** 浮层是否还在 DOM 里：收起要先演完补间，不能立刻卸载节点。 */
  const [mounted, setMounted] = useState(false);
  /** 键盘光标所在行；焦点必须留在属性名输入框，所以只驱动药丸、不交接 DOM 焦点。 */
  const [cursor, setCursor] = useState<number | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<OptionListHandle>(null);
  const mountedRef = useRef(false);
  /** 节点是新建的还是从收起动画里复用的：新建才要写起点，复用要从当前值接着演。 */
  const fresh = useRef(false);
  const overlay = useGlideOverlay(panelRef);

  const existing = useMemo(
    () =>
      new Set(
        existingNames.map((n) => (n.trim().startsWith("--") ? n.trim() : n.trim().toLowerCase())),
      ),
    [existingNames],
  );
  const suggestions = useMemo(() => searchCatalog(name, 10), [name]);
  const kindHint = resolvePropertyMeta(name).kind;
  const takenRows = useMemo(
    () => suggestions.map((meta) => existing.has(suggestKey(meta.name))),
    [suggestions, existing],
  );
  const wantOpen = open && suggestions.length > 0 && !compact;

  const rows = suggestions.map<OptionRow>((meta, index) => ({
    key: meta.name,
    text: meta.name,
    className: styles.suggestItem,
    disabled: takenRows[index],
    node: (
      <>
        <span className={styles.suggestName}>{meta.name}</span>
        <span className={styles.suggestMeta}>
          {GROUP_LABEL_KEYS[meta.group] ? t(GROUP_LABEL_KEYS[meta.group]) : meta.group}
          {takenRows[index] ? ` · ${t("browser.styles.added")}` : ""}
        </span>
      </>
    ),
  }));

  const submit = (): void => {
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (!trimmedName || !trimmedValue) return;
    if (/[{};]/.test(trimmedName) || /[{};]/.test(trimmedValue)) return;
    onAdd(trimmedName, trimmedValue);
    setName("");
    setValue("");
    setCursor(null);
    setOpen(false);
  };

  const pick = (index: number): void => {
    const meta = suggestions[index];
    if (!meta) return;
    setName(meta.name);
    setCursor(null);
    setOpen(false);
    // 点条目不该离开输入框（行的默认聚焦已由 OptionList 的 preventFocusOnPointer 拦下），这里是兜底
    nameRef.current?.focus();
  };

  /** 方向键跳过「已添加」的条目：它们在列表里是 disabled 行，点不动也不该停。 */
  const moveCursor = (delta: number): void => {
    const count = suggestions.length;
    if (count === 0) return;
    const from = cursor ?? (delta > 0 ? -1 : count);
    for (let step = 1; step <= count; step++) {
      const index = (((from + delta * step) % count) + count) % count;
      if (!takenRows[index]) {
        setCursor(index);
        return;
      }
    }
  };

  const place = useCallback((): void => {
    const panel = panelRef.current;
    const anchor = ghostRef.current;
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    // 宽度贴着声明行，高度要等宽度定下来才量得准（条目会不会换行由它决定）
    panel.style.width = `${Math.round(rect.width)}px`;
    // 用布局盒尺寸而非 getBoundingClientRect：补间期间盒子带着 scale，会量小一档
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    let top = rect.bottom + PANEL_GAP;
    let originY = "top";
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = rect.top - PANEL_GAP - height;
      if (above >= VIEWPORT_MARGIN) {
        top = above;
        originY = "bottom";
      } else {
        top = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
      }
    }
    const left = Math.min(
      Math.max(rect.left, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    // 缩放要从贴着声明行的那一角长出，否则面板是"原地呼吸"而不是从行推开
    panel.style.transformOrigin = `${originY} left`;
  }, []);

  useEffect(() => {
    if (wantOpen) {
      if (mountedRef.current) return;
      mountedRef.current = true;
      fresh.current = true;
      setMounted(true);
      return;
    }
    if (!mountedRef.current) return;
    overlay.exit(() => {
      mountedRef.current = false;
      setMounted(false);
    });
  }, [wantOpen, overlay]);

  useLayoutEffect(() => {
    if (!wantOpen || !mounted) return;
    place();
    // 起点必须在首帧前写好：CSS 只描述静息态，否则会闪一下全尺寸面板
    if (fresh.current) {
      fresh.current = false;
      overlay.prime();
    }
    overlay.enter();
    const panel = panelRef.current;
    if (!panel) return;
    // 边打字边筛，条目数与高度都会变：不重算的话下方放不下时不会翻到上方
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [wantOpen, mounted, overlay, place]);

  useEffect(() => {
    if (!mounted) return;
    // 浮层 fixed 在视口上，侧栏滚动后声明行会走偏：跟着重算一次坐标
    const onScroll = (event: Event): void => {
      const panel = panelRef.current;
      if (panel && event.target instanceof Node && panel.contains(event.target)) return;
      place();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [mounted, place]);

  // 药丸由外部驱动（焦点不在列表里，useGlidePill 收不到聚焦事件）
  useEffect(() => {
    listRef.current?.highlight(cursor, true);
    if (cursor === null) return;
    const row = panelRef.current?.querySelector<HTMLElement>(`[data-glide-index="${cursor}"]`);
    const box = row?.parentElement;
    if (!row || !box) return;
    // 光标滚出可视区时补一次滚动：长按方向键药丸不会跑到容器外面"跟丢"
    const bottom = row.offsetTop + row.offsetHeight;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [cursor]);

  const onNameKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      // 方向键把光标落到某条建议上时，Enter 取它；否则保持原有的"直接提交"
      if (cursor !== null && wantOpen) pick(cursor);
      else submit();
      return;
    }
    if (event.key === "Escape") {
      setCursor(null);
      setOpen(false);
      return;
    }
    if (!wantOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCursor(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCursor(-1);
    }
  };

  return (
    <div className={styles.addForm}>
      <div ref={ghostRef} className={styles.addGhost}>
        <input
          ref={nameRef}
          className={styles.addName}
          value={name}
          placeholder={t("browser.styles.addPlaceholder.name")}
          spellCheck={false}
          onChange={(event) => {
            setName(event.target.value);
            setCursor(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onNameKeyDown}
        />
        <span className={styles.addColon}>:</span>
        <input
          className={styles.addValue}
          value={value}
          placeholder={t("browser.styles.addPlaceholder.value")}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className={styles.addSubmit}
          title={t("browser.styles.addSubmit")}
          disabled={!name.trim() || !value.trim()}
          onClick={submit}
        >
          <Plus size={14} weight="regular" />
        </button>
      </div>
      {mounted &&
        createPortal(
          // data-overlay-panel：不走 Popover 的自绘浮层要自己挂这个标记，
          // 否则 Modal 的焦点陷阱认不出"焦点在浮层里"，Tab 会被抢回对话框。
          <div ref={panelRef} className={styles.suggestPanel} data-overlay-panel="">
            <OptionList
              ref={listRef}
              rows={rows}
              role="listbox"
              ariaLabel={t("browser.styles.addPlaceholder.name")}
              className={styles.suggestList}
              preventFocusOnPointer
              onSelect={pick}
            />
          </div>,
          document.body,
        )}
      <p className={styles.addHint}>
        {name.trim() && kindHint === "text"
          ? t("browser.styles.addHint.text")
          : t("browser.styles.addHint.default")}
      </p>
    </div>
  );
}
