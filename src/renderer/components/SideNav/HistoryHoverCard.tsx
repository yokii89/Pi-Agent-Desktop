import { CalendarDots, Desktop, Folder } from "@phosphor-icons/react";
import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SessionSummary } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { formatAbsoluteTime } from "../../utils/time";
import styles from "./HistoryHoverCard.module.css";

/** 卡片与锚点行的水平间隔。 */
const CARD_GAP = 8;
/** 卡片与视口边缘的安全距离。 */
const VIEWPORT_MARGIN = 8;

interface HistoryHoverCardProps {
  session: SessionSummary;
  /** 已解析好的完整标题（含重命名结果）；行内按字数截断的短标题不适用于卡片。 */
  title: string;
  /** 会话所属空间（项目）名；不属于任何项目时为 null。 */
  spaceName: string | null;
  /** 锚点行的视口矩形，由 HistoryItem 在触发时测得。 */
  anchor: DOMRect;
}

/**
 * 历史会话的悬浮详情卡：替代原先"悬浮时循环滚动标题"的全文展示方式。
 *
 * 几个刻意的取舍：
 * - **portal 到 body**：侧栏 `.nav` 是 `overflow: auto` 容器，卡片留在里面会被裁掉；
 * - **position: fixed + 首帧前定位**：先用 useLayoutEffect 量出真实尺寸再写坐标
 *   （同步于首次绘制），所以既不会闪一下错位，也不用给卡片写死高度；
 * - **pointer-events: none**：卡片是纯信息展示，不抢行的悬浮与点击，
 *   鼠标一旦离开行就消失，不需要额外的"指针是否在卡片上"判断；
 * - **aria-hidden**：行内标题在 DOM 里本就是完整文本（只是被 CSS 截断），
 *   读屏已经能读到全文，卡片对辅助技术是冗余信息。
 */
export function HistoryHoverCard({ session, title, spaceName, anchor }: HistoryHoverCardProps) {
  const t = useT();
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    // 优先贴在行右侧；右侧放不下就翻到左侧；两侧都放不下（窗口极窄）时贴视口右缘
    const left =
      anchor.right + CARD_GAP + width + VIEWPORT_MARGIN <= window.innerWidth
        ? anchor.right + CARD_GAP
        : anchor.left - CARD_GAP - width >= VIEWPORT_MARGIN
          ? anchor.left - CARD_GAP - width
          : Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const centerY = anchor.top + anchor.height / 2;
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, centerY - height / 2),
      Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
    );
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.visibility = "visible";
  }, [anchor]);

  return createPortal(
    <div ref={cardRef} className={styles.card} aria-hidden="true">
      <p className={styles.title}>{title}</p>
      {/* 「本地任务」= 这条会话跑在本机 pi 上（M1 只有本地会话，留给后续远程/云端会话区分） */}
      <div className={styles.row}>
        <Desktop size={16} weight="regular" className={styles.rowIcon} />
        <span className={styles.rowText}>{t("sidenav.hover.localTask")}</span>
      </div>
      <div className={styles.row}>
        <Folder size={16} weight="regular" className={styles.rowIcon} />
        <span className={styles.rowText}>
          {t("sidenav.hover.space", { name: spaceName ?? t("sidenav.hover.noSpace") })}
        </span>
      </div>
      <div className={styles.row}>
        <CalendarDots size={16} weight="regular" className={styles.rowIcon} />
        <span className={styles.rowText}>
          {t("sidenav.hover.updatedAt", { time: formatAbsoluteTime(session.updatedAt) })}
        </span>
      </div>
    </div>,
    document.body,
  );
}
