import { memo, useMemo } from "react";
import type { AssistantBlock, ToolAssistantBlock } from "../../stores/sessionTranscript";
import { ActivityGroup } from "./ActivityGroup";
import styles from "./AssistantMessage.module.css";
import { MarkdownContent } from "./MarkdownContent";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCall } from "./tools/ToolCall";
import { isToolOnlyGroup, ToolCallGroup } from "./tools/ToolCallGroup";

/**
 * AI 回复：文档流渲染（Markdown 全宽排版），禁止气泡。
 * 两层结构：text 是正文，直接渲染；text 之间的连续 thinking+tool 段——
 * 同时含工具与思考的收成「活动组」（默认收起一行聚合头，展开回到现状渲染）；
 * 纯工具段 / 纯思考段 / 单条工具行保持原渲染（ToolCallGroup 与思考折叠行的既有规则）。
 * 历史块经 BlockView memo 在 text_delta 时跳过重渲染。
 * 不提供尾部 hover 操作条：整条取用走划选工具条（docs/design/81）。
 */
export function AssistantMessage({ blocks }: { blocks: AssistantBlock[] }) {
  const units = useMemo(() => groupFlow(blocks), [blocks]);
  const hasStreaming = blocks.some((block) => block.kind !== "tool" && block.streaming === true);

  return (
    <article className={styles.message} aria-busy={hasStreaming || undefined}>
      {units.map((unit, index) => {
        if (unit.kind === "activity") {
          // biome-ignore lint/suspicious/noArrayIndexKey: 流式增量按位置追加，索引键保证 DOM 复用
          return <ActivityGroup key={`g-${index}`} blocks={unit.blocks} />;
        }
        const inner = unit.blocks;
        if (inner.length === 1) {
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          return <BlockView key={`g-${index}`} block={inner[0]} />;
        }
        if (isToolOnlyGroup(inner)) {
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          return <ToolCallGroup key={`g-${index}`} blocks={inner as ToolAssistantBlock[]} />;
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: 同上
        return <MixedFallback key={`g-${index}`} group={inner} />;
      })}
    </article>
  );
}

/** 块级 memo：引用未变的历史块在流式 delta 时跳过重渲染。 */
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

type FlowUnit =
  | { kind: "plain"; blocks: AssistantBlock[] }
  | { kind: "activity"; blocks: AssistantBlock[] };

/**
 * 按「正文分段」切流：text 打断段落；text 之间的连续 thinking+tool 是一段工作过程。
 * 段同时含工具与思考 → 活动组（方案A）；纯工具段交给 ToolCallGroup 的既有规则，
 * 纯思考段保持逐条折叠行。空白 text 直接丢弃，避免假空隙。
 */
function groupFlow(blocks: AssistantBlock[]): FlowUnit[] {
  const units: FlowUnit[] = [];
  let span: AssistantBlock[] = [];

  const flushSpan = () => {
    if (span.length === 0) return;
    const hasTool = span.some((block) => block.kind === "tool");
    const hasThinking = span.some((block) => block.kind === "thinking");
    units.push({
      kind: hasTool && hasThinking ? "activity" : "plain",
      blocks: span,
    });
    span = [];
  };

  for (const block of blocks) {
    if (block.kind === "text") {
      if (block.text.trim().length === 0) continue;
      flushSpan();
      units.push({ kind: "plain", blocks: [block] });
      continue;
    }
    span.push(block);
  }
  flushSpan();
  return units;
}
