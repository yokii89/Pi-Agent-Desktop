import { WarningDiamondIcon } from "@phosphor-icons/react";
import { memo, useState } from "react";
import type { TranslateFn } from "../../../../shared/i18n";
import { useCollapseAnimation } from "../../../hooks/useCollapseAnimation";
import { useT } from "../../../hooks/useT";
import type { AssistantBlock, ToolAssistantBlock } from "../../../stores/sessionTranscript";
import type { ToolKind } from "../../../stores/toolPayload";
import { parseMcpToolName } from "../../../utils/mcpToolName";
import { ToolCall, ToolGlyph } from "./ToolCall";
import styles from "./ToolCallGroup.module.css";

export function isToolOnlyGroup(group: AssistantBlock[]): boolean {
  return group.length > 0 && group.every((block) => block.kind === "tool");
}

/** 摘要头动词 key（完成态，对齐 Codex「已读取 / 已编辑 / 已运行」）。 */
const SUMMARY_VERB_KEY: Record<ToolKind, string> = {
  read: "session.tool.past.read",
  write: "session.tool.past.write",
  edit: "session.tool.past.edit",
  search: "session.tool.past.search",
  terminal: "session.tool.past.run",
  diff: "session.tool.past.view",
  mcp: "session.tool.past.mcp",
  generic: "session.tool.past.generic",
};

/** 摘要头量词 key。 */
const SUMMARY_UNIT_KEY: Record<ToolKind, string> = {
  read: "session.tool.unit.files",
  write: "session.tool.unit.files",
  edit: "session.tool.unit.files",
  search: "session.tool.unit.times",
  terminal: "session.tool.unit.commands",
  diff: "session.tool.unit.times",
  mcp: "session.tool.unit.times",
  generic: "session.tool.unit.times",
};

/** 文件类工具按 subject 去重（文案是「N 个文件」，同一路径连改只算 1）。 */
const FILE_KINDS: ReadonlySet<ToolKind> = new Set(["read", "write", "edit"]);

/**
 * 按首次出现顺序聚合：「已读取 4 个文件 · 已调用 filesystem 5 次 · 2 次失败」。
 * 文件类按路径去重；命令/搜索等按操作次数；MCP 调用按 server 聚合（server 名进文案）；
 * 组内有 error 时追加失败次数。
 */
function summarizeTools(t: TranslateFn, blocks: ToolAssistantBlock[]): string {
  // 聚合组 key：普通 kind 直接用 kind 字符串；MCP 组为 `mcp:<server>`（ToolKind 不含冒号，无碰撞）
  const order: string[] = [];
  const fileSubjects = new Map<string, Set<string>>();
  const opCounts = new Map<string, number>();
  let errorCount = 0;

  const note = (key: string): void => {
    if (!order.includes(key)) order.push(key);
  };

  for (const block of blocks) {
    if (block.status === "error") errorCount += 1;
    if (block.toolKind === "mcp") {
      const server = parseMcpToolName(block.name)?.server ?? block.name;
      const key = `mcp:${server}`;
      note(key);
      opCounts.set(key, (opCounts.get(key) ?? 0) + 1);
      continue;
    }
    if (FILE_KINDS.has(block.toolKind)) {
      note(block.toolKind);
      const subjects = fileSubjects.get(block.toolKind) ?? new Set<string>();
      subjects.add(block.subject || block.name);
      fileSubjects.set(block.toolKind, subjects);
      continue;
    }
    note(block.toolKind);
    opCounts.set(block.toolKind, (opCounts.get(block.toolKind) ?? 0) + 1);
  }

  const parts = order.map((key) => {
    if (key.startsWith("mcp:")) {
      const server = key.slice("mcp:".length);
      const n = opCounts.get(key) ?? 0;
      return `${t(SUMMARY_VERB_KEY.mcp)} ${server} ${n} ${t(SUMMARY_UNIT_KEY.mcp)}`;
    }
    const kind = key as ToolKind;
    const n = FILE_KINDS.has(kind)
      ? (fileSubjects.get(kind)?.size ?? 0)
      : (opCounts.get(kind) ?? 0);
    return `${t(SUMMARY_VERB_KEY[kind])} ${n} ${t(SUMMARY_UNIT_KEY[kind])}`;
  });
  if (errorCount > 0) parts.push(t("session.tool.errors", { count: errorCount }));
  return parts.join(" · ");
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
