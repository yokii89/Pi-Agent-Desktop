import { WarningDiamondIcon } from "@phosphor-icons/react";
import { memo, useState } from "react";
import { useCollapseAnimation } from "../../../hooks/useCollapseAnimation";
import { useT } from "../../../hooks/useT";
import type { AssistantBlock, ToolAssistantBlock } from "../../../stores/sessionTranscript";
import { ToolCall, ToolGlyph } from "./ToolCall";
import styles from "./ToolCallGroup.module.css";
import { summarizeTools } from "./toolSummary";

export function isToolOnlyGroup(group: AssistantBlock[]): boolean {
  return group.length > 0 && group.every((block) => block.kind === "tool");
}

/**
 * 连续工具组：
 * - 1 条：保持单行 ToolCall。
 * - ≥2 条：Codex 式摘要头（首工具图标 + 聚合文案，可折叠）；默认收起，不跟随 running 自动展开。
 */
export const ToolCallGroup = memo(function ToolCallGroup({
  blocks,
}: {
  blocks: ToolAssistantBlock[];
}) {
  const t = useT();
  const multi = blocks.length >= 2;
  const [open, setOpen] = useState(false);
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(open);

  if (!multi) {
    const only = blocks[0];
    if (!only) return null;
    return <ToolCall block={only} />;
  }

  const summary = summarizeTools(t, blocks);
  const headKind = blocks[0]?.toolKind ?? "generic";
  const hasError = blocks.some((block) => block.status === "error");
  const isRunning = blocks.some((block) => block.status === "running");

  return (
    <div className={`${styles.groupShell} ${isRunning ? "toolFlowRunning" : ""}`}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className={styles.glyph} aria-hidden="true">
          <ToolGlyph kind={headKind} />
        </span>
        <span className={`${styles.summary} ${isRunning ? "toolFlow" : ""}`}>{summary}</span>
        {hasError && (
          <span className={styles.warn} aria-hidden="true">
            <WarningDiamondIcon size={16} />
          </span>
        )}
        <span className={`${styles.caret} ${open ? styles.caretOpen : ""}`} />
      </button>
      <div className={styles.bodyWrap} ref={ref}>
        {rendered && (
          <div className={`${styles.group} ${styles.railed}`} ref={innerRef}>
            {blocks.map((block) => (
              <ToolCall key={block.toolCallId} block={block} railed />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}, shallowEqualBlocks);

function shallowEqualBlocks(
  prev: { blocks: ToolAssistantBlock[] },
  next: { blocks: ToolAssistantBlock[] },
): boolean {
  if (prev.blocks === next.blocks) return true;
  if (prev.blocks.length !== next.blocks.length) return false;
  return prev.blocks.every((block, index) => block === next.blocks[index]);
}
