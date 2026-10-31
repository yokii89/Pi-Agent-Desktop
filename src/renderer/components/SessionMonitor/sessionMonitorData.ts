/**
 * 会话监控卡的派生数据（纯函数）：摘要、工作区改动、来源、技能名、路径与 URL 短语。
 *
 * 卡片只负责展示，判定与取数口径全在这里，便于不启 UI 直接跑断言。
 * 数据来源都是渲染层已有的东西：会话条目、git 变更、斜杠命令缓存、附件；
 * 不为这张卡新增任何 pi RPC，也不自建会话存储（docs/design/96 / 98）。
 */
import type { PiSlashCommand, SessionSummary } from "../../../shared/ipc";
import type { SessionEntry } from "../../stores/sessionTranscript";
import { parseToolArgs } from "../../stores/toolPayload";
import { parseMcpToolName } from "../../utils/mcpToolName";

/** 工作区文件改动汇总（文件数 + 增删行）。 */
export interface MonitorEdits {
  files: number;
  additions: number;
  deletions: number;
}

/** 「来源」区的单条：随用户消息发出的图片或浏览器元素。 */
export interface MonitorSource {
  key: string;
  kind: "image" | "element";
  label: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * 摘要正文：最后一条含正文的 assistant 消息。
 *
 * 卡片是"状态卡"不是聊天气泡，所以把换行折成单段（模型输出常带硬换行，
 * 折行后由 CSS 的多行截断统一收敛），但不做 Markdown 渲染——摘要只求扫一眼。
 */
export function lastAssistantText(entries: readonly SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "assistant") continue;
    const parts: string[] = [];
    for (const block of entry.blocks) {
      if (block.kind === "text") parts.push(block.text);
    }
    const text = parts.join("\n").trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return null;
}

/**
 * 「文件变更」口径：**项目工作区全部未提交改动**（`reviewStore.summary`，与审查面板
 * 头部汇总同源；含已暂存 / 未暂存 / 未跟踪），不是某一轮的差集——卡片回答的是
 * “这个项目现在有哪些改动”，换会话、恢复历史后都应如实反映工作区。
 * 文件数为 0 表示工作区干净（或目录不是 git 仓库），显示「无改动」。
 */
export function editsFromWorkingTree(summary: MonitorEdits): MonitorEdits | null {
  return summary.files > 0 ? summary : null;
}

/**
 * 「更新时间」：优先取侧栏会话摘要里的 updatedAt（pi JSONL 的最后一条消息时间），
 * 新会话尚未落盘时回退到文档流里最后一条带时间戳的条目。
 */
export function sessionUpdatedAt(
  sessions: readonly SessionSummary[],
  activeSessionFile: string | null,
  entries: readonly SessionEntry[],
): number | null {
  const matched = activeSessionFile
    ? sessions.find((session) => session.file === activeSessionFile)
    : undefined;
  if (matched?.updatedAt) return matched.updatedAt;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === "run") {
      return entry.endedAt || entry.startedAt || null;
    }
    if (entry.kind === "notice" || entry.kind === "error" || entry.kind === "snapshot") {
      return entry.at || null;
    }
    if (entry.kind === "editsSummary") return entry.at || null;
  }
  return null;
}

/** 「来源」区：最近几条随消息发出的图片 / 浏览器元素，新的在前。 */
export function collectSources(entries: readonly SessionEntry[], limit = 3): MonitorSource[] {
  const sources: MonitorSource[] = [];
  for (let i = entries.length - 1; i >= 0 && sources.length < limit; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "user") continue;

    const images = entry.images ?? [];
    for (let j = images.length - 1; j >= 0 && sources.length < limit; j -= 1) {
      const image = images[j];
      const ext = IMAGE_EXTENSIONS[image.mimeType] ?? "png";
      sources.push({
        key: `image:${i}:${j}`,
        kind: "image",
        label: image.name?.trim() || `image.${ext}`,
      });
    }

    const items = entry.items ?? [];
    for (let j = items.length - 1; j >= 0 && sources.length < limit; j -= 1) {
      const item = items[j];
      sources.push({
        key: `element:${item.id}`,
        kind: "element",
        label: item.label.trim() || item.selector,
      });
    }
  }
  return sources;
}

/** 一次技能调用的两种来源：用户 `/skill:` 命令、模型自己读取 SKILL.md。 */
export interface MonitorSkillUsage {
  name: string;
  /** 用户命令次数（含 pi 展开后的 `<skill>` 用户消息）。 */
  commands: number;
  /** 模型读取技能源文件（SKILL.md / 独立 .md）的次数。 */
  reads: number;
}

export interface MonitorMcpToolUsage {
  tool: string;
  count: number;
}

export interface MonitorMcpUsage {
  server: string;
  count: number;
  tools: MonitorMcpToolUsage[];
}

/** 监控卡「技能与 MCP」区的**实际调用**统计（会话累计，非可用量）。 */
export interface MonitorCapabilityUsage {
  skills: MonitorSkillUsage[];
  mcp: MonitorMcpUsage[];
}

/** 用户消息里的技能调用。 */
export interface SkillInvocation {
  name: string;
  /** true = pi 已展开的 `<skill>` 消息；false = 输入栏原样发出的 `/skill:` 命令。 */
  expanded: boolean;
}

/**
 * 用户消息里的技能调用：pi 展开后的 `<skill name="…" location="…">` 块，
 * 或输入栏原样发出的 `/skill:<name>`（发送瞬间 pi 还没展开）。
 * 两者都是「用户把技能放进上下文」，在同一次调用里只命中一种。
 */
export function parseSkillInvocation(text: string): SkillInvocation | null {
  const block = /^<skill name="([^"]+)" location="[^"]*">/.exec(text);
  if (block?.[1]) return { name: block[1], expanded: true };
  // 对齐 pi 的展开规则：名字取到第一个**空格**为止，带换行/制表符的名字 pi 查不到、不会展开
  const command = /^\/skill:([^ ]+)/.exec(text);
  const name = command?.[1];
  return name && !/\s/.test(name) ? { name, expanded: false } : null;
}

interface SkillCatalogRef {
  name: string;
  /** 归一化后的 SKILL.md 绝对路径；旧缓存没有该字段时为 null。 */
  path: string | null;
  /** 技能文件所在目录名；用来兜住 frontmatter 名与目录名不一致的情况。 */
  dirName: string | null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function parentSegment(normalizedPath: string): string | null {
  const parts = normalizedPath.split("/");
  parts.pop();
  return parts.pop() ?? null;
}

function buildSkillCatalog(
  commands: readonly PiSlashCommand[] | null | undefined,
): SkillCatalogRef[] {
  const refs: SkillCatalogRef[] = [];
  for (const command of commands ?? []) {
    if (command.source !== "skill") continue;
    const path = command.filePath ? normalizePath(command.filePath) : null;
    refs.push({
      name: command.name.replace(/^skill:/, ""),
      path,
      dirName: path ? parentSegment(path) : null,
    });
  }
  return refs;
}

/**
 * 技能源文件路径 → 技能名。
 *
 * 只认**已登记**技能：agent 读项目里某个同名文件不能算「调用技能」。
 * 先比精确路径（get_commands 的 sourceInfo.path），再用目录名兜底——
 * 相对路径、旧缓存（没有 filePath）以及 frontmatter 名与目录名不一致都能命中。
 */
function matchSkillPath(path: string, catalog: SkillCatalogRef[]): string | null {
  const normalized = normalizePath(path);
  // 精确文件路径优先：pi 也支持技能目录根部的独立 .md 技能（文件名不是 SKILL.md）
  for (const ref of catalog) {
    if (ref.path !== null && ref.path === normalized) return ref.name;
  }
  if (!normalized.endsWith("/skill.md")) return null;
  const dir = parentSegment(normalized);
  if (!dir) return null;
  for (const ref of catalog) {
    if ((ref.dirName ?? ref.name.toLowerCase()) === dir) return ref.name;
  }
  return null;
}

function catalogHasSkill(name: string, catalog: SkillCatalogRef[]): boolean {
  const lower = name.toLowerCase();
  return catalog.some((ref) => ref.name.toLowerCase() === lower);
}

function canonicalSkillName(name: string, catalog: SkillCatalogRef[]): string {
  const lower = name.toLowerCase();
  for (const ref of catalog) {
    if (ref.name.toLowerCase() === lower) return ref.name;
  }
  return name;
}

/**
 * 从会话条目统计实际发生过的技能 / MCP 调用（会话累计）。
 *
 * - 技能命令：用户消息文本（`/skill:` 或 pi 展开的 `<skill>` 块）；
 * - 技能读取：`read` 工具块参数命中已登记技能的源文件（SKILL.md / 独立 .md）；
 * - MCP 直接调用：工具块名 `mcp__<server>__<tool>`；
 * - MCP codemode 调用：父工具块的 `nestedCalls`（reducer 从 toolResult 消息回填）。
 *
 * 只统计发生过的调用，不读「可用 / 已启用」——配置里有但没用过的不出现在卡上。
 */
export function collectCapabilityUsage(
  entries: readonly SessionEntry[],
  commands: readonly PiSlashCommand[] | null | undefined,
): MonitorCapabilityUsage {
  const catalog = buildSkillCatalog(commands);
  const skills = new Map<string, MonitorSkillUsage>();
  const mcp = new Map<string, { server: string; count: number; tools: Map<string, number> }>();

  const bumpSkill = (rawName: string, source: "commands" | "reads"): void => {
    const name = canonicalSkillName(rawName, catalog);
    const key = name.toLowerCase();
    const usage = skills.get(key) ?? { name, commands: 0, reads: 0 };
    if (source === "commands") usage.commands += 1;
    else usage.reads += 1;
    skills.set(key, usage);
  };

  const bumpMcp = (fullName: string): void => {
    const parts = parseMcpToolName(fullName);
    if (!parts) return;
    const key = parts.server.toLowerCase();
    const usage = mcp.get(key) ?? { server: parts.server, count: 0, tools: new Map() };
    usage.count += 1;
    usage.tools.set(parts.tool, (usage.tools.get(parts.tool) ?? 0) + 1);
    mcp.set(key, usage);
  };

  for (const entry of entries) {
    if (entry.kind === "user") {
      const invocation = parseSkillInvocation(entry.text);
      if (invocation) {
        // 浏览器上下文会把说明 prepend 到消息前，pi 收到的已不是 /skill: 开头，不会展开
        const wrapped = !invocation.expanded && (entry.items?.length ?? 0) > 0;
        // 目录已加载却没有这个技能：pi 只会把原文当普通文本（目录未知时无法核对，按时用户已调用）
        const unknown =
          !invocation.expanded && commands != null && !catalogHasSkill(invocation.name, catalog);
        if (!wrapped && !unknown) bumpSkill(invocation.name, "commands");
      }
      continue;
    }
    if (entry.kind !== "assistant") continue;
    for (const block of entry.blocks) {
      if (block.kind !== "tool") continue;
      if (block.toolKind === "mcp") {
        bumpMcp(block.name);
      } else if (block.toolKind === "read") {
        const path = parseToolArgs("read", block.args).path ?? block.subject;
        if (path) {
          const name = matchSkillPath(path, catalog);
          if (name) bumpSkill(name, "reads");
        }
      }
      for (const call of block.nestedCalls ?? []) {
        if (call.name.startsWith("mcp__")) bumpMcp(call.name);
      }
    }
  }

  return {
    skills: [...skills.values()].sort(
      (a, b) => b.commands + b.reads - (a.commands + a.reads) || a.name.localeCompare(b.name),
    ),
    mcp: [...mcp.values()]
      .map((usage) => ({
        server: usage.server,
        count: usage.count,
        tools: [...usage.tools.entries()]
          .map(([tool, count]) => ({ tool, count }))
          .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool)),
      }))
      .sort((a, b) => b.count - a.count || a.server.localeCompare(b.server)),
  };
}
