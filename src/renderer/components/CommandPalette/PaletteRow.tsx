import { useEffect, useRef } from "react";
import glideStyles from "../ui/GlideList.module.css";
import styles from "./CommandPalette.module.css";
import type { PaletteItem } from "./types";

/** 按命中下标切开文本，命中段着色（ZCode HighlightedMatchText 的对应物）。 */
function HighlightText({
  text,
  positions,
  className,
}: {
  text: string;
  positions: number[] | undefined;
  className: string;
}) {
  if (!positions || positions.length === 0) {
    return <span className={className}>{text}</span>;
  }
  const hits = new Set(positions);
  const runs: { text: string; hit: boolean; start: number }[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const hit = hits.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) {
      last.text += text[i];
      continue;
    }
    runs.push({ text: text[i], hit, start: i });
  }
  return (
    <span className={className}>
      {runs.map((run) =>
        run.hit ? (
          <mark key={run.start} className={styles.highlightMark}>
            {run.text}
          </mark>
        ) : (
          <span key={run.start}>{run.text}</span>
        ),
      )}
    </span>
  );
}

interface PaletteRowProps {
  item: PaletteItem;
  index: number;
  active: boolean;
  optionId: string;
  /** detail 透传给药丸的 consumeClick：擦选已代为实现的那次 click 要跳过（docs/design/51）。 */
  onSelect: (item: PaletteItem, detail: number) => void;
}

/** 命令面板单条结果：图标 + 标题 + 副标题（带命中高亮）+ 右侧 meta/快捷键胶囊。 */
export function PaletteRow({ item, index, active, optionId, onSelect }: PaletteRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const IconComp = item.icon;

  // 键盘导航时把高亮行滚进可视区
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: aria-activedescendant 模式下 option 焦点由容器统管，不单独可聚焦
    // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘导航（↑↓/Enter）由 combobox 输入框统一处理，行内只响应鼠标
    <div
      ref={ref}
      id={optionId}
      role="option"
      aria-selected={active}
      data-glide-index={index}
      className={[glideStyles.row, styles.row, active ? styles.rowActive : ""].join(" ")}
      title={item.subtitle}
      onClick={(event) => onSelect(item, event.detail)}
    >
      <IconComp size={16} weight="regular" className={styles.rowIcon} />
      <span className={styles.rowText}>
        <HighlightText
          text={item.title}
          positions={item.highlight?.title}
          className={styles.rowTitle}
        />
        {item.subtitle && (
          <HighlightText
            text={item.subtitle}
            positions={item.highlight?.subtitle}
            className={styles.rowSubtitle}
          />
        )}
      </span>
      {item.meta && <span className={styles.rowMeta}>{item.meta}</span>}
      {item.shortcut && <kbd className={styles.kbd}>{item.shortcut}</kbd>}
    </div>
  );
}
