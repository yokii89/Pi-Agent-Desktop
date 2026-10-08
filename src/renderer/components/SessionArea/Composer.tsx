import { Folder, PuzzlePiece } from "@phosphor-icons/react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { t as translate } from "../../../shared/i18n";
import { getFileIconUrl } from "../../fileIcons";
import { useT } from "../../hooks/useT";
import type { BrowserContextItem } from "../../services/browserService";
import type { FileMention } from "../../stores/composerStore";
import { useUiStore } from "../../stores/uiStore";
import { loadGsap, prefersReducedMotion } from "../../utils/animation";
import { replaceCaretToken, textBeforeCaret } from "../../utils/composerCaret";
import {
  EL_ID_ATTR,
  FILE_ID_ATTR,
  hasVisibleContent,
  insertNodeAtCaret,
  readComposerDom,
  SLASH_CMD_ATTR,
} from "../../utils/composerDom";
import type { PositionedFileMention } from "../../utils/fileMentionFormat";
import { NAV_MOTION } from "../../utils/motionTokens";
import { formatQuoteBlock } from "../../utils/quoteFormat";
import styles from "./Composer.module.css";
import { createFileChip } from "./composerFileChip";
import {
  createSkillIconShell,
  createSlashChip,
  isSkillCommand,
  pickSvgIconNode,
} from "./composerSlashChip";
import elChip from "./ElementChip.module.css";
import { ElementDetailPopover } from "./ElementDetailPopover";
import {
  EMPTY_CLASS_PLACEHOLDER,
  elementBadgeText,
  elementChipTitle,
  elementClassText,
  elementTone,
} from "./elementChipMeta";

/**
 * 内联元素编辑器：contenteditable + 原子芯片。
 * 芯片嵌在用户文本中间（「这个svg [svg]；这是我提供的 [a.ts]」），
 * 发送时按出现顺序抽出元素/文件，文本连续拼进用户说明。
 */
export interface ComposerHandle {
  /** 读出连续文本 + 按出现顺序排列的元素 id 与文件路径。 */
  read: () => {
    text: string;
    itemIds: string[];
    filePaths: string[];
    fileMentions: PositionedFileMention[];
  };
  /** 清空编辑器。 */
  clear: () => void;
  focus: () => void;
  /** 原子替换光标前的 @token；同一路径只保留一枚芯片。 */
  insertFileMention: (item: FileMention) => boolean;
  /** 原子替换光标前的 /token 为斜杠命令芯片（视觉与 @ 引用一致；技能带 PuzzlePiece 且不截断）。 */
  insertSlashCommand: (name: string) => boolean;
  /** 把会话流选中文本作为引用块追加到草稿末尾（docs/design/12）：聚焦并把光标移到末尾。 */
  appendQuote: (text: string) => void;
}

interface ComposerProps {
  /** 与 store 对齐的元素列表；新增会插入光标处，移除会删掉对应芯片。 */
  elements: BrowserContextItem[];
  onRemoveElement: (id: string) => void;
  /** @ 引用的文件/文件夹；与文字穿插的内联芯片。 */
  fileMentions?: FileMention[];
  onRemoveFileMention?: (path: string) => void;
  onSend: () => void;
  /** 粘贴/拖入的图片 Blob（docs/design/21）；由上层规范化后入附件条。 */
  onImages?: (files: Blob[], names?: string[]) => void;
  /** 拖入的任意文件（docs/design/25）；上层按图片/路径附件分流。 */
  onFiles?: (files: File[]) => void;
  /** 内容（文本或芯片）变化时回调，驱动发送键可用性。 */
  onContentChange?: (hasContent: boolean) => void;
  /** 纯文本变化（含触发 @ / 建议）；contenteditable 的 input 文本。 */
  onTextChange?: (text: string) => void;
  /** 外部要求在光标处插入触发字符（+ 菜单）；seq 变化触发一次。 */
  insertTrigger?: { kind: "@" | "/"; seq: number } | null;
  /** 建议列表打开时拦截 Enter（选中建议而非发送）；返回 true 表示已处理。 */
  onEnterIntercept?: () => boolean;
  /** 建议列表方向键 / Esc；返回 true 表示已处理（应 preventDefault）。 */
  onSuggestKey?: (key: "ArrowUp" | "ArrowDown" | "Escape") => boolean;
  placeholder?: string;
  disabled?: boolean;
  /** 外部（浏览器拾取 Enter）要求聚焦时递增；0 表示尚未发生。 */
  focusSeq?: number;
  onReady?: (handle: ComposerHandle) => void;
}

function createChipElement(item: BrowserContextItem): HTMLElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.setAttribute(EL_ID_ATTR, item.id);
  chip.className = [elChip.chip, item.stale ? elChip.chipStale : ""].join(" ");
  chip.dataset.tone = elementTone(item);
  const classText = elementClassText(item, translate("session.chip.screenshot"));
  const badgeText = elementBadgeText(item);
  chip.dataset.label = classText ? `${badgeText}${classText}` : badgeText;
  chip.title = elementChipTitle(item);
  return chip;
}

/** 引用块落点高亮（docs/design/12 P1-2）：accent-soft 背景闪现后淡出，结束清内联样式；
 *  reduced-motion 直接不加高亮（终态即无高亮，无残留）。 */
function flashQuoteBlock(span: HTMLSpanElement): void {
  if (prefersReducedMotion()) return;
  void loadGsap().then((gsap) => {
    const soft = getComputedStyle(span).getPropertyValue("--color-accent-soft").trim();
    if (!soft) return;
    gsap.fromTo(
      span,
      { backgroundColor: soft },
      {
        backgroundColor: "rgba(0,0,0,0)",
        duration: NAV_MOTION.quoteFlash,
        ease: NAV_MOTION.easeOut,
        clearProps: "backgroundColor",
      },
    );
  });
}

export function Composer({
  elements,
  onRemoveElement,
  fileMentions,
  onRemoveFileMention,
  onSend,
  onImages,
  onFiles,
  onContentChange,
  onTextChange,
  insertTrigger,
  onEnterIntercept,
  onSuggestKey,
  placeholder = "",
  disabled = false,
  focusSeq = 0,
  onReady,
}: ComposerProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const folderIconRef = useRef<HTMLSpanElement>(null);
  const skillIconRef = useRef<HTMLSpanElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const { theme } = useUiStore();
  const [detail, setDetail] = useState<{ item: BrowserContextItem; anchor: HTMLElement } | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);

  const reportContent = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const empty = !hasVisibleContent(root);
    setIsEmpty(empty);
    onContentChange?.(!empty);
    onTextChange?.(textBeforeCaret(root)?.text ?? "");
  }, [onContentChange, onTextChange]);

  const paintChip = useCallback(
    (item: BrowserContextItem): HTMLElement => {
      const chip = createChipElement(item);

      chip.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDetail({ item, anchor: chip });
      });
      chip.addEventListener("mousedown", (event) => {
        if ((event.target as HTMLElement).closest("[data-chip-remove]")) event.preventDefault();
      });

      const classText = elementClassText(item, t("session.chip.screenshot"));
      const badgeText = elementBadgeText(item);
      const emptyCls = !classText;

      const badge = document.createElement("span");
      badge.className = elChip.badge;
      badge.setAttribute("data-el-role", "badge");
      badge.textContent = badgeText;

      const label = document.createElement("span");
      label.className = emptyCls ? `${elChip.cls} ${elChip.clsEmpty}` : elChip.cls;
      label.setAttribute("data-el-role", "cls");
      if (emptyCls) label.setAttribute("data-el-empty", "1");
      label.textContent = emptyCls ? EMPTY_CLASS_PLACEHOLDER : classText;

      chip.appendChild(badge);
      chip.appendChild(label);
      if (item.stale) {
        const stale = document.createElement("span");
        stale.className = elChip.staleTag;
        stale.setAttribute("data-el-role", "stale");
        stale.textContent = t("session.chip.stale");
        chip.appendChild(stale);
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = elChip.remove;
      remove.setAttribute("data-chip-remove", "1");
      remove.title = t("session.chip.remove");
      remove.setAttribute(
        "aria-label",
        t("session.chip.removeItem", {
          name: emptyCls ? badgeText : `${badgeText}${classText}`,
        }),
      );
      remove.textContent = "×";
      remove.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDetail(null);
        onRemoveElement(item.id);
      });
      chip.appendChild(remove);
      return chip;
    },
    [onRemoveElement, t],
  );

  /** 文件/文件夹引用芯片：@ 选中后嵌在文字中间，图标与候选栏一致。 */
  const paintFileChip = useCallback(
    (item: FileMention): HTMLElement =>
      createFileChip(item, theme, pickSvgIconNode(folderIconRef.current)),
    [theme],
  );

  /**
   * CSS Modules 类名带哈希，改样式后哈希会变；contenteditable 里已有芯片
   * 不会被 sync 重建（只按 data-* 判断存活），旧类名对应不到新 CSS，芯片会「裸奔」。
   * 同步时统一回写当前 styles 上的类名。
   */
  const refreshChipClassNames = useCallback((root: HTMLElement) => {
    for (const node of root.querySelectorAll<HTMLElement>(`[${FILE_ID_ATTR}]`)) {
      node.className = styles.fileChip;
      const [icon, label] = node.children;
      if (icon instanceof HTMLElement) icon.className = styles.fileIcon;
      if (label instanceof HTMLElement) label.className = styles.label;
    }
    for (const node of root.querySelectorAll<HTMLElement>(`[${SLASH_CMD_ATTR}]`)) {
      const isSkill = isSkillCommand(node.getAttribute(SLASH_CMD_ATTR) ?? "");
      node.className = isSkill ? `${styles.slashChip} ${styles.slashChipSkill}` : styles.slashChip;
      // HMR / 旧芯片可能缺图标壳：统一补齐，避免只有文案没有 PuzzlePiece
      if (isSkill && !node.querySelector("[data-skill-icon]")) {
        node.insertBefore(
          createSkillIconShell(pickSvgIconNode(skillIconRef.current)),
          node.firstChild,
        );
      }
      for (const child of node.children) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.getAttribute("aria-hidden") === "true") child.className = styles.fileIcon;
        else child.className = isSkill ? styles.labelFull : styles.label;
      }
    }
    for (const node of root.querySelectorAll<HTMLElement>(`[${EL_ID_ATTR}]`)) {
      const staleTag = Array.from(node.children).find(
        (child) => child instanceof HTMLElement && child.getAttribute("data-el-role") === "stale",
      );
      node.className = staleTag ? `${elChip.chip} ${elChip.chipStale}` : elChip.chip;
      for (const child of node.children) {
        if (!(child instanceof HTMLElement)) continue;
        const role = child.getAttribute("data-el-role");
        if (child.getAttribute("data-chip-remove")) child.className = elChip.remove;
        else if (role === "stale") child.className = elChip.staleTag;
        else if (role === "badge") child.className = elChip.badge;
        else if (role === "cls") {
          child.className = child.getAttribute("data-el-empty")
            ? `${elChip.cls} ${elChip.clsEmpty}`
            : elChip.cls;
        }
      }
    }
  }, []);

  /** store → DOM：新元素插到光标，已移除的芯片从 DOM 摘掉。 */
  const syncElements = useCallback(
    (items: BrowserContextItem[]) => {
      const root = rootRef.current;
      if (!root) return;
      const current = new Map<string, HTMLElement>();
      for (const node of root.querySelectorAll(`[${EL_ID_ATTR}]`)) {
        const el = node as HTMLElement;
        const id = el.getAttribute(EL_ID_ATTR);
        if (id) current.set(id, el);
      }

      for (const item of items) {
        if (current.has(item.id)) continue;
        insertNodeAtCaret(root, paintChip(item));
      }

      const alive = new Set(items.map((item) => item.id));
      for (const [id, el] of current) {
        if (!alive.has(id)) el.remove();
      }
      refreshChipClassNames(root);
      reportContent();
    },
    [paintChip, refreshChipClassNames, reportContent],
  );

  useEffect(() => {
    syncElements(elements);
  }, [elements, syncElements]);

  /** store → DOM：@ 文件芯片与文字穿插。 */
  const syncFileMentions = useCallback(
    (items: FileMention[]) => {
      const root = rootRef.current;
      if (!root) return;
      const current = new Map<string, HTMLElement>();
      for (const node of root.querySelectorAll(`[${FILE_ID_ATTR}]`)) {
        const el = node as HTMLElement;
        const id = el.getAttribute(FILE_ID_ATTR);
        if (id) current.set(id, el);
      }
      for (const item of items) {
        if (current.has(item.path)) continue;
        insertNodeAtCaret(root, paintFileChip(item));
      }
      const alive = new Set(items.map((item) => item.path));
      for (const [id, el] of current) {
        if (!alive.has(id)) el.remove();
      }
      refreshChipClassNames(root);
      reportContent();
    },
    [paintFileChip, refreshChipClassNames, reportContent],
  );

  useEffect(() => {
    if (!fileMentions) return;
    syncFileMentions(fileMentions);
  }, [fileMentions, syncFileMentions]);

  // 挂载时回写一次类名：从旧内容哈希类名迁到稳定类名后，已有芯片需要对齐
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    refreshChipClassNames(root);
  }, [refreshChipClassNames]);

  // 主题切换时刷新已插入芯片上的文件图标
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    refreshChipClassNames(root);
    for (const node of root.querySelectorAll("img[data-file-name]")) {
      const img = node as HTMLImageElement;
      const name = img.getAttribute("data-file-name");
      if (name) img.src = getFileIconUrl(name, theme);
    }
  }, [theme, refreshChipClassNames]);

  // 拾取 Enter（焦点可能在页面）后把焦点拉回编辑器，方便继续写句子
  useEffect(() => {
    if (focusSeq === 0) return;
    rootRef.current?.focus();
    const root = rootRef.current;
    if (!root) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [focusSeq]);

  useEffect(() => {
    if (!onReady) return;
    onReady({
      read: () => {
        const root = rootRef.current;
        if (!root) return { text: "", itemIds: [], filePaths: [], fileMentions: [] };
        return readComposerDom(root);
      },
      clear: () => {
        const root = rootRef.current;
        if (!root) return;
        root.replaceChildren();
        setIsEmpty(true);
        onContentChange?.(false);
        onTextChange?.("");
      },
      focus: () => rootRef.current?.focus(),
      insertFileMention: (item) => {
        const root = rootRef.current;
        if (!root) return false;
        const existing = Array.from(root.querySelectorAll<HTMLElement>(`[${FILE_ID_ATTR}]`)).find(
          (chip) => chip.getAttribute(FILE_ID_ATTR) === item.path,
        );
        const chip = paintFileChip(item);
        if (!replaceCaretToken(root, /^@[^\s@]*$/, chip)) return false;
        existing?.remove();
        const spacer = document.createTextNode(" ");
        chip.after(spacer);
        const range = document.createRange();
        range.setStart(spacer, 1);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        reportContent();
        return true;
      },
      insertSlashCommand: (name) => {
        const root = rootRef.current;
        if (!root) return false;
        const chip = createSlashChip(name, pickSvgIconNode(skillIconRef.current));
        if (!replaceCaretToken(root, /^\/\S*$/, chip)) return false;
        const spacer = document.createTextNode(" ");
        chip.after(spacer);
        const range = document.createRange();
        range.setStart(spacer, 1);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        reportContent();
        return true;
      },
      appendQuote: (quoteText) => {
        const root = rootRef.current;
        if (!root) return;
        const { text: draft } = readComposerDom(root);
        const block = formatQuoteBlock(draft, quoteText);
        if (!block) return;
        // 逻辑 \n 逐个拆成 BR + 文本节点：contenteditable 文本节点里的 \n 不渲染，
        // BR 恰与 readComposerDom 的读出约定对应；span 包住本次引用块供落点高亮
        const flash = document.createElement("span");
        block.split("\n").forEach((part, index) => {
          if (index > 0) flash.appendChild(document.createElement("br"));
          if (part) flash.appendChild(document.createTextNode(part));
        });
        root.appendChild(flash);
        flashQuoteBlock(flash);
        setIsEmpty(false);
        onContentChange?.(true);
        onTextChange?.(root.textContent ?? "");
        // 引用落点即反馈：聚焦输入栏，光标移到末尾承接追问
        root.focus();
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      },
    });
  }, [onReady, onContentChange, onTextChange, paintFileChip, reportContent]);

  // + 菜单插入 @ / / 触发符（仅 seq 变化时插入一次）
  const lastTriggerSeqRef = useRef(0);
  useEffect(() => {
    if (!insertTrigger || insertTrigger.seq === 0) return;
    if (insertTrigger.seq === lastTriggerSeqRef.current) return;
    lastTriggerSeqRef.current = insertTrigger.seq;
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    document.execCommand("insertText", false, insertTrigger.kind);
    reportContent();
  }, [insertTrigger, reportContent]);

  useEffect(() => {
    if (detail && !detail.anchor.isConnected) setDetail(null);
  }, [detail]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (onEnterIntercept?.()) return;
      if (!disabled) onSend();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Escape") {
      if (onSuggestKey?.(event.key)) {
        event.preventDefault();
        // 建议面板消费了 Esc：阻断冒泡，避免同时触发全局「Esc 停止」
        // （焦点分层，docs/design/13 P1-7：先收面板，再次 Esc 才停止）
        if (event.key === "Escape") event.stopPropagation();
      }
      return;
    }
    if (event.key !== "Backspace") return;
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const takeChipId = (el: HTMLElement): "el" | "file" | "slash" | null => {
      if (el.hasAttribute(EL_ID_ATTR)) return "el";
      if (el.hasAttribute(FILE_ID_ATTR)) return "file";
      if (el.hasAttribute(SLASH_CMD_ATTR)) return "slash";
      return null;
    };
    /** 斜杠命令芯片不在 store：退格直接摘 DOM。 */
    const removeSlashChip = (el: HTMLElement): void => {
      event.preventDefault();
      const spacer = el.nextSibling;
      el.remove();
      if (spacer?.textContent === " ") spacer.remove();
      reportContent();
    };
    if (range.startContainer === root && range.startOffset > 0) {
      const prev = root.childNodes[range.startOffset - 1];
      if (prev instanceof HTMLElement) {
        const kind = takeChipId(prev);
        if (kind === "el") {
          event.preventDefault();
          const id = prev.getAttribute(EL_ID_ATTR);
          if (id) onRemoveElement(id);
          return;
        }
        if (kind === "file") {
          event.preventDefault();
          const id = prev.getAttribute(FILE_ID_ATTR);
          if (id) onRemoveFileMention?.(id);
          return;
        }
        if (kind === "slash") {
          removeSlashChip(prev);
          return;
        }
      }
    }
    if (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startOffset === 0 &&
      range.startContainer.previousSibling instanceof HTMLElement
    ) {
      const prev = range.startContainer.previousSibling;
      const kind = takeChipId(prev);
      if (kind === "el") {
        event.preventDefault();
        const id = prev.getAttribute(EL_ID_ATTR);
        if (id) onRemoveElement(id);
      } else if (kind === "file") {
        event.preventDefault();
        const id = prev.getAttribute(FILE_ID_ATTR);
        if (id) onRemoveFileMention?.(id);
      } else if (kind === "slash") {
        removeSlashChip(prev);
      }
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>): void => {
    // 图片附件优先：截图粘贴不应被 text/plain 抢走（docs/design/21）
    const imageFiles: File[] = [];
    for (const item of Array.from(event.clipboardData.items ?? [])) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file?.type.startsWith("image/")) imageFiles.push(file);
    }
    if (imageFiles.length > 0 && onImages) {
      event.preventDefault();
      onImages(
        imageFiles,
        imageFiles.map((f) => f.name || t("session.image.clipboard")),
      );
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    document.execCommand("insertText", false, text);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    // 通用附件入口（docs/design/25）：上层统一按图片 / 路径附件分流
    if (onFiles) {
      event.preventDefault();
      onFiles(files);
      return;
    }
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length > 0 && onImages) {
      event.preventDefault();
      onImages(
        imageFiles,
        imageFiles.map((f) => f.name),
      );
    }
    // 无处理器时的非图片拖放不拦截默认行为（避免误伤文本拖入）
  };

  return (
    <div className={styles.composerWrap}>
      {/* 命令式芯片克隆库组件的图标节点，避免手写 SVG 或为每枚芯片创建 React root。 */}
      <span hidden aria-hidden="true" ref={folderIconRef}>
        <Folder size={16} weight="regular" />
      </span>
      <span hidden aria-hidden="true" ref={skillIconRef}>
        <PuzzlePiece size={16} weight="regular" />
      </span>
      {/* contenteditable 必须用 div 才能嵌原子芯片，不能换成 textarea */}
      {/* biome-ignore lint/a11y/useSemanticElements: 内联芯片需要 contenteditable，textarea 做不到 */}
      <div
        ref={rootRef}
        className={[
          styles.composer,
          isEmpty ? styles.composerEmpty : "",
          dragOver ? styles.composerDragOver : "",
        ].join(" ")}
        contentEditable={!disabled}
        tabIndex={0}
        role="textbox"
        aria-label={t("session.input.aria")}
        aria-multiline="true"
        data-placeholder={placeholder || t("session.input.placeholder.composer")}
        suppressContentEditableWarning
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(event) => {
          if (event.dataTransfer?.types?.includes("Files")) {
            event.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragOver(false);
          }
        }}
        onInput={() => {
          const root = rootRef.current;
          if (root) {
            const { filePaths, itemIds } = readComposerDom(root);
            const remaining = new Set(filePaths);
            for (const item of fileMentions ?? []) {
              if (!remaining.has(item.path)) onRemoveFileMention?.(item.path);
            }
            const elementsRemaining = new Set(itemIds);
            for (const item of elements) {
              if (!elementsRemaining.has(item.id)) onRemoveElement(item.id);
            }
          }
          reportContent();
        }}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) reportContent();
        }}
        onMouseUp={reportContent}
      />
      {detail && (
        <ElementDetailPopover
          item={detail.item}
          anchor={detail.anchor}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
