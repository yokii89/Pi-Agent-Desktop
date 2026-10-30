import {
  ArrowElbowDownRight,
  ArrowsLeftRight,
  DotsSixVertical,
  Lightning,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { QueueIntent } from "../../../shared/ipc";
import { useQueueTrayDrawer } from "../../hooks/useQueueTrayDrawer";
import { useT } from "../../hooks/useT";
import { useSessionQueue } from "../../stores/sessionStore";
import styles from "./QueueTray.module.css";

interface QueueItem {
  /** 与顺序无关的稳定 key（种类 + 原文 + 同文序号）：拖动后 DOM 节点只移动不重建。 */
  key: string;
  kind: QueueIntent;
  /** 在该种类队列里的下标（pi 的快照顺序）。 */
  index: number;
  text: string;
}

interface DragState {
  kind: QueueIntent;
  key: string;
  fromIndex: number;
  text: string;
  pointerId: number;
  startY: number;
  dy: number;
  /** 插入位（该种类队列内 0..len，含被拖行本身）。 */
  insert: number;
  rect: { left: number; top: number; width: number; height: number };
}

/** 动作结束后把焦点还给同一行（或删除后的邻近行）。 */
interface FocusTarget {
  text: string;
  action: "grip" | "convert" | "delete";
  /** 动作发起时在整张托盘里的位置：删除后用它找下一条。 */
  index: number;
}

function buildItems(queue: { steering: string[]; followUp: string[] }): QueueItem[] {
  const seen = new Map<string, number>();
  const withKey = (kind: QueueIntent, text: string, index: number): QueueItem => {
    const base = `${kind}:${text}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { key: `${base}#${occurrence}`, kind, index, text };
  };
  return [
    ...queue.steering.map((text, index) => withKey("steer", text, index)),
    ...queue.followUp.map((text, index) => withKey("followUp", text, index)),
  ];
}

/**
 * 排队托盘（docs/design/93）：挂在输入卡正上方，展示 pi 未交付的插话 / 稍后消息。
 * 行内动作：插话 ⇄ 稍后、编辑（取回主输入栏）、删除；左侧手柄在同类 ≥2 条时出现，
 * 可拖动或用 ↑ / ↓ 在同类内换位（跨种类只能走「插话 / 稍后」按钮）。
 * 所有动作都走 store 的「全清 → 本地重排 → 重新入队」，失败文本回填输入栏。
 */
export const QueueTray = memo(function QueueTray() {
  const t = useT();
  const {
    queue,
    queueClearing,
    takeBackQueuedItem,
    discardQueuedItem,
    convertQueuedItem,
    moveQueuedItem,
  } = useSessionQueue();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** 动作串行化的同步闸门：state 要等下一轮渲染才生效，连点会漏过去。 */
  const busyRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  /** 键盘换位 / 转换 / 删除后把焦点还给该行（列表重排会移动或重建 DOM 节点）。 */
  const pendingFocusRef = useRef<FocusTarget | null>(null);

  const items = useMemo(() => buildItems(queue), [queue]);
  const trayRef = useRef<HTMLUListElement>(null);
  const { clipRef, shownItems, closing } = useQueueTrayDrawer(items, trayRef, queueClearing);
  let steerCount = 0;
  let followCount = 0;
  for (const item of shownItems) {
    if (item.kind === "steer") steerCount += 1;
    else followCount += 1;
  }
  /** 任一种类可排序时，所有行都留出手柄位：不同行的种类图标保持同一列。 */
  const gripColumn = steerCount > 1 || followCount > 1;

  const updateDrag = (next: DragState | null): void => {
    dragRef.current = next;
    setDrag(next);
  };

  /** 被拖的那条已交付 / 被别处清空：收起跟手层，避免留下永久的拖拽态。 */
  useEffect(() => {
    const current = dragRef.current;
    if (!current) return;
    if (!items.some((item) => item.key === current.key)) {
      dragRef.current = null;
      setDrag(null);
    }
  }, [items]);

  /**
   * 动作落定后再还原焦点：动作在途时按钮是 disabled 的，提前 focus() 会被忽略。
   * 转换后行还在（kind 变了、节点重建），删除后找原位置的下一条删除键。
   */
  useEffect(() => {
    if (busyKey !== null) return;
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (items.length === 0) {
      if (pending.action === "delete") {
        document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      }
      return;
    }
    const rows = [...(trayRef.current?.querySelectorAll<HTMLElement>("[data-queue-row]") ?? [])];
    const selector =
      pending.action === "grip" ? "[data-queue-grip]" : `[data-queue-action="${pending.action}"]`;
    const row = rows.find((el) => el.dataset.queueRow === pending.text);
    const button = row?.querySelector<HTMLButtonElement>(selector);
    if (button) {
      button.focus();
      return;
    }
    if (pending.action === "delete") {
      rows[Math.min(pending.index, rows.length - 1)]
        ?.querySelector<HTMLButtonElement>('[data-queue-action="delete"]')
        ?.focus();
    }
  }, [items, busyKey]);

  const runAction = async (key: string, task: () => Promise<unknown>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyKey(key);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
  };

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>, item: QueueItem): void => {
    if (busyRef.current || dragRef.current || event.button !== 0) return;
    const row = event.currentTarget.closest<HTMLElement>("[data-queue-row]");
    if (!row) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = row.getBoundingClientRect();
    updateDrag({
      kind: item.kind,
      key: item.key,
      fromIndex: item.index,
      text: item.text,
      pointerId: event.pointerId,
      startY: event.clientY,
      dy: 0,
      insert: item.index,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const tray = trayRef.current;
    if (!tray) return;
    const rows = tray.querySelectorAll<HTMLElement>(`[data-queue-kind="${current.kind}"]`);
    let insert = 0;
    for (const [index, el] of [...rows].entries()) {
      const rect = el.getBoundingClientRect();
      if (event.clientY > rect.top + rect.height / 2) insert = index + 1;
    }
    updateDrag({ ...current, dy: event.clientY - current.startY, insert });
  };

  const endDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const target = current.insert > current.fromIndex ? current.insert - 1 : current.insert;
    updateDrag(null);
    if (target === current.fromIndex) return;
    // 拖动期间这条若已被交付 / 被别处重排，下标已指不准：宁可不做，也不把整队清空
    const fromList = current.kind === "steer" ? queue.steering : queue.followUp;
    if (fromList[current.fromIndex] !== current.text) return;
    void runAction(current.key, () =>
      moveQueuedItem(current.kind, current.fromIndex, target, current.text),
    );
  };

  if (shownItems.length === 0) return null;

  const dragging = drag !== null;
  const target =
    drag === null ? null : drag.insert > drag.fromIndex ? drag.insert - 1 : drag.insert;
  const showDrop = drag !== null && target !== drag.fromIndex;

  return (
    <>
      <div
        ref={clipRef}
        className={styles.trayClip}
        data-closing={closing ? "" : undefined}
        inert={closing || undefined}
        aria-hidden={closing || undefined}
      >
        <ul
          ref={trayRef}
          className={styles.tray}
          data-dragging={drag ? "" : undefined}
          aria-label={t("session.queue.trayLabel")}
        >
          {shownItems.map((item) => {
            const steer = item.kind === "steer";
            const groupCount = steer ? steerCount : followCount;
            const reorderable = groupCount > 1;
            const isBusy = busyKey === item.key;
            const isDragging = drag?.key === item.key;
            const globalIndex = steer ? item.index : steerCount + item.index;
            const dropBefore = showDrop && drag.kind === item.kind && drag.insert === item.index;
            const dropAfter =
              showDrop &&
              drag.kind === item.kind &&
              drag.insert === groupCount &&
              item.index === groupCount - 1;
            return (
              <li
                key={item.key}
                className={styles.row}
                data-queue-row={item.text}
                data-queue-kind={item.kind}
                data-busy={isBusy ? "" : undefined}
                data-dragging={isDragging ? "" : undefined}
                data-drop={dropBefore ? "before" : dropAfter ? "after" : undefined}
              >
                {reorderable ? (
                  <button
                    type="button"
                    className={styles.grip}
                    data-queue-grip=""
                    aria-label={t("session.queue.reorder")}
                    title={t("session.queue.reorderHint")}
                    disabled={busyKey !== null}
                    onPointerDown={(event) => beginDrag(event, item)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={() => updateDrag(null)}
                    onLostPointerCapture={() => updateDrag(null)}
                    onKeyDown={(event) => {
                      const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
                      if (step === 0) return;
                      event.preventDefault();
                      const to = item.index + step;
                      if (to < 0 || to >= groupCount || busyKey !== null || drag !== null) return;
                      pendingFocusRef.current = {
                        text: item.text,
                        action: "grip",
                        index: globalIndex,
                      };
                      void runAction(item.key, () =>
                        moveQueuedItem(item.kind, item.index, to, item.text),
                      );
                    }}
                  >
                    <DotsSixVertical size={16} weight="regular" />
                  </button>
                ) : gripColumn ? (
                  <span className={styles.gripSpacer} aria-hidden="true" />
                ) : null}
                <span
                  className={styles.kindIcon}
                  role="img"
                  aria-label={t(steer ? "session.queue.steerLabel" : "session.queue.followUpLabel")}
                  title={t(steer ? "session.queue.steerLabel" : "session.queue.followUpLabel")}
                >
                  {steer ? (
                    <Lightning size={14} weight="fill" />
                  ) : (
                    <ArrowElbowDownRight size={14} weight="regular" />
                  )}
                </span>
                <span className={styles.text} title={item.text}>
                  {item.text}
                </span>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.convertBtn}
                    data-queue-action="convert"
                    aria-label={t(
                      steer ? "session.queue.toFollowUpHint" : "session.queue.toSteerHint",
                    )}
                    title={t(steer ? "session.queue.toFollowUpHint" : "session.queue.toSteerHint")}
                    disabled={busyKey !== null || dragging}
                    onClick={() => {
                      pendingFocusRef.current = {
                        text: item.text,
                        action: "convert",
                        index: globalIndex,
                      };
                      void runAction(item.key, () =>
                        convertQueuedItem(item.kind, item.index, item.text),
                      );
                    }}
                  >
                    <ArrowsLeftRight size={14} weight="regular" />
                    {t(steer ? "session.queue.followUpLabel" : "session.queue.steerLabel")}
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    data-queue-action="edit"
                    aria-label={t("session.queue.edit")}
                    title={t("session.queue.editHint")}
                    disabled={busyKey !== null || dragging}
                    onClick={() =>
                      void runAction(item.key, () =>
                        takeBackQueuedItem(item.kind, item.index, item.text),
                      )
                    }
                  >
                    <PencilSimple size={16} weight="regular" />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    data-queue-action="delete"
                    aria-label={t("session.queue.delete")}
                    title={t("session.queue.deleteHint")}
                    disabled={busyKey !== null || dragging}
                    onClick={() => {
                      pendingFocusRef.current = {
                        text: item.text,
                        action: "delete",
                        index: globalIndex,
                      };
                      void runAction(item.key, () =>
                        discardQueuedItem(item.kind, item.index, item.text),
                      );
                    }}
                  >
                    <Trash size={16} weight="regular" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {drag && (
        <div
          className={styles.ghost}
          data-queue-ghost=""
          aria-hidden="true"
          style={{
            left: drag.rect.left + 10,
            top: drag.rect.top,
            width: drag.rect.width - 20,
            height: drag.rect.height,
            transform: `translateY(${drag.dy}px)`,
          }}
        >
          <span className={styles.grip}>
            <DotsSixVertical size={16} weight="regular" />
          </span>
          <span className={styles.kindIcon}>
            {drag.kind === "steer" ? (
              <Lightning size={14} weight="fill" />
            ) : (
              <ArrowElbowDownRight size={14} weight="regular" />
            )}
          </span>
          <span className={styles.text}>{drag.text}</span>
        </div>
      )}
    </>
  );
});
