import { GearSix, WarningDiamondIcon } from "@phosphor-icons/react";
import { memo, useMemo, useState } from "react";
import { useCollapseAnimation } from "../../hooks/useCollapseAnimation";
import { useT } from "../../hooks/useT";
import type { AssistantBlock, ToolAssistantBlock } from "../../stores/sessionTranscript";
import styles from "./ActivityGroup.module.css";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallGroup } from "./tools/ToolCallGroup";
import { aggregateChangeStats, summarizeTools } from "./tools/toolSummary";

/**
 * 活动组（方案A）：AI 正文之间的连续 thinking+tool 段收成一个默认收起的聚合头——
 * 「已编辑 6 个文件 · 已执行命令 1 次 · 已读取 1 个文件 · 思考 5 次 ⚠1次失败 +320 -134」。
 * - 聚合文案复用 ToolCallGroup 的 summarizeTools（thinkingCount 追加思考段，omitErrors
 *   把失败留出去单独标红）；diff 合计为组级增量（aggregateChangeStats，口径同单行 changeStat）。
 * - 展开后回到现状渲染：组内按「连续工具成组」交给 ToolCallGroup，思考行逐条折叠——
 *   活动组只是外层折叠壳，不改变任何子块的展示规则。
 * - 默认收起、不跟随 running 自动展开（与工具组同一条硬约束，避免对话流跳动）。
 * - 静息 muted 墨色与思考折叠头一致，悬浮整行转主题色；红绿 diff 与失败红不随悬浮变色。
 */
export const ActivityGroup = memo(function ActivityGroup({ blocks }: { blocks: AssistantBlock[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(open);

  const toolBlocks = useMemo(
    () => blocks.filter((block): block is ToolAssistantBlock => block.kind === "tool"),
    [blocks],
  );
  const thinkingCount = blocks.length - toolBlocks.length;
  const summary = summarizeTools(t, toolBlocks, { thinkingCount, omitErrors: true });
  const errorCount = toolBlocks.filter((block) => block.status === "error").length;
  const diff = aggregateChangeStats(toolBlocks);
  const isRunning = toolBlocks.some((block) => block.status === "running");

  // 展开体 = 现状渲染：组内再按「连续工具成组」切分（段内无 text，思考各自成组）
  const bodyGroups = useMemo(() => {
    const groups: AssistantBlock[][] = [];
    let run: AssistantBlock[] = [];
    for (const block of blocks) {
      if (block.kind === "tool") {
        run.push(block);
        continue;
      }
      if (run.length > 0) {
        groups.push(run);
        run = [];
      }
      groups.push([block]);
    }
    if (run.length > 0) groups.push(run);
    return groups;
  }, [blocks]);

  return (
    <div className={`${styles.activity} ${isRunning ? "toolFlowRunning" : ""}`}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className={styles.glyph} aria-hidden="true">
          <GearSix size={16} weight="regular" />
        </span>
        <span className={`${styles.summary} ${isRunning ? "toolFlow" : ""}`}>{summary}</span>
        {errorCount > 0 && (
          <span className={styles.fail}>
            <WarningDiamondIcon size={14} weight="regular" aria-hidden="true" />
            {t("session.tool.errors", { count: errorCount })}
          </span>
        )}
        {diff && (
          <span className={styles.diff}>
            {diff.additions > 0 && <span className={styles.statAdd}>+{diff.additions}</span>}
            {diff.additions > 0 && diff.deletions > 0 ? " " : ""}
            {diff.deletions > 0 && <span className={styles.statDel}>-{diff.deletions}</span>}
          </span>
        )}
        <span className={`${styles.caret} ${open ? styles.caretOpen : ""}`} />
      </button>
      <div className={styles.bodyWrap} ref={ref}>
        {rendered && (
          <div className={`${styles.group} ${styles.railed}`} ref={innerRef}>
            {bodyGroups.map((group) => {
              const head = group[0];
              if (!head) return null;
              // 键取自块的身份槽位（toolCallId / contentIndex），流式增量下保持 DOM 复用
              const key = head.kind === "tool" ? head.toolCallId : `c${head.contentIndex}`;
              return head.kind === "thinking" ? (
                <ReasoningBlock key={key} text={head.text} streaming={head.streaming} />
              ) : (
                <ToolCallGroup key={key} blocks={group as ToolAssistantBlock[]} />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}, shallowEqualFlow);

/** 段级 memo：引用未变的块在流式 delta 时跳过重渲染（与 ToolCallGroup 同一 comparator）。 */
function shallowEqualFlow(
  prev: { blocks: AssistantBlock[] },
  next: { blocks: AssistantBlock[] },
): boolean {
  if (prev.blocks === next.blocks) return true;
  if (prev.blocks.length !== next.blocks.length) return false;
  return prev.blocks.every((block, index) => block === next.blocks[index]);
}
