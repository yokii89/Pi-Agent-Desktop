/**
 * 工具调用的分类与载荷解析（docs/中间栏对话流设计）。
 * UI 不按文本猜工具类型：分类看 toolName，展示字段从 args / result 结构里取。
 */

import { t } from "../../shared/i18n";

export type ToolKind =
  | "terminal"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "diff"
  | "mcp"
  | "generic";

export type ToolStatus = "pending" | "running" | "ok" | "error" | "cancelled";

export interface ParsedToolArgs {
  /** 行内扫读主体：命令 / 路径 / 查询词。 */
  subject: string;
  command?: string;
  path?: string;
  pattern?: string;
  /** read 的 offset/limit 展示，如 "L10-40"。 */
  lineRange?: string;
}

export interface TerminalPayload {
  kind: "terminal";
  command: string;
  /** pi bash 结果正文（stdout/stderr 合并流）。 */
  output: string;
  exitCode: number | null;
  truncated: boolean;
}

export interface FileReadPayload {
  kind: "read";
  path: string;
  content: string;
  truncated: boolean;
}

export interface FileChangePayload {
  kind: "change";
  path: string;
  mode: "write" | "edit";
  /** 展示用 diff（details.patch → details.diff → 按参数合成）；都没有时为 null。 */
  diff: string | null;
  additions: number | null;
  deletions: number | null;
}

export interface SearchHit {
  path: string;
  line: number | null;
  text: string;
}

export interface SearchPayload {
  kind: "search";
  pattern: string;
  hits: SearchHit[];
  /** 结果被截断 / 超出展示上限。 */
  truncated: boolean;
}

export interface DiffPayload {
  kind: "diff";
  path: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface GenericPayload {
  kind: "generic";
  resultText: string;
  /** result 中的 ImageContent（read 图片等）；无则为空。 */
  images: ToolImage[];
}

/** 工具结果中的图片（data URL）。 */
export interface ToolImage {
  src: string;
  alt: string;
}

export type ToolResultPayload =
  | TerminalPayload
  | FileReadPayload
  | FileChangePayload
  | SearchPayload
  | DiffPayload
  | GenericPayload;

const TERMINAL_TOOLS = new Set(["bash", "shell", "pwsh", "sh", "zsh", "cmd"]);
const READ_TOOLS = new Set(["read", "cat", "view", "ls", "list"]);
const WRITE_TOOLS = new Set(["write", "create", "new"]);
const EDIT_TOOLS = new Set(["edit", "apply_patch", "patch", "str_replace"]);
const SEARCH_TOOLS = new Set(["grep", "glob", "search", "rg", "find", "codebase_search"]);
const DIFF_TOOLS = new Set(["diff", "git_diff"]);

export function classifyTool(name: string): ToolKind {
  // MCP 工具全名 `mcp__<server>__<tool>`（pi 内置 MCP 扩展，docs/design/40）
  if (name.startsWith("mcp__")) return "mcp";
  const key = name.trim().toLowerCase();
  if (TERMINAL_TOOLS.has(key)) return "terminal";
  if (READ_TOOLS.has(key)) return "read";
  if (WRITE_TOOLS.has(key)) return "write";
  if (EDIT_TOOLS.has(key)) return "edit";
  if (SEARCH_TOOLS.has(key)) return "search";
  if (DIFF_TOOLS.has(key)) return "diff";
  return "generic";
}

export function actionLabel(kind: ToolKind): string {
  switch (kind) {
    case "terminal":
      return t("session.toolAction.terminal");
    case "read":
      return t("session.toolAction.read");
    case "write":
      return t("session.toolAction.write");
    case "edit":
      return t("session.toolAction.edit");
    case "search":
      return t("session.toolAction.search");
    case "diff":
      return t("session.toolAction.diff");
    default:
      return t("session.toolAction.generic");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 把 pi 的 arguments（对象或 JSON 字符串）收成记录。 */
export function parseArgsRecord(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed: unknown = JSON.parse(args);
      return asRecord(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(args) ?? {};
}

export function parseToolArgs(kind: ToolKind, args: unknown): ParsedToolArgs {
  const record = parseArgsRecord(args);
  const command = asString(record.command) ?? asString(record.cmd);
  const path =
    asString(record.path) ??
    asString(record.filePath) ??
    asString(record.file) ??
    asString(record.target_file);
  const pattern =
    asString(record.pattern) ?? asString(record.query) ?? asString(record.glob) ?? undefined;
  const offset = asNumber(record.offset) ?? asNumber(record.startLine);
  const limit = asNumber(record.limit) ?? asNumber(record.lineLimit);

  let lineRange: string | undefined;
  if (offset !== undefined) {
    lineRange = limit !== undefined ? `L${offset}-${offset + limit - 1}` : `L${offset}起`;
  }

  let subject = "";
  if (kind === "terminal" && command) subject = command;
  else if (path) subject = path;
  else if (pattern) subject = pattern;
  else if (command) subject = command;
  else {
    const fallback = Object.values(record).find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    subject = firstLinePreview(fallback);
  }

  return { subject, command, path, pattern, lineRange };
}

function firstLinePreview(value: string | undefined): string {
  if (!value) return "";
  const first = value.split("\n", 1)[0] ?? "";
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

/** 从 bash 错误文本反解退出码（pi 非 0 时抛错，code 只在文案里）。 */
export function extractExitCode(text: string, isError: boolean): number | null {
  const match = /Command exited with code (-?\d+)/i.exec(text);
  if (match?.[1]) return Number(match[1]);
  if (!isError) return 0;
  return null;
}

export function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

/** pi 展示型 diff 行：`[+\- ]` + 行号场（padStart，可有前导空格）+ 一个空格 + 正文。 */
const DISPLAY_DIFF_LINE = /^([+\- ])(\s*\d+) ([\s\S]*)$/;
/** 展示型截断标记：` {pad} ...`。 */
const DISPLAY_DIFF_GAP = /^\s*\.\.\.$/;

/** 文本是否像 unified/git diff 或 pi 展示型 diff（有 hunk 头或 +/- 行）；纯成功文案不算。 */
function looksLikeUnifiedDiff(text: string): boolean {
  for (const line of text.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("+++ ") || line.startsWith("--- ")) return true;
    if (line.startsWith("diff ") || line.startsWith("index ")) return true;
    // pi 展示型：`+{num} {text}` / `-{num} {text}`
    if (DISPLAY_DIFF_LINE.test(line)) return true;
    // 排除 +++/--- 文件头后仍要有真实增删行
    if (
      !line.startsWith("+++") &&
      !line.startsWith("---") &&
      (line.startsWith("+") || line.startsWith("-"))
    ) {
      return true;
    }
  }
  return false;
}

function countTextLines(text: string): number {
  if (!text) return 0;
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

/** 一对替换文本：缺侧为 undefined（只算得出的一侧才报数）。 */
interface EditPair {
  oldText: string | undefined;
  newText: string | undefined;
}

function readOldText(record: Record<string, unknown>): string | undefined {
  return asString(record.oldText) ?? asString(record.old_string) ?? asString(record.old_str);
}

function readNewText(record: Record<string, unknown>): string | undefined {
  return (
    asString(record.newText) ??
    asString(record.new_string) ??
    asString(record.new_str) ??
    asString(record.replacement)
  );
}

/**
 * edit 参数里的替换块：pi 用 `edits: [{ oldText, newText }]` 批量提交，
 * 单对字段是其余工具/旧版形态，按同一种结构返回，便于逐块累加。
 */
function editPairs(record: Record<string, unknown>): EditPair[] {
  if (!Array.isArray(record.edits)) {
    const pair: EditPair = { oldText: readOldText(record), newText: readNewText(record) };
    return pair.oldText === undefined && pair.newText === undefined ? [] : [pair];
  }
  const pairs: EditPair[] = [];
  for (const item of record.edits) {
    const entry = asRecord(item);
    if (!entry) continue;
    const pair: EditPair = { oldText: readOldText(entry), newText: readNewText(entry) };
    if (pair.oldText === undefined && pair.newText === undefined) continue;
    pairs.push(pair);
  }
  return pairs;
}

/**
 * 无 git / 无 details.diff 时从 write/edit 参数估算行增减。
 * 只报能算出来的侧：write 全文记 additions；edit 按替换块逐块累加 old/new 行数。
 * 估不出的一侧保持 null，UI 不展示，避免假的 +0 -0。
 */
function estimateChangeStatsFromArgs(
  kind: ToolKind,
  args: unknown,
): { additions: number | null; deletions: number | null } {
  const record = parseArgsRecord(args);
  if (kind === "write") {
    const content =
      asString(record.content) ??
      asString(record.text) ??
      asString(record.file_text) ??
      asString(record.data) ??
      readNewText(record);
    if (content === undefined) return { additions: null, deletions: null };
    return { additions: countTextLines(content), deletions: null };
  }
  const pairs = editPairs(record);
  if (pairs.length === 0) return { additions: null, deletions: null };
  let additions: number | null = null;
  let deletions: number | null = null;
  for (const pair of pairs) {
    if (pair.newText !== undefined) additions = (additions ?? 0) + countTextLines(pair.newText);
    if (pair.oldText !== undefined) deletions = (deletions ?? 0) + countTextLines(pair.oldText);
  }
  return { additions, deletions };
}

/** 解析 unified / git patch 文本为 hunk 结构。 */
export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/**
 * 解析 unified / git patch，或 pi edit 的展示型 diff（`generateDiffString`）。
 * 展示型格式无 `@@` 头：`+{num} {text}` / `-{num} {text}` / ` {num} {text}`，截断为 ` ...`。
 */
export function parseUnifiedDiff(diff: string): DiffHunk[] {
  if (isDisplayDiff(diff)) return parseDisplayDiff(diff);
  return parseStandardUnifiedDiff(diff);
}

function parseStandardUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      current = { header: raw, lines: [] };
      hunks.push(current);
      const range = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      oldLine = range?.[1] ? Number(range[1]) : 0;
      newLine = range?.[3] ? Number(range[3]) : 0;
      continue;
    }
    if (!current) continue;
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++")
    ) {
      continue;
    }
    if (raw.startsWith("+")) {
      current.lines.push({ kind: "add", text: raw.slice(1), oldLine: null, newLine });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      current.lines.push({ kind: "del", text: raw.slice(1), oldLine, newLine: null });
      oldLine += 1;
      continue;
    }
    if (raw.startsWith("\\")) continue;
    if (raw.startsWith(" ")) {
      current.lines.push({ kind: "context", text: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

function isDisplayDiff(diff: string): boolean {
  if (diff.includes("\n@@") || diff.startsWith("@@")) return false;
  for (const raw of diff.split("\n")) {
    if (raw.length === 0) continue;
    if (DISPLAY_DIFF_GAP.test(raw)) return true;
    if (DISPLAY_DIFF_LINE.test(raw)) return true;
  }
  return false;
}

function parseDisplayDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let segmentOldStart: number | null = null;
  let segmentNewStart: number | null = null;
  let segmentOldCount = 0;
  let segmentNewCount = 0;

  const openHunk = () => {
    if (current) return current;
    const oldStart = segmentOldStart ?? segmentNewStart ?? 1;
    const newStart = segmentNewStart ?? segmentOldStart ?? 1;
    current = {
      header: `@@ -${oldStart},${segmentOldCount} +${newStart},${segmentNewCount} @@`,
      lines: [],
    };
    // 头里的计数要在收口时回填；先占位，flush 时改写
    hunks.push(current);
    return current;
  };

  const closeHunk = () => {
    if (!current) return;
    const oldStart = segmentOldStart ?? segmentNewStart ?? 1;
    const newStart = segmentNewStart ?? segmentOldStart ?? 1;
    current.header = `@@ -${oldStart},${segmentOldCount} +${newStart},${segmentNewCount} @@`;
    current = null;
    segmentOldStart = null;
    segmentNewStart = null;
    segmentOldCount = 0;
    segmentNewCount = 0;
  };

  for (const raw of diff.split("\n")) {
    if (raw.length === 0) continue;
    if (DISPLAY_DIFF_GAP.test(raw)) {
      closeHunk();
      continue;
    }
    const match = DISPLAY_DIFF_LINE.exec(raw);
    if (!match?.[1] || match[2] === undefined || match[3] === undefined) continue;
    const sign = match[1];
    const num = Number(match[2]);
    const text = match[3];
    const hunk = openHunk();
    if (sign === "+") {
      if (segmentNewStart === null) segmentNewStart = num;
      segmentNewCount += 1;
      hunk.lines.push({ kind: "add", text, oldLine: null, newLine: num });
      continue;
    }
    if (sign === "-") {
      if (segmentOldStart === null) segmentOldStart = num;
      segmentOldCount += 1;
      hunk.lines.push({ kind: "del", text, oldLine: num, newLine: null });
      continue;
    }
    if (segmentOldStart === null) segmentOldStart = num;
    if (segmentNewStart === null) segmentNewStart = num;
    segmentOldCount += 1;
    segmentNewCount += 1;
    // 展示型 context 只带一个行号（旧文件侧）；新侧按段内偏移近似，预览足够
    const newApprox = (segmentNewStart ?? num) + segmentNewCount - 1;
    hunk.lines.push({ kind: "context", text, oldLine: num, newLine: newApprox });
  }
  closeHunk();
  return hunks;
}

function splitTextLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * 无 details.diff/patch 时从 write/edit 参数合成 unified diff。
 * write：全文按新增行；edit：按替换块逐块出 hunk。行号是占位（参数里没有文件坐标）。
 */
function synthesizeChangeDiff(kind: ToolKind, args: unknown): string | null {
  const record = parseArgsRecord(args);
  if (kind === "write") {
    const content =
      asString(record.content) ??
      asString(record.text) ??
      asString(record.file_text) ??
      asString(record.data) ??
      readNewText(record);
    if (content === undefined) return null;
    const lines = splitTextLines(content);
    if (lines.length === 0) return null;
    const body = lines.map((line) => `+${line}`).join("\n");
    return `@@ -0,0 +1,${lines.length} @@\n${body}`;
  }
  const pairs = editPairs(record);
  const parts: string[] = [];
  for (const pair of pairs) {
    const oldLines = pair.oldText !== undefined ? splitTextLines(pair.oldText) : [];
    const newLines = pair.newText !== undefined ? splitTextLines(pair.newText) : [];
    if (oldLines.length === 0 && newLines.length === 0) continue;
    const oldStart = oldLines.length > 0 ? 1 : 0;
    const newStart = newLines.length > 0 ? 1 : 0;
    parts.push(`@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`);
    for (const line of oldLines) parts.push(`-${line}`);
    for (const line of newLines) parts.push(`+${line}`);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/** 从 grep/glob 纯文本结果解析命中行。 */
export function parseSearchHits(text: string): { hits: SearchHit[]; truncated: boolean } {
  const hits: SearchHit[] = [];
  let truncated = false;
  for (const line of text.split("\n")) {
    if (line.includes("matches limit reached") || line.includes("limit reached")) {
      truncated = true;
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) continue;
    const match = /^(.+?):(\d+):\s?(.*)$/.exec(line);
    if (match?.[1] && match[2]) {
      hits.push({ path: match[1], line: Number(match[2]), text: match[3] ?? "" });
      continue;
    }
    if (line.trim().length > 0 && !line.includes("matches")) {
      hits.push({ path: line.trim(), line: null, text: "" });
    }
  }
  return { hits, truncated };
}

export function extractResultText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(extractResultText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.text === "string") return record.text;
  if (record.content !== undefined) return extractResultText(record.content);
  return null;
}

export function extractResultDetails(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return asRecord(record.details);
}

/** 从 result.content 抽出 ImageContent（pi 的 image 块）。 */
export function extractImages(result: unknown): ToolImage[] {
  const images: ToolImage[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    if (record.type === "image" && typeof record.data === "string") {
      const mime = typeof record.mimeType === "string" ? record.mimeType : "image/png";
      images.push({ src: `data:${mime};base64,${record.data}`, alt: t("session.image.resultAlt") });
      return;
    }
    if (record.content !== undefined) visit(record.content);
  };
  visit(result);
  return images;
}

/** 工具结果展示上限：防止超长输出把 entries 内存与 DOM 双重撑爆。 */
const MAX_RESULT_TEXT = 256 * 1024;

function capResultText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_RESULT_TEXT) return { text, truncated: false };
  return { text: text.slice(0, MAX_RESULT_TEXT), truncated: true };
}

/**
 * 按工具种类把 args + result 折成专用展示载荷。
 * partialResult 与最终 result 都走这里，保证流式期间结构一致。
 */
export function buildToolResult(
  kind: ToolKind,
  args: unknown,
  result: unknown,
  isError: boolean,
): ToolResultPayload {
  const parsedArgs = parseToolArgs(kind, args);
  const rawText = extractResultText(result) ?? "";
  const capped = capResultText(rawText);
  const text = capped.text;
  const details = extractResultDetails(result);
  const images = extractImages(result);

  if (kind === "terminal") {
    return {
      kind: "terminal",
      command: parsedArgs.command ?? parsedArgs.subject,
      output: text,
      exitCode: extractExitCode(text, isError),
      truncated:
        capped.truncated || (details?.truncation !== undefined && details?.truncation !== null),
    };
  }

  if (kind === "read") {
    // 图片文件：read 会返回 ImageContent；正文只有 MIME 说明时交给 generic 图卡
    if (images.length > 0 && (text.startsWith("Read image") || text.trim().length === 0)) {
      return { kind: "generic", resultText: text, images };
    }
    return {
      kind: "read",
      path: parsedArgs.path ?? parsedArgs.subject,
      content: text,
      truncated: capped.truncated || text.includes("truncated") || details?.truncation != null,
    };
  }

  if (kind === "write" || kind === "edit") {
    // pi edit：patch 是标准 unified，diff 是展示型（带行号）；优先 patch 便于统一解析。
    // pi write：details 为空，从 content 合成「全文新增」diff，避免展开区空白。
    const fromDetails = asString(details?.patch) ?? asString(details?.diff) ?? null;
    const rawDiff = fromDetails ?? synthesizeChangeDiff(kind, args);
    const diffCapped = rawDiff ? capResultText(rawDiff) : null;
    const detailDiff = diffCapped?.text ?? null;
    // 有真实 diff 才按 diff 数 +/-；合成/估不出时走参数估算，估不出的一侧保持 null
    const stats =
      fromDetails && detailDiff && looksLikeUnifiedDiff(detailDiff)
        ? countDiffStats(detailDiff)
        : estimateChangeStatsFromArgs(kind, args);
    return {
      kind: "change",
      path: parsedArgs.path ?? parsedArgs.subject,
      mode: kind === "write" ? "write" : "edit",
      diff: detailDiff,
      additions: stats.additions,
      deletions: stats.deletions,
    };
  }

  if (kind === "search") {
    const parsed = parseSearchHits(text);
    return {
      kind: "search",
      pattern: parsedArgs.pattern ?? parsedArgs.subject,
      hits: parsed.hits,
      truncated: capped.truncated || parsed.truncated || details?.matchLimitReached != null,
    };
  }

  if (kind === "diff") {
    const rawDiff = asString(details?.diff) ?? asString(details?.patch) ?? text;
    const diffCapped = capResultText(rawDiff);
    const stats = countDiffStats(diffCapped.text);
    return {
      kind: "diff",
      path: parsedArgs.path ?? parsedArgs.subject,
      diff: diffCapped.text,
      additions: stats.additions,
      deletions: stats.deletions,
    };
  }

  return { kind: "generic", resultText: text, images };
}
