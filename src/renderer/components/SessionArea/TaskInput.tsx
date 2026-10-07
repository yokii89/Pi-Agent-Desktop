import { Folder } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FsSearchHit, PiSlashCommand } from "../../../shared/ipc";
import { FileIcon } from "../../fileIcons/FileIcon";
import { useT } from "../../hooks/useT";
import { fsService } from "../../services/fsService";
import { useBrowserStore } from "../../stores/browserStore";
import { useComposerStore } from "../../stores/composerStore";
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
import { Button } from "../ui/Button";
import { Composer, type ComposerHandle } from "./Composer";
import { FileAttachStrip } from "./FileAttachStrip";
import { ImageAttachStrip } from "./ImageAttachStrip";
import styles from "./TaskInput.module.css";
import { TaskInputContextBar } from "./TaskInputContextBar";
import { TaskInputToolbar } from "./TaskInputToolbar";

type SuggestKind = "file" | "slash" | null;

/**
 * 任务输入栏：empty 显示工作区/Git 顶栏；running/idle 为底部停靠精简版。
 * 元素芯片内联嵌在文本中间；@ 文件与 / 命令走上方建议列表。
 */
export function TaskInput({ variant }: { variant: "empty" | "session" }) {
  const t = useT();
  const { phase, send, stop, getSlashCommands, switchingTo, modelInput, modelLabel } =
    useSessionMeta();
  const { showToast } = useUiStore();
  const browser = useBrowserStore();
  const { currentProject } = useProjectStore();
  const {
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
  const setSuggestAndReset = useCallback(
    (next: { kind: Exclude<SuggestKind, null>; query: string } | null) => {
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
  const canSend =
    (hasContent ||
      fileMentions.length > 0 ||
      imageAttachments.length > 0 ||
      fileAttachments.length > 0) &&
    !running &&
    !hasBlockingView &&
    !switching &&
    !modeTransitioning;
  const cwd = currentProject?.dir ?? null;

  const placeholder = switching
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

  /** 按 pi source 分组：命令（extension/prompt）与技能（skill）。 */
  const slashGroups = useMemo(() => {
    if (suggest?.kind !== "slash") return [];
    const commands = slashFiltered.filter((c) => c.source !== "skill");
    const skills = slashFiltered.filter((c) => c.source === "skill");
    const groups: Array<{ title: string; items: PiSlashCommand[] }> = [];
    if (commands.length > 0)
      groups.push({ title: t("session.input.group.commands"), items: commands });
    if (skills.length > 0) groups.push({ title: t("session.input.group.skills"), items: skills });
    return groups;
  }, [suggest, slashFiltered, t]);

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
    // 与 slashGroups 展示顺序一致（命令在前、技能在后），保证 ↑↓ 与视觉行序一一对应
    return slashGroups
      .flatMap((g) => g.items)
      .map((c) => ({
        id: c.name,
        label: `/${c.name.replace(/^skill:/, "skill:")}`,
        hint: c.description || (c.source === "skill" ? t("session.input.group.skills") : ""),
        kind: undefined,
      }));
  }, [suggest, fileHits, slashGroups, t]);

  const onComposerReady = useCallback((handle: ComposerHandle) => {
    composerRef.current = handle;
  }, []);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  // 会话流「添加到对话栏」（docs/design/12）：消费待引用文本追加进编辑器，seq 由 store 保证单次
  useEffect(() => {
    if (!pendingQuote) return;
    composerRef.current?.appendQuote(pendingQuote.text);
    consumePendingQuote();
  }, [pendingQuote, consumePendingQuote]);

  const closeSuggest = useCallback(() => setSuggestAndReset(null), [setSuggestAndReset]);

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
        setSuggestAndReset({ kind: "file", query: fileMatch[2] ?? "" });
        return;
      }
      if (slashMatch) {
        setSuggestAndReset({ kind: "slash", query: slashMatch[2] ?? "" });
        return;
      }
      setSuggestAndReset(null);
    },
    [setSuggestAndReset],
  );

  const doSend = async (): Promise<void> => {
    const composer = composerRef.current;
    if (!composer) return;
    // modal 打开时忽略发送（abort 仍可用，走 toolbar stop）；切换中同样忽略
    if (hasBlockingView || switching) return;
    // running 可编辑草稿但禁止发送（docs/design/12 P1-1）：Enter 误触时说明原因
    if (running) {
      showToast(t("session.input.sendAfterReply"));
      return;
    }
    const { text, itemIds, filePaths, fileMentions: orderedFiles } = composer.read();
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
    )
      return;
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
    send(finalText, {
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
    });
    composer.clear();
    setStaleConfirm(false);
    setSuggestAndReset(null);
    clearFileMentions();
    clearImageAttachments();
    clearFileAttachments();
    browser.clearChatElements();
    composer.focus();
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

  const onEnterIntercept = useCallback((): boolean => {
    if (!suggest || suggestItems.length === 0) return false;
    const item = suggestItems[suggestIndex];
    if (!item) return false;
    applySuggestItem(item);
    return true;
  }, [suggest, suggestItems, suggestIndex, applySuggestItem]);

  const onSuggestKey = useCallback(
    (key: "ArrowUp" | "ArrowDown" | "Escape"): boolean => {
      if (!suggest || suggestItems.length === 0) return false;
      if (key === "ArrowDown") {
        setSuggestIndex((i) => (i + 1) % suggestItems.length);
        return true;
      }
      if (key === "ArrowUp") {
        setSuggestIndex((i) => (i - 1 + suggestItems.length) % suggestItems.length);
        return true;
      }
      closeSuggest();
      return true;
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
    const panelRect = panel.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < panelRect.top) {
      panel.scrollTop -= panelRect.top - activeRect.top;
    } else if (activeRect.bottom > panelRect.bottom) {
      panel.scrollTop += activeRect.bottom - panelRect.bottom;
    }
  }, [suggest, suggestIndex, suggestItems.length, slashGroups]);

  return (
    <div className={styles.wrap}>
      {suggest && (
        <div ref={suggestPanelRef} className={styles.suggestPanel} role="listbox">
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
                      className={[
                        styles.suggestRow,
                        index === suggestIndex ? styles.suggestActive : "",
                      ].join(" ")}
                      onMouseEnter={() => setSuggestIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySuggestItem(item)}
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
                className={[
                  styles.suggestRow,
                  index === suggestIndex ? styles.suggestActive : "",
                ].join(" ")}
                onMouseEnter={() => setSuggestIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestItem(item)}
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
        </div>
      )}

      <div
        className={[styles.inputBox, variant === "session" ? styles.inputSession : ""].join(" ")}
      >
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
            onImages={(blobs, names) => void onImages(blobs, names)}
            onFiles={onAttachFiles}
            onContentChange={setHasContent}
            onTextChange={onComposerTextChange}
            insertTrigger={insertTrigger}
            onEnterIntercept={onEnterIntercept}
            onSuggestKey={onSuggestKey}
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
            onStop={stop}
          />
        </div>
      </div>
    </div>
  );
}
