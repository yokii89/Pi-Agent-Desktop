import {
  BookOpenUser,
  GitDiff,
  MagnifyingGlass,
  PencilLine,
  PencilSimpleLine,
  Plugs,
  TerminalWindow,
} from "@phosphor-icons/react";
import { memo, useState } from "react";
import type { TranslateFn } from "../../../../shared/i18n";
import { useCollapseAnimation } from "../../../hooks/useCollapseAnimation";
import { useNowTick } from "../../../hooks/useNowTick";
import { useT } from "../../../hooks/useT";
import type { ToolAssistantBlock } from "../../../stores/sessionTranscript";
import type { ToolKind } from "../../../stores/toolPayload";
import { parseMcpToolName } from "../../../utils/mcpToolName";
import { formatElapsed } from "../../../utils/time";
import styles from "./ToolCall.module.css";
import { ToolResultRouter } from "./ToolResultRouter";

/** 工具行图标（Codex 对齐）：read 书 / write·edit 铅笔 / bash·扩展 终端窗 / mcp 插头。 */
export function ToolGlyph({ kind }: { kind: ToolKind }) {
  const size = 16;
  const weight = "regular" as const;
  switch (kind) {
    case "read":
      return <BookOpenUser size={size} weight={weight} />;
    case "write":
      return <PencilLine size={size} weight={weight} />;
    case "edit":
      return <PencilSimpleLine size={size} weight={weight} />;
    case "terminal":
    case "generic":
      return <TerminalWindow size={size} weight={weight} />;
    case "search":
      return <MagnifyingGlass size={size} weight={weight} />;
    case "diff":
      return <GitDiff size={size} weight={weight} />;
    case "mcp":
      // 与 SideNav「MCP 服务器」入口同源：应用内已建立「Plugs = MCP」的视觉关联
      return <Plugs size={size} weight={weight} />;
    default:
      return <TerminalWindow size={size} weight={weight} />;
  }
}

/** 完成态动作（Codex「已读取 / 已编辑 / 已执行命令」）。 */
function pastAction(t: TranslateFn, kind: ToolKind): string {
  switch (kind) {
    case "read":
      return t("session.tool.past.read");
    case "write":
      return t("session.tool.past.write");
    case "edit":
      return t("session.tool.past.edit");
    case "terminal":
      return t("session.tool.past.terminal");
    case "search":
      return t("session.tool.past.search");
    case "diff":
      return t("session.tool.past.diff");
    case "mcp":
      return t("session.tool.past.mcp");
    default:
      return t("session.tool.past.generic");
  }
}

/** 失败/中断前缀用的短名（Codex「未执行 · 编辑」）。 */
function shortKind(t: TranslateFn, kind: ToolKind): string {
  switch (kind) {
    case "read":
      return t("session.tool.read");
    case "write":
      return t("session.tool.write");
    case "edit":
      return t("session.tool.edit");
    case "terminal":
      return t("session.tool.bash");
    case "search":
      return t("session.tool.search");
    case "diff":
      return t("session.tool.change");
    case "mcp":
      return t("session.tool.mcp");
    default:
      return t("session.tool.tool");
  }
}

function rowAction(t: TranslateFn, block: ToolAssistantBlock): { text: string; tone: string } {
  if (block.status === "running")
    return {
      text: t("session.tool.executing"),
      // .actionRun 必须保留：prefers-reduced-motion / forced-colors 两条回退路径里 color 的语义来源
      tone: `${styles.actionRun} toolFlow`,
    };
  if (block.status === "pending")
    return { text: t("session.tool.pending"), tone: styles.actionMuted };
  // 失败（工具报错）与中断（用户/会话取消）语义不同：前者标红，后者保持 muted。
  if (block.status === "error") {
    return {
      text: t("session.tool.kindFailed", { kind: shortKind(t, block.toolKind) }),
      tone: styles.actionErr,
    };
  }
  if (block.status === "cancelled") {
    return {
      text: t("session.tool.notExecuted", { kind: shortKind(t, block.toolKind) }),
      tone: styles.actionMuted,
    };
  }
  return { text: pastAction(t, block.toolKind), tone: "" };
}

interface ToolCallProps {
  block: ToolAssistantBlock;
  /** 轨道连线（组内）。 */
  railed?: boolean;
  /** 初始展开态；缺省收起，避免流式时自动开合导致对话流跳动。 */
  defaultOpen?: boolean;
}

/**
 * 单次工具调用行（Codex 式）：图标 + 动作文案 + 主体芯片 + 可选统计，展开看结果。
 * 默认收起，由用户点击展开——不自动跟随 running 状态开合。
 */
export const ToolCall = memo(function ToolCall({ block, railed, defaultOpen }: ToolCallProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { ref, innerRef, rendered } = useCollapseAnimation<HTMLDivElement, HTMLDivElement>(open);
  const expandable = Boolean(block.result || block.argsText || block.status === "running");
  const running = block.status === "running";
  const now = useNowTick(running);
  const elapsedText =
    running && block.startedAt != null ? formatElapsed(now - block.startedAt) : null;
  const action = rowAction(t, block);
  const elapsedStats = elapsedText ? { text: elapsedText, tone: styles.statRun } : null;
  const changeStats = changeStat(block);
  const fallbackStats = elapsedStats || changeStats ? null : statusStats(t, block);

  // MCP 调用芯片显示 `server · tool` 短名（title 给全名）；args 里的 path 等
  // 不再顶替芯片——原始身份是用户认不出 MCP 调用的根因，展开后的参数里仍可见
  const mcpParts = block.toolKind === "mcp" ? parseMcpToolName(block.name) : null;
  const rawSubject = mcpParts
    ? `${mcpParts.server} · ${mcpParts.tool}`
    : block.subject || block.name;
  // Codex 展示路径/命令原文（芯片内省略），不再缩成 basename
  const subjectText = rawSubject;
  const chipTitle = mcpParts ? block.name : undefined;

  return (
    <div
      className={`${styles.call} ${railed ? styles.railed : ""} ${open ? styles.open : ""} ${
        running ? "toolFlowRunning" : ""
      }`}
    >
      <button
        type="button"
        className={`${styles.row} ${expandable ? "" : styles.plain}`}
        aria-expanded={expandable ? open : undefined}
        aria-label={`${action.text} ${subjectText}`}
        disabled={!expandable}
        onClick={() => {
          if (!expandable) return;
          setOpen((value) => !value);
        }}
      >
        <span className={styles.glyph} aria-hidden="true">
          <ToolGlyph kind={block.toolKind} />
        </span>
        <span className={`${styles.action} ${action.tone}`}>{action.text}</span>
        <span className={styles.subjectChip} title={chipTitle}>
          {subjectText}
        </span>
        {elapsedStats && (
          <span className={`${styles.stats} ${elapsedStats.tone}`} aria-hidden="true">
            {elapsedStats.text}
          </span>
        )}
        {changeStats && (
          <span className={styles.stats} aria-hidden="true">
            {changeStats.addText && <span className={styles.statAdd}>{changeStats.addText}</span>}
            {changeStats.addText && changeStats.delText ? " " : ""}
            {changeStats.delText && <span className={styles.statDel}>{changeStats.delText}</span>}
          </span>
        )}
        {fallbackStats && (
          <span className={`${styles.stats} ${fallbackStats.tone}`} aria-hidden="true">
            {fallbackStats.text}
          </span>
        )}
        {expandable && <span className={styles.caret} />}
      </button>
      <div className={styles.detailWrap} ref={ref}>
        {rendered && (
          <div className={styles.detail} ref={innerRef}>
            <ToolResultRouter block={block} />
          </div>
        )}
      </div>
    </div>
  );
});

function changeStat(block: ToolAssistantBlock): { addText: string; delText: string } | null {
  if (block.toolKind !== "edit" && block.toolKind !== "write") return null;
  // 失败编辑行只标「编辑失败」，不展示 +N -M（与 Codex 式截图一致）
  if (block.status === "error" || block.status === "cancelled") return null;
  const result = block.result;
  if (result?.kind !== "change" || result.additions === null) return null;
  const adds = result.additions;
  const dels = result.deletions ?? 0;
  if (adds === 0 && dels === 0) return null;
  // 省略 0 侧：只增显示 +N，只减显示 -M，双边才 +N -M
  return {
    addText: adds > 0 ? `+${adds}` : "",
    delText: dels > 0 ? `-${dels}` : "",
  };
}

function statusStats(
  t: TranslateFn,
  block: ToolAssistantBlock,
): { text: string; tone: string } | null {
  if (block.toolKind === "search" && block.result?.kind === "search") {
    const n = block.result.hits.length;
    return {
      text: t("session.tool.hits", { count: n }),
      tone: block.status === "error" ? styles.statErr : "",
    };
  }
  if (block.toolKind === "read" && block.args) {
    const args = block.args as { offset?: number; limit?: number };
    const offset = typeof args.offset === "number" ? args.offset : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    if (offset !== undefined) {
      return {
        text:
          limit !== undefined
            ? `L${offset}-${offset + limit - 1}`
            : t("session.tool.lineFrom", { line: offset }),
        tone: "",
      };
    }
  }
  if (block.status === "error") {
    const result = block.result;
    if (result?.kind === "terminal" && result.exitCode !== null) {
      return { text: `exit ${result.exitCode}`, tone: styles.statErr };
    }
    return null;
  }
  return null;
}
