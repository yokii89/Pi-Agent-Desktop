/**
 * 上下文用量分类明细（docs/design/28 P1）：零依赖纯函数。
 *
 * 原理性约束：provider 报回的 usage 是不透明总数（已含 system prompt / tool schema），
 * pi 无法按来源拆开。因此本模块只产出**相对占比**，Σ(分类) 不必等于标题总量；
 * 差额进「其它/开销」残差桶。**不要**在 UI 上给分项 token 数。
 *
 * 估算器：CJK 约 1 token/字，拉丁 chars/4（pi 的 chars/4 对中文系统性低估约 4 倍）。
 * 与 pi footer 数字可能有偏差——标题 percent 来自 pi（权威），明细是本地加权估算。
 */

export type ContextBucket =
  | "user"
  | "assistant"
  | "thinking"
  | "toolResult"
  | "summary"
  | "skills"
  | "other";

export interface ContextBreakdownSlice {
  bucket: ContextBucket;
  /** 归一化后的百分比（各片之和恒为 100）。 */
  ratioPercent: number;
}

export interface ContextBreakdownResult {
  slices: ContextBreakdownSlice[];
  /** 残差桶占比；> 40 时 UI 应注明「含系统提示与工具定义」。 */
  otherPercent: number;
}

/** CJK 统一表意 / 扩展 A / 假名 / 谚文 / 全角标点——按 1 token/字计。 */
function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x3040 && c <= 0x30ff) || // 假名
    (c >= 0x3400 && c <= 0x4dbf) || // 扩展 A
    (c >= 0x4e00 && c <= 0x9fff) || // 统一表意
    (c >= 0xac00 && c <= 0xd7af) || // 谚文
    (c >= 0xff00 && c <= 0xffef) // 全角形式
  );
}

/** 本地 token 估算：CJK 1:1，其余 chars/4。只用于分类占比，不写回 pi。 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCjk(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
  name?: unknown;
  arguments?: unknown;
}

function blocksFromContent(content: unknown): ContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is ContentBlock => Boolean(b) && typeof b === "object");
}

function textOfBlocks(blocks: ContentBlock[]): string {
  let out = "";
  for (const b of blocks) {
    if (typeof b.text === "string") out += b.text;
  }
  return out;
}

function toolCallTextOfBlocks(blocks: ContentBlock[]): string {
  let out = "";
  for (const b of blocks) {
    if (b.type === "toolCall") {
      if (typeof b.name === "string") out += b.name;
      try {
        out += JSON.stringify(b.arguments ?? null);
      } catch {
        out += String(b.arguments ?? "");
      }
    }
  }
  return out;
}

function thinkingOfBlocks(blocks: ContentBlock[]): string {
  let out = "";
  for (const b of blocks) {
    if (typeof b.thinking === "string") out += b.thinking;
  }
  return out;
}

/**
 * 按消息角色分桶（get_messages 的未展平形态）。
 * `bashExecution.excludeFromContext` 为真时整条跳过——它不占上下文。
 */
export function estimateMessageBuckets(
  messages: unknown[],
): Record<Exclude<ContextBucket, "skills" | "other">, number> {
  const acc = { user: 0, assistant: 0, thinking: 0, toolResult: 0, summary: 0 };
  for (const raw of messages) {
    if (!raw || typeof raw !== "object") continue;
    const msg = raw as {
      role?: unknown;
      content?: unknown;
      summary?: unknown;
      command?: unknown;
      output?: unknown;
      excludeFromContext?: unknown;
    };
    switch (msg.role) {
      case "user": {
        const blocks = blocksFromContent(msg.content);
        acc.user += estimateTextTokens(textOfBlocks(blocks));
        break;
      }
      case "assistant": {
        const blocks = blocksFromContent(msg.content);
        acc.thinking += estimateTextTokens(thinkingOfBlocks(blocks));
        acc.assistant += estimateTextTokens(textOfBlocks(blocks));
        acc.assistant += estimateTextTokens(toolCallTextOfBlocks(blocks));
        break;
      }
      case "toolResult": {
        const blocks = blocksFromContent(msg.content);
        acc.toolResult += estimateTextTokens(textOfBlocks(blocks));
        break;
      }
      case "bashExecution": {
        if (msg.excludeFromContext === true) break;
        const command = typeof msg.command === "string" ? msg.command : "";
        const output = typeof msg.output === "string" ? msg.output : "";
        acc.toolResult += estimateTextTokens(`${command}\n${output}`);
        break;
      }
      case "branchSummary":
      case "compactionSummary": {
        const summary = typeof msg.summary === "string" ? msg.summary : "";
        acc.summary += estimateTextTokens(summary);
        break;
      }
      default:
        break;
    }
  }
  return acc;
}

/** skills 元数据成本：get_commands 里 source=skill 的 name + description（对齐 system-prompt 注入字段）。 */
export function estimateSkillsTokens(commands: unknown[]): number {
  let total = 0;
  for (const raw of commands) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { name?: unknown; description?: unknown; source?: unknown };
    if (item.source !== "skill") continue;
    const name = typeof item.name === "string" ? item.name : "";
    const description = typeof item.description === "string" ? item.description : "";
    total += estimateTextTokens(`${name}\n${description}`);
  }
  return total;
}

const BUCKET_ORDER: ContextBucket[] = [
  "user",
  "assistant",
  "thinking",
  "toolResult",
  "summary",
  "skills",
  "other",
];

/**
 * 归一化为相对占比（总和 100）。
 * `realTokens` 来自 pi 的 contextUsage（权威）；`Σ估算` 与之的正差进 other 残差。
 */
export function buildContextBreakdown(input: {
  messages: unknown[];
  commands: unknown[];
  /** pi 报告的上下文 token 总数；null 时只归一化估算桶。 */
  realTokens: number | null;
}): ContextBreakdownResult {
  const estimates = estimateMessageBuckets(input.messages);
  const skills = estimateSkillsTokens(input.commands);

  const values: Record<ContextBucket, number> = {
    user: estimates.user,
    assistant: estimates.assistant,
    thinking: estimates.thinking,
    toolResult: estimates.toolResult,
    summary: estimates.summary,
    skills,
    other: 0,
  };

  const estimateSum =
    values.user +
    values.assistant +
    values.thinking +
    values.toolResult +
    values.summary +
    values.skills;
  if (input.realTokens != null && input.realTokens > estimateSum) {
    // 真实总数更高：差额 = system prompt + tool schema + provider 框架开销（无法细分）
    values.other = input.realTokens - estimateSum;
  }

  const total =
    values.user +
    values.assistant +
    values.thinking +
    values.toolResult +
    values.summary +
    values.skills +
    values.other;
  if (total <= 0) {
    return { slices: [], otherPercent: 0 };
  }

  const slices: ContextBreakdownSlice[] = [];
  let assigned = 0;
  for (const bucket of BUCKET_ORDER) {
    const value = values[bucket];
    if (value <= 0) continue;
    const ratioPercent = (value / total) * 100;
    const rounded = Math.round(ratioPercent * 10) / 10;
    slices.push({ bucket, ratioPercent: rounded });
    assigned += rounded;
  }
  // 抹平四舍五入误差，保证总和 100
  if (slices.length > 0 && Math.abs(assigned - 100) > 0.05) {
    const last = slices[slices.length - 1];
    last.ratioPercent = Math.round((last.ratioPercent + (100 - assigned)) * 10) / 10;
  }

  return {
    slices,
    otherPercent: values.other > 0 ? (values.other / total) * 100 : 0,
  };
}
