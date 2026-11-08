import type { TranslateFn } from "../../../../shared/i18n";
import type { ToolAssistantBlock } from "../../../stores/sessionTranscript";
import type { ToolKind } from "../../../stores/toolPayload";
import { parseMcpToolName } from "../../../utils/mcpToolName";

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

export interface SummarizeOptions {
  /** 段末追加「思考 N 次」（活动组聚合头）；0 / 缺省不追加。 */
  thinkingCount?: number;
  /** 失败段不并入文案——活动组把失败单独标红渲染（语义色不随悬浮变色）。 */
  omitErrors?: boolean;
}

/**
 * 按首次出现顺序聚合：「已读取 4 个文件 · 已调用 filesystem 5 次 · 2 次失败」。
 * 文件类按路径去重；命令/搜索等按操作次数；MCP 调用按 server 聚合（server 名进文案）；
 * 组内有 error 时追加失败次数。
 */
export function summarizeTools(
  t: TranslateFn,
  blocks: ToolAssistantBlock[],
  options: SummarizeOptions = {},
): string {
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
  if (options.thinkingCount != null && options.thinkingCount > 0) {
    parts.push(t("session.activity.thinkingCount", { count: options.thinkingCount }));
  }
  if (!options.omitErrors && errorCount > 0) {
    parts.push(t("session.tool.errors", { count: errorCount }));
  }
  return parts.join(" · ");
}

export interface ChangeTotals {
  additions: number;
  deletions: number;
}

/**
 * 活动组头部的全组 diff 合计（方案A）：累加各编辑行的 +N/-M。
 * 口径同单行 changeStat：失败/取消行不计；全组 0/0 或无可统计行时返回 null（不显示）。
 */
export function aggregateChangeStats(blocks: ToolAssistantBlock[]): ChangeTotals | null {
  let additions = 0;
  let deletions = 0;
  let counted = false;
  for (const block of blocks) {
    if (block.toolKind !== "edit" && block.toolKind !== "write") continue;
    if (block.status === "error" || block.status === "cancelled") continue;
    const result = block.result;
    if (result?.kind !== "change" || result.additions === null) continue;
    additions += result.additions;
    deletions += result.deletions ?? 0;
    counted = true;
  }
  if (!counted || (additions === 0 && deletions === 0)) return null;
  return { additions, deletions };
}
