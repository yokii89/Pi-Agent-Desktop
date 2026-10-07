import { useState } from "react";
import { useT } from "../../hooks/useT";
import type { BrowserContextItem } from "../../services/browserService";
import styles from "./ElementChip.module.css";
import { ElementDetailPopover } from "./ElementDetailPopover";
import {
  EMPTY_CLASS_PLACEHOLDER,
  elementBadgeText,
  elementChipTitle,
  elementClassText,
  elementTone,
} from "./elementChipMeta";

/**
 * 历史消息里的元素芯片：类型徽章 + class 线索（方案 B）。
 * 点击打开独立详情浮窗（不撑开气泡布局）。
 */
export function ContextChip({
  item,
  onRemove,
}: {
  item: BrowserContextItem;
  onRemove?: (id: string) => void;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const classText = elementClassText(item, t("session.chip.screenshot"));
  const badgeText = elementBadgeText(item);
  const emptyCls = !classText;

  return (
    <span
      className={[styles.chip, item.stale ? styles.chipStale : ""].join(" ")}
      data-tone={elementTone(item)}
    >
      <button
        type="button"
        className={styles.main}
        title={elementChipTitle(item)}
        aria-haspopup="dialog"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <span className={styles.badge}>{badgeText}</span>
        <span className={[styles.cls, emptyCls ? styles.clsEmpty : ""].join(" ")}>
          {emptyCls ? EMPTY_CLASS_PLACEHOLDER : classText}
        </span>
        {item.stale && <span className={styles.staleTag}>{t("session.chip.stale")}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          title={t("session.chip.remove")}
          aria-label={t("session.chip.removeItem", {
            name: emptyCls ? badgeText : `${badgeText}${classText}`,
          })}
          onClick={() => onRemove(item.id)}
        >
          ×
        </button>
      )}
      {anchor && (
        <ElementDetailPopover item={item} anchor={anchor} onClose={() => setAnchor(null)} />
      )}
    </span>
  );
}
