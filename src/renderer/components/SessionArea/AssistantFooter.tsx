import { MarkdownLogo, TextT } from "@phosphor-icons/react";
import { useT } from "../../hooks/useT";
import type { AssistantBlock } from "../../stores/sessionTranscript";
import { useUiStore } from "../../stores/uiStore";
import { formatMessageTime } from "../../utils/time";
import styles from "./AssistantFooter.module.css";
import { assistantReplyMarkdown, markdownToPlainText } from "./assistantReplyText";

/**
 * 回复页脚：整轮输出结束后出现在文档流末尾。
 * 两种复制都只取正文 text 块，思考与工具调用内容不参与。
 */
export function AssistantFooter({ blocks, at }: { blocks: AssistantBlock[]; at: number | null }) {
  const t = useT();
  const { showToast } = useUiStore();

  const copy = (text: string): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => showToast(t("common.copied")))
      .catch(() => showToast(t("session.copyFailed")));
  };

  const copyMarkdown = (): void => copy(assistantReplyMarkdown(blocks));
  const copyPlainText = (): void => copy(markdownToPlainText(assistantReplyMarkdown(blocks)));

  return (
    <footer className={styles.footer}>
      <button
        type="button"
        className={styles.action}
        title={t("session.copyMarkdown")}
        aria-label={t("session.copyMarkdown")}
        onClick={copyMarkdown}
      >
        <MarkdownLogo size={20} weight="regular" />
      </button>
      <button
        type="button"
        className={styles.action}
        title={t("session.copyPlainText")}
        aria-label={t("session.copyPlainText")}
        onClick={copyPlainText}
      >
        <TextT size={20} weight="regular" />
      </button>
      {at ? (
        <time className={styles.time} dateTime={new Date(at).toISOString()}>
          {formatMessageTime(at)}
        </time>
      ) : null}
    </footer>
  );
}
