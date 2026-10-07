import { Camera } from "@phosphor-icons/react";
import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { useT } from "../../hooks/useT";
import { useComposerStore } from "../../stores/composerStore";
import {
  type ExtensionViewEntry,
  filterViewsForSession,
  useExtensionViewStore,
} from "../../stores/extensionViewStore";
import { useSessionEntries, useSessionMeta } from "../../stores/sessionStore";
import {
  findRetrySurfaceId,
  type SessionEntry,
  type SnapshotEntry,
} from "../../stores/sessionTranscript";
import { useUiStore } from "../../stores/uiStore";
import { StreamMount } from "../ExtensionView/StreamMount";
import { AgentRunHeader } from "./AgentRunHeader";
import { AssistantMessage } from "./AssistantMessage";
import { FileEditsSummary } from "./FileEditsSummary";
import { FirstTokenWaiter } from "./FirstTokenWaiter";
import { QuestionRail } from "./QuestionRail";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { SelectionContextMenu } from "./SelectionContextMenu";
import styles from "./SessionView.module.css";
import { StreamErrorCard } from "./StreamErrorCard";
import { UserMessage } from "./UserMessage";

/** 稳定空数组：EntryRow memo 比较 afterStreams 引用时避免每次新建。 */
const EMPTY_STREAMS: ExtensionViewEntry[] = [];

/** 未读条数超过该值时按钮只显示条数，不再估算行数。 */
const UNREAD_LINE_PX = 24;

/**
 * 自研会话视图（docs/design/03 §3.3 + docs/design/13）：
 * 用户气泡 + AI 文档流 + run 边界。滚动跟随走 useStickToBottom 状态机
 * （用户上滚/拖选 → free，滚回底部 → follow）；划选右键呼出浮窗（docs/design/12）。
 */
export function SessionView() {
  const t = useT();
  const entries = useSessionEntries();
  const { switchingTo, transcriptReady, processAlive, activeSessionId, phase, startPending, stop } =
    useSessionMeta();
  const { streams, hasBlockingViewFor } = useExtensionViewStore();
  const { quoteComposer } = useComposerStore();
  const { showToast, settingsOpen } = useUiStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const { mode, unreadPx, jumpToLatest, jumpToOffset, reset } = useStickToBottom(
    scrollRef,
    contentRef,
  );
  const showSkeleton = switchingTo !== null && !transcriptReady;
  // 切换中：磁盘历史已上屏、进程尚未就绪 → 细提示，可滚动只读
  const showRestoreHint = switchingTo !== null && transcriptReady && !processAlive;
  // 引用落点在输入栏：仅输入栏整体锁定（切换中 / 阻断浮层）时置灰；
  // running 期间输入栏可编辑草稿，引用照常可用（docs/design/12 P1-1）
  const hasBlockingView = hasBlockingViewFor(activeSessionId);
  const quoteDisabled = switchingTo !== null || hasBlockingView;
  const quoteDisabledHint =
    switchingTo !== null
      ? t("session.restoringShort")
      : hasBlockingView
        ? t("session.blockedByOverlay")
        : "";

  // 会话切换后不带上一会话的滚动状态（free / 未读数）
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeSessionId 是重置信号；reset 引用稳定
  useEffect(() => {
    reset();
  }, [activeSessionId, reset]);

  // 未读条目计数：free 期间新增的 entries 数（配合 unreadPx 生成跳底提示）
  const [unreadEntries, setUnreadEntries] = useState(0);
  const entriesCountRef = useRef(entries.length);
  useEffect(() => {
    if (mode === "follow") {
      entriesCountRef.current = entries.length;
      setUnreadEntries(0);
      return;
    }
    const delta = entries.length - entriesCountRef.current;
    if (delta > 0) setUnreadEntries((count) => count + delta);
    else if (delta < 0) entriesCountRef.current = entries.length;
  }, [entries.length, mode]);

  // Ctrl+End 跳到最新（docs/design/10 §3.5 G3）；输入框 / 终端内保留原生行为
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "End") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target.isContentEditable && !target.closest(`.${styles.scroll}`)))
      ) {
        return;
      }
      event.preventDefault();
      jumpToLatest();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jumpToLatest]);

  // Esc 停止（docs/design/13 P1-7）：焦点分层——建议面板 / 右键浮窗 / 弹窗各自消费 Esc
  // （stopPropagation），这里只接未被消费的 Esc；焦点在输入类元素（重命名、终端）时不抢。
  const running = phase === "running";
  useEffect(() => {
    if (!running) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (selectionMenu || settingsOpen || hasBlockingView || !processAlive) return;
      event.preventDefault();
      stop();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [running, stop, selectionMenu, settingsOpen, hasBlockingView, processAlive]);

  // 读屏播报（docs/design/10 §3.11 G1）：视觉隐藏 live region，只在状态边界更新，
  // 不随流式 delta 刷屏；失败时错误卡的 role="alert" 已有播报。
  const [announcement, setAnnouncement] = useState("");
  const prevRunningRef = useRef(running);
  useEffect(() => {
    const was = prevRunningRef.current;
    prevRunningRef.current = running;
    if (!was && running) setAnnouncement(t("session.a11y.assistantReplying"));
    else if (was && !running) setAnnouncement(t("session.a11y.replyEnded"));
  }, [running, t]);

  const closeSelectionMenu = useCallback(() => setSelectionMenu(null), []);

  // 右键浮窗入口（docs/design/12 §4.1）：无条件抑制浏览器默认菜单；有有效选区才浮窗
  const openSelectionMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = scrollRef.current;
    const selection = window.getSelection();
    if (!container || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const text = selection.toString();
    if (!text.trim()) return;
    // 选区两端都在会话流内（从输入框等处拖出的选区不误判）
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return;
    }
    setSelectionMenu({ x: event.clientX, y: event.clientY, text });
  }, []);

  const handleCopySelection = useCallback(
    (text: string) => {
      // 渲染进程直写剪贴板（SessionHeader 同范式），成功失败双路反馈
      void navigator.clipboard
        .writeText(text)
        .then(() => showToast(t("common.copied")))
        .catch(() => showToast(t("session.copyFailed")));
    },
    [showToast, t],
  );

  const handleQuoteSelection = useCallback(
    (text: string) => {
      quoteComposer(text);
    },
    [quoteComposer],
  );

  // 浮窗打开期间会话流滚动 / 窗口缩放会让菜单与选区错位，立即关闭
  useEffect(() => {
    if (!selectionMenu) return;
    const el = scrollRef.current;
    const close = (): void => setSelectionMenu(null);
    el?.addEventListener("scroll", close);
    window.addEventListener("resize", close);
    return () => {
      el?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [selectionMenu]);

  // stream 卡片：afterEntryId 命中则插在该条目后，未命中/缺省 → 追加流末尾（§5.3.2）
  // 多会话：按 active 过滤；id 错位时 filterViewsForSession 会兜底，避免 stream 整页消失
  const streamsAfter = new Map<string, ExtensionViewEntry[]>();
  const trailingStreams: ExtensionViewEntry[] = [];
  const entryIdSet = new Set(entries.map((e) => e.id));
  const visibleStreams = filterViewsForSession(streams, activeSessionId);
  for (const stream of visibleStreams) {
    const after = stream.placementHint?.afterEntryId;
    if (after && entryIdSet.has(after)) {
      const list = streamsAfter.get(after) ?? [];
      list.push(stream);
      streamsAfter.set(after, list);
    } else {
      trailingStreams.push(stream);
    }
  }

  // 仅流末尾那张汇总卡接撤销/审阅（历史卡只读回看）
  let latestEditsId: string | null = null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind === "editsSummary") {
      latestEditsId = entries[i].id;
      break;
    }
  }

  // 最后一条用户消息 id（用户气泡「重新发送」仅对它开放，与 run 头重试同源）
  let lastUserId: string | null = null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === "user") {
      lastUserId = entry.text.trim() ? entry.id : null;
      break;
    }
  }

  // 终态失败只保留一个「重试」落点：中间 attempt 的 run 头不再各带按钮
  const retrySurfaceId = findRetrySurfaceId(entries);

  // 首字等待占位（docs/design/13 P1-3）：run 已开始且其后还没有任何条目时出现
  const lastEntry = entries.at(-1);
  const showWaiter =
    !showSkeleton &&
    lastEntry !== undefined &&
    lastEntry.kind === "run" &&
    lastEntry.status === "running" &&
    lastEntry.synthetic !== true;

  const unreadLabel =
    unreadEntries > 0
      ? t("session.unread.entries", { count: unreadEntries })
      : unreadPx > 0
        ? t("session.unread.lines", {
            count: Math.max(1, Math.round(unreadPx / UNREAD_LINE_PX)),
          })
        : undefined;

  return (
    <div className={styles.view}>
      {showRestoreHint && <div className={styles.restoreHint}>{t("session.restoring")}</div>}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 会话流是只读阅读面，右键只做划选浮窗入口，不伪装成交互 role */}
      <div
        className={`${styles.scroll} ${mode === "free" ? styles.scrollFree : ""}`}
        ref={scrollRef}
        onContextMenu={openSelectionMenu}
      >
        <div className={styles.inner} ref={contentRef}>
          {showSkeleton ? (
            <div className={styles.skeleton} aria-hidden>
              <div className={styles.skeletonTitle} />
              <div className={styles.skeletonLine} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineMid}`} />
            </div>
          ) : (
            <>
              {entries.map((entry) => {
                const entryIsLastUser = entry.kind === "user" && entry.id === lastUserId;
                return (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    isLatestEdits={entry.kind === "editsSummary" && entry.id === latestEditsId}
                    isLastUser={entryIsLastUser}
                    coldStart={startPending && entryIsLastUser}
                    showRetry={entry.id === retrySurfaceId}
                    afterStreams={streamsAfter.get(entry.id) ?? EMPTY_STREAMS}
                  />
                );
              })}
              {trailingStreams.map((stream) => (
                <StreamMount key={stream.id} entry={stream} />
              ))}
              {showWaiter && <FirstTokenWaiter />}
            </>
          )}
        </div>
      </div>
      {!showSkeleton && (
        <QuestionRail entries={entries} scrollRef={scrollRef} jumpToOffset={jumpToOffset} />
      )}
      <div aria-live="polite" className={styles.srOnly}>
        {announcement}
      </div>
      {mode === "free" && !showSkeleton && (
        <ScrollToBottomButton onClick={jumpToLatest} label={unreadLabel} />
      )}
      {selectionMenu && (
        <SelectionContextMenu
          position={{ x: selectionMenu.x, y: selectionMenu.y }}
          text={selectionMenu.text}
          quoteDisabled={quoteDisabled}
          quoteDisabledHint={quoteDisabledHint}
          onCopy={handleCopySelection}
          onQuote={handleQuoteSelection}
          onClose={closeSelectionMenu}
        />
      )}
    </div>
  );
}

/**
 * 条目行：历史稳定条目在 entries 数组整体替换时凭引用相等跳过重渲染。
 * 运行中的 run 头仍会因自身 useSessionMeta 订阅而更新（usage/停止按钮）。
 */
const EntryRow = memo(function EntryRow({
  entry,
  isLatestEdits,
  isLastUser,
  coldStart,
  showRetry,
  afterStreams,
}: {
  entry: SessionEntry;
  isLatestEdits: boolean;
  isLastUser: boolean;
  /** 最后一条用户气泡上的冷启动进度条（PiColdStartBar 挂载判定的一半，另一半在桶上）。 */
  coldStart: boolean;
  /** 当前轮唯一「重试」落点（findRetrySurfaceId）；中间失败 attempt 为 false。 */
  showRetry: boolean;
  afterStreams: ExtensionViewEntry[];
}) {
  return (
    <div className={styles.entry} data-kind={entry.kind} data-entry-id={entry.id}>
      {entry.kind === "user" ? (
        <UserMessage
          text={entry.text}
          items={entry.items}
          images={entry.images}
          canResend={isLastUser}
          coldStart={coldStart}
        />
      ) : entry.kind === "run" ? (
        <AgentRunHeader entry={entry} showRetry={showRetry} />
      ) : entry.kind === "notice" ? (
        <p className={styles.notice}>{entry.text}</p>
      ) : entry.kind === "error" ? (
        <StreamErrorCard entry={entry} showRetry={showRetry} />
      ) : entry.kind === "snapshot" ? (
        <SnapshotCard entry={entry} />
      ) : entry.kind === "editsSummary" ? (
        <FileEditsSummary entry={entry} isLatest={isLatestEdits} />
      ) : (
        <AssistantMessage blocks={entry.blocks} />
      )}
      {afterStreams.map((stream) => (
        <StreamMount key={stream.id} entry={stream} />
      ))}
    </div>
  );
});

/** "刷新并截图"验证快照（docs/design/05 P1-3）：以卡片进入会话文档流，供肉眼确认。 */
function SnapshotCard({ entry }: { entry: SnapshotEntry }) {
  const t = useT();
  return (
    <figure className={styles.snapshot}>
      <figcaption className={styles.snapshotCaption}>
        <Camera size={14} weight="regular" />
        <span>{t("session.snapshot.title")}</span>
        <span className={styles.snapshotUrl} title={entry.url}>
          {entry.url}
        </span>
        <span className={styles.snapshotTime}>{new Date(entry.at).toLocaleTimeString()}</span>
      </figcaption>
      <img className={styles.snapshotImage} src={entry.image} alt={t("session.snapshot.alt")} />
    </figure>
  );
}
