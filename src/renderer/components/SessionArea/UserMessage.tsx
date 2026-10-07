import { ArrowClockwise, Copy } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { TranslateFn } from "../../../shared/i18n";
import { useT } from "../../hooks/useT";
import type { BrowserContextItem } from "../../services/browserService";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import type { UserMessageImage } from "../../utils/imageAttach";
import {
  parseUserMessageSegments,
  readableUserMessageWithImages,
  type UserMessagePart,
} from "../../utils/userMessageSegments";
import { ContextChip } from "./ContextChip";
import { FileMentionChip } from "./FileMentionChip";
import { MessageActionBar } from "./MessageActionBar";
import { PiColdStartBar } from "./PiColdStartBar";
import { SlashCommandChip } from "./SlashCommandChip";
import { UserImageStrip } from "./UserImageStrip";
import styles from "./UserMessage.module.css";

/** 独立 token 形态的 / 命令（不含路径），避免把 /usr/bin 之类误标成命令。 */
const SLASH_TOKEN_RE = /(^|[\s(（「『【])(\/[A-Za-z][\w-]*(?::[A-Za-z][\w-]*)?)(?![\w/-])/g;

/** 把正文中的 / 命令拆成芯片节点，其余保持纯文本。 */
function renderSlashTokens(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(SLASH_TOKEN_RE)) {
    const lead = match[1];
    const token = match[2];
    const start = match.index + lead.length;
    if (start > last) nodes.push(text.slice(last, start));
    nodes.push(<SlashCommandChip key={start} name={token.slice(1)} />);
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface UserMessageProps {
  text: string;
  items?: BrowserContextItem[];
  /** 用户附件图片（docs/design/21）；展示在正文上方。 */
  images?: UserMessageImage[];
  /** 是否为最后一条用户消息：开放「重新发送」（与 run 头重试同源，docs/design/13 P1-6）。 */
  canResend?: boolean;
  /**
   * 冷启动进行中：active 桶 startPending 且本气泡是最后一条用户消息
   * （docs/会话进程懒加载方案 Phase 2）。状态在桶上不在组件上，
   * 切走 active 条随渲染消失，切回仍在启动则重新出现。
   */
  coldStart?: boolean;
}

/**
 * 用户消息气泡。发送侧组装的引用块 / 计划模式前缀 / 路径附注在此还原为
 * 结构化段落（docs/design/13 P2-1）；元素芯片内联嵌在用户自己的文字里。
 */
export function UserMessage({
  text,
  items,
  images,
  canResend = false,
  coldStart = false,
}: UserMessageProps) {
  const t = useT();
  const { showToast } = useUiStore();
  const { phase, processAlive, retryLastUserMessage } = useSessionMeta();
  const segments = useMemo(() => parseUserMessageSegments(text), [text]);

  // 进度条要在启动完成后补一段「100% + 淡出」再卸载，父级需短暂保活：
  // coldStart 置 true 时挂载；onFinished（收尾播完）才卸载。
  // 启动失败不走收尾——processAlive=false 直接停渲染，立即消失。
  const [barMounted, setBarMounted] = useState(false);
  useEffect(() => {
    if (coldStart) setBarMounted(true);
  }, [coldStart]);
  const handleBarFinished = useCallback(() => setBarMounted(false), []);

  const actions = useMemo(
    () => [
      {
        key: "copy",
        label: t("session.copyMessage"),
        title: t("session.copyMessage.title"),
        icon: Copy,
        onClick: () => {
          void navigator.clipboard
            .writeText(readableUserMessageWithImages(segments, images?.length ?? 0))
            .then(() => showToast(t("common.copied")))
            .catch(() => showToast(t("session.copyFailed")));
        },
      },
      ...(canResend && phase !== "running"
        ? [
            {
              key: "resend",
              label: t("session.resend"),
              title: t("session.resend.title"),
              icon: ArrowClockwise,
              onClick: () => void retryLastUserMessage(),
            },
          ]
        : []),
    ],
    [segments, images, showToast, canResend, phase, retryLastUserMessage, t],
  );

  return (
    <div className={styles.row}>
      <div className={styles.bubble}>
        {images && images.length > 0 ? <UserImageStrip images={images} /> : null}
        {renderSegments(segments, items, t)}
        {(coldStart || (barMounted && processAlive)) && (
          <PiColdStartBar active={coldStart} onFinished={handleBarFinished} />
        )}
      </div>
      <MessageActionBar items={actions} className={styles.actions} />
    </div>
  );
}

function renderSegments(
  segments: ReturnType<typeof parseUserMessageSegments>,
  items?: BrowserContextItem[],
  t: TranslateFn = (key) => key,
): ReactNode {
  // key 用 kind + 同类序号：段列表随消息固定，避免数组索引键
  const counters = new Map<string, number>();
  let itemCursor = 0;
  const renderText = (text: string): ReactNode =>
    text.split(/(⟨[^⟩]*⟩)/g).map((part, index) => {
      if (part.startsWith("⟨") && part.endsWith("⟩")) {
        const item = items?.[itemCursor++];
        if (item) return <ContextChip key={item.id} item={item} />;
      }
      // biome-ignore lint/suspicious/noArrayIndexKey: immutable message fragments
      return <span key={index}>{renderSlashTokens(part)}</span>;
    });
  const renderParts = (
    parts: UserMessagePart[] | undefined,
    content: string,
    contextChips = true,
  ): ReactNode => {
    if (!parts) return contextChips ? renderText(content) : renderSlashTokens(content);
    return parts.map((part, index) =>
      part.kind === "file" ? (
        <FileMentionChip key={part.mention.path} {...part.mention} />
      ) : (
        // biome-ignore lint/suspicious/noArrayIndexKey: immutable message fragments
        <span key={index}>
          {contextChips ? renderText(part.text) : renderSlashTokens(part.text)}
        </span>
      ),
    );
  };
  return segments.map((segment) => {
    const occurrence = counters.get(segment.kind) ?? 0;
    counters.set(segment.kind, occurrence + 1);
    const key = `${segment.kind}-${occurrence}`;
    switch (segment.kind) {
      case "plan":
        return (
          <span key={key} className={styles.planRow}>
            <span className={styles.planTag}>{t("session.planMode")}</span>
            <span className={styles.planNote}>{segment.content}</span>
          </span>
        );
      case "quote":
        return (
          <blockquote key={key} className={styles.quote}>
            {renderParts(segment.parts, segment.content, false)}
          </blockquote>
        );
      default:
        // 元素芯片只存在于用户自己输入的文字里
        return (
          <div key={key} className={styles.text}>
            {renderParts(segment.parts, segment.content)}
          </div>
        );
    }
  });
}
