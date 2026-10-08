import { memo, useMemo } from "react";
import type { AssistantBlock, ToolAssistantBlock } from "../../stores/sessionTranscript";
import styles from "./AssistantMessage.module.css";
import { MarkdownContent } from "./MarkdownContent";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCall } from "./tools/ToolCall";
import { isToolOnlyGroup, ToolCallGroup } from "./tools/ToolCallGroup";

/**
 * AI 回复：文档流渲染（Markdown 全宽排版），禁止气泡。
 * 连续工具成组：≥2 条收成摘要头；思考默认折叠成一行。
 * 历史块经 BlockView memo 在 text_delta 时跳过重渲染。
 * 不提供尾部 hover 操作条：整条取用走划选浮窗（docs/design/12）。
 */
export function AssistantMessage({ blocks }: { blocks: AssistantBlock[] }) {
  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const hasStreaming = blocks.some((block) => block.kind !== "tool" && block.streaming === true);

  return (
    <article className={styles.message} aria-busy={hasStreaming || undefined}>
      {groups.map((group, index) => {
        if (group.length === 1) {
          const block = group[0];
          // biome-ignore lint/suspicious/noArrayIndexKey: 流式增量按位置追加，索引键保证 DOM 复用
          return <BlockView key={`g-${index}`} block={block} />;
        }
        if (isToolOnlyGroup(group)) {
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          return <ToolCallGroup key={`g-${index}`} blocks={group as ToolAssistantBlock[]} />;
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: 同上
        return <MixedFallback key={`g-${index}`} group={group} />;
      })}
    </article>
  );
}

/** 块级 memo：引用未变的历史块在流式 delta 时跳过。 */
const BlockView = memo(function BlockView({ block }: { block: AssistantBlock }) {
  if (block.kind === "text") {
    // 单一组件 + streaming prop：流式收尾时原地 reconcile，不切换组件类型（docs/design/13 P1-4）
    return <MarkdownContent text={block.text} streaming={block.streaming === true} breaks />;
  }
  if (block.kind === "thinking") {
    return <ReasoningBlock text={block.text} streaming={block.streaming} />;
  }
  return <ToolCall block={block} />;
});

function MixedFallback({ group }: { group: AssistantBlock[] }) {
  return (
    <>
      {group.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同上
        <BlockView key={`m-${index}`} block={block} />
      ))}
    </>
  );
}

/** 按「连续工具成组」切分；text/thinking 各自独立。空白 text 直接丢弃，避免假空隙。 */
function groupBlocks(blocks: AssistantBlock[]): AssistantBlock[][] {
  const groups: AssistantBlock[][] = [];
  let toolRun: AssistantBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "text" && block.text.trim().length === 0) continue;
    if (block.kind === "tool") {
      toolRun.push(block);
      continue;
    }
    if (toolRun.length > 0) {
      groups.push(toolRun);
      toolRun = [];
    }
    groups.push([block]);
  }
  if (toolRun.length > 0) groups.push(toolRun);
  return groups;
}
