import { Check } from "@phosphor-icons/react";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { type GlideCancel, glide, mix } from "../../utils/glideMotion";
import { GLIDE_MOTION } from "../../utils/motionTokens";
import { GlideChevron } from "./GlideChevron";
import { OptionList, type OptionListHandle, type OptionRow } from "./OptionList";
import { Popover } from "./Popover";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  /** 行尾辅助说明（如"推荐""需硬件"）。 */
  hint?: string;
  /** 行的悬停说明（对齐原生 <option title>）。 */
  title?: string;
}

interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** 读屏用途：触发器没有伴随的文字标签时必须传。 */
  ariaLabel?: string;
  /** 触发器外观类名；不传用内置 `.field`（标准字段皮肤）。 */
  className?: string;
  /** 包裹触发器的那层根节点类名（嵌入式控件要靠它撑满父容器）。 */
  rootClassName?: string;
  /** 触发器 id：让 `<label htmlFor>` 能真正指过来。 */
  id?: string;
  /** 面板外壳附加类名（宽度、`--panel-min-width` 等外壳级差异）。 */
  panelClassName?: string;
  disabled?: boolean;
  /** 无选中值时的占位文案。 */
  placeholder?: string;
  align?: "left" | "right";
  direction?: "top" | "bottom";
}

/**
 * 自绘下拉（docs/design/51）：替掉原生 `<select>`——原生弹层由系统绘制，
 * 既加不了 30fps 的弹出与药丸滑行，也改不了圆角，是"所有下拉同一套手感"的唯一障碍。
 *
 * 键盘语义照原生控件补齐：方向键进出列表、Home/End 跳两端、首字符匹配、Enter 确认、
 * Esc/Tab 收起；焦点在"触发器 ↔ 列表行"之间交接，收起后交还触发器，不会掉到 body。
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  rootClassName,
  id,
  panelClassName,
  disabled = false,
  placeholder = "",
  align = "left",
  direction = "bottom",
}: SelectProps) {
  const listRef = useRef<OptionListHandle>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  /** 这一次打开是键盘发起的？键盘要把焦点交进列表，指针则留在触发器。 */
  const viaKey = useRef(false);
  const swapTween = useRef<GlideCancel>(() => {});

  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  // 换值：标签从 0.6 透明度 + 2px 模糊落回清晰（参考稿的 gs-swap）
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const label = labelRef.current;
    if (!label) return;
    swapTween.current();
    swapTween.current = glide({
      duration: GLIDE_MOTION.swap,
      onUpdate: (p) => {
        label.style.opacity = String(mix(0.6, 1, p));
        label.style.filter = `blur(${mix(2, 0, p).toFixed(2)}px)`;
      },
      onComplete: () => {
        label.style.opacity = "";
        label.style.filter = "";
      },
    });
  }, [value]);

  useEffect(() => () => swapTween.current(), []);

  const openFromKey = (toggle: () => void): void => {
    viaKey.current = true;
    toggle();
  };

  const onTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    open: boolean,
    toggle: () => void,
  ): void => {
    if (disabled) return;
    const key = event.key;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        // preventDefault 同时压掉了按钮的默认 click，否则会把刚打开的面板立刻关掉
        event.preventDefault();
        openFromKey(toggle);
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      listRef.current?.focusRow(Math.max(0, selectedIndex));
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, close: () => void): void => {
    const key = event.key;
    if (key === "ArrowDown") {
      event.preventDefault();
      listRef.current?.moveCursor(1);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      listRef.current?.moveCursor(-1);
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      listRef.current?.toEdge("first");
      return;
    }
    if (key === "End") {
      event.preventDefault();
      listRef.current?.toEdge("last");
      return;
    }
    if (key === "Tab") {
      close();
      return;
    }
    // Enter / Space 留给行按钮自己的 click；单字符做首字符匹配
    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      listRef.current?.typeahead(key);
    }
  };

  const rows = options.map<OptionRow>((option) => ({
    key: option.value,
    text: option.label,
    title: option.title,
    selected: option.value === value,
    node: (
      <>
        <span className={styles.label}>{option.label}</span>
        {option.hint && <span className={styles.hint}>{option.hint}</span>}
        {option.value === value && (
          <span className={styles.check} aria-hidden="true">
            <Check size={14} weight="regular" />
          </span>
        )}
      </>
    ),
  }));

  return (
    <Popover
      align={align}
      direction={direction}
      rootClassName={rootClassName}
      panelClassName={panelClassName}
      trigger={({ open, onClick }) => (
        <button
          id={id}
          type="button"
          className={[styles.trigger, className ?? styles.field].filter(Boolean).join(" ")}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => {
            viaKey.current = false;
            onClick();
          }}
          onKeyDown={(event) => onTriggerKeyDown(event, open, onClick)}
        >
          <span ref={labelRef} className={styles.label} data-empty={current ? undefined : ""}>
            {current?.label ?? placeholder}
          </span>
          <GlideChevron />
        </button>
      )}
    >
      {(close) => (
        <OptionList
          ref={listRef}
          rows={rows}
          role="listbox"
          ariaLabel={ariaLabel}
          focusOnMount={viaKey.current ? Math.max(0, selectedIndex) : null}
          onKeyDown={(event) => onListKeyDown(event, close)}
          onSelect={(index) => {
            const option = options[index];
            if (option && option.value !== value) onChange(option.value);
            close();
          }}
        />
      )}
    </Popover>
  );
}
