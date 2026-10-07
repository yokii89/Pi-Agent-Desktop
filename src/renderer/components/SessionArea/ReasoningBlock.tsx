import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { useState } from "react";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import { MarkdownContent } from "./MarkdownContent";
import styles from "./ReasoningBlock.module.css";

interface ReasoningBlockProps {
  text: string;
  /** 流式中：标题「思考中」+ 脉冲点；正文末尾带打字光标。 */
  streaming?: boolean;
}

/**
 * 词数：拉丁/数字序列各计 1 词，CJK 按字计（无分词器时的常用近似）。
 * 不用 text.length——那是字符数，会把空格和标点也算进去。
 */
function countWords(text: string): number {
  // CJK 统一表意 / 扩展 A / 兼容表意：每字 1 词；拉丁数字连成 token
  const matches = text.match(/[㐀-䶿一-鿿豈-﫿]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  return matches ? matches.length : 0;
}

/**
 * 深度思考：默认折叠成一行（Codex 式），点开才渲染 muted Markdown。
 * 只渲染 API 明确提供的 reasoning，不伪造内部 chain-of-thought。
 */
export function ReasoningBlock({ text, streaming = false }: ReasoningBlockProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const empty = text.trim().length === 0;
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(open);

  if (empty && !streaming) return null;

  const wordCount = empty ? 0 : countWords(text);

  return (
    <section className={styles.reasoning}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.caretSlot}>
          {open ? (
            <CaretDown size={14} weight="regular" />
          ) : (
            <CaretRight size={14} weight="regular" />
          )}
        </span>
        <span>{streaming ? t("session.reasoning.thinking") : t("session.reasoning.label")}</span>
        <span className={styles.meta}>
          {streaming ? (
            <i className={styles.pulse} />
          ) : wordCount > 0 ? (
            t("session.reasoning.words", { count: wordCount })
          ) : null}
        </span>
      </button>
      <div className={styles.bodyWrap} ref={ref}>
        {rendered && (
          <div className={styles.body} ref={innerRef}>
            {empty ? (
              <span className={styles.emptyHint}>
                {t("session.reasoning.thinkingMore")}
                <span className={styles.caret} />
              </span>
            ) : (
              <>
                {/* streaming 同样走切分管线；caret 关掉——思考块有自己的光标（行 71） */}
                <MarkdownContent
                  text={text}
                  className={styles.mutedMd}
                  streaming={streaming}
                  caret={false}
                  breaks
                />
                {streaming && <span className={styles.caret} />}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
