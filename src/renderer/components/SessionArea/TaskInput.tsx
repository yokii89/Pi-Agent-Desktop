import { Folder } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FsSearchHit, PiSlashCommand, QueueIntent } from "../../../shared/ipc";
import { FileIcon } from "../../fileIcons/FileIcon";
import { useGlideOverlay } from "../../hooks/useGlideOverlay";
import { useGlidePill } from "../../hooks/useGlidePill";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useBrowserStore } from "../../stores/browserStore";
import { type FileMention, useComposerStore } from "../../stores/composerStore";
import { useExtensionViewStore } from "../../stores/extensionViewStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import {
  createFileAttachmentId,
  MAX_ATTACH_FILES,
  routeAttachFile,
  toDisplayPath,
} from "../../utils/fileAttach";
import { formatFileMentionPrompt } from "../../utils/fileMentionFormat";
import { loadComposerImage, MAX_ATTACH_IMAGES, toPiImageContent } from "../../utils/imageAttach";
import {
  imageCapabilityFromInput,
  imageCapabilityHint,
  imageCapabilityToast,
} from "../../utils/imageCapability";
import { parseSteerCommand } from "../../utils/steerCommand";
import { Button } from "../ui/Button";
import glideStyles from "../ui/GlideList.module.css";
import { Composer, type ComposerHandle } from "./Composer";
import { FileAttachStrip } from "./FileAttachStrip";
import { ImageAttachStrip } from "./ImageAttachStrip";
import { InputBuddy, type InputBuddyHandle } from "./InputBuddy/InputBuddy";
import styles from "./TaskInput.module.css";
import { TaskInputContextBar } from "./TaskInputContextBar";
import { TaskInputToolbar } from "./TaskInputToolbar";
import { ThinkingMaxAura } from "./ThinkingMaxAura";

type SuggestKind = "file" | "slash" | null;

/** PiDesk 输入栏本地命令（docs/design/73）：不进 pi 命令表，斜杠菜单单独成组。 */
interface LocalSlashCommand {
  name: string;
  description: string;
}

type SlashGroupItem = PiSlashCommand | LocalSlashCommand;

interface TaskInputProps {
  variant: "empty" | "session";
  /** queueEdit：编辑排队消息形态（docs/design/73）。 */
  mode?: "session" | "queueEdit";
  /** queueEdit：打开时的草稿文本（队列原文）。 */
  initialText?: string;
  /** queueEdit：保存（Enter / 发送键）；返回 false 表示失败、保留编辑态。 */
  onQueueEditSubmit?: (text: string, fileMentions: FileMention[]) => boolean | Promise<boolean>;
  /** queueEdit：取消（工具栏「取消」按钮 / Esc）。 */
  onQueueEditCancel?: () => void;
}

/**
 * 任务输入栏：empty 显示工作区/Git 顶栏；running/idle 为底部停靠精简版。
 * 元素芯片内联嵌在文本中间；@ 文件与 / 命令走上方建议列表。
 * queueEdit 形态供排队气泡原位编辑复用：同一张输入卡（含 / @ 建议与工具栏），
 * 但保存改走 onQueueEditSubmit、取消走按钮/Esc（见 QueueTail）。
 */
export function TaskInput({
  variant,
  mode = "session",
  initialText,
  onQueueEditSubmit,
  onQueueEditCancel,
}: TaskInputProps) {
  const isQueueEdit = mode === "queueEdit";
  const t = useT();
  const { phase, send, stop, getSlashCommands, switchingTo, modelInput, modelLabel } =
    useSessionMeta();
  const { showToast, inputBuddy } = useUiStore();
  const browser = useBrowserStore();
  const { currentProject } = useProjectStore();
  const {
    thinkingLevel,
    fileMentions,
    addFileMention,
    removeFileMention,
    clearFileMentions,
    imageAttachments,
    addImageAttachment,
    removeImageAttachment,
    clearImageAttachments,
    fileAttachments,
    addFileAttachment,
    removeFileAttachment,
    clearFileAttachments,
    reorderImageAttachments,
    reorderFileAttachments,
    pendingQuote,
    consumePendingQuote,
    pendingInsert,
    consumePendingInsert,
  } = useComposerStore();

  const [staleConfirm, setStaleConfirm] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [focusSeq, setFocusSeq] = useState(0);
  const [insertTrigger, setInsertTrigger] = useState<{ kind: "@" | "/"; seq: number } | null>(null);
  const [suggest, setSuggest] = useState<{
    kind: Exclude<SuggestKind, null>;
    query: string;
  } | null>(null);
  const [fileHits, setFileHits] = useState<FsSearchHit[]>([]);
  const [slashCommands, setSlashCommands] = useState<PiSlashCommand[]>([]);
  const [slashLoading, setSlashLoading] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const slashFetchSeqRef = useRef(0);
  const suggestPanelRef = useRef<HTMLDivElement | null>(null);
  /**
   * 同一个 token 的重复上报（光标移动、选区变化都会再报一次同样的文本）必须**原样吞掉**：
   * 早先无条件 setSuggest(新对象) + setSuggestIndex(0) 会让 suggestIndex 被反复清零，
   * 于是悬停刚把药丸移到第 4 行，下一次上报就把它拽回第 0 行——视觉上就是频闪。
   */
  const lastSuggestKey = useRef("");
  const setSuggestAndReset = useCallback(
    (next: { kind: Exclude<SuggestKind, null>; query: string } | null) => {
      const key = next ? `${next.kind}|${next.query}` : "";
      if (key === lastSuggestKey.current) return;
      lastSuggestKey.current = key;
      setSuggest(next);
      setSuggestIndex(0);
    },
    [],
  );
  const prevLenRef = useRef(0);
  const composerRef = useRef<ComposerHandle | null>(null);
  const searchSeqRef = useRef(0);
  const running = phase === "running";
  // P0：modal / floating widget 打开期间禁用任务输入发送，避免与工具 Promise 双写
  // （docs/design/08 §12.1；floating widget 与 modal 同属阻断交互）
  const { hasBlockingViewFor, modeTransitioning, sendBlockedReason } = useExtensionViewStore();
  const { activeSessionId } = useSessionMeta();
  // 仅阻断「当前会话」的 floating 表单；新建空态（activeSessionId=null）不因后台问卷禁用输入
  const hasBlockingView = hasBlockingViewFor(activeSessionId);

  const chatElements = browser.chatElements;
  const staleCount = chatElements.filter((item) => item.stale).length;
  // 切换会话未完成时禁用发送：避免在错误 cwd / 未就绪进程上误发
  const switching = switchingTo !== null;
  // 访问模式激活期间禁发送：门禁确认前 prompt 不得抢跑（docs/design/16 §7.5）
  // 图片附件单独放行空正文（docs/design/21：「看这张图」合法）
  // 软门禁：目录 input 只作信号，任何能力态都允许发送；declared-no 仅轻提示
  const imageCapability = imageCapabilityFromInput(modelInput);
  const imageHint = imageAttachments.length > 0 ? imageCapabilityHint(imageCapability) : null;
  const visionToastShownFor = useRef<Set<string>>(new Set());
  // 伙伴的情绪走命令式：误触发送只是「它替你生气一下」，不该让整个输入栏重渲染
  const buddyRef = useRef<InputBuddyHandle | null>(null);
  const canSend =
    (hasContent ||
      fileMentions.length > 0 ||
      imageAttachments.length > 0 ||
      fileAttachments.length > 0) &&
    !hasBlockingView &&
    !switching &&
    !modeTransitioning;
  /** 运行中发送等 pi 受理后再清空，失败时草稿原样保留。 */
  const queueSendingRef = useRef(false);
  const cwd = currentProject?.dir ?? null;

  const placeholder = isQueueEdit
    ? t("session.queue.editPlaceholder")
    : switching
      ? t("session.restoring")
      : modeTransitioning
        ? (sendBlockedReason ?? t("session.input.placeholder.switchingMode"))
        : running
          ? // running 可编辑草稿的外显（docs/design/12 P1-1 / 13 P2-2）：能力不靠 toast 才被发现
            t("session.input.placeholder.runningDraft")
          : variant === "empty"
            ? t("session.input.placeholder.ask")
            : t("session.input.placeholder.followUp");

  useEffect(() => {
    if (chatElements.length > prevLenRef.current) setFocusSeq((n) => n + 1);
    prevLenRef.current = chatElements.length;
  }, [chatElements.length]);

  /**
   * 拉取 pi 斜杠命令（docs/会话进程懒加载方案 §5.2）：借用/缓存编排都在
   * sessionStore.getSlashCommands——冷会话借同 cwd 存活实例或命中缓存，零 spawn。
   * get_commands 返回扩展命令 / prompt 模板 / skills（docs/rpc.md）。
   */
  const loadSlashCommands = useCallback(async (): Promise<void> => {
    const seq = ++slashFetchSeqRef.current;
    setSlashLoading(true);
    try {
      const list = await getSlashCommands();
      if (slashFetchSeqRef.current === seq) setSlashCommands(list);
    } finally {
      if (slashFetchSeqRef.current === seq) setSlashLoading(false);
    }
  }, [getSlashCommands]);

  // 打开 / 建议时确保命令已加载（冷会话不再为菜单预启动 pi）
  useEffect(() => {
    if (suggest?.kind !== "slash") return;
    if (slashCommands.length > 0) return;
    void loadSlashCommands();
  }, [suggest, slashCommands.length, loadSlashCommands]);

  // 命令列表随 cwd 走（§5.2 跨 cwd 不共享）：切换项目后清空，下次打开 / 重新拉取
  // biome-ignore lint/correctness/useExhaustiveDependencies: cwd 是重置信号，不在闭包内读取
  useEffect(() => {
    setSlashCommands((prev) => (prev.length > 0 ? [] : prev));
  }, [cwd]);

  // @ 文件/文件夹搜索：空查询返回浅层浏览列表；有查询按文件名或相对路径部分匹配
  useEffect(() => {
    if (suggest?.kind !== "file") {
      setFileHits([]);
      return;
    }
    if (!cwd) {
      setFileHits([]);
      return;
    }
    const q = suggest.query.trim();
    const seq = ++searchSeqRef.current;
    const timer = window.setTimeout(
      () => {
        fsService.search(cwd, q).then((hits) => {
          if (searchSeqRef.current === seq) setFileHits(hits.slice(0, 16));
        });
      },
      q ? 180 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [suggest, cwd]);

  const slashFiltered = useMemo(() => {
    if (suggest?.kind !== "slash") return [];
    const q = suggest.query.trim().toLowerCase();
    // 只输入 / 时展示全部指令及说明；有输入再过滤（名称或说明）
    if (!q) return slashCommands;
    return slashCommands.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q),
    );
  }, [suggest, slashCommands]);

  /** 本地命令（/steer）：查询为空或命中名称/说明时展示，不依赖 pi 命令表加载。
      队列编辑不展示：条目已在队列里，插话/稍后归属由原队列种类决定。 */
  const localCommands = useMemo<LocalSlashCommand[]>(
    () => (isQueueEdit ? [] : [{ name: "steer", description: t("session.queue.steerDesc") }]),
    [isQueueEdit, t],
  );

  /** 本地命令在前（输入栏命令 /steer），随后按 pi source 分组：命令（extension/prompt）与技能（skill）。 */
  const slashGroups = useMemo(() => {
    if (suggest?.kind !== "slash") return [];
    const q = suggest.query.trim().toLowerCase();
    const matchQuery = (name: string, description?: string): boolean =>
      !q || name.toLowerCase().includes(q) || (description ?? "").toLowerCase().includes(q);
    const groups: Array<{ title: string; items: SlashGroupItem[] }> = [];
    const local = localCommands.filter((c) => matchQuery(c.name, c.description));
    if (local.length > 0) {
      groups.push({ title: t("session.input.group.local"), items: local });
    }
    const commands = slashFiltered.filter((c) => c.source !== "skill");
    const skills = slashFiltered.filter((c) => c.source === "skill");
    if (commands.length > 0)
      groups.push({ title: t("session.input.group.commands"), items: commands });
    if (skills.length > 0) groups.push({ title: t("session.input.group.skills"), items: skills });
    return groups;
  }, [suggest, slashFiltered, localCommands, t]);

  const suggestItems = useMemo((): Array<{
    id: string;
    label: string;
    hint?: string;
    kind?: string;
  }> => {
    if (!suggest) return [];
    if (suggest.kind === "file") {
      return fileHits.map((hit) => {
        const name = hit.displayPath.split("/").pop() || hit.displayPath;
        const dir = hit.displayPath.includes("/")
          ? hit.displayPath.slice(0, hit.displayPath.lastIndexOf("/"))
          : "";
        return {
          id: hit.path,
          label: name,
          hint: dir || ".",
          kind: hit.kind,
        };
      });
    }
    // 与 slashGroups 展示顺序一致（本地命令、pi 命令、技能），保证 ↑↓ 与视觉行序一一对应
    return slashGroups
      .flatMap((g) => g.items)
      .map((c) => ({
        id: c.name,
        label: `/${c.name.replace(/^skill:/, "skill:")}`,
        hint:
          c.description ||
          ("source" in c && c.source === "skill" ? t("session.input.group.skills") : ""),
        kind: undefined,
      }));
  }, [suggest, fileHits, slashGroups, t]);

  const onComposerReady = useCallback((handle: ComposerHandle) => {
    composerRef.current = handle;
  }, []);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // queueEdit 草稿预填：appendText 写入并把光标放到末尾；StrictMode 双跑用 ref 挡一次
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!isQueueEdit || !initialText || prefilledRef.current) return;
    const composer = composerRef.current;
    if (!composer) return;
    prefilledRef.current = true;
    composer.appendText(initialText);
  }, [isQueueEdit, initialText]);

  // 会话流「添加到对话栏」（docs/design/12）：消费待引用文本追加进编辑器，seq 由 store 保证单次
  useEffect(() => {
    if (!pendingQuote) return;
    composerRef.current?.appendQuote(pendingQuote.text);
    consumePendingQuote();
  }, [pendingQuote, consumePendingQuote]);

  // 清空队列 / 停止取回的文本：纯文本追加到编辑器末尾（不是引用块）
  useEffect(() => {
    if (!pendingInsert) return;
    composerRef.current?.appendText(pendingInsert.text);
    consumePendingInsert();
  }, [pendingInsert, consumePendingInsert]);

  /**
   * 建议列表的进出场（docs/design/51）。面板是父级条件渲染的，收起要演完动画再卸载，
   * 所以这里**延迟置空** `suggest`：动画期间行内容原样保留，不动任何数据流；
   * 用户在淡出过程中继续打字就中止收起、从当前值演回展开。
   */
  const suggestOverlay = useGlideOverlay(suggestPanelRef);
  const suggestClosing = useRef(false);
  const suggestShown = useRef(false);

  useLayoutEffect(() => {
    const panel = suggestPanelRef.current;
    if (!panel || !suggest || suggestClosing.current || suggestShown.current) return;
    suggestShown.current = true;
    // 面板长在输入框上方，缩放要从贴近输入框的那一角推开
    panel.style.transformOrigin = "bottom left";
    suggestOverlay.prime();
    suggestOverlay.enter();
  }, [suggest, suggestOverlay]);

  const abortSuggestClose = useCallback((): void => {
    if (!suggestClosing.current) return;
    suggestClosing.current = false;
    suggestOverlay.enter();
  }, [suggestOverlay]);

  const closeSuggest = useCallback((): void => {
    if (!suggest || suggestClosing.current) return;
    suggestClosing.current = true;
    suggestOverlay.exit(() => {
      suggestClosing.current = false;
      suggestShown.current = false;
      setSuggestAndReset(null);
    });
  }, [suggest, setSuggestAndReset, suggestOverlay]);

  /** 不演动画直接收：发送后整栏清空，留着过期条目淡出会闪一下。 */
  const hideSuggestNow = useCallback((): void => {
    suggestClosing.current = false;
    suggestShown.current = false;
    suggestOverlay.cancel();
    setSuggestAndReset(null);
  }, [setSuggestAndReset, suggestOverlay]);

  const applySuggestItem = useCallback(
    (item: { id: string; label: string }) => {
      const composer = composerRef.current;
      if (!suggest || !composer) return;
      if (suggest.kind === "file") {
        const hit = fileHits.find((h) => h.path === item.id);
        if (!hit || !composer.insertFileMention(hit)) return;
        addFileMention({ path: hit.path, displayPath: hit.displayPath, kind: hit.kind });
      } else {
        composer.insertSlashCommand(item.id);
      }
      closeSuggest();
      composer.focus();
    },
    [suggest, fileHits, addFileMention, closeSuggest],
  );

  const onComposerTextChange = useCallback(
    (text: string) => {
      // 仅在光标附近的尾部 token 触发
      const fileMatch = text.match(/(^|\s)@([^\s@]*)$/);
      const slashMatch = text.match(/(^|\s)\/([^\s/]*)$/);
      if (fileMatch) {
        abortSuggestClose();
        setSuggestAndReset({ kind: "file", query: fileMatch[2] ?? "" });
        return;
      }
      if (slashMatch) {
        abortSuggestClose();
        setSuggestAndReset({ kind: "slash", query: slashMatch[2] ?? "" });
        return;
      }
      // 删掉 @ 或 / 让 token 消失：走动画收起，与点开条目一致
      closeSuggest();
    },
    [setSuggestAndReset, abortSuggestClose, closeSuggest],
  );

  const doSend = async (): Promise<void> => {
    const composer = composerRef.current;
    if (!composer) return;
    if (isQueueEdit) {
      const { text: rawText, fileMentions: orderedFiles } = composer.read();
      const body = rawText.trim();
      if (!body && orderedFiles.length === 0) return;
      // @ 芯片序列化为 @displayPath 文本（队列只存文本，附件入口已隐藏）
      const finalText = formatFileMentionPrompt(rawText, orderedFiles);
      const ok = await onQueueEditSubmit?.(finalText, orderedFiles);
      // false = 失败保留编辑态；成功由父级收起编辑并卸载本卡
      if (ok === false) return;
      return;
    }
    // modal 打开时忽略发送（abort 仍可用，走 toolbar stop）；切换中同样忽略
    if (hasBlockingView || switching) {
      buddyRef.current?.nudge("angry");
      return;
    }
    const { text: rawText, itemIds, filePaths, fileMentions: orderedFiles } = composer.read();
    // `/steer <内容>` 是 PiDesk 输入栏命令（docs/design/73）：命中时只把正文发给 pi
    const parsed = parseSteerCommand(rawText);
    const text = parsed.text;
    const ordered = itemIds
      .map((id) => chatElements.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const body = text.trim();
    if (
      !body &&
      ordered.length === 0 &&
      filePaths.length === 0 &&
      imageAttachments.length === 0 &&
      fileAttachments.length === 0
    ) {
      if (parsed.steer) showToast(t("session.queue.steerNeedsText"));
      return;
    }
    /**
     * 默认 Enter = 稍后（followUp）；显式 /steer 才插话。空闲时 pi 忽略该字段，
     * 值仍取 followUp：phase 滞后竞态下（本地以为空闲、pi 实际在流式）默认 Enter 不能打断当前轮。
     */
    const intent: QueueIntent = parsed.steer ? "steer" : "followUp";
    // 软门禁：不拦发送；同模型首次附图发送时 toast 一次风险说明
    if (imageAttachments.length > 0) {
      const toastMsg = imageCapabilityToast(imageCapability);
      const toastKey = `${modelLabel ?? ""}|${imageCapability}`;
      if (toastMsg && !visionToastShownFor.current.has(toastKey)) {
        visionToastShownFor.current.add(toastKey);
        showToast(toastMsg);
      }
    }
    if (staleCount > 0 && !staleConfirm) {
      setStaleConfirm(true);
      return;
    }
    // 文件芯片已序列化为 @displayPath，与用户文字穿插；补绝对路径便于 agent 定位
    // 条附件（docs/design/25）只进路径附注，历史侧落为底部 files 芯片
    const finalText = formatFileMentionPrompt(
      text,
      orderedFiles,
      fileAttachments.map((file) => file.path),
    );
    const images = imageAttachments.map(toPiImageContent);
    const contextPayload = {
      ...(ordered.length > 0 ? { items: ordered, consoleErrors: browser.errors } : {}),
      ...(images.length > 0
        ? {
            images,
            displayImages: imageAttachments.map((img) => ({
              src: img.previewUrl,
              mimeType: img.mimeType,
              name: img.name,
            })),
          }
        : {}),
    };
    const clearAfterSend = (): void => {
      composer.clear();
      setStaleConfirm(false);
      hideSuggestNow();
      clearFileMentions();
      clearImageAttachments();
      clearFileAttachments();
      browser.clearChatElements();
      composer.focus();
    };

    // 运行中发送：等 pi 受理（queued/started/handled）后再清空，失败时草稿与附件保留
    if (running) {
      if (queueSendingRef.current) return;
      queueSendingRef.current = true;
      try {
        const accepted = await send(finalText, contextPayload, intent);
        if (accepted === null) return;
      } finally {
        queueSendingRef.current = false;
      }
      clearAfterSend();
      return;
    }

    void send(finalText, contextPayload, intent);
    clearAfterSend();
  };

  const onImages = useCallback(
    async (blobs: Blob[], names?: string[]): Promise<void> => {
      let count = imageAttachments.length;
      for (let i = 0; i < blobs.length; i += 1) {
        const blob = blobs[i];
        if (!blob) continue;
        if (count >= MAX_ATTACH_IMAGES) {
          showToast(t("session.input.maxImages", { count: MAX_ATTACH_IMAGES }));
          return;
        }
        const result = await loadComposerImage(blob, names?.[i]);
        if (!result.ok) {
          showToast(result.message);
          continue;
        }
        if (!addImageAttachment(result.attachment)) {
          showToast(t("session.input.maxImages", { count: MAX_ATTACH_IMAGES }));
          return;
        }
        count += 1;
      }
    },
    [addImageAttachment, imageAttachments.length, showToast, t],
  );

  /** + 菜单 / 拖入统一入口：图片走 docs/21，其余走路径引用（docs/design/25）。 */
  const onAttachFiles = useCallback(
    (files: File[]): void => {
      const images: File[] = [];
      let fileCount = fileAttachments.length;
      for (const file of files) {
        const route = routeAttachFile(file);
        if (route.kind === "reject") {
          showToast(t(route.messageKey));
          continue;
        }
        if (route.kind === "image") {
          images.push(route.file);
          continue;
        }
        if (fileCount >= MAX_ATTACH_FILES) {
          showToast(t("session.input.maxFiles", { count: MAX_ATTACH_FILES }));
          break;
        }
        // 与 @ 芯片 / 已挂附件同路径：一次表达，跳过后加
        if (
          fileMentions.some((mention) => mention.path === route.path) ||
          fileAttachments.some((entry) => entry.path === route.path)
        ) {
          continue;
        }
        const ok = addFileAttachment({
          id: createFileAttachmentId(route.path),
          name: route.name,
          path: route.path,
          displayPath: toDisplayPath(route.path, cwd),
          kind: "file",
        });
        if (!ok) {
          showToast(t("session.input.maxFiles", { count: MAX_ATTACH_FILES }));
          break;
        }
        fileCount += 1;
      }
      if (images.length > 0) {
        void onImages(
          images,
          images.map((file) => file.name),
        );
      }
    },
    [addFileAttachment, cwd, fileAttachments, fileMentions, onImages, showToast, t],
  );

  const removeStale = (): void => {
    for (const item of chatElements) {
      if (item.stale) browser.removeChatElement(item.id);
    }
    setStaleConfirm(false);
  };

  const onPlusAction = (action: "mention" | "slash"): void => {
    const composer = composerRef.current;
    if (!composer) return;
    // 上一次收起可能还在淡出中
    abortSuggestClose();
    if (action === "mention") {
      setInsertTrigger({ kind: "@", seq: Date.now() });
      setSuggestAndReset({ kind: "file", query: "" });
    } else {
      setInsertTrigger({ kind: "/", seq: Date.now() });
      setSuggestAndReset({ kind: "slash", query: "" });
    }
    composer.focus();
  };

  /** 系统选附件（+ 菜单）：File 即 Blob；图片与路径附件分流。 */
  const onAttachImages = useCallback(
    (files: File[]) => {
      onAttachFiles(files);
    },
    [onAttachFiles],
  );

  // 建议列表的高亮由滑动的药丸承担（焦点必须留在输入框，所以不抢焦点）。
  // 指向行 = 键盘光标 suggestIndex，**只有一个写入方**：悬停改了指向就经 onActiveChange
  // 同步回 state，effect 不再反向把药丸拽回上一行——两边各写一次会互相取消补间，
  // 实测过那种写法：悬停末行（offsetTop 582）药丸却卡在 32px 不动，视觉上就是频闪。
  const pillIndex = useRef(-1);
  const suggestPill = useGlidePill(suggestPanelRef, {
    onPick: (index) => {
      const item = suggestItems[index];
      if (item) applySuggestItem(item);
    },
    onActiveChange: (index) => {
      if (index === null || index === pillIndex.current) return;
      pillIndex.current = index;
      setSuggestIndex(index);
    },
  });

  const onEnterIntercept = useCallback((): boolean => {
    if (!suggest || suggestItems.length === 0 || suggestClosing.current) return false;
    const item = suggestItems[suggestIndex];
    if (!item) return false;
    applySuggestItem(item);
    return true;
  }, [suggest, suggestItems, suggestIndex, applySuggestItem]);

  const onSuggestKey = useCallback(
    (key: "ArrowUp" | "ArrowDown" | "Escape"): boolean => {
      if (!suggest || suggestClosing.current) return false;
      // Esc 永远先收面板（哪怕条目还没加载出来）：再按一次才落到外层（队列编辑取消 / 全局停止）
      if (key === "Escape") {
        closeSuggest();
        return true;
      }
      if (suggestItems.length === 0) return false;
      if (key === "ArrowDown") {
        setSuggestIndex((i) => (i + 1) % suggestItems.length);
        return true;
      }
      if (key === "ArrowUp") {
        setSuggestIndex((i) => (i - 1 + suggestItems.length) % suggestItems.length);
        return true;
      }
      return false;
    },
    [suggest, suggestItems.length, closeSuggest],
  );

  // 高亮变化时把选中项滚进面板可视区；只调 panel.scrollTop，
  // 避免 scrollIntoView 牵动外层会话流滚动。
  // biome-ignore lint/correctness/useExhaustiveDependencies: index/列表长度/分组是「DOM 已更新」重跑信号，不在闭包内读取
  useEffect(() => {
    if (!suggest) return;
    const panel = suggestPanelRef.current;
    if (!panel) return;
    const active = panel.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    if (!active) return;
    // 只有键盘/换查询改了光标才挪药丸；悬停改的指向已经由 onActiveChange 同步过了
    if (suggestIndex !== pillIndex.current) {
      pillIndex.current = suggestIndex;
      suggestPill.highlight(suggestIndex, true);
    }
    const panelRect = panel.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < panelRect.top) {
      panel.scrollTop -= panelRect.top - activeRect.top;
    } else if (activeRect.bottom > panelRect.bottom) {
      panel.scrollTop += activeRect.bottom - panelRect.bottom;
    }
  }, [suggest, suggestIndex, suggestItems.length, slashGroups, suggestPill]);

  return (
    <div className={styles.wrap}>
      {suggest && (
        <div
          ref={suggestPanelRef}
          className={styles.suggestPanel}
          role="listbox"
          {...suggestPill.listProps}
        >
          <span ref={suggestPill.pillRef} className={glideStyles.pill} aria-hidden="true" />
          {suggest.kind === "file" && suggestItems.length > 0 && (
            <p className={styles.suggestTitle}>{t("session.input.filesTitle")}</p>
          )}

          {suggest.kind === "slash" && slashLoading && slashCommands.length === 0 && (
            <p className={styles.suggestFooter}>{t("session.input.loadingSlash")}</p>
          )}

          {suggest.kind === "slash" &&
            slashGroups.map((group) => (
              <div key={group.title}>
                <p className={styles.suggestTitle}>{group.title}</p>
                {group.items.map((cmd) => {
                  const index = suggestItems.findIndex((item) => item.id === cmd.name);
                  if (index < 0) return null;
                  const item = suggestItems[index];
                  return (
                    <button
                      key={cmd.name}
                      type="button"
                      role="option"
                      aria-selected={index === suggestIndex}
                      className={styles.suggestRow}
                      data-glide-index={index}
                      onMouseEnter={() => setSuggestIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        if (suggestPill.consumeClick(event.detail)) return;
                        applySuggestItem(item);
                      }}
                    >
                      <span className={styles.suggestName}>{item.label}</span>
                      {item.hint && <span className={styles.suggestPath}>{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))}

          {suggest.kind === "file" &&
            suggestItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === suggestIndex}
                className={styles.suggestRow}
                data-glide-index={index}
                onMouseEnter={() => setSuggestIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  if (suggestPill.consumeClick(event.detail)) return;
                  applySuggestItem(item);
                }}
              >
                {item.kind === "dir" ? (
                  <Folder size={16} weight="regular" className={styles.suggestIcon} />
                ) : (
                  <FileIcon fileName={item.label} className={styles.suggestIcon} />
                )}
                <span className={styles.suggestName}>{item.label}</span>
                {item.hint && <span className={styles.suggestPath}>{item.hint}</span>}
              </button>
            ))}

          {suggestItems.length === 0 && !slashLoading && (
            <p className={styles.suggestFooter}>
              {suggest.kind === "file"
                ? cwd
                  ? t("session.input.fileSearchHint")
                  : t("session.input.selectWorkspaceFirst")
                : slashCommands.length === 0
                  ? t("session.input.noSlashCommands")
                  : t("session.input.searchSlashHint")}
            </p>
          )}
          {suggestItems.length > 0 && (
            <p className={styles.suggestFooter}>
              {suggest.kind === "file"
                ? t("session.input.suggestKeysFile")
                : t("session.input.suggestKeysSlash")}
            </p>
          )}
          {suggest.kind === "slash" && running && !isQueueEdit && (
            <p className={styles.suggestFooter}>{t("session.queue.slashHint")}</p>
          )}
        </div>
      )}

      <div
        className={[styles.inputBox, variant === "session" ? styles.inputSession : ""].join(" ")}
        data-max={thinkingLevel === "max" ? "" : undefined}
      >
        {/* 动物伙伴：骑在输入卡右上沿，纯装饰；姿态只跟随会话状态（设置 → 个性化）。
            队列编辑不渲染：伙伴是会话输入卡的专属装饰。 */}
        {!isQueueEdit && (
          <InputBuddy
            ref={buddyRef}
            kind={inputBuddy}
            sessionId={activeSessionId}
            running={running}
            switching={switching || modeTransitioning}
            alert={staleConfirm || hasBlockingView}
          />
        )}

        {/* 思考等级顶档特效：左下角起辉走 .inputBox[data-max]::before，粒子在这里 */}
        {thinkingLevel === "max" && !isQueueEdit && <ThinkingMaxAura />}

        {variant === "empty" && <TaskInputContextBar />}

        {staleConfirm && (
          <div className={styles.staleConfirm}>
            <span>{t("session.input.staleConfirm", { count: staleCount })}</span>
            <div className={styles.staleActions}>
              <Button onClick={() => void doSend()}>{t("session.input.staleConfirm.send")}</Button>
              <Button onClick={removeStale}>{t("session.input.staleConfirm.remove")}</Button>
              <Button onClick={() => setStaleConfirm(false)}>{t("common.cancel")}</Button>
            </div>
          </div>
        )}

        <div className={styles.surface}>
          <ImageAttachStrip
            images={imageAttachments}
            onRemove={removeImageAttachment}
            onReorder={reorderImageAttachments}
            hint={imageHint}
          />
          <FileAttachStrip
            files={fileAttachments}
            onRemove={removeFileAttachment}
            onReorder={reorderFileAttachments}
          />
          <Composer
            elements={chatElements}
            onRemoveElement={browser.removeChatElement}
            fileMentions={fileMentions}
            onRemoveFileMention={removeFileMention}
            onSend={() => void doSend()}
            onImages={
              isQueueEdit
                ? () => showToast(t("session.queue.editNoAttach"))
                : (blobs, names) => void onImages(blobs, names)
            }
            onFiles={isQueueEdit ? () => showToast(t("session.queue.editNoAttach")) : onAttachFiles}
            onContentChange={setHasContent}
            onTextChange={onComposerTextChange}
            insertTrigger={insertTrigger}
            onEnterIntercept={onEnterIntercept}
            onSuggestKey={onSuggestKey}
            onEscape={isQueueEdit ? onQueueEditCancel : undefined}
            placeholder={placeholder}
            // 编辑锁定与发送解锁分离（docs/design/12 P1-1）：running 期间可编辑草稿，
            // 发送由 canSend / doSend 拦截，只有阻断浮层与会话切换锁编辑
            disabled={hasBlockingView || switching}
            focusSeq={focusSeq}
            onReady={onComposerReady}
          />
          <TaskInputToolbar
            running={running}
            canSend={canSend}
            onPlusAction={onPlusAction}
            onAttachImages={onAttachImages}
            onSend={() => void doSend()}
            onQueueSend={() => void doSend()}
            onStop={stop}
            onCancel={isQueueEdit ? onQueueEditCancel : undefined}
            sendRunning={isQueueEdit ? false : undefined}
            attachEnabled={!isQueueEdit}
          />
        </div>
        {/* 运行态边框流光：只挂在会话态输入卡上，running 时点亮；
            纯装饰层，不参与布局，也不拦截输入/点击。 */}
        {variant === "session" && !isQueueEdit && (
          <div
            className={styles.runBorder}
            data-active={running ? "true" : "false"}
            aria-hidden="true"
          >
            <span className={styles.runBorderGlow} />
            <span className={styles.runBorderBeam} />
          </div>
        )}
      </div>
    </div>
  );
}
