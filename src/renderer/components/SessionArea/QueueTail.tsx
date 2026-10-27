import { ArrowUUpLeft, ClockCountdown, Lightning, PencilSimple } from "@phosphor-icons/react";
import { memo, useEffect, useRef, useState } from "react";
import type { QueueIntent } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { useSessionQueue } from "../../stores/sessionStore";
import styles from "./QueueTail.module.css";

interface QueueItem {
  key: string;
  kind: QueueIntent;
  index: number;
  text: string;
}

/** 原位置编辑态：`source` 是打开编辑时的原文（用于在队列变化后重新定位这条），`text` 是草稿。 */
interface EditState {
  key: string;
  source: string;
  text: string;
}

/**
 * 把编辑态重新落到当前队列上。气泡下标是位置量，队列一变（别的条目交付 / 被撤销）就指不准了，
 * 所以先按「原 key 且原文没变」认，再退到「按原文找回同一条」——编辑不因无关的队列变化中断。
 * 两条都找不到说明这条已经不在了，返回 undefined 让调用方收起编辑。
 */
function resolveEditTarget(items: QueueItem[], edit: EditState): QueueItem | undefined {
  const at = items.find((item) => item.key === edit.key && item.text === edit.source);
  return at ?? items.find((item) => item.text === edit.source);
}

/**
 * 未交付的排队消息（docs/design/73 方案 B）：挂在对话流尾部，交付后由 store 落成普通用户条目。
 * 左侧状态轨（插话蓝 / 稍后琥珀）+ 与正文同行的徽标；悬停 / 键盘聚焦在气泡右上角揭示
 * 「撤销 / 编辑」，编辑在原气泡内改文本——pi 只有全量 clear_queue，保存时由 store
 * 全清后按原序重排，队列顺序不变。
 *
 * memo：会话流每个流式批次都会重渲染 SessionView，排队气泡本身不依赖 entries；
 * 这里只随队列 context 变化重渲染（props 恒空，memo 挡父级重渲染）。
 */
export const QueueTail = memo(function QueueTail() {
  const t = useT();
  const { queue, withdrawQueuedItem, editQueuedItem } = useSessionQueue();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const items: QueueItem[] = [
    ...queue.steering.map((text, index) => ({
      key: `s${index}`,
      kind: "steer" as const,
      index,
      text,
    })),
    ...queue.followUp.map((text, index) => ({
      key: `f${index}`,
      kind: "followUp" as const,
      index,
      text,
    })),
  ];

  const editTarget = editing ? resolveEditTarget(items, editing) : undefined;
  const editState = editing && editTarget ? editing : null;

  // 编辑中的那条已经不在队列里（被交付 / 被撤销）：收起编辑态
  useEffect(() => {
    if (editing && !editTarget) setEditing(null);
  }, [editing, editTarget]);

  // 依赖落点 key（不是 editState 对象）：目标条换行时 textarea 会重挂，得重新聚焦
  const editKey = editTarget?.key;
  useEffect(() => {
    if (!editKey) return;
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    // 光标落到末尾：改排队消息多是续写，不是整段重打
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editKey]);

  const startEdit = (item: QueueItem): void => {
    setEditing({ key: item.key, source: item.text, text: item.text });
  };

  const withdraw = async (item: QueueItem): Promise<void> => {
    if (busyKey !== null) return;
    setBusyKey(item.key);
    try {
      await withdrawQueuedItem(item.kind, item.index, item.text);
    } finally {
      setBusyKey(null);
    }
  };

  const save = async (item: QueueItem): Promise<void> => {
    if (!editState || busyKey !== null) return;
    const next = editState.text.trim();
    // 没改动就只收起编辑，不惊动 pi 队列
    if (!next || next === item.text) {
      setEditing(null);
      return;
    }
    setBusyKey(item.key);
    try {
      // 失败（含队列已变化）保留编辑态，用户改完还能再来一次
      if (await editQueuedItem(item.kind, item.index, item.text, next)) setEditing(null);
    } finally {
      setBusyKey(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {items.map((item) => {
        const isBusy = busyKey === item.key;
        const isEditing = editTarget?.key === item.key;
        const steer = item.kind === "steer";
        return (
          <div
            key={item.key}
            className={styles.row}
            data-kind={item.kind}
            data-busy={isBusy ? "" : undefined}
            data-editing={isEditing ? "" : undefined}
          >
            {/* 动作槽在气泡左侧：常驻占位、悬停揭示，正文一个字都不会被压住 */}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.actBtn}
                title={t("session.queue.undoHint")}
                aria-label={t("session.queue.undo")}
                disabled={isBusy || editTarget !== undefined}
                onClick={() => void withdraw(item)}
              >
                <ArrowUUpLeft size={16} weight="regular" />
              </button>
              <button
                type="button"
                className={styles.actBtn}
                title={t("session.queue.editHint")}
                aria-label={t("session.queue.edit")}
                disabled={isBusy || editTarget !== undefined}
                onClick={() => startEdit(item)}
              >
                <PencilSimple size={16} weight="regular" />
              </button>
            </div>
            <div className={styles.bubble}>
              <div className={styles.flow}>
                <span className={styles.badge}>
                  {steer ? (
                    <Lightning size={12} weight="fill" />
                  ) : (
                    <ClockCountdown size={12} weight="regular" />
                  )}
                  {/* 视觉只留种类（与正文同行），读屏给完整状态「排队中 · 插话」 */}
                  <span aria-hidden="true">
                    {steer ? t("session.queue.steerLabel") : t("session.queue.followUpLabel")}
                  </span>
                  <span className={styles.srOnly}>
                    {steer ? t("session.queue.steerBadge") : t("session.queue.followUpBadge")}
                  </span>
                </span>
                {!isEditing && <span className={styles.text}>{item.text}</span>}
              </div>
              {isEditing && editState && (
                <>
                  <textarea
                    ref={editorRef}
                    className={styles.editor}
                    value={editState.text}
                    rows={3}
                    aria-label={t("session.queue.editHint")}
                    onChange={(event) => {
                      const text = event.target.value;
                      setEditing((prev) => (prev ? { ...prev, text } : prev));
                    }}
                    onKeyDown={(event) => {
                      // 输入法组合期的 Enter / Escape 是候选操作，不是保存 / 取消
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void save(item);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                  <div className={styles.editBar}>
                    <button
                      type="button"
                      className={styles.editBtn}
                      disabled={isBusy}
                      onClick={() => setEditing(null)}
                    >
                      {t("session.queue.cancel")}
                    </button>
                    <button
                      type="button"
                      className={`${styles.editBtn} ${styles.editBtnPrimary}`}
                      disabled={isBusy}
                      onClick={() => void save(item)}
                    >
                      {t("session.queue.save")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
